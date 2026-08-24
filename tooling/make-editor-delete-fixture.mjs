/** 删除必须覆盖普通元素、递归组、框架对象、共享资源与两种占位符状态。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makePng, makeZip, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shape = sp({
  x: 70, y: 70, w: 170, h: 90, fill: solid('accent1'), name: 'delete-shape',
  text: '<a:p><a:r><a:t>ordinary</a:t></a:r></a:p>',
});
const group = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="401" name="delete-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(280)}" y="${px(60)}"/><a:ext cx="${px(300)}" cy="${px(170)}"/>
<a:chOff x="0" y="0"/><a:chExt cx="${px(300)}" cy="${px(170)}"/></a:xfrm></p:grpSpPr>
${sp({ x: 20, y: 20, w: 110, h: 60, fill: solid('accent2'), name: 'delete-group-child-a' })}
${sp({ x: 160, y: 80, w: 110, h: 60, fill: solid('accent3'), name: 'delete-group-child-b' })}
</p:grpSp>`;
const picture = `<p:pic>
<p:nvPicPr><p:cNvPr id="402" name="delete-picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(620)}" y="${px(60)}"/><a:ext cx="${px(170)}" cy="${px(120)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const frame = `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="403" name="delete-frame"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(830)}" y="${px(60)}"/><a:ext cx="${px(190)}" cy="${px(120)}"/></p:xfrm>
<a:graphic><a:graphicData uri="urn:web-ppt:delete"><x:item xmlns:x="urn:web-ppt:delete"/></a:graphicData></a:graphic>
</p:graphicFrame>`;
const placeholder = (id, name, y, text) => `<p:sp>
<p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="${id}"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(80)}" y="${px(y)}"/><a:ext cx="${px(440)}" cy="${px(100)}"/></a:xfrm>
<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>${text}</p:txBody></p:sp>`;
const filled = placeholder(404, 'delete-placeholder-filled', 280,
  '<a:p><a:r><a:rPr b="1"/><a:t>保留格式后清空</a:t></a:r></a:p>');
const empty = placeholder(405, 'delete-placeholder-empty', 420,
  '<a:p><a:endParaRPr lang="zh-CN"/></a:p>');
const peer = sp({ x: 590, y: 280, w: 200, h: 90, fill: solid('accent4'), name: 'delete-peer' });
const second = sp({ x: 100, y: 100, w: 220, h: 100, fill: solid('accent5'), name: 'delete-second-page' });

const files = unzipSync(deck({
  name: 'Editor Delete', width: 1100, height: 620,
  slides: [slideXml(shape + group + picture + frame + filled + empty + peer), slideXml(second)],
}));
const decoder = new TextDecoder();
files['ppt/slides/_rels/slide1.xml.rels'] = new TextEncoder().encode(
  decoder.decode(files['ppt/slides/_rels/slide1.xml.rels']).replace('</Relationships>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>'),
);
files['[Content_Types].xml'] = new TextEncoder().encode(
  decoder.decode(files['[Content_Types].xml']).replace('<Default Extension="xml"',
    '<Default Extension="png" ContentType="image/png"/>\n<Default Extension="xml"'),
);
files['ppt/media/image1.png'] = makePng(20, 14, (x, y) => [x * 9, y * 13, 170]);
const bytes = makeZip(Object.entries(files));

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-delete.pptx'), bytes);
console.log(`fixtures/sample-editor-delete.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
