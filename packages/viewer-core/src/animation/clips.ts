/**
 * 揭开类的局部窗口。坐标都在 ClipRegion 里，不读 DOM。
 *
 * 形状组上的多边形要带 fill-box，否则百分比相对整页视口。
 * 向内的洞用 shape(evenodd)。shape() fill-box 挂在 <g> 上会把整组藏掉，
 * 所以组上的向内揭开另走蒙版，不把这段 shape() 挪到组上。
 */

import { FULL_REGION, isFull, percent, type ClipRegion } from './region';

type Point = readonly [number, number];

const BOX_MASK_IMAGE = [
  'linear-gradient(#000,#000)',
  'linear-gradient(#000,#000)',
  'linear-gradient(#000,#000)',
  'linear-gradient(#000,#000)',
].join(', ');

function polygon(points: readonly Point[]): string {
  return `polygon(${points.map(([x, y]) => `${percent(x)} ${percent(y)}`).join(',')}) fill-box`;
}

/**
 * 一条 polygon 会把各块的终点和起点连起来。这条斜线穿过窗口，棋盘和分裂会被切掉一块。
 * shape() 可以 close 之后再 move，每块单独成环。fill-box 仍然相对形状，不相对整页。
 */
function shapeFill(contours: readonly (readonly Point[])[]): string {
  const body = contours.map((contour, index) => {
    const commands = contour.map(([x, y], point) => {
      const verb = point === 0 ? (index === 0 ? 'from' : 'move to') : 'line to';
      return `${verb} ${percent(x)} ${percent(y)}`;
    });
    return `${commands.join(', ')}, close`;
  }).join(', ');
  return `shape(${body}) fill-box`;
}

function place(region: ClipRegion, x: number, y: number): Point {
  return [region.l + (x / 100) * region.w, region.t + (y / 100) * region.h];
}

function shapeHole(hole: readonly Point[]): string {
  const commands = hole.map(([x, y], index) =>
    `${index === 0 ? 'move to' : 'line to'} ${percent(x)} ${percent(y)}`);
  return 'shape(evenodd from 0% 0%, line to 100% 0%, line to 100% 100%, line to 0% 100%, close, '
    + `${commands.join(', ')}, close)`;
}

/**
 * 横条可以串成一条 polygon：相接的边落在左边界上，填色不会被斜线挖掉。
 * 竖条若也串成一条，上一条的底边会连到下一条的顶边，斜线把窗口切成三角。
 * 竖条每条单独成环。
 */
function slats(
  vertical: boolean, spans: readonly (readonly [number, number])[], open: boolean, region: ClipRegion,
): string {
  const contours: Point[][] = [];
  const flat: Point[] = [];
  for (const [start, end] of spans) {
    const mid = (start + end) / 2;
    const near = open ? start : mid;
    const far = open ? end : mid;
    const quad = vertical
      ? [place(region, near, 0), place(region, far, 0), place(region, far, 100), place(region, near, 100)]
      : [place(region, 0, near), place(region, 100, near), place(region, 100, far), place(region, 0, far)];
    if (vertical) contours.push(quad);
    else flat.push(...quad);
  }
  return vertical ? shapeFill(contours) : polygon(flat);
}

/** `vert` 是竖条，其余（含 horizontal）是横条。固定 6 条。 */
export function blindsClip(
  dir: string | undefined, open: boolean, region: ClipRegion = FULL_REGION,
): string {
  const spans: [number, number][] = [];
  for (let index = 0; index < 6; index++) spans.push([(index / 6) * 100, ((index + 1) / 6) * 100]);
  return slats(dir === 'vert', spans, open, region);
}

/**
 * 向内用四块蒙版拼边框。polygon 只有一条轮廓，四边串起来会在中心拉出蝴蝶结。
 * 整框的尺寸两帧都用同一套位置，避免底边在插值时离开边框。
 */
