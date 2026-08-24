/** 图片插入固件：现有同哈希媒体、编号缺口、高位身份与未知尾节点共同守住媒体闭包。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makePng, makeZip, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const existingPng = makePng(41, 27, (x, y) => [x * 5, y * 7, (x + y) * 3]);
const unusedPng = makePng(17, 13, (x, y) => [190, x * 11, y * 13]);
const existingPicture = `<p:pic>
<p:nvPicPr><p:cNvPr id="880" name="既有同哈希图片"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId19"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(120)}" y="${px(120)}"/><a:ext cx="${px(246)}" cy="${px(162)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>`;
const extension = `<p:extLst><p:ext uri="{ADD-IMAGE-TAIL}">
<fixture:keep xmlns:fixture="urn:web-ppt:add-image" value="必须原位保留"/>
</p:ext></p:extLst>`;
const source = deck({
  name: 'Add Image', width: 1280, height: 720,
  slides: [slideXml([
    sp({ x: 460, y: 110, w: 230, h: 110, fill: solid('accent2'), name: '图片插入锚点' }),
    existingPicture,
    extension,
  ].join(''))],
  presRels: '<Relationship Id="rId44" Type="urn:web-ppt:add-image:unknown" Target="../customXml/add-image.xml"/>',
  extraTypes: '<Override PartName="/customXml/add-image.xml" ContentType="application/x-web-ppt-add-image+xml"/>',
  extraEntries: [['customXml/add-image.xml', '<keep xmlns="urn:web-ppt:add-image">不可改写</keep>']],
});

const files = unzipSync(source);
const replace = (part, fn) => { files[part] = encoder.encode(fn(decoder.decode(files[part]))); };
replace('ppt/slides/_rels/slide1.xml.rels', (xml) => xml.replace('</Relationships>',
  `<Relationship Id="rId19" Type="${REL}/image" Target="../media/image7.png"/>`
  + '<Relationship Id="rId41" Type="urn:web-ppt:add-image:unknown" Target="../../customXml/add-image.xml"/>'
  + '</Relationships>'));
replace('[Content_Types].xml', (xml) => xml.replace('<Default Extension="xml"',
  '<Default Extension="png" ContentType="image/png"/><Default Extension="xml"'));
files['ppt/media/image7.png'] = existingPng;
files['ppt/media/image12.png'] = unusedPng;

const bytes = makeZip(Object.entries(files));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-add-image.pptx'), bytes);
console.log(`fixtures/sample-editor-add-image.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
