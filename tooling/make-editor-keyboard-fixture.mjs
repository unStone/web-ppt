/** 键盘微移必须反解复合组世界位移，独立固件避免依赖其它手势的偶然排布。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plain = sp({
  x: 100, y: 100, w: 100, h: 80, fill: solid('accent1'), name: 'nudge-plain',
});
const rotated = sp({
  x: 320, y: 100, w: 120, h: 90, rot: 1800000, flipH: true,
  fill: solid('accent3'), name: 'nudge-rotated-flipped',
});
const leaf = sp({
  x: 20, y: 15, w: 50, h: 40, rot: 900000, flipV: true,
  fill: solid('accent5'), name: 'nudge-nested-leaf',
});
const inner = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="1001" name="nudge-inner-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="-600000" flipH="1"><a:off x="${px(60)}" y="${px(30)}"/>
<a:ext cx="${px(160)}" cy="${px(100)}"/><a:chOff x="${px(10)}" y="${px(10)}"/>
<a:chExt cx="${px(80)}" cy="${px(50)}"/></a:xfrm></p:grpSpPr>
${leaf}
</p:grpSp>`;
const sibling = sp({
  x: 10, y: 10, w: 35, h: 30, fill: solid('accent2'), name: 'nudge-group-sibling',
});
const outer = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="1002" name="nudge-outer-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="1200000" flipV="1"><a:off x="${px(550)}" y="${px(250)}"/>
<a:ext cx="${px(320)}" cy="${px(200)}"/><a:chOff x="0" y="0"/>
<a:chExt cx="${px(160)}" cy="${px(100)}"/></a:xfrm></p:grpSpPr>
${inner}
${sibling}
</p:grpSp>`;

const bytes = deck({
  name: 'Editor Keyboard', width: 1000, height: 600,
  slides: [
    slideXml(plain + rotated + outer),
    slideXml(sp({
      x: 100, y: 100, w: 100, h: 80, fill: solid('accent4'), name: 'nudge-second-slide',
    })),
  ],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-keyboard.pptx'), bytes);
console.log(`fixtures/sample-editor-keyboard.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