export function boxInMask(open: boolean, region: ClipRegion = FULL_REGION): Keyframe {
  if (isFull(region)) {
    const edge = open ? 50 : 0;
    return {
      opacity: 1,
      maskImage: BOX_MASK_IMAGE,
      maskRepeat: 'no-repeat',
      maskPosition: 'center top, center bottom, left center, right center',
      maskSize: `100% ${edge}%, 100% ${edge}%, ${edge}% 100%, ${edge}% 100%`,
      maskOrigin: 'fill-box',
      maskClip: 'fill-box',
    };
  }
  const scale = open ? 0.5 : 0;
  const bottomGap = 100 - (region.t + region.h);
  const rightGap = 100 - (region.l + region.w);
  return {
    opacity: 1,
    maskImage: BOX_MASK_IMAGE,
    maskRepeat: 'no-repeat',
    maskPosition: [
      `left ${percent(region.l)} top ${percent(region.t)}`,
      `left ${percent(region.l)} bottom ${percent(bottomGap)}`,
      `left ${percent(region.l)} top ${percent(region.t)}`,
      `right ${percent(rightGap)} top ${percent(region.t)}`,
    ].join(', '),
    maskSize: [
      `${percent(region.w)} ${percent(region.h * scale)}`,
      `${percent(region.w)} ${percent(region.h * scale)}`,
      `${percent(region.w * scale)} ${percent(region.h)}`,
      `${percent(region.w * scale)} ${percent(region.h)}`,
    ].join(', '),
    maskOrigin: 'fill-box',
    maskClip: 'fill-box',
  };
}

/** 文字上的向内盒状。洞收到中心点后面积是 0，避免四条蒙版对不齐留下细缝。 */
export function boxInClip(open: boolean, region: ClipRegion = FULL_REGION): string {
  const left = open ? region.l + region.w / 2 : region.l;
  const top = open ? region.t + region.h / 2 : region.t;
  const right = open ? region.l + region.w / 2 : region.l + region.w;
  const bottom = open ? region.t + region.h / 2 : region.t + region.h;
  return shapeHole([[left, top], [right, top], [right, bottom], [left, bottom]]);
}

/** `out` 从窗口中心向四边扩大。 */
export function boxOutClip(open: boolean, region: ClipRegion = FULL_REGION): string {
  if (isFull(region)) {
    return open ? 'inset(0% 0% 0% 0%) fill-box' : 'inset(50% 50% 50% 50%) fill-box';
  }
  const top = open ? region.t : region.t + region.h / 2;
  const left = open ? region.l : region.l + region.w / 2;
  const bottom = open ? 100 - (region.t + region.h) : 100 - (region.t + region.h / 2);
  const right = open ? 100 - (region.l + region.w) : 100 - (region.l + region.w / 2);
  return `inset(${percent(top)} ${percent(right)} ${percent(bottom)} ${percent(left)}) fill-box`;
}

export type CheckerPhase = 'closed' | 'half' | 'open';

/**
 * 短边大约 6 格，格子尽量是正方形。`aspect` 是像素宽高比，缺省 1 时退回 6×6。
 * `horz` 每格从左缘向右铺开，`vert` 从上缘向下铺开。收到中线时四边形会翻成蝴蝶结，
 * 所以关闭帧贴着起始边留一条细缝。半开只放开偶数格。
 */
export function checkerClip(
  dir: string | undefined, phase: CheckerPhase, region: ClipRegion = FULL_REGION, aspect = 1,
): string {
  const vertical = dir === 'vert';
  const { cols, rows, cw, ch } = checkerGrid(aspect);
  const contours: Point[][] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = col * cw;
      const y0 = row * ch;
      const x1 = x0 + cw;
      const y1 = y0 + ch;
      const even = (col + row) % 2 === 0;
      const shown = phase === 'open' || (phase === 'half' && even);
      const right = shown || vertical ? x1 : Math.min(x1, x0 + 0.2);
      const bottom = shown || !vertical ? y1 : Math.min(y1, y0 + 0.2);
      contours.push([
        place(region, x0, y0), place(region, right, y0),
        place(region, right, bottom), place(region, x0, bottom),
      ]);
    }
  }
  return shapeFill(contours);
}

function checkerGrid(aspect: number): { cols: number; rows: number; cw: number; ch: number } {
  const ratio = aspect > 0.2 && aspect < 5 ? aspect : 1;
  const across = 6;
  if (ratio >= 1) {
    const rows = across;
    const cols = Math.max(across, Math.round(rows * ratio));
    return { cols, rows, cw: 100 / cols, ch: 100 / rows };
  }
  const cols = across;
  const rows = Math.max(across, Math.round(cols / ratio));
  return { cols, rows, cw: 100 / cols, ch: 100 / rows };
}

