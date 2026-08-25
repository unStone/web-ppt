/** 页面图片背景固件：直接拉伸、平铺与版式继承共享同一媒体，附带未知 XML。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makeBmp, makePng, makeWav, makeZip, slideXml } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const imageRelationship = `<Relationship Id="rId2" Type="${REL}/image" Target="../media/slide-background.png"/>`;
const inheritedImageRelationship = `<Relationship Id="rId2" Type="${REL}/image" Target="../media/inherited-background.bmp"/>`;
const inheritedExtensionRelationship = `<Relationship Id="rId3" Type="${REL}/hyperlink" Target="https://example.com/background-extension" TargetMode="External"/>`;
const inheritedMediaRelationship = `<Relationship Id="rId4" Type="${REL}/audio" Target="../media/inherited-background.wav"/>`;

const stretch = `<p:bg xmlns:fixture="urn:web-ppt:slide-image-background" fixture:slot="stretch">
<p:bgPr fixture:keep="stretch"><a:blipFill dpi="96" rotWithShape="0">
<a:blip r:embed="rId2"><a:alphaModFix amt="72000"/><a:extLst><a:ext uri="{BACKGROUND-BLIP}"><fixture:keep value="blip-extension"/></a:ext></a:extLst></a:blip>
<a:srcRect l="8000" t="4000" r="12000" b="6000"><fixture:keep value="crop-extension"/></a:srcRect>
<a:stretch><a:fillRect l="1000"/></a:stretch></a:blipFill>
<a:effectLst/><a:extLst><a:ext uri="{BACKGROUND-HOST}"><fixture:keep value="host-extension"/></a:ext></a:extLst>
</p:bgPr></p:bg>`;
const tile = `<p:bg xmlns:fixture="urn:web-ppt:slide-image-background" fixture:slot="tile">
<p:bgPr fixture:keep="tile"><a:blipFill dpi="96"><a:blip r:embed="rId2"/>
<a:tile sx="65000" sy="80000" flip="xy" tx="95250" ty="-19050" algn="ctr"/></a:blipFill><a:effectLst/>
</p:bgPr></p:bg>`;
const slides = [slideXml('', stretch), slideXml('', tile), slideXml('')];
const source = deck({ name: 'Editor Slide Image Background', width: 1280, height: 720, slides });
const files = unzipSync(source);
const replace = (part, fn) => { files[part] = encoder.encode(fn(decoder.decode(files[part]))); };
for (const index of [1, 2]) {
  replace(`ppt/slides/_rels/slide${index}.xml.rels`, (xml) =>
    xml.replace('</Relationships>', `${imageRelationship}</Relationships>`));
}
replace('ppt/slideLayouts/slideLayout1.xml', (xml) => xml
  .replace('<p:sldLayout ', '<p:sldLayout xmlns:fixture="urn:web-ppt:slide-image-background" ')
  .replace(
  '<p:cSld name="Blank">',
  `<p:cSld name="Blank"><p:bg fixture:slot="inherited">`
    + '<p:bgPr fixture:keep="inherited"><a:blipFill dpi="120"><a:blip r:embed="rId2">'
    + '<a:extLst><a:ext uri="{INHERITED-BLIP}"><fixture:keep value="inherited-blip-extension"/>'
    + '<fixture:linked r:id="rId3"/><fixture:media r:id="rId4"/></a:ext></a:extLst>'
    + '</a:blip><a:srcRect l="5000" t="10000" r="15000" b="20000">'
    + '<fixture:keep value="inherited-crop-extension"/></a:srcRect><a:stretch><a:fillRect/></a:stretch>'
    + '</a:blipFill><a:effectLst/><a:extLst><a:ext uri="{INHERITED-HOST}">'
    + '<fixture:keep value="inherited-host-extension"/></a:ext></a:extLst></p:bgPr></p:bg>',
));
replace('ppt/slideLayouts/_rels/slideLayout1.xml.rels', (xml) =>
  xml.replace('</Relationships>',
    `${inheritedImageRelationship}${inheritedExtensionRelationship}${inheritedMediaRelationship}</Relationships>`));
replace('[Content_Types].xml', (xml) => xml.replace(
  '<Default Extension="xml"',
  '<Default Extension="png" ContentType="image/png"/><Default Extension="bmp" ContentType="image/bmp"/><Default Extension="wav" ContentType="audio/wav"/><Default Extension="xml"',
));
files['ppt/media/slide-background.png'] = makePng(96, 54,
  (x, y) => [20 + (x * 2) % 220, 15 + (y * 4) % 220, (x * 11 + y * 17) % 256], 96);
files['ppt/media/inherited-background.bmp'] = makeBmp(24, 12,
  (x, y) => [180 - x * 3, 40 + y * 8, (x * 13 + y * 19) % 256]);
files['ppt/media/inherited-background.wav'] = makeWav();

const bytes = makeZip(Object.entries(files));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-slide-image-background.pptx'), bytes);
console.log(`fixtures/sample-editor-slide-image-background.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
