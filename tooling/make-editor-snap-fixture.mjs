/** 吸附阈值不能依赖综合固件的偶然排布；用整数坐标给出可手算的 6px 边界。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = sp({
  x: 100, y: 100, w: 100, h: 80, fill: solid('accent1'), name: 'snap-threshold-target',
});
const sibling = sp({
  x: 300, y: 100, w: 100, h: 80, fill: solid('accent2'), name: 'snap-threshold-sibling',
});
const anchor = sp({
  x: 500, y: 100, w: 100, h: 80, fill: solid('accent3'), name: 'snap-threshold-anchor',
});
const priorityTarget = sp({
  x: 100, y: 250, w: 100, h: 80, fill: solid('accent1'), name: 'snap-priority-target',
});
const prioritySibling = sp({
  x: 447, y: 250, w: 70, h: 80, fill: solid('accent3'), name: 'snap-priority-sibling',
});
const centerTarget = sp({
  x: 100, y: 100, w: 100, h: 80, fill: solid('accent1'), name: 'snap-center-target',
});
const centerSibling = sp({
  x: 350, y: 300, w: 200, h: 160, fill: solid('accent4'), name: 'snap-center-sibling',
});
const canvasTarget = sp({
  x: 100, y: 100, w: 100, h: 80, fill: solid('accent1'), name: 'snap-canvas-target',
});
const spacingTarget = sp({
  x: 50, y: 100, w: 80, h: 60, fill: solid('accent1'), name: 'snap-spacing-target',
});
const spacingFirst = sp({
  x: 250, y: 100, w: 80, h: 60, fill: solid('accent2'), name: 'snap-spacing-first',
});
const spacingSecond = sp({
  x: 450, y: 100, w: 80, h: 60, fill: solid('accent3'), name: 'snap-spacing-second',
});
const spacingOverlapBackground = sp({
  x: 0, y: 0, w: 1000, h: 600, fill: solid('FFFFFF'), name: 'snap-spacing-overlap-background',
});
const verticalSpacingTarget = sp({
  x: 800, y: 450, w: 60, h: 80, fill: solid('accent4'), name: 'snap-spacing-vertical-target',
});
const verticalSpacingFirst = sp({
  x: 800, y: 50, w: 60, h: 80, fill: solid('accent5'), name: 'snap-spacing-vertical-first',
});
const verticalSpacingSecond = sp({
  x: 800, y: 370, w: 60, h: 80, fill: solid('accent6'), name: 'snap-spacing-vertical-second',
});
const groupTarget = sp({
  x: 20, y: 20, w: 40, h: 30, fill: solid('accent1'), name: 'snap-group-target',
});
const groupSibling = sp({
  x: 120, y: 20, w: 40, h: 30, fill: solid('accent2'), name: 'snap-group-sibling',
});
const snapGroup = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="801" name="snap-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(100)}" y="${px(200)}"/>
<a:ext cx="${px(400)}" cy="${px(200)}"/><a:chOff x="0" y="0"/>
<a:chExt cx="${px(200)}" cy="${px(100)}"/></a:xfrm></p:grpSpPr>
${groupTarget}${groupSibling}
</p:grpSp>`;
const groupDecoy = sp({
  x: 334, y: 240, w: 50, h: 60, fill: solid('accent5'), name: 'snap-group-outside-decoy',
});
const priorityEdgeTarget = sp({
  x: 20, y: 100, w: 100, h: 80, fill: solid('accent1'), name: 'snap-priority-edge-target',
});
const prioritySpacingFirst = sp({
  x: 100, y: 100, w: 50, h: 80, fill: solid('accent2'), name: 'snap-priority-spacing-first',
});
const prioritySpacingSecond = sp({
  x: 250, y: 100, w: 50, h: 80, fill: solid('accent3'), name: 'snap-priority-spacing-second',
});
const priorityCenterSibling = sp({
  x: 427, y: 100, w: 50, h: 80, fill: solid('accent4'), name: 'snap-priority-center-sibling',
});
const priorityEdgeSibling = sp({
  x: 504, y: 100, w: 50, h: 80, fill: solid('accent5'), name: 'snap-priority-edge-sibling',
});
const bytes = deck({
  name: 'Editor Snap', width: 1000, height: 600,
  slides: [
    slideXml(target + sibling + anchor),
    slideXml(priorityTarget + prioritySibling),
    slideXml(centerTarget + centerSibling),
    slideXml(canvasTarget),
    slideXml(spacingOverlapBackground + spacingTarget + spacingFirst + spacingSecond
      + verticalSpacingTarget + verticalSpacingFirst + verticalSpacingSecond),
    slideXml(snapGroup + groupDecoy),
    slideXml(priorityEdgeTarget + prioritySpacingFirst + prioritySpacingSecond
      + priorityCenterSibling + priorityEdgeSibling),
    slideXml(priorityEdgeTarget + priorityEdgeSibling + priorityCenterSibling
      + prioritySpacingSecond + prioritySpacingFirst),
    slideXml(priorityEdgeTarget + prioritySpacingFirst + prioritySpacingSecond
      + priorityCenterSibling),
  ],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-snap.pptx'), bytes);
console.log(`fixtures/sample-editor-snap.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