/** 宽度固定，禁止随机数，固件和放映才能对上同一条。 */
const RANDOM_BAR_WIDTHS = [6, 18, 9, 14, 22, 7, 15, 9];

export function randomBarClip(
  dir: string | undefined, open: boolean, region: ClipRegion = FULL_REGION,
): string {
  const spans: [number, number][] = [];
  let cursor = 0;
  for (const width of RANDOM_BAR_WIDTHS) {
    spans.push([cursor, cursor + width]);
    cursor += width;
  }
  return slats(dir === 'vert', spans, open, region);
}

/** 斜条允许落在 0–100 之外，由裁剪框切掉。`lu`/`rd`/`ru` 是 `ld` 的翻转。 */
export function stripsClip(
  dir: string | undefined, open: boolean, region: ClipRegion = FULL_REGION,
): string {
  const flipX = dir === 'rd' || dir === 'ru';
  const flipY = dir === 'lu' || dir === 'ru';
  // 矩形上 x+y 的范围是 0–200。6 条若只铺 100，底边会留在窗外。
  const span = 200;
  const contours: Point[][] = [];
  for (let index = 0; index < 6; index++) {
    const start = (index * span) / 6;
    const end = ((index + 1) * span) / 6;
    const mid = (start + end) / 2;
    // 收成零宽度时插值会把平行四边形翻过去，斜条中途变成三角。
    const near = open ? start : mid - 0.2;
    const far = open ? end : mid + 0.2;
    const quad: Point[] = [[near, 0], [far, 0], [far - 100, 100], [near - 100, 100]];
    contours.push(quad.map(([x, y]) => place(region, flipX ? 100 - x : x, flipY ? 100 - y : y)));
  }
  return shapeFill(contours);
}

function ring(region: ClipRegion, radius: number, count: number, aspect = 1): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < count; index++) {
    points.push(rimPoint(region, -90 + (index * 360) / count, radius, aspect));
  }
  return points;
}

/** 百分比里 x、y 各自相对宽高。不按宽高比拉开，圆在扁矩形上会变成椭圆。 */
function rimPoint(region: ClipRegion, degrees: number, radius: number, aspect: number): Point {
  const ratio = aspect > 0.2 && aspect < 5 ? aspect : 1;
  const angle = degrees * Math.PI / 180;
  const cx = region.l + region.w / 2;
  const cy = region.t + region.h / 2;
  return [
    cx + radius * Math.cos(angle),
    cy + radius * Math.sin(angle) * ratio,
  ];
}

function coverRadius(region: ClipRegion): number {
  return Math.hypot(region.w, region.h) / 2;
}

/** 正多边形的边要比外接圆更靠外，弦才盖得住矩形四角。 */
function containingRadius(region: ClipRegion, sides: number): number {
  return coverRadius(region) / Math.cos(Math.PI / sides);
}

export function circleClip(
  inward: boolean, open: boolean, region: ClipRegion = FULL_REGION, aspect = 1,
): string {
  const radius = open === inward ? 0 : containingRadius(region, 12);
  const points = ring(region, radius, 12, aspect);
  return inward ? shapeHole(points) : polygon(points);
}

function diamondPoints(region: ClipRegion, reach: number): Point[] {
  const cx = region.l + region.w / 2;
  const cy = region.t + region.h / 2;
  return [[cx, cy - reach], [cx + reach, cy], [cx, cy + reach], [cx - reach, cy]];
}

export function diamondClip(
  inward: boolean, open: boolean, region: ClipRegion = FULL_REGION,
): string {
  const reach = open === inward ? 0 : (region.w + region.h) / 2;
  const points = diamondPoints(region, reach);
  return inward ? shapeHole(points) : polygon(points);
}

function plusPoints(region: ClipRegion, arm: number): Point[] {
  const cx = region.l + region.w / 2;
  const cy = region.t + region.h / 2;
  const hx = region.w / 2;
  const hy = region.h / 2;
  const ax = hx * arm;
  const ay = hy * arm;
  return [
    [cx - ax, cy - hy], [cx + ax, cy - hy], [cx + ax, cy - ay],
    [cx + hx, cy - ay], [cx + hx, cy + ay], [cx + ax, cy + ay],
    [cx + ax, cy + hy], [cx - ax, cy + hy], [cx - ax, cy + ay],
    [cx - hx, cy + ay], [cx - hx, cy - ay], [cx - ax, cy - ay],
  ];
}

