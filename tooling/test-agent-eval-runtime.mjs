import assert from 'node:assert/strict';
import { parse, readImageMetadata } from '@web-ppt/core';
import { renderSlidePngInNode } from '@web-ppt/core/node';
import { createDoc, disposeDoc } from '@web-ppt/edit-core';
import { LAYOUT_CHECKS, lintPresentation } from '@web-ppt/edit-core/lint';
import { deck, slideXml, sp } from './lib/ooxml.mjs';
const { createRuntime } = await import(process.env.AGENT_EVAL_RUNTIME_MODULE ?? new URL('./agent-eval/runtime.mjs', import.meta.url).href);

const family = 'WebPPT Template Fill Latin';
const runtime = createRuntime();
const run = { text: '', b: false, i: false, u: false, strike: false, size: 24, color: '#111111', fonts: [family] };
assert.equal(createRuntime(), runtime, '运行时字体由同一进程持有');
assert.equal(runtime.manifest.fontFamily, family);
assert.equal(runtime.manifest.fontSelection, 'preferred-family-with-complete-glyph-coverage');
assert.equal(runtime.manifest.contrast, 'solid-backgrounds-only');
assert.equal(runtime.manifest.files.length, 3);
assert.deepEqual(runtime.lint.checks, LAYOUT_CHECKS);
assert.deepEqual(runtime.lint.fonts, { available: [family], embedded: [] });
const width = (text) => runtime.measureText(text, run, 1);
assert(width('WWW') > width('iii') * 2, '真实字形宽度不能退化为按字数估算');
assert(width('AV') < width('A') + width('V'), '真实 HarfBuzz 字偶调整必须有效');
assert(Math.abs(runtime.measureText('AV', run, 2) - width('AV') * 2) < 1e-8);
assert.equal(width(''), 0);
assert(runtime.measureText('Bold', { ...run, b: true }, 1) > 0);
for (const fonts of [[], ['Arial'], ['Unavailable Family', family]]) {
  assert.throws(() => runtime.measureText('A', { ...run, fonts }, 1), /字体/);
}
assert.equal(runtime.measureText('AV', { ...run, fonts: [family, 'Unavailable Family'] }, 1), width('AV'));
assert.throws(() => runtime.measureText('A', { ...run, i: true }, 1), /斜体/);
assert.throws(() => width('中文'), /缺少字形/);
for (const size of [0, -1, NaN, Infinity]) {
  assert.throws(() => runtime.measureText('A', { ...run, size }, 1), /字号/);
}
for (const scale of [0, -1, NaN, Infinity]) {
  assert.throws(() => runtime.measureText('A', run, scale), /比例/);
}
assert.throws(() => runtime.measureText('A', { ...run, spacing: Infinity }, 1), /字间距/);

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" viewBox="0 0 80 40"><rect width="80" height="40" fill="#e53935"/></svg>';
const png = await runtime.rasterize(svg, { width: 160, height: 80 });
assert(png instanceof Uint8Array && png.length > 0);
const metadata = readImageMetadata(png);
assert.equal(metadata.width, 160);
assert.equal(metadata.height, 80);
for (const size of [
  { width: 0, height: 10 },
  { width: 1.5, height: 10 },
  { width: 100000, height: 100000 },
]) {
  await assert.rejects(() => runtime.rasterize(svg, size), /像素尺寸/);
}
await assert.rejects(() => runtime.rasterize(svg, { width: 160, height: 79 }), /实际尺寸/);
const signal = AbortSignal.abort();
await assert.rejects(() => runtime.rasterize(svg, { width: 80, height: 40, signal }), /取消/);

const gradient =
  '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="F0F0F0"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>';
function testDeck(fill, tailFamily = family) {
  const text = `<a:p><a:pPr/><a:r><a:rPr sz="2400"><a:solidFill><a:srgbClr val="111111"/></a:solidFill><a:latin typeface="${family}"/><a:ea typeface="${tailFamily}"/><a:cs typeface="${family}"/></a:rPr><a:t>Actual glyph sampling</a:t></a:r></a:p>`;
  return deck({
    width: 640,
    height: 360,
    slides: [
      slideXml(
        sp({ x: 30, y: 30, w: 500, h: 100, name: 'Contrast test', fill, text, bodyPr: '<a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/>' }),
        '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>',
      ),
    ],
  });
}
for (const mode of ['solid', 'missing-tail', 'complex']) {
  const fill = mode === 'complex' ? gradient : '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>';
  const presentation = await parse(testDeck(fill, mode === 'missing-tail' ? 'Unavailable Family' : family), {
    edit: true,
    keepPackage: true,
    lazy: false,
  });
  const doc = createDoc(presentation, { idPrefix: 'runtime-test-' });
  try {
    const lint = () => lintPresentation(doc, { ...runtime.lint, measureText: runtime.measureText });
    if (mode === 'complex') {
      await assert.rejects(
        lint,
        (error) => error.reason === 'eval-contrast-background-unsupported',
        '复杂背景不得退回没有真实 measureText 注入的采样排版',
      );
    } else {
      const report = await lint();
      assert.deepEqual(report.checks, LAYOUT_CHECKS);
      if (mode === 'missing-tail') {
        assert(
          report.issues.some((issue) => issue.reason === 'missing-font' && issue.measurements.families.includes('Unavailable Family')),
          '备用字体不在真实库存时仍必须报告，不得为通过检查扩大库存',
        );
      } else {
        assert.deepEqual(report.issues, []);
        let measures = 0;
        const image = await renderSlidePngInNode(presentation, presentation.slides[0], {
          scale: 1,
          measureText: (...args) => {
            measures++;
            return runtime.measureText(...args);
          },
          rasterize: runtime.rasterize,
        });
        assert(measures > 0, '真实 Node SVG 构建必须使用已注入的 HarfBuzz 测量');
        const dimensions = readImageMetadata(image);
        assert.equal(dimensions.width, 640);
        assert.equal(dimensions.height, 360);
      }
    }
  } finally {
    disposeDoc(doc);
    presentation.dispose();
  }
}
console.log('Agent 评测运行时：真实字形、首选字体与完整库存、PNG、实色七项和复杂背景拒绝通过');
