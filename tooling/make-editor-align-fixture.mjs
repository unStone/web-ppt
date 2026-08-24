/** 对齐固件覆盖旋转视觉框、非均匀组合坐标、框架对象、来源移动锁、继承只读与跨页拒绝。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, label, makeZip, NS, px, slideXml, solid, sp, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plain = sp({
  x: 80, y: 90, w: 170, h: 100, fill: solid('accent1'), name: 'align-plain', text: label('plain'),
});
const rotated = sp({
  x: 360, y: 80, w: 190, h: 130, rot: 1500000, flipH: true,
  fill: solid('accent3'), name: 'align-rotated', text: label('rotated'),
});
const locked = sp({
  x: 1040, y: 90, w: 170, h: 100, fill: solid('accent6'), name: 'align-locked', text: label('locked'),
}).replace('<p:cNvSpPr/>', '<p:cNvSpPr><a:spLocks noMove="1"/></p:cNvSpPr>');
const leaf = sp({
  x: 25, y: 15, w: 90, h: 45, rot: 900000, flipV: true,
  fill: solid('accent5'), name: 'align-group-leaf', text: label('leaf'),
});
const group = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="2801" name="align-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="-600000" flipH="1"><a:off x="${px(650)}" y="${px(120)}"/>
<a:ext cx="${px(320)}" cy="${px(240)}"/><a:chOff x="${px(10)}" y="${px(5)}"/>
<a:chExt cx="${px(160)}" cy="${px(80)}"/></a:xfrm></p:grpSpPr>${leaf}</p:grpSp>`;
const frame = `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="2802" name="align-frame"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(970)}" y="${px(430)}"/><a:ext cx="${px(220)}" cy="${px(140)}"/></p:xfrm>
<a:graphic><a:graphicData uri="urn:web-ppt:align"><x:item xmlns:x="urn:web-ppt:align"/></a:graphicData></a:graphic>
</p:graphicFrame>`;
const second = sp({
  x: 60, y: 70, w: 180, h: 90, fill: solid('accent4'), name: 'align-second-page', text: label('page 2'),
});

const files = unzipSync(deck({
  name: 'Editor Align', width: 1280, height: 720,
  slides: [slideXml(plain + rotated + group + frame + locked), slideXml(second)],
}));
const inherited = sp({
  x: 20, y: 680, w: 220, h: 24, fill: solid('accent2'), name: 'align-inherited', text: label('layout'),
});
files['ppt/slideLayouts/slideLayout1.xml'] = new TextEncoder().encode(`${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="obj">
<p:cSld name="Align"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${inherited}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);

const bytes = makeZip(Object.entries(files));
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-align.pptx'), bytes);
console.log(`fixtures/sample-editor-align.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