export function plusClip(
  inward: boolean, open: boolean, region: ClipRegion = FULL_REGION,
): string {
  const points = plusPoints(region, open === inward ? 0 : 1);
  return inward ? shapeHole(points) : polygon(points);
}

/** 单边擦除。方向是揭开后内容出现的来向，缺省向下。 */
export function wipeClip(dir: string | undefined, hidden: boolean): string {
  const full = hidden ? 100 : 0;
  switch (dir) {
    case 'l': return `inset(0 ${full}% 0 0)`;
    case 'r': return `inset(0 0 0 ${full}%)`;
    case 'u': return `inset(0 0 ${full}% 0)`;
    default: return `inset(${full}% 0 0 0)`;
  }
}

function band(x0: number, y0: number, x1: number, y1: number, region: ClipRegion): Point[] {
  return [place(region, x0, y0), place(region, x1, y0), place(region, x1, y1), place(region, x0, y1)];
}

/** 两条边带。`in` 从外向中线长，`out` 从中线向两边张。 */
export function splitClip(
  dir: string | undefined, open: boolean, region: ClipRegion = FULL_REGION,
): string {
  const vertical = !dir?.includes('horz');
  const inward = dir === 'in' || dir?.endsWith('-in') === true;
  const shown = open;
  if (vertical) {
    const left = !inward
      ? [shown ? 0 : 50, 0, shown ? 50 : 50, 100]
      : [0, 0, shown ? 50 : 0, 100];
    const right = !inward
      ? [shown ? 50 : 50, 0, shown ? 100 : 50, 100]
      : [shown ? 50 : 100, 0, 100, 100];
    return shapeFill([
      band(left[0], left[1], left[2], left[3], region),
      band(right[0], right[1], right[2], right[3], region),
    ]);
  }
  const top = !inward
    ? [0, shown ? 0 : 50, 100, shown ? 50 : 50]
    : [0, 0, 100, shown ? 50 : 0];
  const bottom = !inward
    ? [0, shown ? 50 : 50, 100, shown ? 100 : 50]
    : [0, shown ? 50 : 100, 100, 100];
  return shapeFill([
    band(top[0], top[1], top[2], top[3], region),
    band(bottom[0], bottom[1], bottom[2], bottom[3], region),
  ]);
}

function wheelSpokes(dir: string | undefined): number {
  return dir === '1' || dir === '2' || dir === '3' || dir === '8' ? Number(dir) : 4;
}

/**
 * 辐条从 12 点方向顺时针扫开。进度 0 时每片收在起始射线上，1 时铺满自己的圆心角。
 * 两帧之间若直接插值，外点沿弦滑动，扇形会比角度更早铺满。播放层按小角度分帧。
 * 四辐的打开帧仍是每片一个三角形（24 个百分比）；单辐、双辐用折线去逼近圆弧。
 */
export function wheelClip(
  dir: string | undefined, open: boolean, region: ClipRegion = FULL_REGION, aspect = 1,
): string {
  return wheelAt(dir, open ? 1 : 0, region, aspect);
}

export function wheelSequence(
  dir: string | undefined, region: ClipRegion = FULL_REGION, aspect = 1,
): string[] {
  const spokes = wheelSpokes(dir);
  const steps = spokes === 1 ? 12 : 8;
  const frames: string[] = [];
  for (let step = 0; step <= steps; step++) frames.push(wheelAt(dir, step / steps, region, aspect));
  return frames;
}

function wheelAt(
  dir: string | undefined, progress: number, region: ClipRegion, aspect: number,
): string {
  const spokes = wheelSpokes(dir);
  const sweep = 360 / spokes;
  const segments = spokes === 1 ? 12 : spokes === 2 ? 6 : 1;
  const radius = containingRadius(region, Math.max(spokes, segments));
  const center: Point = [region.l + region.w / 2, region.t + region.h / 2];
  const contours: Point[][] = [];
  for (let index = 0; index < spokes; index++) {
    const start = -90 + index * sweep;
    const leading = start + sweep * progress;
    const points: Point[] = [center];
    for (let step = 0; step <= segments; step++) {
      const finalAngle = start + (sweep * step) / segments;
      points.push(rimPoint(region, Math.min(finalAngle, leading), radius, aspect));
    }
    contours.push(points);
  }
  return shapeFill(contours);
}

