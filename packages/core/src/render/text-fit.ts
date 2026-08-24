import type { TextBody } from '../types';
import { layoutText } from './text-layout';
import type { TextLayoutOptions } from './text-layout-types';

/**
 * 求 `spAutoFit` 形状的最小物理高度。
 *
 * 以与公开行盒完全相同的溢出判据做单调搜索；竖排时增高会扩大逻辑行宽，
 * 分栏时又会改变分桶点，因此不能把最后一行坐标当成内容高度。
 */
export function fitTextShapeHeight(
  text: TextBody,
  width: number,
  options: TextLayoutOptions = {},
): number {
  if (!Number.isFinite(width) || width <= 0) throw new Error('文字形状宽度必须是有限正数');
  const fits = (height: number): boolean => !layoutText(text, width, height, {
    ...options,
    includeCarets: false,
  }).overflow;
  let upper = 1;
  for (let attempt = 0; attempt < 32 && !fits(upper); attempt++) upper *= 2;
  if (!fits(upper)) throw new Error('spAutoFit 无法在有限高度内容纳文字');
  let lower = 0;
  for (let attempt = 0; attempt < 24; attempt++) {
    const middle = (lower + upper) / 2;
    if (fits(middle)) upper = middle;
    else lower = middle;
  }
  return upper;
}
