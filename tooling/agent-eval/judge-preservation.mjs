import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { scalePathData } from '@web-ppt/core';
import { effectiveElement, queryElementPresetGeometry, sourceAsset, toSlide } from '@web-ppt/edit-core';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

function stripMetadata(value) {
  if (Array.isArray(value)) return value.map(stripMetadata);
  if (!value || typeof value !== 'object') return Object.is(value, -0) ? 0 : value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'editInfo')
    .map(([key, child]) => [key, stripMetadata(child)]));
}

function textSignature(body, title) {
  if (!body) return null;
  // normal autofit 是真实字号调整；形状增高与压行不属于允许的字号修复。
  const fixed = omit(stripMetadata(body), ['paragraphs', 'fontScale', 'autoFitNormal', 'autoFitCompute']);
  fixed.lnSpcReduction = body.lnSpcReduction ?? 0;
  return { ...fixed, paragraphs: body.paragraphs.map(paragraph => {
    const runs = [];
    for (const run of paragraph.runs) {
      const style = omit(stripMetadata(run), ['text', 'size', 'fonts', 'color']);
      const text = title ? '' : run.text;
      const previous = runs.at(-1);
      if (previous && isDeepStrictEqual(previous.style, style)) previous.text += text;
      else runs.push({ text, style });
    }
    return { ...omit(stripMetadata(paragraph), ['runs']), runs };
  }) };
}

function normalizedPath(path, element) {
  return path ? scalePathData(path, 1 / element.w, 1 / element.h) : path ?? null;
}

function imageResource(doc, source, strict, failures, id) {
  const asset = sourceAsset(doc, source.src);
  if (!asset?.bytes?.length || typeof asset.mime !== 'string' || !asset.mime) {
    if (strict) throw new Error(`评测输入 ${id} 缺少实际引用的图片字节`);
    failures.push({ reason: 'image-content-changed', elementId: id,
      message: `输出 ${id} 未引用可读取的真实图片资源` });
    return null;
  }
  return { sha256: hash(asset.bytes), mime: asset.mime };
}

function elementSignature(doc, id, titleId, strict, failures) {
  const source = effectiveElement(doc, id);
  const result = omit(stripMetadata(source), ['x', 'y', 'w', 'h', 'text', 'src', 'path', 'clipPath']);
  if (source.kind === 'shape') {
    result.path = normalizedPath(source.path, source);
    result.preset = queryElementPresetGeometry(doc, [id]).value;
    result.text = textSignature(source.text, id === titleId);
  } else if (source.kind === 'image') {
    result.src = imageResource(doc, source, strict, failures, id);
    result.crop = Object.fromEntries(['l', 't', 'r', 'b'].map(key => [key, source.crop?.[key] ?? 0]));
    result.clipPath = normalizedPath(source.clipPath, source);
  }
  return result;
}

export function checkPreservation({ input, output, before, after, titleId, task, failures }) {
  if (!isDeepStrictEqual(omit(before, ['slides', 'truncation']), omit(after, ['slides', 'truncation']))) {
    failures.push({ reason: 'document-structure-changed', message: '页面尺寸、来源、页数或元素总数改变' });
  }
  const baselineItems = before.slides.flatMap(slide => slide.elements);
  const finalItems = after.slides.flatMap(slide => slide.elements);
  if (!isDeepStrictEqual(baselineItems.map(item => item.id), finalItems.map(item => item.id))) {
    failures.push({ reason: 'element-structure-changed', message: '元素身份、数量或绘制次序改变' });
  }
  if (!isDeepStrictEqual(input.slideOrder, output.slideOrder)) {
    failures.push({ reason: 'document-structure-changed', message: '页面身份或页序改变' });
  }
  for (let index = 0; index < before.slides.length; index++) {
    const a = before.slides[index], b = after.slides[index];
    if (!b) continue;
    if (b.hidden !== a.hidden || b.hidden) failures.push({ reason: 'visibility-changed',
      slideNumber: index + 1, message: '原页面必须保持可见' });
    if (!isDeepStrictEqual(omit(a, ['elements']), omit(b, ['elements']))) {
      failures.push({ reason: 'slide-content-changed', slideNumber: index + 1,
        message: '页属性、版式、母版、章节或备注改变' });
    }
    const sourceSlide = toSlide(input, a.id), finalSlide = toSlide(output, b.id);
    if (!isDeepStrictEqual(stripMetadata(omit(sourceSlide, ['elements'])), stripMetadata(omit(finalSlide, ['elements'])))) {
      failures.push({ reason: 'slide-content-changed', slideNumber: index + 1,
        message: '页面背景、转场、动画或其他非元素属性改变' });
    }
  }
  const byId = new Map(finalItems.map(item => [item.id, item]));
  for (const original of baselineItems) {
    const candidate = byId.get(original.id);
    if (!candidate || !output.elements[original.id]) continue;
    if (candidate.hidden !== original.hidden || candidate.hidden) {
      failures.push({ reason: 'visibility-changed', elementId: original.id, message: '原对象必须保持可见' });
    }
    if (!isDeepStrictEqual(omit(original, ['bounds', 'paragraphs', 'hidden']), omit(candidate, ['bounds', 'paragraphs', 'hidden']))) {
      failures.push({ reason: 'element-identity-changed', elementId: original.id,
        message: '对象类型、名称、父子身份、占位身份、锁定或替代文字改变' });
    }
    const expectedText = original.id === titleId ? task.expectedTitle
      : original.paragraphs.map(paragraph => paragraph.text).join('\n');
    const actualText = candidate.paragraphs.map(paragraph => paragraph.text).join('\n');
    if (actualText !== expectedText) {
      failures.push({ reason: original.id === titleId ? 'title-mismatch' : 'text-content-changed',
        elementId: original.id, message: `对象 ${original.name} 完整正文不符`, expected: expectedText, actual: actualText });
    }
    const element = effectiveElement(output, original.id);
    if (![element.x, element.y, element.w, element.h].every(Number.isFinite) || element.w <= 0 || element.h <= 0) {
      failures.push({ reason: 'invalid-geometry', elementId: original.id, message: '对象必须保持正有限尺寸' });
      continue;
    }
    const originalSignature = elementSignature(input, original.id, titleId, true, failures);
    const finalSignature = elementSignature(output, original.id, titleId, false, failures);
    if (!isDeepStrictEqual(originalSignature, finalSignature)) {
      const reason = original.kind === 'image' ? 'image-content-changed' : 'protected-format-changed';
      failures.push({ reason, elementId: original.id,
        message: '位置、尺寸、字号、字体和前景色以外的原始语义或格式改变' });
    }
    if (element.kind === 'image') {
      const source = effectiveElement(input, original.id);
      if (element.w * element.h + .00001 < source.w * source.h * .5) {
        failures.push({ reason: 'image-too-small', elementId: original.id,
          message: '图片显示面积不得小于原图框面积的一半' });
      }
    }
  }
}
