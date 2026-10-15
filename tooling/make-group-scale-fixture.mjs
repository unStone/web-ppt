import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, nextShapeId, px, slideXml, solid, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = '<a:p><a:r><a:rPr sz="2400"/><a:t>Work in pairs. Compare your answers to Exercise 9.</a:t></a:r></a:p>';
const run = (value, size) => `<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="${size}"/><a:t>${value}</a:t></a:r></a:p>`;
const ln = (widthPx, color) => `<a:ln w="${px(widthPx)}">${solid(color)}</a:ln>`;
const shadow = '<a:effectLst><a:outerShdw blurRad="76200" dist="57150" dir="2700000" algn="tl" rotWithShape="0">'
  + '<a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst>';

/** 坐标单位为 px；归一化子坐标空间需要 EMU 级精度，因此 chExt 允许直接给 EMU。 */
function grp({ name, x, y, w, h, chX = 0, chY = 0, chW, chH, emuChild = false, rot, flipH, flipV }, children) {
  const toEmu = emuChild ? Math.round : px;
  const attrs = [rot ? ` rot="${rot * 60000}"` : '', flipH ? ' flipH="1"' : '', flipV ? ' flipV="1"' : ''].join('');
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${nextShapeId()}" name="${name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm${attrs}><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/>
<a:chOff x="${toEmu(chX)}" y="${toEmu(chY)}"/><a:chExt cx="${toEmu(chW)}" cy="${toEmu(chH)}"/></a:xfrm></p:grpSpPr>${children.join('')}</p:grpSp>`;
}

function textGroup(normalized) {
  const childW = normalized ? 1 : 600;
  const childH = normalized ? 2540 / 9525 : 160;
  const child = sp({
    x: 0, y: 0, w: childW, h: childH, name: '组合内文字',
    fill: solid('DBEAFE'),
    bodyPr: '<a:bodyPr wrap="square" anchor="t"/>',
    text,
  });
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="900" name="文字组合"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(100)}" y="${px(130)}"/>
<a:ext cx="${px(600)}" cy="${px(160)}"/><a:chOff x="0" y="0"/>
<a:chExt cx="${px(childW)}" cy="${px(childH)}"/></a:xfrm></p:grpSpPr>${child}</p:grpSp>`;
}

// WPS 产出的归一化组合：子坐标空间只有约 1px，描边、字号仍是物理尺寸。
function normalizedStrokeGroup() {
  const unit = 9525;
  return grp({ name: '归一化描边组合', x: 100, y: 120, w: 640, h: 320, chW: unit, chH: unit / 2, emuChild: true }, [
    sp({
      x: 0, y: 0, w: 1, h: 0.5, prst: 'roundRect', name: '归一化描边矩形',
      fill: solid('FDE7F3'), ln: ln(3, 'C2185B'), text: run('3px stroke · 24pt', 2400),
    }),
    sp({ x: 0.05, y: 0.42, w: 0.9, h: 0, prst: 'line', name: '归一化直线', ln: ln(2, '1F3864') }),
  ]);
}

// 普通缩放组合与右侧未成组的同尺寸形状逐项对照：PowerPoint 中两者外观一致。
function scaledGroupWithReference() {
  const child = (x, y) => sp({
    x, y, w: 300, h: 150, name: '缩放组合内形状',
    fill: solid('E2F0D9'), ln: ln(6, '385723'), effect: shadow, text: run('6px · 24pt', 2400),
  });
  return grp({ name: '1.5 倍组合', x: 80, y: 120, w: 450, h: 225, chX: 40, chY: 30, chW: 300, chH: 150 }, [child(40, 30)])
    + sp({
      x: 680, y: 120, w: 450, h: 225, name: '对照形状',
      fill: solid('E2F0D9'), ln: ln(6, '385723'), effect: shadow, text: run('6px · 24pt', 2400),
    });
}

// 外层放大 2 倍、内层缩小一半：叶节点最终外框与右侧对照形状相同。
function nestedGroupWithReference() {
  const leaf = sp({
    x: 50, y: 50, w: 480, h: 200, prst: 'ellipse', name: '嵌套叶节点',
    fill: solid('FFF2CC'), ln: ln(4, 'BF9000'), text: run('nested 4px · 20pt', 2000),
  });
  const inner = grp({ name: '内层组合', x: 20, y: 20, w: 240, h: 100, chX: 50, chY: 50, chW: 480, chH: 200 }, [leaf]);
  return grp({ name: '外层组合', x: 80, y: 100, w: 560, h: 280, chW: 280, chH: 140 }, [inner])
    + sp({
      x: 680, y: 140, w: 480, h: 200, prst: 'ellipse', name: '嵌套对照形状',
      fill: solid('FFF2CC'), ln: ln(4, 'BF9000'), text: run('nested 4px · 20pt', 2000),
    });
}

// 非等比组合同时旋转、翻转：子元素自身的 30° / 120° 旋转在组缩放下保持矩形（120° 落在交换宽高的象限）。
function rotatedFlippedGroup() {
  return grp({ name: '旋转翻转组合', x: 280, y: 180, w: 600, h: 300, rot: 20, flipH: true, chW: 400, chH: 400 }, [
    sp({
      x: 20, y: 20, w: 260, h: 110, prst: 'rightArrow', name: '箭头',
      fill: solid('DEEBF7'), ln: ln(3, '2E75B6'), text: run('flip', 1800),
    }),
    sp({ x: 40, y: 200, w: 200, h: 80, rot: 30 * 60000, name: '30° 子元素', fill: solid('FBE5D6'), ln: ln(3, 'C55A11') }),
    sp({ x: 220, y: 220, w: 200, h: 80, rot: 120 * 60000, name: '120° 子元素', fill: solid('E2F0D9'), ln: ln(3, '548235') }),
  ]);
}

const bytes = deck({
  name: 'Group Text Scale', width: 1280, height: 720,
  slides: [
    slideXml(textGroup(false)),
    slideXml(textGroup(true)),
    slideXml(normalizedStrokeGroup()),
    slideXml(scaledGroupWithReference()),
    slideXml(nestedGroupWithReference()),
    slideXml(rotatedFlippedGroup()),
  ],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-group-scale.pptx'), bytes);
console.log(`fixtures/sample-group-scale.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
