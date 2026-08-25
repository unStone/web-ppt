import type { ImageTile, ImageTileAlignment } from '@web-ppt/core';
import { assertDataObject } from '../data-validation';

const TILE_FLIPS = new Set(['none', 'x', 'y', 'xy']);
const TILE_ALIGNMENTS = new Set<ImageTileAlignment>(['tl', 't', 'tr', 'l', 'ctr', 'r', 'bl', 'b', 'br']);

function normalizeTile(value: unknown, label: string, sourceDimensions: boolean): ImageTile | undefined {
  if (value === undefined) return undefined;
  assertDataObject(value, [
    'sx', 'sy', 'flip', 'tx', 'ty', 'algn',
    ...(sourceDimensions ? ['sourceWidth', 'sourceHeight'] : []),
  ], label);
  const tile = value as Partial<ImageTile>;
  if (typeof tile.sx !== 'number' || !Number.isFinite(tile.sx) || tile.sx <= 0
    || typeof tile.sy !== 'number' || !Number.isFinite(tile.sy) || tile.sy <= 0
    || typeof tile.flip !== 'string' || !TILE_FLIPS.has(tile.flip)
    || (tile.tx !== undefined && (typeof tile.tx !== 'number' || !Number.isFinite(tile.tx)))
    || (tile.ty !== undefined && (typeof tile.ty !== 'number' || !Number.isFinite(tile.ty)))
    || (tile.algn !== undefined && !TILE_ALIGNMENTS.has(tile.algn))) {
    throw new Error(`${label} 的缩放、偏移、对齐或翻转无效`);
  }
  const hasWidth = tile.sourceWidth !== undefined;
  const hasHeight = tile.sourceHeight !== undefined;
  if (sourceDimensions && (hasWidth !== hasHeight || (hasWidth
    && (typeof tile.sourceWidth !== 'number' || !Number.isFinite(tile.sourceWidth) || tile.sourceWidth <= 0
      || typeof tile.sourceHeight !== 'number' || !Number.isFinite(tile.sourceHeight) || tile.sourceHeight <= 0)))) {
    throw new Error(`${label} 的来源图片物理尺寸无效`);
  }
  const round = (number: number): number => Math.round(number * 100000) / 100000;
  return {
    sx: round(tile.sx), sy: round(tile.sy), flip: tile.flip,
    tx: round(tile.tx ?? 0), ty: round(tile.ty ?? 0), algn: tile.algn ?? 'tl',
    ...(hasWidth ? { sourceWidth: round(tile.sourceWidth!), sourceHeight: round(tile.sourceHeight!) } : {}),
  };
}

/** 命令入口与远端 patch 共用同一平铺边界，避免协同载荷绕过本地校验。 */
export function normalizeSlideImageTile(value: unknown, label: string): ImageTile | undefined {
  return normalizeTile(value, label, true);
}

export function normalizeSlideImageTilePlacement(value: unknown, label: string): ImageTile | undefined {
  return normalizeTile(value, label, false);
}
