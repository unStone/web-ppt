import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

function savedShapeGeometry(bytes, name) {
  const parts = unzipSync(bytes);
  const decode = (part) => new TextDecoder().decode(parts[part]);
  const slide = decode('ppt/slides/slide1.xml');
  const named = slide.indexOf(`name="${name}"`);
  const from = slide.lastIndexOf('<p:sp>', named);
  const to = slide.indexOf('</p:sp>', named);
  const fragment = from >= 0 && to >= 0 ? slide.slice(from, to + 7) : '';
  const xfrm = fragment.match(/<a:xfrm\b([^>]*)>[\s\S]*?<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/);
  const size = decode('ppt/presentation.xml').match(/<p:sldSz cx="(\d+)" cy="(\d+)"\/>/);
  if (!xfrm || !size) throw new Error(`无法从组合产物读取 ${name} 的 xfrm`);
  return {
    x: Number(xfrm[2]), y: Number(xfrm[3]), w: Number(xfrm[4]), h: Number(xfrm[5]),
    rot: Number(xfrm[1].match(/\brot="(-?\d+)"/)?.[1] ?? 0) / 60000,
    slideW: Number(size[1]), slideH: Number(size[2]),
  };
}

function expectedBounds(frame, viewW, viewH) {
  const radians = frame.rot * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const points = [[frame.x, frame.y], [frame.x + frame.w, frame.y],
    [frame.x + frame.w, frame.y + frame.h], [frame.x, frame.y + frame.h]].map(([x, y]) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  }));
  return {
    left: Math.min(...points.map((point) => point.x)) / frame.slideW * viewW,
    right: Math.max(...points.map((point) => point.x)) / frame.slideW * viewW,
    top: Math.min(...points.map((point) => point.y)) / frame.slideH * viewH,
    bottom: Math.max(...points.map((point) => point.y)) / frame.slideH * viewH,
  };
}

function pathBounds(tag) {
  const coordinates = tag.match(/\bd="([^"]+)"/)?.[1].match(/-?[\d.]+/g)?.map(Number) ?? [];
  if (coordinates.length < 8 || coordinates.length % 2) throw new Error('组合产物 SVG path 无效');
  const xs = coordinates.filter((_, index) => index % 2 === 0);
  const ys = coordinates.filter((_, index) => index % 2 === 1);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

const geometryError = (actual, expected) => Math.max(...Object.keys(actual)
  .map((key) => Math.abs(actual[key] - expected[key])));

function coloredShape(markup, rgb, hex, expected) {
  const candidates = (markup.match(/<path\b[^>]*>/g) ?? []).filter((tag) => {
    const compact = tag.replace(/\s+/g, '').toLowerCase();
    return compact.includes(`fill="rgb(${rgb})"`) || compact.includes(`fill="#${hex}"`);
  }).map((tag) => ({ tag, bounds: pathBounds(tag) }));
  candidates.sort((left, right) => geometryError(left.bounds, expected) - geometryError(right.bounds, expected));
  if (!candidates.length) throw new Error(`LibreOffice SVG 缺少组合几何颜色 ${rgb}`);
  return candidates[0].bounds;
}

/** LibreOffice 的 SVG 为 1/100 mm 整数，旋转边界容许 3 unit 量化误差。 */
export function runGroupUngroupLibreOfficeContract({ savedPath, exportSvg }) {
  const file = savedPath.slice(savedPath.lastIndexOf('/') + 1);
  if (file !== 'group-elements.pptx' && file !== 'ungroup-elements.pptx') return '';
  const markup = exportSvg('组合/解组几何');
  const viewBox = markup.match(/\bviewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!viewBox) throw new Error('LibreOffice 组合 SVG 缺少 viewBox');
  const bytes = new Uint8Array(readFileSync(savedPath));
  const viewW = Number(viewBox[1]);
  const viewH = Number(viewBox[2]);
  const targets = file === 'group-elements.pptx'
    ? [
      ['space-plain', '46,117,182', '2e75b6'],
      ['space-rotated-flipped', '112,173,71', '70ad47'],
    ] : [['解组后保留的孩子', '166,166,166', 'a6a6a6']];
  const errors = targets.map(([name, rgb, hex]) => {
    const expected = expectedBounds(savedShapeGeometry(bytes, name), viewW, viewH);
    return geometryError(coloredShape(markup, rgb, hex, expected), expected);
  });
  const maximum = Math.max(...errors);
  if (maximum > 3) throw new Error(`LibreOffice 组合/解组几何偏差 ${maximum.toFixed(3)} SVG unit`);
  return `，组合/解组 frame 最大偏差 ${maximum.toFixed(3)} SVG unit`;
}
