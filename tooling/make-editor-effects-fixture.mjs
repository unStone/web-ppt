/** 二维效果编辑固件：主题继承、显式空列表、效果图、图片、组合与未知扩展。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makePng, makeZip, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function withThemeStyle(markup) {
  return markup.replace('</p:spPr>\n<p:txBody>', `</p:spPr>
<p:style><a:lnRef idx="0"><a:schemeClr val="accent1"/></a:lnRef>
<a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef>
<a:effectRef idx="1"><a:schemeClr val="accent1"/></a:effectRef>
<a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style>
<p:txBody>`);
}

const inherited = withThemeStyle(sp({
  x: 55, y: 55, w: 210, h: 110, name: 'effects-inherited', fill: solid('accent1'),
}));
const explicitEmpty = withThemeStyle(sp({
  x: 300, y: 55, w: 210, h: 110, name: 'effects-explicit-empty', fill: solid('accent2'),
  effect: '<a:effectLst/>',
}));
const rich = sp({
  x: 545, y: 55, w: 210, h: 110, name: 'effects-rich', fill: solid('accent3'),
  effect: `<a:effectLst xmlns:fixture="urn:web-ppt:effects" fixture:token="keep-effect-list">
<a:glow rad="28575"><a:srgbClr val="F97316"/></a:glow></a:effectLst>
<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></a:scene3d>
<a:sp3d prstMaterial="matte"><a:bevelT w="12700" h="12700"/></a:sp3d>
<a:extLst><a:ext uri="{WEB-PPT-EFFECTS}"><fixture:keep xmlns:fixture="urn:web-ppt:effects" value="shape-extension"/></a:ext></a:extLst>`,
});
const picture = `<p:pic>
<p:nvPicPr><p:cNvPr id="2801" name="effects-picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId20"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr fixture:host="keep-picture" xmlns:fixture="urn:web-ppt:effects"><a:xfrm><a:off x="${px(790)}" y="${px(55)}"/><a:ext cx="${px(210)}" cy="${px(110)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:effectLst><a:softEdge rad="9525"/></a:effectLst></p:spPr>
</p:pic>`;
const child = sp({ x: 15, y: 15, w: 180, h: 80, name: 'effects-group-child', fill: solid('accent5') });
const group = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="2802" name="effects-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr fixture:host="keep-group" xmlns:fixture="urn:web-ppt:effects"><a:xfrm><a:off x="${px(55)}" y="${px(230)}"/><a:ext cx="${px(260)}" cy="${px(130)}"/>
<a:chOff x="0" y="0"/><a:chExt cx="${px(210)}" cy="${px(110)}"/></a:xfrm>
<a:effectDag name="source-dag" type="tree"><a:glow rad="19050"><a:srgbClr val="7C3AED"/></a:glow></a:effectDag>
<a:extLst><a:ext uri="{WEB-PPT-GROUP-EFFECTS}"><fixture:keep value="group-extension"/></a:ext></a:extLst></p:grpSpPr>
${child}</p:grpSp>`;
const libreOfficeShapes = [
  sp({ x: 55, y: 450, w: 160, h: 80, name: 'effects-lo-shadow', fill: solid('FDE68A') }),
  sp({ x: 270, y: 450, w: 160, h: 80, name: 'effects-lo-glow', fill: solid('DDD6FE') }),
  sp({ x: 485, y: 450, w: 160, h: 80, name: 'effects-lo-soft-edge', fill: solid('A7F3D0') }),
  sp({ x: 700, y: 450, w: 160, h: 80, name: 'effects-lo-reflection', fill: solid('FECACA') }),
].join('');
const alternateContent = `<mc:AlternateContent
xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
xmlns:fixture="urn:web-ppt:effects"><mc:Choice Requires="fixture">
${sp({ x: 1020, y: 400, w: 1, h: 1, name: 'effects-alternate-choice', fill: solid('FFFFFF') })}
</mc:Choice><mc:Fallback>
${sp({ x: 1020, y: 400, w: 1, h: 1, name: 'effects-alternate-fallback', fill: solid('FFFFFF') })}
</mc:Fallback></mc:AlternateContent>`;
const source = deck({
  name: 'Editor Effects', width: 1060, height: 600,
  slides: [
    slideXml(inherited + explicitEmpty + rich + picture + group + libreOfficeShapes + alternateContent),
    slideXml(sp({
      x: 80, y: 70, w: 260, h: 120, name: 'effects-unrelated-page', fill: solid('0F172A'),
    })),
  ],
});
const files = unzipSync(source);
const replace = (part, fn) => { files[part] = encoder.encode(fn(decoder.decode(files[part]))); };
replace('ppt/theme/theme1.xml', (xml) => xml.replace(
  '<a:effectStyle><a:effectLst/></a:effectStyle>',
  '<a:effectStyle><a:effectLst><a:outerShdw blurRad="38100" dist="28575" dir="2700000"><a:srgbClr val="111827"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle>',
));
replace('ppt/slides/_rels/slide1.xml.rels', (xml) => xml.replace('</Relationships>',
  `<Relationship Id="rId20" Type="${REL}/image" Target="../media/effects.png"/>`
  + '</Relationships>'));
replace('[Content_Types].xml', (xml) => xml.replace('<Default Extension="xml"',
  '<Default Extension="png" ContentType="image/png"/><Default Extension="xml"'));
files['ppt/media/effects.png'] = makePng(64, 36,
  (x, y) => [(x * 4) % 256, 80 + (y * 4) % 176, ((x + y) * 3) % 256]);

const bytes = makeZip(Object.entries(files));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-effects.pptx'), bytes);
console.log(`fixtures/sample-editor-effects.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
