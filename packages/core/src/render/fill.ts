import type { Fill } from '../types';
import { imageFillPaint } from './image-fill';
import type { ImageFillContext } from './image-fill';

const round = (value: number): string =>
  Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0';

const PATTERN_DEFS: Record<string, string> = {
  pct5: 'M0 0h1v1H0z', pct10: 'M0 0h1v1H0z', pct20: 'M0 0h2v2H0z', pct25: 'M0 0h2v2H0z',
  pct30: 'M0 0h2v2H0zM2 2h2v2H2z', pct40: 'M0 0h2v2H0zM2 2h2v2H2z', pct50: 'M0 0h2v2H0zM2 2h2v2H2z',
  pct60: 'M0 0h3v3H0z', pct70: 'M0 0h3v3H0z', pct75: 'M0 0h3v3H0z', pct80: 'M0 0h4v4H0z', pct90: 'M0 0h4v4H0z',
  ltHorz: 'M0 2h8v1H0z', horz: 'M0 2h8v2H0z', dkHorz: 'M0 1h8v3H0z',
  ltVert: 'M2 0h1v8H0z', vert: 'M2 0h2v8H2z', dkVert: 'M1 0h3v8H1z',
  ltUpDiag: 'M0 8L8 0M-2 2L2 -2M6 10L10 6', upDiag: 'M0 8L8 0M-2 2L2 -2M6 10L10 6',
  ltDnDiag: 'M0 0L8 8M-2 6L2 10M6 -2L10 2', dnDiag: 'M0 0L8 8M-2 6L2 10M6 -2L10 2',
  smGrid: 'M0 0h8v1H0zM0 0h1v8H0z', lgGrid: 'M0 0h8v1H0zM0 0h1v8H0z',
  cross: 'M0 3h8v2H0zM3 0h2v8H3z', diagCross: 'M0 0L8 8M8 0L0 8',
  trellis: 'M0 0L8 8M8 0L0 8', wave: 'M0 4Q2 2 4 4T8 4',
};

const PATTERN_SIZE: Record<string, number> = {
  pct5: 8, pct10: 6, pct20: 5, pct25: 4, pct30: 4, pct40: 4, pct50: 4,
  pct60: 4, pct70: 4, pct75: 4, pct80: 5, pct90: 5,
};

export function paint(fill: Fill, ctx: ImageFillContext, w: number, h: number): string {
  switch (fill.type) {
    case 'none': return 'none';
    case 'solid': return fill.color;
    case 'gradient': {
      const id = ctx.nextId('g');
      const stops = fill.stops
        .map((stop) => `<stop offset="${round(Math.max(0, Math.min(1, stop.pos)) * 100)}%" stop-color="${stop.color}"/>`)
        .join('');
      if (fill.radial) {
        ctx.defs.push(`<radialGradient id="${id}" cx="50%" cy="50%" r="70%">${stops}</radialGradient>`);
      } else {
        const radians = (fill.angle * Math.PI) / 180;
        const dx = Math.cos(radians) / 2;
        const dy = Math.sin(radians) / 2;
        ctx.defs.push(
          `<linearGradient id="${id}" x1="${round(0.5 - dx)}" y1="${round(0.5 - dy)}" `
          + `x2="${round(0.5 + dx)}" y2="${round(0.5 + dy)}">${stops}</linearGradient>`,
        );
      }
      return `url(#${id})`;
    }
    case 'image': return imageFillPaint(fill, ctx, w, h);
    case 'pattern': {
      const id = ctx.nextId('pt');
      const size = PATTERN_SIZE[fill.preset] ?? 8;
      const path = PATTERN_DEFS[fill.preset] ?? PATTERN_DEFS.pct50;
      const stroked = /^[MLQT].*[ML]/.test(path) && !path.includes('h') && !path.includes('v');
      ctx.defs.push(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${size}" height="${size}">`
        + `<rect width="${size}" height="${size}" fill="${fill.bg}"/>`
        + `<path d="${path}" ${stroked ? `stroke="${fill.fg}" stroke-width="1" fill="none"` : `fill="${fill.fg}"`}/>`
        + '</pattern>',
      );
      return `url(#${id})`;
    }
  }
}
