import { parse, modeRgb, useMode } from 'culori/fn';
import type { Fill } from '@web-ppt/core';
import { LayoutLintError } from './types';
useMode(modeRgb);
export function color(value: string): readonly [number, number, number, number] {
  const c = typeof value === 'string' ? parse(value) : undefined;
  if (!c || c.mode !== 'rgb' || ![c.r, c.g, c.b, c.alpha ?? 1].every(n => typeof n === 'number' && Number.isFinite(n))) throw new LayoutLintError('invalid-color', `无法分析 sRGB 颜色：${String(value)}`);
  return [c.r, c.g, c.b, c.alpha ?? 1].map(n => Math.max(0, Math.min(1, n))) as unknown as readonly [number, number, number, number];
}
export function over(fg: readonly number[], bg: readonly number[]): readonly [number, number, number, number] {
  const a = fg[3]; return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}
export function contrast(fg: readonly number[], bg: readonly number[]): number {
  const light = (c: readonly number[]) => c.slice(0, 3).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
  const a = light(over(fg, bg)), b = light(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
export function paint(fill: Fill | null | undefined, bg: readonly number[]): readonly number[] | null {
  return !fill || fill.type === 'none' ? bg : fill.type === 'solid' ? over(color(fill.color), bg) : null;
}
