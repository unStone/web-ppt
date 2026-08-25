import type { Shape3D, ShapeElement } from '../types';

interface Shape3DContext {
  readonly defs: string[];
  readonly nextId: (prefix: string) => string;
}

const round = (value: number): string =>
  Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0';

export function mixShapeColor(color: string, target: string, ratio: number): string {
  const parse = (source: string): [number, number, number] => {
    const functional = source.match(/rgba?\(([^)]+)\)/);
    if (functional) {
      const parts = functional[1].split(',').map((value) => Number(value.trim()));
      return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
    }
    const hex = source.replace('#', '');
    return hex.length >= 6
      ? [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
      : [128, 128, 128];
  };
  const from = parse(color);
  const to = parse(target);
  const output = from.map((value, index) => Math.round(value * (1 - ratio) + to[index] * ratio));
  return `rgb(${output[0]},${output[1]},${output[2]})`;
}

export function extrusionLayers(el: ShapeElement, shape3d: Shape3D, baseColor: string): string {
  const depth = Math.min(shape3d.extrusion ?? 0, Math.max(el.w, el.h));
  if (depth <= 0.5) return '';
  const angle = (((shape3d.rotY ?? 0) || 35) * Math.PI) / 180;
  const dx = Math.cos(angle) * depth;
  const dy = Math.sin((((shape3d.rotX ?? 0) || 20) * Math.PI) / 180) * depth;
  const side = shape3d.extrusionColor ?? mixShapeColor(baseColor, '#000', 0.32);
  const steps = Math.max(2, Math.min(14, Math.round(depth)));
  const output: string[] = [];
  for (let index = steps; index >= 1; index--) {
    const progress = index / steps;
    output.push(`<g transform="translate(${round(dx * progress)} ${round(dy * progress)})">`
      + `<path d="${el.path}" fill="${side}" fill-rule="nonzero"/></g>`);
  }
  return output.join('');
}

export function bevelOverlay(
  el: ShapeElement,
  shape3d: Shape3D,
  baseColor: string,
  ctx: Shape3DContext,
): string {
  const bevel = shape3d.bevelTop ?? 0;
  if (bevel <= 0.3 || !el.path) return '';
  const light = mixShapeColor(baseColor, '#fff', 0.5);
  const dark = mixShapeColor(baseColor, '#000', 0.25);
  const width = Math.min(bevel * 2, Math.min(el.w, el.h) / 3);
  const id = ctx.nextId('bv');
  ctx.defs.push(`<clipPath id="${id}"><path d="${el.path}"/></clipPath>`);
  return `<g clip-path="url(#${id})"><path d="${el.path}" fill="none" stroke="${light}" `
    + `stroke-width="${round(width)}" stroke-linejoin="round" opacity="0.55"/>`
    + `<path d="${el.path}" fill="none" stroke="${dark}" stroke-width="${round(width / 3)}" `
    + `stroke-linejoin="round" opacity="0.35" transform="translate(0 ${round(width / 3)})"/></g>`;
}
