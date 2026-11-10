import { unzipSync } from 'fflate';
import { parse } from '@web-ppt/core';
import { createDoc, disposeDoc, Editor, queryLayout, queryMaster } from '@web-ppt/edit-core';
import { fillTemplate } from '@web-ppt/edit-core/fill';
import { createPptxFromTemplate } from '@web-ppt/edit-core/templates';
import { LAYOUT_CHECKS } from '@web-ppt/edit-core/lint';
import { createSvgContrastSampler } from '@web-ppt/edit-core/lint/sampler';
import { createTemplateFillOutline } from './template-fill-cases.mjs';

const families = ['Arial', 'Helvetica', 'Georgia', 'Aptos', 'Aptos Display', 'Calibri', 'Calibri Light', 'WebPPT Template Fill Latin'];

export { families, installFonts, measurement, rasterize };

function base64(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(text);
}

async function bytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`验收资源 ${url} 返回 HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function rasterize(svg, width, height, signal) {
  if (signal?.aborted) throw new DOMException('对比度取样已取消', 'AbortError');
  const image = new Image();
  let abort = () => {};
  try {
    await new Promise((resolve, reject) => {
      abort = () => {
        image.src = '';
        reject(new DOMException('对比度取样已取消', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      image.onload = resolve;
      image.onerror = () => reject(new Error('真实浏览器无法解码对比度 SVG'));
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    if (signal?.aborted) throw new DOMException('对比度取样已取消', 'AbortError');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('真实浏览器未提供对比度 Canvas');
      context.drawImage(image, 0, 0, width, height);
      return context.getImageData(0, 0, width, height).data;
    } finally {
      canvas.width = canvas.height = 0;
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    image.onload = image.onerror = null;
  }
}

/** 字体由验收调用方实际安装；库存只包含 FontFaceSet 中已加载的这些别名。 */
async function installFonts(check) {
  const regular = await bytes('/tooling/template-fill-fonts/regular.ttf');
  const bold = await bytes('/tooling/template-fill-fonts/bold.ttf');
  const installed = [];
  const embeddedFonts = [];
  try {
    for (const family of families)
      for (const [weight, data] of [
        ['400', regular],
        ['700', bold],
      ]) {
        const face = await new FontFace(family, data, { weight }).load();
        document.fonts.add(face);
        installed.push(face);
        check(face.status === 'loaded' && document.fonts.has(face), `${family}/${weight} 必须真实安装`);
        embeddedFonts.push({ family, src: `data:font/ttf;base64,${base64(data)}`, bold: weight === '700', italic: false });
      }
    await document.fonts.ready;
    return { embeddedFonts, release: () => installed.forEach((face) => document.fonts.delete(face)) };
  } catch (error) {
    installed.forEach((face) => document.fonts.delete(face));
    throw error;
  }
}

function measurement() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('真实浏览器未提供文字测量 Canvas');
  let calls = 0;
  return {
    measureText(text, run, scale) {
      const fonts = run.fonts.length ? run.fonts : ['Helvetica', 'Arial'];
      if (!fonts.some((font) => families.includes(font))) {
        throw new Error(`验收文字未匹配实际安装的字体资源：${fonts.join(', ')}`);
      }
      context.font = `${run.i ? 'italic ' : ''}${run.b ? '700 ' : '400 '}${run.size * scale * (run.baseline ? 0.65 : 1)}px ${fonts.map((font) => JSON.stringify(font)).join(',')}`;
      calls++;
      return context.measureText(text).width + (run.spacing ?? 0) * text.length;
    },
    get calls() {
      return calls;
    },
  };
}

const equalBytes = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);

function designParts(source, output) {
  const original = unzipSync(source),
    generated = unzipSync(output);
  const names = Object.keys(original)
    .filter((name) => name.endsWith('.xml') && (name.startsWith('ppt/slideMasters/') || name.startsWith('ppt/slideLayouts/')))
    .sort();
  return {
    names,
    retained: names.every((name) => generated[name]),
    changed: names.filter((name) => generated[name] && !equalBytes(original[name], generated[name])),
  };
}

async function designFingerprint(bytes) {
  const presentation = await parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const doc = createDoc(presentation, { idPrefix: 'design-proof-' });
  const editor = new Editor(doc);
  const visual = (element) => ({
    name: element.name,
    kind: element.kind,
    x: element.x,
    y: element.y,
    w: element.w,
    h: element.h,
    rot: element.rot,
    flipH: element.flipH,
    flipV: element.flipV,
    fill: element.fill,
    stroke: element.stroke,
    text: element.text?.paragraphs.map((paragraph) =>
      paragraph.runs.map((run) => ({
        text: run.text,
        color: run.color,
        size: run.size,
        bold: run.b,
        italic: run.i,
      })),
    ),
    children: element.children?.map(visual),
  });
  try {
    return JSON.stringify({
      masters: doc.masterOrder.map((id) => ({
        id,
        background: queryMaster(doc, { kind: 'master', id }).background.value,
        elements: doc.masters[id].children.map((child) => visual(editor.effectiveElement(child))),
      })),
      layouts: doc.layoutOrder.map((id) => ({
        id,
        background: queryLayout(doc, { kind: 'layout', id }).background.value,
        elements: doc.layouts[id].children.map((child) => visual(editor.effectiveElement(child))),
      })),
    });
  } finally {
    editor.dispose();
    disposeDoc(doc);
  }
}

export async function runTemplateFillBrowserContract(externalUrl) {
  let assertions = 0;
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    assertions++;
  };
  const fonts = await installFonts(check);
  try {
    const measured = measurement();
    let samples = 0;
    const sampler = createSvgContrastSampler({
      embeddedFonts: fonts.embeddedFonts,
      rasterize: (...args) => {
        samples++;
        return rasterize(...args);
      },
    });
    const lint = {
      checks: [...LAYOUT_CHECKS],
      measureText: measured.measureText,
      fonts: { available: [...families], embedded: [] },
      resolveContrast: sampler,
    };
    const outline = createTemplateFillOutline(base64(await bytes('/fixtures/agent-mcp-replacement.png')));
    const fixture = await bytes('/fixtures/sample-template-fill.pptx');
    const artifacts = {};
    const results = {};
    for (const [name, template] of [
      ['fixture', fixture],
      ...['editorial', 'aurora', 'midnight'].map((id) => [id, createPptxFromTemplate(id)]),
    ]) {
      const original = template.slice(),
        outlineBefore = JSON.stringify(outline);
      const originalDesign = await designFingerprint(original);
      let beforeRepair = null;
      if (name === 'aurora' || name === 'midnight') {
        const diagnostic = await fillTemplate(template, outline, { idPrefix: 'browser-fill-', lint, repair: false, requireClean: false });
        check(JSON.stringify(diagnostic.lint.checks) === JSON.stringify(LAYOUT_CHECKS), `${name} 关闭修复时仍须执行全部检查`);
        check(
          diagnostic.lint.issues.some((issue) => issue.reason === 'off-canvas'),
          `${name} 关闭修复必须保留原始出血问题`,
        );
        check(designParts(original, diagnostic.bytes).changed.length === 0, `${name} 关闭修复不能改变原始设计部件`);
        beforeRepair = diagnostic.lint;
      }
      let filled;
      try {
        filled = await fillTemplate(template, outline, { idPrefix: 'browser-fill-', lint, requireClean: true });
      } catch (error) {
        throw new Error(`${name} 严格填充失败：${error.reason}: ${error.message}；完整报告 ${JSON.stringify(error.lint)}`, {
          cause: error,
        });
      }
      check(filled.bytes instanceof Uint8Array && filled.bytes.length > 0, `${name} 必须生成实际 PPTX`);
      check(JSON.stringify(filled.lint.checks) === JSON.stringify(LAYOUT_CHECKS), `${name} 必须执行全部七项检查`);
      check(filled.lint.issues.length === 0, `${name} 七项检查必须零问题：${JSON.stringify(filled.lint.issues)}`);
      check(filled.description.totalSlides === outline.slides.length, `${name} 必须生成完整六类内容`);
      check(
        filled.description.slides.every((slide) =>
          slide.elements.some((element) => element.paragraphs.some((paragraph) => paragraph.text)),
        ),
        `${name} 每页必须保留实际文字`,
      );
      check(equalBytes(template, original), `${name} 填充不能修改调用方模板字节`);
      check(JSON.stringify(outline) === outlineBefore, `${name} 填充不能修改调用方大纲`);
      const design = designParts(original, filled.bytes);
      check(design.retained && design.names.length > 0, `${name} 必须保留原生母版与版式部件`);
      const generatedDesign = await designFingerprint(filled.bytes);
      if (name === 'aurora' || name === 'midnight') {
        check(design.changed.length > 0, `${name} 必须实际修改原生设计部件`);
        check(originalDesign !== generatedDesign, `${name} 必须真实修复母版/版式几何或颜色`);
        check(
          filled.description.slides.every((slide) =>
            slide.elements.every(
              (element) =>
                element.bounds.x >= -0.01
                && element.bounds.y >= -0.01
                && element.bounds.x + element.bounds.width <= filled.description.width + 0.01
                && element.bounds.y + element.bounds.height <= filled.description.height + 0.01,
            ),
          ),
          `${name} 独立 describe 坐标必须全部处于页面内`,
        );
      }
      artifacts[name] = { base64: base64(filled.bytes), byteLength: filled.bytes.length };
      results[name] = {
        description: filled.description,
        lint: filled.lint,
        bindings: filled.bindings,
        beforeRepair,
        design: { ...design, originalVisual: JSON.parse(originalDesign), generatedVisual: JSON.parse(generatedDesign) },
      };
    }
    const longText = 'W'.repeat(12000);
    const overflowing = { version: 1, slides: [{ type: 'content', title: 'Content boundary', body: [{ text: longText }] }] };
    const diagnostic = await fillTemplate(fixture, overflowing, { lint, requireClean: false });
    check(
      diagnostic.lint.issues.some((issue) => issue.reason === 'text-overflow'),
      '无法在正常缩放下容纳的正文必须保留真实溢出报告',
    );
    check(
      diagnostic.description.slides[0].elements.some((element) => element.paragraphs.some((paragraph) => paragraph.text === longText)),
      '诊断模式不能截断正文以伪造布局成功',
    );
    try {
      await fillTemplate(fixture, overflowing, { lint, requireClean: true });
      check(false, '严格模式不能接受仍有真实内容溢出的产物');
    } catch (error) {
      check(
        error.reason === 'layout-invalid' && error.lint?.issues.some((issue) => issue.reason === 'text-overflow'),
        `严格内容溢出必须拒绝并保留完整报告：${error.reason}`,
      );
    }
    check(measured.calls > 0, '填充与 lint 必须使用真实 Canvas 字宽');
    check(samples > 0, '复杂前景/背景必须使用真实 SVG 像素取样');
    const beforeAbort = new AbortController();
    beforeAbort.abort();
    try {
      await fillTemplate(fixture, outline, { lint, signal: beforeAbort.signal });
      check(false, '已取消填充不能返回成功结果');
    } catch (error) {
      check(error.reason === 'aborted', `取消必须返回 aborted：${error.reason}`);
    }
    const businessAssertions = assertions;
    let external = null;
    if (externalUrl) {
      const template = await bytes(externalUrl),
        original = template.slice(),
        outlineBefore = JSON.stringify(outline);
      const before = await designFingerprint(original);
      const diagnostic = await fillTemplate(template, outline, { idPrefix: 'external-fill-', lint, repair: false, requireClean: false });
      const filled = await fillTemplate(template, outline, { idPrefix: 'external-fill-', lint, requireClean: true });
      const after = await designFingerprint(filled.bytes);
      const design = designParts(original, filled.bytes);
      if (!equalBytes(template, original) || JSON.stringify(outline) !== outlineBefore) throw new Error('外部填充不能修改调用方输入');
      if (filled.lint.issues.length || JSON.stringify(filled.lint.checks) !== JSON.stringify(LAYOUT_CHECKS))
        throw new Error('外部模板必须执行七项检查且零问题');
      if (!design.retained || !design.changed.length || before === after) throw new Error('外部模板必须保留并真实修复原生设计');
      if (designParts(original, diagnostic.bytes).changed.length || !diagnostic.lint.issues.length)
        throw new Error('外部模板关闭修复时必须保留原始设计和完整问题');
      external = {
        issues: filled.lint.issues,
        checks: filled.lint.checks,
        description: filled.description,
        beforeRepair: diagnostic.lint,
        design: { ...design, originalVisual: JSON.parse(before), generatedVisual: JSON.parse(after) },
      };
      artifacts.external = { base64: base64(filled.bytes), byteLength: filled.bytes.length };
    }
    return {
      ok: true,
      assertions,
      businessAssertions,
      checks: [...LAYOUT_CHECKS],
      installedFontAliases: families,
      callerFontResources: ['tooling/template-fill-fonts/regular.ttf', 'tooling/template-fill-fonts/bold.ttf'],
      measurementCalls: measured.calls,
      rasterizationCalls: samples,
      results,
      contentBoundary: { length: longText.length, lint: diagnostic.lint },
      external,
      artifacts,
    };
  } finally {
    fonts.release();
  }
}
