/** 生成命令与历史的最小确定性固件：普通形状、嵌套组、仅框架可编辑对象。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makePng, makeZip, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const groupChild = sp({
  x: 40, y: 30, w: 180, h: 100, prst: 'roundRect', fill: solid('accent2'), text: '', name: '组内形状',
});
const group = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="201" name="测试组"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="600000"><a:off x="${px(420)}" y="${px(100)}"/>
<a:ext cx="${px(360)}" cy="${px(220)}"/><a:chOff x="${px(20)}" y="${px(20)}"/>
<a:chExt cx="${px(240)}" cy="${px(140)}"/></a:xfrm></p:grpSpPr>
${groupChild}
</p:grpSp>`;
const frame = `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="301" name="未知框架"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(850)}" y="${px(130)}"/><a:ext cx="${px(300)}" cy="${px(230)}"/></p:xfrm>
<a:graphic><a:graphicData uri="urn:web-ppt:fixture:unsupported"><x:item xmlns:x="urn:web-ppt:fixture"/></a:graphicData></a:graphic>
</p:graphicFrame>`;
const picture = `<p:pic>
<p:nvPicPr><p:cNvPr id="302" name="测试图片"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(90)}" y="${px(340)}"/><a:ext cx="${px(220)}" cy="${px(140)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>`;
const table = `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="303" name="测试表格"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(390)}" y="${px(390)}"/><a:ext cx="${px(360)}" cy="${px(120)}"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
<a:tblPr/><a:tblGrid><a:gridCol w="${px(180)}"/><a:gridCol w="${px(180)}"/></a:tblGrid>
<a:tr h="${px(120)}"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>B</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
</a:tbl></a:graphicData></a:graphic>
</p:graphicFrame>`;
const shape = sp({
  x: 90, y: 120, w: 260, h: 150, prst: 'rect', fill: solid('accent1'), name: '普通形状',
  text: '<a:p><a:r><a:rPr sz="1800"/><a:t>可编辑</a:t></a:r></a:p>',
});
const slide = slideXml(shape + group + frame + picture + table);
const secondSlide = slideXml(sp({
  x: 120, y: 160, w: 320, h: 180, prst: 'ellipse', fill: solid('accent3'), name: '第二页形状',
}));
const files = unzipSync(deck({ name: 'Edit Basic', width: 1280, height: 720, slides: [slide, secondSlide] }));
const decoder = new TextDecoder();
files['ppt/slides/_rels/slide1.xml.rels'] = new TextEncoder().encode(
  decoder.decode(files['ppt/slides/_rels/slide1.xml.rels']).replace('</Relationships>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>'),
);
files['[Content_Types].xml'] = new TextEncoder().encode(
  decoder.decode(files['[Content_Types].xml']).replace('<Default Extension="xml"',
    '<Default Extension="png" ContentType="image/png"/>\n<Default Extension="xml"'),
);
files['ppt/media/image1.png'] = makePng(16, 12, (x, y) => [x * 12, y * 16, 160]);
const bytes = makeZip(Object.entries(files));

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-edit-basic.pptx'), bytes);
console.log(`fixtures/sample-edit-basic.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