const FULL_LAYER = 'linear-gradient(#000,#000)';

/**
 * 圆外透明，半径贴住蒙版格的短边。
 * farthest-corner 在扁矩形里会盖满整格，减下去是矩形洞。
 */
const CIRCLE_LAYER = 'radial-gradient(circle closest-side, #000 99%, transparent 100%)';

function maskUrl(markup: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
}

const DIAMOND_LAYER = maskUrl(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><polygon fill='white' points='50,0 100,50 50,100 0,50'/></svg>",
);

/** 臂宽约占图像 20%。放到 500% 时臂盖住矩形，缩到 0 时洞消失。 */
const PLUS_LAYER = maskUrl(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><polygon fill='white' points='40,0 60,0 60,40 100,40 100,60 60,60 60,100 40,100 40,60 0,60 0,40 40,40'/></svg>",
);

/**
 * 圆形蒙版格必须是像素上的正方形，closest-side 的圆才盖得住对角线而不是变成椭圆。
 * 宽高百分比按元素宽高比折算：格子边长等于元素对角线。
 */
function circleCover(aspect: number): readonly [number, number] {
  const ratio = aspect > 0.2 && aspect < 5 ? aspect : 1;
  const side = 100 * Math.hypot(ratio, 1);
  return [side / ratio, side];
}

/**
 * 组上不用 shape()。整框蒙版减去光圈：exclude 掉第二层。
 * 只用于整框；段落文字走 shape(evenodd) 的洞。
 */
export function inwardGroupMask(effect: string, open: boolean, aspect = 1): Keyframe {
  const layer = effect === 'diamond' ? DIAMOND_LAYER
    : effect === 'plus' ? PLUS_LAYER
      : CIRCLE_LAYER;
  const [coverW, coverH] = effect === 'plus' ? [500, 500]
    : effect === 'circle' ? circleCover(aspect)
      : [200, 200];
  const scale = open ? 0 : 1;
  return {
    opacity: 1,
    maskImage: `${FULL_LAYER}, ${layer}`,
    maskRepeat: 'no-repeat, no-repeat',
    maskPosition: 'center, center',
    maskSize: `100% 100%, ${percent(coverW * scale)} ${percent(coverH * scale)}`,
    maskComposite: 'exclude',
    // SVG 蒙版按透明度取形。不写的话十字图层会按外接矩形整块减掉。
    maskMode: 'alpha, alpha',
    maskOrigin: 'fill-box',
    maskClip: 'fill-box',
  } as Keyframe;
}

const DISSOLVE_COLS = 12;
const DISSOLVE_ROWS = 8;
const DISSOLVE_ORDER = perm(DISSOLVE_COLS * DISSOLVE_ROWS);

function perm(count: number): number[] {
  const items = Array.from({ length: count }, (_, index) => index);
  let seed = 17;
  for (let index = count - 1; index > 0; index--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const swap = seed % (index + 1);
    const item = items[index];
    items[index] = items[swap];
    items[swap] = item;
  }
  return items;
}

/** 8×6 小格按固定顺序铺开。一起淡入看起来和淡入是同一个效果。 */
export function dissolveClip(
  phase: CheckerPhase, region: ClipRegion = FULL_REGION,
): string {
  const cols = DISSOLVE_COLS;
  const rows = DISSOLVE_ROWS;
  const limit = phase === 'open' ? DISSOLVE_ORDER.length : phase === 'half' ? DISSOLVE_ORDER.length / 2 : 0;
  const shown = new Set(DISSOLVE_ORDER.slice(0, limit));
  const contours: Point[][] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = (col / cols) * 100;
      const y0 = (row / rows) * 100;
      const x1 = ((col + 1) / cols) * 100;
      const y1 = ((row + 1) / rows) * 100;
      const open = shown.has(row * cols + col);
      const right = open ? x1 : Math.min(x1, x0 + 0.2);
      const bottom = open ? y1 : Math.min(y1, y0 + 0.2);
      contours.push([
        place(region, x0, y0), place(region, right, y0),
        place(region, right, bottom), place(region, x0, bottom),
      ]);
    }
  }
  return shapeFill(contours);
}
