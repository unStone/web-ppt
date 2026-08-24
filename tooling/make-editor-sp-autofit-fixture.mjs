/** 生成 spAutoFit 编辑固件：锚点、旋转、翻转、组、分栏与竖排必须共用同一套改高语义。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, nextShapeId, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = (value, size = 1800) => `<a:p><a:r><a:rPr sz="${size}"/><a:t>${value}</a:t></a:r></a:p>`;
const body = (anchor, extra = '') => `<a:bodyPr wrap="square" anchor="${anchor}"${extra} lIns="${px(6)}" rIns="${px(6)}" tIns="${px(4)}" bIns="${px(4)}"><a:spAutoFit/></a:bodyPr>`;
const fill = solid('EFF6FF');

const anchors = [
  sp({ x: 45, y: 70, w: 210, h: 44, name: 'sp-autofit-top', fill,
    bodyPr: body('t'), text: text('顶部锚点') }),
  sp({ x: 285, y: 70, w: 210, h: 44, name: 'sp-autofit-middle', fill,
    bodyPr: body('ctr'), text: text('居中锚点') }),
  sp({ x: 525, y: 70, w: 210, h: 44, name: 'sp-autofit-bottom', fill,
    bodyPr: body('b'), text: text('底部锚点') }),
  sp({ x: 805, y: 70, w: 210, h: 44, rot: 5400000, name: 'sp-autofit-rotated', fill: solid('D9EAF7'),
    bodyPr: body('t'), text: text('旋转锚点') }),
  sp({ x: 1060, y: 70, w: 170, h: 44, flipV: true, name: 'sp-autofit-flipped', fill,
    bodyPr: body('t'), text: text('翻转锚点') }),
  sp({ x: 45, y: 330, w: 260, h: 44, name: 'sp-autofit-disabled', fill: solid('F3F4F6'),
    bodyPr: '<a:bodyPr wrap="square" anchor="t"/>', text: text('普通文本框') }),
].join('');

const nestedChild = sp({
  x: 40, y: 35, w: 280, h: 44, name: 'sp-autofit-nested', fill: solid('ECFDF5'),
  bodyPr: body('b'), text: text('组内底部锚点'),
});
const nested = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="${nextShapeId()}" name="sp-autofit-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="1200000"><a:off x="${px(70)}" y="${px(70)}"/><a:ext cx="${px(440)}" cy="${px(240)}"/><a:chOff x="0" y="0"/><a:chExt cx="${px(440)}" cy="${px(240)}"/></a:xfrm></p:grpSpPr>
${nestedChild}
</p:grpSp>`;

const columns = sp({
  x: 570, y: 80, w: 330, h: 44, name: 'sp-autofit-columns', fill: solid('FFF7ED'),
  bodyPr: body('ctr', ` numCol="2" spcCol="${px(16)}"`), text: text('双栏文字'),
});
const vertical = sp({
  x: 980, y: 80, w: 95, h: 70, name: 'sp-autofit-vertical', fill: solid('F5F3FF'),
  bodyPr: body('t', ' vert="vert"'), text: text('竖排'),
});

const bytes = deck({
  name: 'Editor Shape Autofit', width: 1280, height: 720,
  slides: [slideXml(anchors), slideXml(nested + columns + vertical)],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-sp-autofit.pptx'), bytes);
console.log(`fixtures/sample-editor-sp-autofit.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
