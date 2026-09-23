/**
 * 百叶窗和盒状的裁剪窗口。
 *
 * 百分比必须相对形状的 fill-box。动画挂在 `data-el` 的 `<g>` 上，
 * 不写 geometry box 时百分比相对整页视口，条带会铺到幻灯片而不是对象上。
 *
 * 百叶窗固定 6 条，每条从自己槽位的中线向两侧打开，内容不缩放。
 * 盒状只揭开、不缩放：`in` 从四边向中心收，`out` 从中心矩形向四边扩。
 */

const SLATS = 6;

function percent(value: number): string {
  return `${Math.round(value * 1000) / 1000}%`;
}

function polygon(points: readonly (readonly [number, number])[]): string {
  return `polygon(${points.map(([x, y]) => `${percent(x)} ${percent(y)}`).join(',')}) fill-box`;
}

/** `vert` 是竖条，其余（含 horizontal）是横条。 */
export function blindsClip(dir: string | undefined, open: boolean): string {
  const vertical = dir === 'vert';
  const points: [number, number][] = [];
  for (let index = 0; index < SLATS; index++) {
    const start = (index / SLATS) * 100;
    const end = ((index + 1) / SLATS) * 100;
    const mid = (start + end) / 2;
    const near = open ? start : mid;
    const far = open ? end : mid;
    if (vertical) points.push([near, 0], [far, 0], [far, 100], [near, 100]);
    else points.push([0, near], [100, near], [100, far], [0, far]);
  }
  return polygon(points);
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
  const scale = open ? 0.5 : 0;
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

/**
 * 向内用一条矩形洞，不用四块蒙版。
 * 百分比定位的蒙版条会对不齐，窗口不再是长方形；上下各 50% 在像素上对不齐时，
 * 结束帧中间会留下一条细缝。洞收到中心点后面积是 0，文字完整露出来。
 */
export function boxInClip(open: boolean, region: ClipRegion = FULL_REGION): string {
  const left = open ? region.l + region.w / 2 : region.l;
  const top = open ? region.t + region.h / 2 : region.t;
  const right = open ? region.l + region.w / 2 : region.l + region.w;
  const bottom = open ? region.t + region.h / 2 : region.t + region.h;
  const hole = [
    `${percent(left)} ${percent(top)}`,
    `${percent(right)} ${percent(top)}`,
    `${percent(right)} ${percent(bottom)}`,
    `${percent(left)} ${percent(bottom)}`,
  ];
  return 'shape(evenodd from 0% 0%, line to 100% 0%, line to 100% 100%, line to 0% 100%, close, '
    + `move to ${hole[0]}, line to ${hole[1]}, line to ${hole[2]}, line to ${hole[3]}, close)`;
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
