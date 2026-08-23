/** SetXfrm 写回固件：异名前缀、组内坐标、frame 与缺失显式 xfrm 的占位符。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makeZip, NS, px, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nv = `<q:nvGrpSpPr><q:cNvPr id="1" name=""/><q:cNvGrpSpPr/><q:nvPr/></q:nvGrpSpPr>
<q:grpSpPr><d:xfrm><d:off x="0" y="0"/><d:ext cx="0" cy="0"/><d:chOff x="0" y="0"/><d:chExt cx="0" cy="0"/></d:xfrm></q:grpSpPr>`;
const shape = `<q:sp><q:nvSpPr><q:cNvPr id="41" name="异名前缀形状"/><q:cNvSpPr/><q:nvPr/></q:nvSpPr>
<q:spPr><d:xfrm><d:off x="${px(80)}" y="${px(90)}"/><d:ext cx="${px(240)}" cy="${px(130)}"/></d:xfrm><d:prstGeom prst="rect"><d:avLst/></d:prstGeom><d:solidFill><d:srgbClr val="4472C4"/></d:solidFill></q:spPr>
<q:txBody><d:bodyPr/><d:lstStyle/><d:p><d:r><d:t>shape</d:t></d:r></d:p></q:txBody></q:sp>`;
const child = `<q:sp><q:nvSpPr><q:cNvPr id="43" name="组内形状"/><q:cNvSpPr/><q:nvPr/></q:nvSpPr>
<q:spPr><d:xfrm><d:off x="${px(25)}" y="${px(35)}"/><d:ext cx="${px(120)}" cy="${px(70)}"/></d:xfrm><d:prstGeom prst="ellipse"><d:avLst/></d:prstGeom></q:spPr>
<q:txBody><d:bodyPr/><d:lstStyle/><d:p><d:endParaRPr/></d:p></q:txBody></q:sp>`;
const group = `<q:grpSp><q:nvGrpSpPr><q:cNvPr id="42" name="坐标组"/><q:cNvGrpSpPr/><q:nvPr/></q:nvGrpSpPr>
<q:grpSpPr><d:xfrm rot="600000"><d:off x="${px(390)}" y="${px(90)}"/><d:ext cx="${px(320)}" cy="${px(190)}"/><d:chOff x="${px(10)}" y="${px(20)}"/><d:chExt cx="${px(160)}" cy="${px(95)}"/></d:xfrm></q:grpSpPr>${child}</q:grpSp>`;
const frame = `<q:graphicFrame><q:nvGraphicFramePr><q:cNvPr id="44" name="框架对象"/><q:cNvGraphicFramePr/><q:nvPr/></q:nvGraphicFramePr>
<q:xfrm><d:off x="${px(760)}" y="${px(100)}"/><d:ext cx="${px(330)}" cy="${px(210)}"/></q:xfrm>
<d:graphic><d:graphicData uri="urn:web-ppt:xfrm"><opaque:item xmlns:opaque="urn:web-ppt:opaque" keep="yes"/></d:graphicData></d:graphic></q:graphicFrame>`;
const placeholder = `<q:sp><q:nvSpPr><q:cNvPr id="45" name="继承占位符"/><q:cNvSpPr/><q:nvPr><q:ph type="obj" idx="9"/></q:nvPr></q:nvSpPr>
<q:spPr><d:prstGeom prst="roundRect"><d:avLst/></d:prstGeom><d:noFill/></q:spPr>
<q:txBody><d:bodyPr/><d:lstStyle/><d:p><d:r><d:t>placeholder</d:t></d:r></d:p></q:txBody></q:sp>`;
const foreignLookalike = `<q:extLst><q:ext uri="{B1503A6C-1B88-4D0B-85F6-D0139278AAB1}">
<opaque:sp><q:nvSpPr><q:cNvPr id="41" name="外来同名节点"/><q:cNvSpPr/><q:nvPr/></q:nvSpPr></opaque:sp>
</q:ext></q:extLst>`;
const slide = `${XML}<q:sld xmlns:d="${NS.a}" xmlns:q="${NS.p}" xmlns:r="${NS.r}" xmlns:opaque="urn:web-ppt:opaque">
<q:cSld><q:spTree>${nv}${shape}${group}${frame}${placeholder}${foreignLookalike}</q:spTree></q:cSld>
<q:clrMapOvr><d:masterClrMapping/></q:clrMapOvr></q:sld>`;

const files = unzipSync(deck({ name: 'Edit Xfrm', width: 1280, height: 720, slides: [slide] }));
files['ppt/slideLayouts/slideLayout1.xml'] = new TextEncoder().encode(`${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="obj">
<p:cSld name="Xfrm"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="9" name="版式占位符"/><p:cNvSpPr/><p:nvPr><p:ph type="obj" idx="9"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(180)}" y="${px(410)}"/><a:ext cx="${px(520)}" cy="${px(150)}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom></p:spPr></p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
const bytes = makeZip(Object.entries(files));

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-edit-xfrm.pptx'), bytes);
console.log(`fixtures/sample-edit-xfrm.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
