import { n } from '../gdi';
import type { Mat } from '../gdi';
import type { Paint, Pen } from './objects';
import { unitScale } from './binary';

let serial = 0;
export const id = (): string => `emfp${++serial}`;
export const transform = (m: Mat): string => `matrix(${m.map(n).join(' ')})`;
export function paint(value: Paint, defs: string[]): string {
  if (value.kind === 'solid') return value.color;
  const key = id();
  if (value.kind === 'gradient') {
    const b = value.box;
    defs.push(`<linearGradient id="${key}" gradientUnits="userSpaceOnUse" x1="${n(b.x)}" y1="${n(b.y)}" x2="${n(b.x + b.w)}" y2="${n(b.y + b.h)}" spreadMethod="${value.wrap === 4 ? 'pad' : value.wrap ? 'reflect' : 'repeat'}" color-interpolation="${value.gamma ? 'linearRGB' : 'sRGB'}"${value.matrix ? ` gradientTransform="${transform(value.matrix)}"` : ''}>${value.stops.map(s => `<stop offset="${n(s.offset * 100)}%" stop-color="${s.color}"/>`).join('')}</linearGradient>`);
  } else {
    const lines = ['M0 4H8', 'M4 0V8', 'M-1 1L7 9M1-1L9 7', 'M-1 7L7-1M1 9L9 1', 'M0 4H8M4 0V8', 'M-1 1L7 9M1-1L9 7M-1 7L7-1M1 9L9 1'];
    defs.push(`<pattern id="${key}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${value.background}"/><path d="${lines[value.style]}" stroke="${value.color}" fill="none"/></pattern>`);
  }
  return `url(#${key})`;
}
export function stroke(p: Pen, dpi: number, pageY: number, defs: string[]): string {
  if (p.start !== p.end) throw new Error('EMF+ 非对称线帽暂不支持');
  const width = p.width ? p.width * (p.unit === 0 ? 1 : unitScale(p.unit, dpi) / pageY) : 1 / pageY;
  return `fill="none" stroke="${paint(p.paint, defs)}" stroke-width="${n(width)}" stroke-linecap="${['butt', 'square', 'round'][p.start]}" stroke-linejoin="${['miter', 'bevel', 'round', 'miter'][p.join]}" stroke-miterlimit="${n(Math.max(1, p.miter))}"${p.dash.length ? ` stroke-dasharray="${p.dash.map(v => n(v * width)).join(' ')}" stroke-dashoffset="${n(p.offset * width)}"` : ''}`;
}
