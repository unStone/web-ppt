/**
 * 百叶窗和盒状的裁剪窗口。
 *
 * 百分比必须相对形状的 fill-box。动画挂在 `data-el` 的 `<g>` 上，
 * 不写 geometry box 时百分比相对整页视口，条带会铺到幻灯片而不是对象上。
 *
 * 百叶窗固定 6 条，每条从自己槽位的上沿或左沿展开，内容不缩放。
 * 盒状只揭开、不缩放：`in` 从四边向中心收，`out` 从中心矩形向四边扩。
 */

const SLATS = 6;

function percent(value: number): string {
  return `${Math.round(value * 1000) / 1000}%`;
}

/** `vert` 是竖条，其余（含 horizontal）是横条。 */
export function blindsClip(dir: string | undefined, open: boolean): Keyframe {
  const vertical = dir === 'vert';
  const paths: Point[][] = [];
  for (let index = 0; index < SLATS; index++) {
    const start = (index / SLATS) * 100;
    const end = ((index + 1) / SLATS) * 100;
    const far = open ? end : start;
    paths.push(vertical ? rect(start, 0, far, 100) : rect(0, start, 100, far));
  }
  return rectMask(paths);
}

const BOX_MASK_IMAGE = [
  'linear-gradient(#000,#000)',
  'linear-gradient(#000,#000)',
  'linear-gradient(#000,#000)',
  'linear-gradient(#000,#000)',
].join(', ');

/** 相对元素边框的百分比窗口。整框是 0,0,100,100。 */
export interface ClipRegion {
  l: number;
  t: number;
  w: number;
  h: number;
}

const FULL_REGION: ClipRegion = { l: 0, t: 0, w: 100, h: 100 };

function isFull(region: ClipRegion): boolean {
  return region.l === 0 && region.t === 0 && region.w === 100 && region.h === 100;
}

/**
 * `polygon()` 只有一条轮廓，四边串起来会在中心拉出蝴蝶结。
 * 向内用四块蒙版拼边框：上下两条通宽，左右两条通高。`out` 仍是中心矩形。
 * 段落动画传入文字墨迹框，四边相对这段字而不是整块占位框。
 */
