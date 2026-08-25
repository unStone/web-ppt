import type { Fill, ImageTileAlignment } from '../types';

type ImageFill = Extract<Fill, { type: 'image' }>;

export interface ImageFillContext {
  readonly defs: string[];
  readonly nextId: (prefix: string) => string;
}
const round = (value: number): string =>
  Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0';
const escapeXml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// DrawingML srcRect 以十万分数存储；合法编辑值最小可见比例是 1/100000。
const MIN_CROP_FRACTION = 1 / 100000;
const MIN_TILE_SIZE = 0.01;

function tiledImageCell(
  fill: ImageFill,
  x: number,
  y: number,
  width: number,
  height: number,
  flipH: boolean,
  flipV: boolean,
): string {
  const crop = fill.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const imageWidth = width / Math.max(1 - crop.l - crop.r, MIN_CROP_FRACTION);
  const imageHeight = height / Math.max(1 - crop.t - crop.b, MIN_CROP_FRACTION);
  const image = `<image href="${escapeXml(fill.src)}" x="${round(-crop.l * imageWidth)}" `
    + `y="${round(-crop.t * imageHeight)}" width="${round(imageWidth)}" height="${round(imageHeight)}" `
    + 'preserveAspectRatio="none"'
    + (fill.alpha !== undefined ? ` opacity="${round(fill.alpha)}"` : '') + '/>';
  const transformed = flipH || flipV
    ? `<g transform="translate(${round(flipH ? width : 0)} ${round(flipV ? height : 0)}) `
      + `scale(${flipH ? -1 : 1} ${flipV ? -1 : 1})">${image}</g>`
    : image;
  // 每个交替翻转单元先裁到自己的格子，否则放大后的 srcRect 会串进相邻格。
  return `<svg x="${round(x)}" y="${round(y)}" width="${round(width)}" `
    + `height="${round(height)}" overflow="hidden">${transformed}</svg>`;
}

function alignmentFactor(alignment: ImageTileAlignment | undefined): readonly [number, number] {
  switch (alignment ?? 'tl') {
    case 't': return [0.5, 0];
    case 'tr': return [1, 0];
    case 'l': return [0, 0.5];
    case 'ctr': return [0.5, 0.5];
    case 'r': return [1, 0.5];
    case 'bl': return [0, 1];
    case 'b': return [0.5, 1];
    case 'br': return [1, 1];
    default: return [0, 0];
  }
}

function tiledPaint(fill: ImageFill, ctx: ImageFillContext, id: string, w: number, h: number): void {
  const tile = fill.tile!;
  const crop = fill.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const visibleWidth = Math.max(1 - crop.l - crop.r, MIN_CROP_FRACTION);
  const visibleHeight = Math.max(1 - crop.t - crop.b, MIN_CROP_FRACTION);
  // OOXML 的 sx/sy 缩放图片 srcRect，而不是宿主页；旧生产者缺物理尺寸时才保留历史回退。
  const sourceWidth = tile.sourceWidth ?? w * 0.25;
  const sourceHeight = tile.sourceHeight ?? h * 0.25;
  const tileWidth = Math.max(MIN_TILE_SIZE, sourceWidth * visibleWidth * tile.sx);
  const tileHeight = Math.max(MIN_TILE_SIZE, sourceHeight * visibleHeight * tile.sy);
  const [alignX, alignY] = alignmentFactor(tile.algn);
  const originX = (w - tileWidth) * alignX + (tile.tx ?? 0);
  const originY = (h - tileHeight) * alignY + (tile.ty ?? 0);
  const alternateX = tile.flip === 'x' || tile.flip === 'xy';
  const alternateY = tile.flip === 'y' || tile.flip === 'xy';
  const columns = alternateX ? 2 : 1;
  const rows = alternateY ? 2 : 1;
  let cells = '';
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      cells += tiledImageCell(
        fill, column * tileWidth, row * tileHeight, tileWidth, tileHeight,
        column === 1, row === 1,
      );
    }
  }
  ctx.defs.push(
    `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${round(originX)}" y="${round(originY)}" `
    + `width="${round(tileWidth * columns)}" height="${round(tileHeight * rows)}">${cells}</pattern>`,
  );
}

export function imageFillPaint(fill: ImageFill, ctx: ImageFillContext, w: number, h: number): string {
  const id = ctx.nextId('p');
  if (fill.tile) {
    tiledPaint(fill, ctx, id, w, h);
  } else if (fill.crop && (fill.crop.l || fill.crop.t || fill.crop.r || fill.crop.b)) {
    const crop = fill.crop;
    const imageWidth = w / Math.max(1 - crop.l - crop.r, MIN_CROP_FRACTION);
    const imageHeight = h / Math.max(1 - crop.t - crop.b, MIN_CROP_FRACTION);
    ctx.defs.push(
      `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${round(w)}" height="${round(h)}">`
      + `<image href="${escapeXml(fill.src)}" x="${round(-crop.l * imageWidth)}" `
      + `y="${round(-crop.t * imageHeight)}" width="${round(imageWidth)}" height="${round(imageHeight)}" `
      + 'preserveAspectRatio="none"'
      + (fill.alpha !== undefined ? ` opacity="${round(fill.alpha)}"` : '') + '/></pattern>',
    );
  } else {
    ctx.defs.push(
      `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${round(w)}" height="${round(h)}">`
      + `<image href="${escapeXml(fill.src)}" width="${round(w)}" height="${round(h)}" `
      + 'preserveAspectRatio="none"'
      + (fill.alpha !== undefined ? ` opacity="${round(fill.alpha)}"` : '') + '/></pattern>',
    );
  }
  return `url(#${id})`;
}
