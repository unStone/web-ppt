/** 框选需要可手算边界与复合组世界 OBB，不依赖综合固件的偶然排布。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plain = sp({
  x: 100, y: 100, w: 120, h: 80, fill: solid('accent1'), name: 'marquee-plain',
});
const rotated = sp({
  x: 350, y: 100, w: 120, h: 80, rot: 1800000, flipH: true,
  fill: solid('accent3'), name: 'marquee-rotated-flipped',
});
const nestedLeaf = sp({
  x: 0, y: 0, w: 30, h: 25, flipV: true,
  fill: solid('accent5'), name: 'marquee-nested-leaf',
});
const inner = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="901" name="marquee-inner-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="-600000" flipH="1"><a:off x="${px(70)}" y="${px(20)}"/>
<a:ext cx="${px(60)}" cy="${px(50)}"/><a:chOff x="0" y="0"/>
<a:chExt cx="${px(30)}" cy="${px(25)}"/></a:xfrm></p:grpSpPr>
${nestedLeaf}
</p:grpSp>`;
const sibling = sp({
  x: 10, y: 10, w: 40, h: 30, rot: 900000,
  fill: solid('accent2'), name: 'marquee-group-sibling',
});
const outer = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="902" name="marquee-outer-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="1200000" flipV="1"><a:off x="${px(650)}" y="${px(280)}"/>
<a:ext cx="${px(300)}" cy="${px(180)}"/><a:chOff x="0" y="0"/>
<a:chExt cx="${px(150)}" cy="${px(90)}"/></a:xfrm></p:grpSpPr>
${inner}
${sibling}
</p:grpSp>`;

const bytes = deck({
  name: 'Editor Marquee', width: 1000, height: 600,
  slides: [
    slideXml(plain + rotated + outer),
    slideXml(sp({
      x: 100, y: 100, w: 120, h: 80, fill: solid('accent4'), name: 'marquee-second-slide',
    })),
  ],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-marquee.pptx'), bytes);
console.log(`fixtures/sample-editor-marquee.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