export function boxInMask(open: boolean, region: ClipRegion = FULL_REGION): Keyframe {
  if (isFull(region)) {
    const edge = open ? 50 : 0;
    const maskSize = `100% ${edge}%, 100% ${edge}%, ${edge}% 100%, ${edge}% 100%`;
    return {
      opacity: 1,
      maskImage: BOX_MASK_IMAGE,
      maskRepeat: 'no-repeat',
      maskPosition: 'center top, center bottom, left center, right center',
      maskSize,
      maskOrigin: 'fill-box',
      maskClip: 'fill-box',
    };
  }
  // 四边在终态轻微重叠，避免非整数像素的墨迹框中心留下细缝。
  const scale = open ? 0.501 : 0;
  const topH = region.h * scale;
  const sideW = region.w * scale;
  const bottomGap = 100 - (region.t + region.h);
  const rightGap = 100 - (region.l + region.w);
  return {
    opacity: 1,
    maskImage: BOX_MASK_IMAGE,
    maskRepeat: 'no-repeat',
    // 位置在两帧里不变，只让尺寸插值。底边和右边钉在墨迹框上，条带向中心长。
    maskPosition: [
      `left ${percent(region.l)} top ${percent(region.t)}`,
      `left ${percent(region.l)} bottom ${percent(bottomGap)}`,
      `left ${percent(region.l)} top ${percent(region.t)}`,
      `right ${percent(rightGap)} top ${percent(region.t)}`,
    ].join(', '),
    maskSize: [
      `${percent(region.w)} ${percent(topH)}`,
      `${percent(region.w)} ${percent(topH)}`,
      `${percent(sideW)} ${percent(region.h)}`,
      `${percent(sideW)} ${percent(region.h)}`,
    ].join(', '),
    maskOrigin: 'fill-box',
    maskClip: 'fill-box',
  };
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

type Point = readonly [number, number];

type MaskAnchor = { x?: 'right'; y?: 'bottom' };

function rectMask(paths: readonly (readonly Point[])[], anchors: readonly MaskAnchor[] = []): Keyframe {
  return {
    opacity: 1,
    maskImage: paths.map(() => 'linear-gradient(#000,#000)').join(', '),
    maskRepeat: 'no-repeat',
    maskPosition: paths.map((points, index) =>
      `${anchors[index]?.x === 'right' ? `right ${percent(100 - points[2][0])}` : `left ${percent(points[0][0])}`} `
        + `${anchors[index]?.y === 'bottom' ? `bottom ${percent(100 - points[2][1])}` : `top ${percent(points[0][1])}`}`).join(', '),
    maskSize: paths.map((points) =>
      `${percent(points[2][0] - points[0][0])} ${percent(points[2][1] - points[0][1])}`).join(', '),
    maskOrigin: 'fill-box',
    maskClip: 'fill-box',
  };
}

function shapeMask(paths: readonly (readonly Point[])[], evenodd = false): Keyframe {
  const coordinate = (value: number) => Math.round(value * 1000) / 1000;
  const d = paths.map((points) =>
    `M${coordinate(points[0][0])} ${coordinate(points[0][1])} `
      + points.slice(1).map(([x, y]) => `L${coordinate(x)} ${coordinate(y)}`).join(' ')
      + ' Z').join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><path fill="#000" fill-rule="${evenodd ? 'evenodd' : 'nonzero'}" d="${d}"/></svg>`;
  return {
    opacity: 1,
    maskImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
    maskSize: '100% 100%',
    maskOrigin: 'fill-box',
    maskClip: 'fill-box',
  };
}

function rect(left: number, top: number, right: number, bottom: number): Point[] {
  return [[left, top], [right, top], [right, bottom], [left, bottom]];
}

export function splitClip(dir: string | undefined, open: boolean): Keyframe {
  const vertical = dir?.endsWith('vert') ?? true;
  const inward = dir?.startsWith('in') ?? false;
  const span = open ? 50 : 0;
  if (vertical) return rectMask(inward
    ? [rect(0, 0, span, 100), rect(100 - span, 0, 100, 100)]
    : [rect(50 - span, 0, 50, 100), rect(50, 0, 50 + span, 100)]);
  return rectMask(inward
    ? [rect(0, 0, 100, span), rect(0, 100 - span, 100, 100)]
    : [rect(0, 50 - span, 100, 50), rect(0, 50, 100, 50 + span)]);
}

export function checkerboardClip(dir: string | undefined, open: boolean): Keyframe {
  const paths: Point[][] = [];
  for (let row = 0; row < 6; row++) for (let col = 0; col < 8; col++) {
    const left = col * 12.5;
    const top = row * (100 / 6);
    const right = left + 12.5;
    const bottom = top + 100 / 6;
    const reverse = (row + col) % 2 === 1;
    if (dir === 'down') {
      paths.push(rect(left, reverse ? bottom - (open ? bottom - top : 0) : top,
        right, reverse ? bottom : top + (open ? bottom - top : 0)));
    } else {
      paths.push(rect(reverse ? right - (open ? right - left : 0) : left, top,
        reverse ? right : left + (open ? right - left : 0), bottom));
    }
  }
  return rectMask(paths);
}

export function randomBarsClip(dir: string | undefined, open: boolean | number): Keyframe {
  const vertical = dir === 'vert';
  const count = 128;
  const progress = typeof open === 'boolean' ? Number(open) : open;
  const paths: Point[][] = [];
  for (let index = 0; index < count; index++) {
    const start = index * 100 / count;
    const end = (index + 1) * 100 / count;
    const rank = (index * 73) % count;
    const span = Math.min(1, Math.max(0, progress * count - rank)) * (end - start);
    paths.push(vertical
      ? rect(start, 0, start + span, 100)
      : rect(0, start, 100, start + span));
  }
  return rectMask(paths);
}

export function stripsClip(dir: string | undefined, open: boolean | number): Keyframe {
  const left = dir?.startsWith('l') ?? false;
  const up = dir?.endsWith('u') ?? false;
  const progress = typeof open === 'boolean' ? Number(open) : open;
  const count = 8;
  const paths: Point[][] = [];
  for (let row = 0; row < count; row++) {
    const top = row * 100 / count;
    const bottom = (row + 1) * 100 / count;
    const delay = (up ? count - row - 1 : row) / (2 * count);
    const extent = Math.min(1, Math.max(0, (progress - delay) / (1 - (count - 1) / (2 * count))));
    const width = extent * 100;
    paths.push(left ? rect(100 - width, top, 100, bottom) : rect(0, top, width, bottom));
  }
  return rectMask(paths, left ? paths.map(() => ({ x: 'right' })) : []);
}

function irisPoints(effect: 'circle' | 'diamond' | 'plus', radius: number): Point[] {
  if (effect === 'circle') return Array.from({ length: 40 }, (_, index) => {
    const angle = index * Math.PI / 20 - Math.PI / 2;
    return [50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle)];
  });
  if (effect === 'diamond') return [[50, 50 - radius], [50 + radius, 50],
    [50, 50 + radius], [50 - radius, 50]];
  const thin = radius / 3;
  return [[50 - thin, 50 - radius], [50 + thin, 50 - radius],
    [50 + thin, 50 - thin], [50 + radius, 50 - thin],
    [50 + radius, 50 + thin], [50 + thin, 50 + thin],
    [50 + thin, 50 + radius], [50 - thin, 50 + radius],
    [50 - thin, 50 + thin], [50 - radius, 50 + thin],
    [50 - radius, 50 - thin], [50 - thin, 50 - thin]];
}

export function irisClip(effect: 'circle' | 'diamond' | 'plus', dir: string | undefined, open: boolean | number): Keyframe {
  const progress = typeof open === 'boolean' ? Number(open) : open;
  if (effect === 'plus' && dir === 'in') {
    const span = progress * 50;
    return rectMask([
      rect(0, 0, span, span), rect(100 - span, 0, 100, span),
      rect(0, 100 - span, span, 100), rect(100 - span, 100 - span, 100, 100),
    ], [{}, { x: 'right' }, { y: 'bottom' }, { x: 'right', y: 'bottom' }]);
  }
  const fullRadius = effect === 'circle' ? 72 : effect === 'diamond' ? 101 : 151;
  const radius = (dir === 'in' ? 1 - progress : progress) * fullRadius;
  const aperture = irisPoints(effect, radius);
  return dir === 'in'
    ? shapeMask([rect(0, 0, 100, 100), aperture], true)
    : shapeMask([aperture]);
}

export function wheelClip(spokes: string | undefined, open: boolean | number): Keyframe {
  const count = [1, 2, 3, 4, 8].includes(Number(spokes)) ? Number(spokes) : 1;
  const progress = typeof open === 'boolean' ? Number(open) : open;
  const paths: Point[][] = [];
  for (let sector = 0; sector < count; sector++) {
    const start = -Math.PI / 2 + sector * 2 * Math.PI / count;
    const sweep = progress * 2 * Math.PI / count;
    const arc: Point[] = [[50, 50]];
    for (let index = 0; index <= 16; index++) {
      const angle = start + sweep * index / 16;
      arc.push([50 + 200 * Math.cos(angle), 50 + 200 * Math.sin(angle)]);
    }
    paths.push(arc);
  }
  return shapeMask(paths);
}

export function dissolveClip(open: boolean | number, seed: number): Keyframe {
  const progress = typeof open === 'boolean' ? Number(open) : open;
  const paths: Point[][] = [];
  for (let row = 0; row < 8; row++) for (let col = 0; col < 10; col++) {
    const left = col * 10;
    const top = row * 12.5;
    const right = (col + 1) * 10;
    const bottom = (row + 1) * 12.5;
    let hash = Math.imul(row * 10 + col + seed * 101, 0x45d9f3b);
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
    hash = (hash ^ (hash >>> 16)) >>> 0;
    const turn = (hash % 17) / 17;
    const centerX = left + (right - left) * turn;
    const centerY = top + (bottom - top) * (1 - turn);
    const rank = (hash >>> 8) % 8;
    const extent = Math.min(1, Math.max(0, progress * 8 - rank));
    paths.push(rect(
      centerX + (left - centerX) * extent,
      centerY + (top - centerY) * extent,
      centerX + (right - centerX) * extent,
      centerY + (bottom - centerY) * extent,
    ));
  }
  return rectMask(paths);
}
