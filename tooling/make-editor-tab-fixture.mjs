/** Tab 遍历只认当前层直属绘制顺序；独立固件把页级、两层组和跨页边界固定下来。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const innerLeaf = sp({
  x: 10, y: 10, w: 55, h: 40, fill: solid('accent6'), name: 'tab-inner-leaf',
});
const inner = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="1101" name="tab-inner-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(95)}" y="${px(65)}"/>
<a:ext cx="${px(100)}" cy="${px(75)}"/><a:chOff x="0" y="0"/>
<a:chExt cx="${px(100)}" cy="${px(75)}"/></a:xfrm></p:grpSpPr>
${innerLeaf}
</p:grpSp>`;
const outer = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="1102" name="tab-outer-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(300)}" y="${px(180)}"/>
<a:ext cx="${px(360)}" cy="${px(240)}"/><a:chOff x="0" y="0"/>
<a:chExt cx="${px(360)}" cy="${px(240)}"/></a:xfrm></p:grpSpPr>
${sp({ x: 20, y: 20, w: 60, h: 45, fill: solid('accent2'), name: 'tab-child-a' })}
${inner}
${sp({ x: 230, y: 130, w: 70, h: 50, fill: solid('accent4'), name: 'tab-child-b' })}
</p:grpSp>`;

const bytes = deck({
  name: 'Editor Tab', width: 1000, height: 600,
  slides: [
    slideXml([
      sp({ x: 80, y: 80, w: 100, h: 70, fill: solid('accent1'), name: 'tab-back' }),
      sp({ x: 210, y: 80, w: 100, h: 70, fill: solid('accent3'), name: 'tab-middle' }),
      outer,
      sp({ x: 760, y: 80, w: 100, h: 70, fill: solid('accent5'), name: 'tab-front' }),
    ].join('')),
    slideXml(sp({
      x: 100, y: 100, w: 120, h: 80, fill: solid('accent2'), name: 'tab-second-page',
    })),
  ],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-tab.pptx'), bytes);
console.log(`fixtures/sample-editor-tab.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
