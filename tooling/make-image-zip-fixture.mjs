/** 批量图片导出固件：三页、原位隐藏页与退出动画终态必须同时可观察。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, label, makePng, nextShapeId, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const width = 320;
const height = 180;

function identifiedShape(id, color, name, x, y, w, h) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`;
}

const exitId = nextShapeId();
const keeperId = nextShapeId();
const timing = `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" nodeType="tmRoot"><p:childTnLst>
<p:seq><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" presetID="10" presetClass="exit" nodeType="clickEffect">
<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="4" dur="1" fill="hold"/><p:tgtEl><p:spTgt spid="${exitId}"/></p:tgtEl>
<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="hidden"/></p:to></p:set>
</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
const animated = slideXml(
  identifiedShape(exitId, 'E53935', 'export-exit', 0, 0, width, height)
    + identifiedShape(keeperId, '43A047', 'export-keeper', 0, 0, 2, 2),
  '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="43A047"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>',
).replace('</p:sld>', `${timing}</p:sld>`);
const hidden = slideXml(sp({
  x: 10, y: 10, w: 300, h: 160, fill: solid('ED7D31'), name: 'export-hidden',
  text: label('隐藏页仍保留原始页码', 1800, 'FFFFFF'),
}), '', 'show="0"');
const visible = slideXml(sp({
  x: 10, y: 10, w: 300, h: 160, fill: solid('2E75B6'), name: 'export-visible',
  text: label('slide-003.png', 1800, 'FFFFFF'),
}));

const bytes = deck({ name: 'Image Zip', width, height, slides: [animated, hidden, visible] });
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-image-zip.pptx'), bytes);
writeFileSync(join(root, 'fixtures/image-zip-external.png'), makePng(2, 2, () => [17, 34, 51]));
console.log(`fixtures/sample-image-zip.pptx 已生成（3 页，1 张隐藏页，${(bytes.length / 1024).toFixed(1)} KB）`);
