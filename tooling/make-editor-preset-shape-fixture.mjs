/** 预设形状编辑固件：XY、极坐标、多手柄、无手柄和自由形状共存，负载固定且可重复。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, label, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hyperlinkRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const line = '<a:ln w="19050"><a:solidFill><a:srgbClr val="17365D"/></a:solidFill></a:ln>';
const effect = '<a:effectLst><a:outerShdw blurRad="38100" dist="19050" dir="2700000">'
  + '<a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst>';

const source = sp({
  x: 70, y: 80, w: 260, h: 150, prst: 'roundRect',
  avLst: '<a:gd name="adj" fmla="val 26000"/>',
  fill: solid('accent1'), ln: line, effect, name: 'preset-source',
  text: label('保留文字与格式', 1800, 'FFFFFF'), rot: 600000,
}).replace(
  '<p:cNvPr id="101" name="preset-source"/>',
  '<p:cNvPr id="101" name="preset-source"><a:hlinkClick r:id="rIdPresetLink"/></p:cNvPr>',
);

const polar = sp({
  x: 390, y: 70, w: 220, h: 170, prst: 'arc', name: 'preset-polar',
  avLst: '<a:gd name="adj1" fmla="val 1800000"/><a:gd name="adj2" fmla="val 12600000"/>',
  fill: '<a:noFill/>', ln: line,
});
const multi = sp({
  x: 670, y: 65, w: 240, h: 180, prst: 'blockArc', name: 'preset-multi',
  avLst: '<a:gd name="adj1" fmla="val 9000000"/><a:gd name="adj2" fmla="val 1800000"/>'
    + '<a:gd name="adj3" fmla="val 22000"/>',
  fill: solid('accent4'), ln: line,
});
const noHandle = sp({
  x: 970, y: 90, w: 190, h: 130, prst: 'rect', name: 'preset-no-handle',
  fill: solid('accent3'), ln: line,
});
const custom = `<p:sp>
<p:nvSpPr><p:cNvPr id="900" name="preset-custom"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(70)}" y="${px(300)}"/><a:ext cx="${px(260)}" cy="${px(150)}"/></a:xfrm>
<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/>
<a:pathLst><a:path w="260000" h="150000"><a:moveTo><a:pt x="0" y="150000"/></a:moveTo>
<a:lnTo><a:pt x="130000" y="0"/></a:lnTo><a:lnTo><a:pt x="260000" y="150000"/></a:lnTo>
<a:close/></a:path></a:pathLst></a:custGeom>${solid('accent2')}${line}</p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>${label('自由形状', 1600, 'FFFFFF')}</p:txBody></p:sp>`;

const load = Array.from({ length: 56 }, (_, index) => sp({
  x: 390 + index % 8 * 100, y: 300 + Math.floor(index / 8) * 52,
  w: 78, h: 34, prst: index % 3 === 0 ? 'roundRect' : index % 3 === 1 ? 'ellipse' : 'hexagon',
  name: `preset-load-${index + 1}`, fill: solid(index % 2 ? 'accent5' : 'accent6'),
})).join('');

const bytes = deck({
  name: 'Editor Preset Shape', width: 1280, height: 720,
  slides: [slideXml(source + polar + multi + noHandle + custom + load)],
  slideRelationships: [
    `<Relationship Id="rIdPresetLink" Type="${hyperlinkRel}" Target="https://example.com/preset" TargetMode="External"/>`,
  ],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-preset-shape.pptx'), bytes);
console.log(`fixtures/sample-editor-preset-shape.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
