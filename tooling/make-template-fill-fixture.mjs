import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { deck, makeZip, NS, nvGrp, px, slideXml, solid, XML } from './lib/ooxml.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const relationships = items => `${XML}<Relationships xmlns="${NS.rel}">${items}</Relationships>`;
const relationship = (id, type, target) => `<Relationship Id="${id}" Type="${NS.r}/${type}" Target="${target}"/>`;
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>`;
const run = (value, size) => `<a:p><a:pPr/><a:r><a:rPr sz="${size}"><a:solidFill><a:srgbClr val="1A1A1A"/></a:solidFill><a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${value}</a:t></a:r></a:p>`;

function placeholder({ id, name, type, index, rect, text = `Click to add ${name}`, size = 1600 }) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"${index === undefined ? '' : ` idx="${index}"`}/></p:nvPr></p:nvSpPr>
<p:spPr>${xfrm(...rect)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/><a:lstStyle/>${run(text, size)}</p:txBody></p:sp>`;
}

const title = (name = 'Title') => ({ id: 2, name, type: 'title', rect: [60, 35, 840, 75], size: 2800 });
const body = (id, name, index, rect) => ({ id, name, type: 'body', index, rect });
const layouts = [
  { type: 'title', name: 'Fill Title', placeholders: [
    { id: 2, name: 'Cover Title', type: 'ctrTitle', rect: [80, 150, 800, 100], size: 3600 },
    { id: 3, name: 'Subtitle', type: 'subTitle', index: 1, rect: [120, 285, 720, 70], size: 2000 },
  ] },
  { type: 'secHead', name: 'Fill Section', placeholders: [
    { id: 2, name: 'Section Title', type: 'title', rect: [80, 160, 800, 90], size: 3200 },
    body(3, 'Section Body', 1, [120, 280, 720, 90]),
  ] },
  { type: 'obj', name: 'Fill Content', placeholders: [
    title(), body(3, 'Content', 1, [70, 130, 820, 320]),
  ] },
  { type: 'twoObj', name: 'Fill Two Column', placeholders: [
    title(), body(3, 'Left Content', 1, [70, 130, 390, 320]),
    body(4, 'Right Content', 2, [500, 130, 390, 320]),
  ] },
  { type: 'picTx', name: 'Fill Picture', placeholders: [
    title(), { id: 3, name: 'Picture', type: 'pic', index: 1, rect: [70, 130, 530, 300] },
    body(4, 'Caption', 2, [640, 150, 250, 250]),
  ] },
  { type: 'chart', name: 'Fill Chart', placeholders: [
    title(), { id: 3, name: 'Chart', type: 'chart', index: 1, rect: [70, 130, 820, 320] },
  ] },
];

const masterMarker = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Template Master Marker"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr>${xfrm(60, 500, 100, 4)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solid('accent1')}</p:spPr></p:sp>`;
const sourceSlides = [
  slideXml(placeholder({ ...layouts[0].placeholders[0], text: 'Original Example One' })
    + placeholder({ ...layouts[0].placeholders[1], text: 'Replace this original cover' })),
  slideXml(placeholder({ ...title(), text: 'Original Example Two' })
    + placeholder({ ...body(3, 'Content', 1, [70, 130, 820, 320]), text: 'Replace this original content' })),
];
const extraTypes = layouts.slice(1).map((_, index) => `<Override PartName="/ppt/slideLayouts/slideLayout${index + 2}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`).join('');
const files = unzipSync(deck({
  name: 'Template Fill Fixture', width: 960, height: 540, slides: sourceSlides,
  masterShapes: masterMarker, extraTypes,
  presRels: '<Relationship Id="fixtureKeep" Type="urn:web-ppt:template-fill:keep" Target="../customXml/template-fill.xml"/>',
  extraEntries: [['customXml/template-fill.xml', `${XML}<template-fill xmlns="urn:web-ppt:template-fill" preserve="true"/>`]],
}));
const set = (part, xml) => { files[part] = encoder.encode(xml); };
const masterStyles = ['title', 'body', 'other'].map(category => `<p:${category}Style>${Array.from({ length: 9 }, (_, level) =>
  `<a:lvl${level + 1}pPr marL="${px(level * 18)}" indent="0"><a:buNone/><a:defRPr sz="${category === 'title' ? 2800 : 1600}"><a:solidFill><a:srgbClr val="1A1A1A"/></a:solidFill><a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/></a:defRPr></a:lvl${level + 1}pPr>`).join('')}</p:${category}Style>`).join('');

set('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld name="Fill Master"><p:bg><p:bgPr>${solid('FFFFFF')}<a:effectLst/></p:bgPr></p:bg><p:spTree>${nvGrp}${masterMarker}</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst>${layouts.map((_, index) => `<p:sldLayoutId id="${2147483649 + index}" r:id="rId${index + 1}"/>`).join('')}</p:sldLayoutIdLst>
<p:txStyles>${masterStyles}</p:txStyles></p:sldMaster>`);
set('ppt/slideMasters/_rels/slideMaster1.xml.rels', relationships(layouts.map((_, index) =>
  relationship(`rId${index + 1}`, 'slideLayout', `../slideLayouts/slideLayout${index + 1}.xml`)).join('')
  + relationship('rId7', 'theme', '../theme/theme1.xml')));

for (const [index, layout] of layouts.entries()) {
  const part = index + 1;
  set(`ppt/slideLayouts/slideLayout${part}.xml`, `${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="${layout.type}" showMasterSp="1">
<p:cSld name="${layout.name}"><p:spTree>${nvGrp}${layout.placeholders.map(placeholder).join('')}</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  set(`ppt/slideLayouts/_rels/slideLayout${part}.xml.rels`, relationships(relationship('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml')));
}
set('ppt/slides/_rels/slide2.xml.rels', relationships(relationship('rId1', 'slideLayout', '../slideLayouts/slideLayout3.xml')));
const sourceTheme = decoder.decode(files['ppt/theme/theme1.xml']);
assert(sourceTheme.includes('typeface="Calibri Light"') && sourceTheme.includes('typeface="Calibri"'));
set('ppt/theme/theme1.xml', sourceTheme.replaceAll('typeface="Calibri Light"', 'typeface="Arial"')
  .replaceAll('typeface="Calibri"', 'typeface="Arial"'));

const output = new URL('../fixtures/sample-template-fill.pptx', import.meta.url);
writeFileSync(output, makeZip(Object.entries(files)));
console.log('sample-template-fill.pptx：六种版式与两页原始示例已生成');
