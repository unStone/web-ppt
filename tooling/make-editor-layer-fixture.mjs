/** 层级固件固定 60 个顶层可写对象，并覆盖组、frame、超链接、继承只读节点与跨页边界。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, label, makeZip, NS, px, slideXml, solid, sp, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const back = sp({
  x: 40, y: 40, w: 110, h: 55, fill: solid('accent1'), name: 'layer-back', text: label('back'),
});
const items = Array.from({ length: 55 }, (_, index) => sp({
  x: 35 + (index % 11) * 92,
  y: 115 + Math.floor(index / 11) * 72,
  w: 78,
  h: 48,
  fill: solid(`accent${index % 6 + 1}`),
  name: `layer-item-${String(index + 1).padStart(2, '0')}`,
  text: label(String(index + 1)),
})).join('');
const group = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="1701" name="layer-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(60)}" y="${px(500)}"/><a:ext cx="${px(220)}" cy="${px(100)}"/>
<a:chOff x="0" y="0"/><a:chExt cx="${px(220)}" cy="${px(100)}"/></a:xfrm></p:grpSpPr>
${sp({ x: 10, y: 15, w: 80, h: 55, fill: solid('accent2'), name: 'layer-child-a', text: label('A') })}
${sp({ x: 120, y: 25, w: 80, h: 55, fill: solid('accent3'), name: 'layer-child-b', text: label('B') })}
</p:grpSp>`;
const frame = `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="1702" name="layer-frame"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(330)}" y="${px(500)}"/><a:ext cx="${px(180)}" cy="${px(90)}"/></p:xfrm>
<a:graphic><a:graphicData uri="urn:web-ppt:layer"><x:item xmlns:x="urn:web-ppt:layer"/></a:graphicData></a:graphic>
</p:graphicFrame>`;
const link = sp({
  x: 570, y: 510, w: 170, h: 65, fill: solid('accent5'), name: 'layer-link', text: label('link'),
}).replace(
  /<p:cNvPr id="(\d+)" name="layer-link"\/>/,
  '<p:cNvPr id="$1" name="layer-link"><a:hlinkClick r:id="rId2"/></p:cNvPr>',
);
const front = sp({
  x: 800, y: 510, w: 150, h: 65, fill: solid('accent6'), name: 'layer-front', text: label('front'),
});
const second = sp({
  x: 80, y: 80, w: 160, h: 80, fill: solid('accent4'), name: 'layer-second-page',
});

const files = unzipSync(deck({
  name: 'Editor Layer', width: 1060, height: 640,
  slides: [slideXml(back + items + group + frame + link + front), slideXml(second)],
}));
const decoder = new TextDecoder();
files['ppt/slides/_rels/slide1.xml.rels'] = new TextEncoder().encode(
  decoder.decode(files['ppt/slides/_rels/slide1.xml.rels']).replace('</Relationships>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/layer" TargetMode="External"/></Relationships>'),
);
const inherited = sp({
  x: 20, y: 600, w: 220, h: 24, fill: solid('accent4'), name: 'layer-inherited', text: label('layout'),
});
files['ppt/slideLayouts/slideLayout1.xml'] = new TextEncoder().encode(`${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="obj">
<p:cSld name="Layer"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${inherited}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);

const bytes = makeZip(Object.entries(files));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-layer.pptx'), bytes);
console.log(`fixtures/sample-editor-layer.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
