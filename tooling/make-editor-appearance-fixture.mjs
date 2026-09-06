import { writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { deck, makePng, makeZip, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const picture = (id, x, effects) => `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="picture-${id}" descr="灰阶渐变图片"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId10">${effects}<a:extLst><a:ext uri="appearance-test"><test:keep xmlns:test="urn:appearance"/></a:ext></a:extLst></a:blip><a:srcRect l="10000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(180)}"/><a:ext cx="${px(160)}" cy="${px(100)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const parts = unzipSync(deck({ name: 'Appearance', width: 640, height: 360, slides: [slideXml(
  sp({ x: 40, y: 40, w: 200, h: 100, name: 'plain-shape', fill: solid('4285F4') })
  + sp({ x: 340, y: 40, w: 200, h: 100, name: 'rich-shape', fill: solid('F97316'),
    effect: '<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></a:scene3d><a:sp3d extrusionH="95250" prstMaterial="metal"><a:bevelT w="38100" h="38100"/></a:sp3d>' })
  + picture(901, 40, '') + picture(902, 240, '<a:alphaModFix amt="60000"/><a:grayscl/>')
  + picture(903, 440, '<a:duotone><a:srgbClr val="112233"/><a:srgbClr val="FFEEDD"/></a:duotone>'))] }));
const enc = new TextEncoder(), dec = new TextDecoder();
parts['ppt/media/ramp.png'] = makePng(64, 32, (x) => [x * 4, x * 4, x * 4]);
for (const [part, before, after] of [
  ['ppt/slides/_rels/slide1.xml.rels', '</Relationships>', '<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/ramp.png"/></Relationships>'],
  ['[Content_Types].xml', '<Default Extension="xml"', '<Default Extension="png" ContentType="image/png"/><Default Extension="xml"'],
]) parts[part] = enc.encode(dec.decode(parts[part]).replace(before, after));
writeFileSync(new URL('../fixtures/sample-editor-appearance.pptx', import.meta.url), makeZip(Object.entries(parts)));
