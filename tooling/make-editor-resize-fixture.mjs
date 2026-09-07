import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { deck, nextShapeId, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const text = '<a:p><a:pPr marL="95250" indent="-19050"><a:lnSpc><a:spcPts val="3600"/></a:lnSpc><a:spcBef><a:spcPts val="600"/></a:spcBef></a:pPr>'
  + '<a:r><a:rPr sz="2400" spc="150"><a:latin typeface="Arial"/></a:rPr><a:t>按比例缩放 Scale</a:t></a:r>'
  + '<a:r><a:rPr sz="1200" b="1"/><a:t>不同字号</a:t></a:r></a:p>';
const shape = (name, x, y, w = 240, h = 100) => sp({ name, x, y, w, h, text,
  fill: solid('4285F4'), ln: '<a:ln w="38100"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:ln>',
  effect: '<a:effectLst><a:outerShdw blurRad="38100" dist="57150" dir="0"><a:srgbClr val="000000"/></a:outerShdw></a:effectLst>',
  bodyPr: '<a:bodyPr lIns="95250" rIns="95250" tIns="38100" bIns="38100" wrap="square"/>',
});
const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${nextShapeId()}" name="scaled-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="900000"><a:off x="${px(600)}" y="${px(200)}"/><a:ext cx="${px(300)}" cy="${px(200)}"/>
<a:chOff x="0" y="0"/><a:chExt cx="${px(600)}" cy="${px(400)}"/></a:xfrm></p:grpSpPr>
${shape('nested-text', 20, 30)}</p:grpSp>`;
const tableParts = unzipSync(readFileSync(new URL('../fixtures/sample-editor-table-structure.pptx', import.meta.url)));
const bytes = deck({ name: 'Ensure Fit', width: 1280, height: 720,
  masterShapes: shape('master-scale', 950, 20), layoutShapes: shape('layout-scale', 30, 560),
  slides: [slideXml(shape('scale-text', 80, 70) + group), strFromU8(tableParts['ppt/slides/slide1.xml'])],
});
writeFileSync(new URL('../fixtures/sample-editor-resize.pptx', import.meta.url), bytes);
console.log(`页面适配固件：${bytes.length} 字节`);
