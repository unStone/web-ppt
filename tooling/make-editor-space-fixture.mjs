/** 多层旋转/翻转不能靠简单命中固件代表；独立坐标固件让矩阵语义可稳定取证。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plain = sp({
  x: 80, y: 80, w: 180, h: 120, fill: solid('accent1'), name: 'space-plain',
});
const flipped = sp({
  x: 360, y: 80, w: 200, h: 140, rot: 1500000, flipH: true,
  fill: solid('accent3'), name: 'space-rotated-flipped',
});
const rotated45 = sp({
  x: 80, y: 410, w: 200, h: 140, rot: 2700000,
  fill: solid('accent4'), name: 'space-rotated-45',
});
const leaf = sp({
  x: 30, y: 20, w: 140, h: 80, rot: 900000, flipV: true,
  fill: solid('accent5'), name: 'space-nested-leaf',
});
const inner = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="501" name="space-inner-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="-600000" flipH="1"><a:off x="${px(50)}" y="${px(40)}"/>
<a:ext cx="${px(280)}" cy="${px(160)}"/><a:chOff x="${px(10)}" y="${px(20)}"/>
<a:chExt cx="${px(140)}" cy="${px(80)}"/></a:xfrm></p:grpSpPr>
${leaf}
</p:grpSp>`;
const outerSibling = sp({
  x: 170, y: 35, w: 50, h: 55, rot: 1800000,
  fill: solid('accent2'), name: 'space-outer-sibling',
});
const outer = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="502" name="space-outer-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="1200000" flipV="1"><a:off x="${px(700)}" y="${px(330)}"/>
<a:ext cx="${px(420)}" cy="${px(260)}"/><a:chOff x="${px(20)}" y="${px(10)}"/>
<a:chExt cx="${px(210)}" cy="${px(130)}"/></a:xfrm></p:grpSpPr>
${inner}
${outerSibling}
</p:grpSp>`;

const bytes = deck({
  name: 'Editor Space', width: 1280, height: 720,
  slides: [slideXml(plain + flipped + rotated45 + outer)],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-space.pptx'), bytes);
console.log(`fixtures/sample-editor-space.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
