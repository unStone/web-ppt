/** 图片内容编辑固件：外链替换、四种格式、共享媒体、来源裁剪、组合变换与未知 XML。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makePng, makeZip, px, slideXml } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const JPEG_1PX = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==';
const GIF_1PX = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const WEBP_1PX = 'UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ/Y/+ByKi/wEA';
const bytesOf = (base64) => Uint8Array.from(Buffer.from(base64, 'base64'));

function picture({ id, name, rid, x, y, w, h, crop = '', attrs = '', extra = '', link = false }) {
  const relationship = link ? 'r:link' : 'r:embed';
  return `<p:pic>
<p:nvPicPr><p:cNvPr id="${id}" name="${name}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip ${relationship}="${rid}"><a:extLst><a:ext uri="{WEB-PPT-IMAGE-BLIP}"><fixture:keep xmlns:fixture="urn:web-ppt:image-content" value="blip-extension"/></a:ext></a:extLst></a:blip>${crop}
<a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr xmlns:fixture="urn:web-ppt:image-content" fixture:host="keep-image-content"><a:xfrm${attrs}><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="334155"/></a:solidFill></a:ln>
<a:effectLst><a:glow rad="9525"><a:srgbClr val="F59E0B"><a:alpha val="45000"/></a:srgbClr></a:glow></a:effectLst>${extra}</p:spPr>
</p:pic>`;
}

const external = picture({
  id: 3101, name: 'image-external', rid: 'rId8', x: 40, y: 40, w: 260, h: 170,
  crop: '<a:srcRect xmlns:fixture="urn:web-ppt:image-content" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="fixture" fixture:keep="srcRect-extension" l="5000" t="10000" r="15000" b="20000"><fixture:keep value="srcRect-child"/></a:srcRect>',
  attrs: ' rot="900000" flipH="1"', link: true,
  extra: '<a:extLst><a:ext uri="{WEB-PPT-IMAGE-HOST}"><fixture:keep value="host-extension"/></a:ext></a:extLst>',
});
const sharedA = picture({
  id: 3102, name: 'image-shared-a', rid: 'rId2', x: 350, y: 45, w: 170, h: 105,
  crop: '<a:srcRect l="8000" t="4000" r="12000" b="6000"/>',
});
const sharedB = picture({
  id: 3103, name: 'image-shared-b', rid: 'rId3', x: 555, y: 45, w: 170, h: 105,
  crop: '<a:srcRect l="8000" t="4000" r="12000" b="6000"/>',
});
const jpeg = picture({
  id: 3104, name: 'image-jpeg', rid: 'rId4', x: 760, y: 45, w: 105, h: 105,
  crop: '<a:srcRect l="0" t="0" r="0" b="0"/>',
});
const gif = picture({ id: 3105, name: 'image-gif', rid: 'rId5', x: 900, y: 45, w: 105, h: 105 });
const webp = picture({ id: 3106, name: 'image-webp', rid: 'rId6', x: 350, y: 205, w: 170, h: 105 });
const nested = picture({
  id: 3108, name: 'image-nested', rid: 'rId7', x: 20, y: 15, w: 190, h: 120,
  crop: '<a:srcRect l="3000" t="9000" r="17000" b="11000"/>', attrs: ' rot="600000" flipV="1"',
});
const group = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="3107" name="image-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr xmlns:fixture="urn:web-ppt:image-content" fixture:host="keep-image-group"><a:xfrm rot="1200000"><a:off x="${px(600)}" y="${px(230)}"/><a:ext cx="${px(310)}" cy="${px(210)}"/>
<a:chOff x="0" y="0"/><a:chExt cx="${px(250)}" cy="${px(160)}"/></a:xfrm>
<a:extLst><a:ext uri="{WEB-PPT-IMAGE-GROUP}"><fixture:keep value="group-extension"/></a:ext></a:extLst></p:grpSpPr>
${nested}</p:grpSp>`;

const source = deck({
  name: 'Editor Image Content', width: 1060, height: 600,
  slides: [slideXml(external + sharedA + sharedB + jpeg + gif + webp + group)],
});
const files = unzipSync(source);
const replace = (part, fn) => { files[part] = encoder.encode(fn(decoder.decode(files[part]))); };
replace('ppt/slides/_rels/slide1.xml.rels', (xml) => xml.replace('</Relationships>',
  `<Relationship Id="rId2" Type="${REL}/image" Target="../media/image-content.png"/>`
  + `<Relationship Id="rId3" Type="${REL}/image" Target="../media/image-content.png"/>`
  + `<Relationship Id="rId4" Type="${REL}/image" Target="../media/image-content.jpg"/>`
  + `<Relationship Id="rId5" Type="${REL}/image" Target="../media/image-content.gif"/>`
  + `<Relationship Id="rId6" Type="${REL}/image" Target="../media/image-content.webp"/>`
  + `<Relationship Id="rId7" Type="${REL}/image" Target="../media/image-content.png"/>`
  + `<Relationship Id="rId8" Type="${REL}/image" Target="https://example.invalid/image.png" TargetMode="External"/>`
  + '</Relationships>'));
replace('[Content_Types].xml', (xml) => xml.replace('<Default Extension="xml"',
  '<Default Extension="png" ContentType="image/png"/>'
  + '<Default Extension="jpg" ContentType="image/jpeg"/>'
  + '<Default Extension="gif" ContentType="image/gif"/>'
  + '<Default Extension="webp" ContentType="image/webp"/>'
  + '<Default Extension="xml"'));
files['ppt/media/image-content.png'] = makePng(80, 50,
  (x, y) => [20 + x * 2, 15 + y * 4, (x * 7 + y * 11) % 256]);
files['ppt/media/image-content.jpg'] = bytesOf(JPEG_1PX);
files['ppt/media/image-content.gif'] = bytesOf(GIF_1PX);
files['ppt/media/image-content.webp'] = bytesOf(WEBP_1PX);

const bytes = makeZip(Object.entries(files));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-image-content.pptx'), bytes);
console.log(`fixtures/sample-editor-image-content.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
