import type { Presentation } from './types';
const MAX_CANVAS_EDGE = 32_767;

export function validateRasterSize(
  pres: Presentation,
  scale: number,
): { width: number; height: number } {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('scale 必须是大于 0 的有限数');
  }
  const width = Math.round(pres.width * scale);
  const height = Math.round(pres.height * scale);
  if (width < 1 || height < 1 || width > MAX_CANVAS_EDGE || height > MAX_CANVAS_EDGE) {
    throw new RangeError(`scale 产生了浏览器 canvas 不支持的尺寸：${width}×${height}`);
  }
  return { width, height };
}

