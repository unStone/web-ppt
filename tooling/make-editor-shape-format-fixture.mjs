/** 形状格式固件：覆盖继承、全部矢量填充、完整描边、图片关系、嵌套组与未知扩展。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makePng, makeZip, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const dashPresets = [
  'dash', 'dashDot', 'dot', 'lgDash', 'lgDashDot', 'lgDashDotDot',
  'sysDash', 'sysDashDot', 'sysDashDotDot', 'sysDot',
];

const styled = sp({
  x: 45, y: 45, w: 180, h: 90, name: 'format-inherited',
}).replace('</p:spPr>\n<p:txBody>', `</p:spPr>
<p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef>
<a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef>
<a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>
<a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style>
<p:txBody>`);
const noFill = sp({
  x: 250, y: 45, w: 180, h: 90, name: 'format-none', fill: '<a:noFill/>',
  ln: '<a:ln><a:noFill/></a:ln>',
});
const alphaSolid = sp({
  x: 455, y: 45, w: 180, h: 90, name: 'format-alpha-solid',
  fill: '<a:solidFill><a:srgbClr val="E11D48"><a:alpha val="42000"/></a:srgbClr></a:solidFill>',
});
const linear = sp({
  x: 660, y: 45, w: 180, h: 90, name: 'format-linear',
  fill: `<a:gradFill rotWithShape="1"><a:gsLst>
<a:gs pos="0"><a:srgbClr val="2563EB"/></a:gs>
<a:gs pos="45000"><a:srgbClr val="7C3AED"><a:alpha val="65000"/></a:srgbClr></a:gs>
<a:gs pos="100000"><a:srgbClr val="EC4899"/></a:gs>
</a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill>`,
});
const radial = sp({
  x: 865, y: 45, w: 180, h: 90, name: 'format-radial',
  fill: `<a:gradFill rotWithShape="1"><a:gsLst>
<a:gs pos="0"><a:srgbClr val="FEF3C7"/></a:gs>
<a:gs pos="100000"><a:srgbClr val="F59E0B"/></a:gs>
</a:gsLst><a:path path="circle"><a:fillToRect l="20000" t="10000" r="20000" b="10000"/></a:path></a:gradFill>`,
});
const pattern = sp({
  x: 45, y: 165, w: 180, h: 90, name: 'format-pattern',
  fill: '<a:pattFill prst="diagCross"><a:fgClr><a:srgbClr val="0F172A"/></a:fgClr><a:bgClr><a:srgbClr val="E2E8F0"/></a:bgClr></a:pattFill>',
});
const imageFill = sp({
  x: 250, y: 165, w: 180, h: 90, name: 'format-image-fill',
  fill: '<a:blipFill><a:blip r:embed="rId20"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>',
});
const richStroke = sp({
  x: 455, y: 165, w: 180, h: 90, name: 'format-rich-stroke', prst: 'line', fill: '<a:noFill/>',
  ln: `<a:ln xmlns:fixture="urn:web-ppt:shape-format" fixture:token="keep-line" w="28575" cap="rnd" cmpd="dbl">
<a:solidFill><a:srgbClr val="0891B2"><a:alpha val="75000"/></a:srgbClr></a:solidFill>
<a:prstDash val="lgDashDot"/><a:bevel/><a:headEnd type="triangle" w="lg" len="sm"/>
<a:tailEnd type="diamond" w="med" len="lg"/><a:extLst><a:ext uri="{WEB-PPT-SHAPE-FORMAT}">
<fixture:keep value="line-extension"/></a:ext></a:extLst></a:ln>`,
});
const picture = `<p:pic>
<p:nvPicPr><p:cNvPr id="1901" name="format-picture-border"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId20"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(660)}" y="${px(165)}"/><a:ext cx="${px(180)}" cy="${px(90)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="15803D"/></a:solidFill></a:ln></p:spPr>
</p:pic>`;
const nested = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="1902" name="format-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(865)}" y="${px(165)}"/><a:ext cx="${px(180)}" cy="${px(90)}"/>
<a:chOff x="0" y="0"/><a:chExt cx="${px(180)}" cy="${px(90)}"/></a:xfrm></p:grpSpPr>
${sp({ x: 15, y: 15, w: 150, h: 60, name: 'format-nested-leaf', fill: solid('70AD47') })}
</p:grpSp>`;
const dashShapes = dashPresets.map((preset, index) => sp({
  x: 45 + (index % 5) * 205, y: 285 + Math.floor(index / 5) * 55,
  w: 180, h: 35, name: `format-dash-${preset}`, fill: '<a:noFill/>',
  ln: `<a:ln w="19050"><a:solidFill><a:srgbClr val="334155"/></a:solidFill>`
    + `<a:prstDash val="${preset}"/></a:ln>`,
})).join('');
const alternateContent = `<mc:AlternateContent
xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
xmlns:fixture="urn:web-ppt:shape-format"><mc:Choice Requires="fixture">
${sp({ x: 0, y: 0, w: 1, h: 1, name: 'format-alternate-choice', fill: solid('FFFFFF') })}
</mc:Choice><mc:Fallback>
${sp({ x: 0, y: 0, w: 1, h: 1, name: 'format-alternate-fallback', fill: solid('FFFFFF') })}
</mc:Fallback></mc:AlternateContent>`;
const unknownTail = `<p:extLst><p:ext uri="{WEB-PPT-SHAPE-FORMAT-TAIL}">
<fixture:keep xmlns:fixture="urn:web-ppt:shape-format" value="slide-extension"/>
</p:ext></p:extLst>`;

const source = deck({
  name: 'Editor Shape Format', width: 1090, height: 520,
  slides: [slideXml([
    styled, noFill, alphaSolid, linear, radial, pattern, imageFill, richStroke, picture, nested,
    dashShapes, alternateContent, unknownTail,
  ].join(''))],
});
const files = unzipSync(source);
const replace = (part, fn) => { files[part] = encoder.encode(fn(decoder.decode(files[part]))); };
replace('ppt/theme/theme1.xml', (xml) => xml.replace(
  '<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>',
  '<a:ln w="6350" cap="rnd" cmpd="dbl"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
    + '<a:prstDash val="dashDot"/><a:bevel/><a:headEnd type="triangle" w="lg" len="sm"/>'
    + '<a:tailEnd type="oval" w="sm" len="lg"/></a:ln>',
));
replace('ppt/slides/_rels/slide1.xml.rels', (xml) => xml.replace('</Relationships>',
  `<Relationship Id="rId20" Type="${REL}/image" Target="../media/shape-format.png"/>`
  + '</Relationships>'));
replace('[Content_Types].xml', (xml) => xml.replace('<Default Extension="xml"',
  '<Default Extension="png" ContentType="image/png"/><Default Extension="xml"'));
files['ppt/media/shape-format.png'] = makePng(64, 36,
  (x, y) => [(x * 4) % 256, (y * 7) % 256, ((x + y) * 3) % 256]);

const bytes = makeZip(Object.entries(files));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-shape-format.pptx'), bytes);
console.log(`fixtures/sample-editor-shape-format.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
