/** 生成文字框属性固件：本层直设、版式/母版继承、方向、分栏与 autofit 互斥组。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, nextShapeId, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = (value) => `<a:p><a:r><a:rPr sz="1800"/><a:t>${value}</a:t></a:r></a:p>`;
const placeholder = ({ name, bodyPr, source }) => `<p:sp>
<p:nvSpPr><p:cNvPr id="${nextShapeId()}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(55)}" y="${px(55)}"/><a:ext cx="${px(410)}" cy="${px(235)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solid('E0F2FE')}</p:spPr>
<p:txBody>${bodyPr}<a:lstStyle/>${text(source)}</p:txBody>
</p:sp>`;

const masterPlaceholder = placeholder({
  name: '母版文字框属性', source: '母版',
  bodyPr: `<a:bodyPr anchor="b" wrap="none" vert="vert270" anchorCtr="1" numCol="3" spcCol="${px(12)}"
    tIns="${px(11)}" rIns="${px(12)}" bIns="${px(13)}" lIns="${px(14)}"><a:noAutofit/></a:bodyPr>`,
});
const layoutPlaceholder = placeholder({
  name: '版式文字框属性', source: '版式',
  bodyPr: `<a:bodyPr anchor="ctr" tIns="${px(21)}" rIns="${px(22)}"><a:normAutofit/></a:bodyPr>`,
});
const slidePlaceholder = placeholder({
  name: '继承文字框属性', source: '继承与清除必须可见',
  bodyPr: `<a:bodyPr anchor="t" wrap="square" vert="horz" anchorCtr="0" numCol="2" spcCol="${px(18)}"
    tIns="${px(5)}" rIns="${px(6)}" bIns="${px(7)}" lIns="${px(8)}">
    <?body-props keep="yes"?><!--body-props:keep-->
    <a:prstTxWarp prst="textWave1"><a:avLst><a:gd name="adj" fmla="val 70000"/></a:avLst></a:prstTxWarp>
    <a:spAutoFit/>
    <a:extLst><a:ext uri="urn:web-ppt:body-props"><x:keep xmlns:x="urn:web-ppt:test" value="yes"/></a:ext></a:extLst>
  </a:bodyPr>`,
});

const directions = [
  ['文字方向-水平', 'horz', 520, 55],
  ['文字方向-竖排', 'vert', 700, 55],
  ['文字方向-反向竖排', 'vert270', 880, 55],
  ['文字方向-逐字竖排', 'wordArtVert', 1060, 55],
].map(([name, vert, x, y]) => sp({
  x, y, w: 150, h: 235, name, fill: solid('F5F3FF'),
  bodyPr: `<a:bodyPr vert="${vert}" anchor="ctr" wrap="square"><a:noAutofit/></a:bodyPr>`,
  text: text(name),
})).join('');
const modes = [
  ['自动适应-无', '<a:noAutofit/>', 55],
  ['自动适应-缩小', '<a:normAutofit fontScale="82000"/>', 325],
  ['自动适应-改高', '<a:spAutoFit/>', 595],
].map(([name, mode, x]) => sp({
  x, y: 350, w: 240, h: 75, name, fill: solid('ECFDF5'),
  bodyPr: `<a:bodyPr wrap="square" anchor="t">${mode}</a:bodyPr>`, text: text(`${name} ${'内容'.repeat(20)}`),
})).join('');
const empty = sp({
  x: 865, y: 350, w: 260, h: 75, name: '空文字框属性', fill: solid('FFF7ED'),
  bodyPr: '<a:bodyPr wrap="none" anchor="b"/>',
});
const columns = sp({
  x: 55, y: 480, w: 600, h: 170, name: '分栏与锚点', fill: solid('FEF3C7'),
  bodyPr: '<a:bodyPr wrap="square" anchor="t"><a:noAutofit/></a:bodyPr>',
  text: text(`分栏布局验证 ${'甲乙丙丁'.repeat(18)}`),
});

const bytes = deck({
  name: 'Editor Body Properties', width: 1280, height: 720,
  masterShapes: masterPlaceholder,
  layoutShapes: layoutPlaceholder,
  slides: [slideXml(slidePlaceholder + directions + modes + empty + columns)],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-body-props.pptx'), bytes);
console.log(`fixtures/sample-editor-body-props.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
