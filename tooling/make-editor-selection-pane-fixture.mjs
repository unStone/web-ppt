/** 选择窗格固件：稳定名称、重名、两级组合、未知框架与跨页边界。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deck, label, px, slideXml, solid, sp,
} from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const child = sp({
  x: 20, y: 20, w: 120, h: 60, fill: solid('accent2'),
  name: 'pane-child', text: label('child'),
});
const inner = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="2601" name="pane-inner-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(30)}" y="${px(30)}"/><a:ext cx="${px(180)}" cy="${px(110)}"/>
<a:chOff x="0" y="0"/><a:chExt cx="${px(180)}" cy="${px(110)}"/></a:xfrm></p:grpSpPr>
${child}
</p:grpSp>`;
const outer = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="2602" name="pane-outer-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(500)}" y="${px(250)}"/><a:ext cx="${px(260)}" cy="${px(180)}"/>
<a:chOff x="0" y="0"/><a:chExt cx="${px(260)}" cy="${px(180)}"/></a:xfrm></p:grpSpPr>
${inner}
${sp({ x: 180, y: 90, w: 60, h: 50, fill: solid('accent4'), name: 'pane-outer-child' })}
</p:grpSp>`;
const frame = `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="2603" name="pane-unknown-frame"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(820)}" y="${px(80)}"/><a:ext cx="${px(200)}" cy="${px(120)}"/></p:xfrm>
<a:graphic><a:graphicData uri="urn:web-ppt:selection-pane"><x:payload xmlns:x="urn:web-ppt:selection-pane" keep="yes"/></a:graphicData></a:graphic>
</p:graphicFrame>`;
const pageOne = [
  sp({ x: 40, y: 40, w: 180, h: 70, fill: solid('accent1'), name: 'pane-duplicate', text: label('A') }),
  sp({ x: 260, y: 40, w: 180, h: 70, fill: solid('accent3'), name: 'pane-duplicate', text: label('B') }),
  sp({ x: 40, y: 160, w: 260, h: 70, fill: solid('accent5'), name: '对象 &amp; &lt;一&gt;', text: label('特殊名') }),
  outer,
  frame,
].join('');
const pageTwo = sp({
  x: 100, y: 100, w: 240, h: 100, fill: solid('accent6'),
  name: 'pane-second-slide', text: label('page 2'),
});

const bytes = deck({
  name: 'Editor Selection Pane', width: 1120, height: 630,
  slides: [slideXml(pageOne), slideXml(pageTwo)],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-selection-pane.pptx'), bytes);
console.log(`fixtures/sample-editor-selection-pane.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
