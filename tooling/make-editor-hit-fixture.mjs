/** 命中语义依赖真实 SVG 几何；固定坐标避免测试退化成人工改 DOM。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const line = '<a:ln w="114300"><a:solidFill><a:srgbClr val="7C3AED"/></a:solidFill></a:ln>';

const solidShape = sp({
  x: 80, y: 100, w: 220, h: 140, fill: solid('accent1'), name: 'hit-solid',
});
const outlineShape = sp({
  x: 360, y: 100, w: 220, h: 140, fill: '<a:noFill/>', ln: line, name: 'hit-outline',
});
const overlapLower = sp({
  x: 700, y: 100, w: 220, h: 160, fill: solid('accent2'), name: 'hit-overlap-lower',
});
const overlapUpper = sp({
  x: 780, y: 150, w: 220, h: 160, fill: solid('accent3'), name: 'hit-overlap-upper',
});
const nestedLeaf = sp({
  x: 20, y: 20, w: 200, h: 100, fill: solid('accent5'), name: 'hit-nested-leaf',
});
const innerGroup = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="401" name="hit-inner-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(50)}" y="${px(40)}"/><a:ext cx="${px(300)}" cy="${px(150)}"/>
<a:chOff x="0" y="0"/><a:chExt cx="${px(300)}" cy="${px(150)}"/></a:xfrm></p:grpSpPr>
${nestedLeaf}
</p:grpSp>`;
const outerGroup = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="402" name="hit-outer-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(80)}" y="${px(360)}"/><a:ext cx="${px(500)}" cy="${px(240)}"/>
<a:chOff x="0" y="0"/><a:chExt cx="${px(500)}" cy="${px(240)}"/></a:xfrm></p:grpSpPr>
${innerGroup}
</p:grpSp>`;

const bytes = deck({
  name: 'Editor Hit', width: 1280, height: 720,
  slides: [slideXml(solidShape + outlineShape + overlapLower + overlapUpper + outerGroup)],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-hit.pptx'), bytes);
console.log(`fixtures/sample-editor-hit.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
