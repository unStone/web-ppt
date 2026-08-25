import type { Effects, ElementBase } from '../types';

interface EffectContext {
  readonly defs: string[];
  readonly nextId: (prefix: string) => string;
}
const round = (value: number): string =>
  Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0';

export function effectFilter(effects: Effects | undefined, ctx: EffectContext): string {
  if (!effects) return '';
  const parts: string[] = [];
  let last = 'SourceGraphic';
  let sequence = 0;
  const step = (markup: string): void => {
    const out = `e${++sequence}`;
    parts.push(markup.replace(/__IN__/g, last).replace(/__OUT__/g, out));
    last = out;
  };
  if (effects.glow) {
    step(`<feDropShadow in="__IN__" dx="0" dy="0" stdDeviation="${round(effects.glow.radius / 2)}" `
      + `flood-color="${effects.glow.color}" flood-opacity="1" result="__OUT__"/>`);
  }
  const shadow = effects.shadow;
  if (shadow && !shadow.inner) {
    step(`<feDropShadow in="__IN__" dx="${round(shadow.dx)}" dy="${round(shadow.dy)}" `
      + `stdDeviation="${round(shadow.blur / 2)}" flood-color="${shadow.color}" result="__OUT__"/>`);
  }
  if (shadow?.inner) {
    const prefix = `is${sequence}`;
    parts.push(
      `<feComponentTransfer in="SourceAlpha" result="${prefix}a"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>`
      + `<feGaussianBlur in="${prefix}a" stdDeviation="${round(shadow.blur / 2)}" result="${prefix}b"/>`
      + `<feOffset in="${prefix}b" dx="${round(shadow.dx)}" dy="${round(shadow.dy)}" result="${prefix}c"/>`
      + `<feComposite in="${prefix}c" in2="SourceAlpha" operator="in" result="${prefix}d"/>`
      + `<feFlood flood-color="${shadow.color}" result="${prefix}e"/>`
      + `<feComposite in="${prefix}e" in2="${prefix}d" operator="in" result="${prefix}f"/>`,
    );
    step(`<feComposite in="${prefix}f" in2="__IN__" operator="over" result="__OUT__"/>`);
  }
  if (effects.softEdge) {
    parts.push(
      `<feGaussianBlur in="SourceAlpha" stdDeviation="${round(effects.softEdge / 2)}" result="se"/>`
      + '<feComponentTransfer in="se" result="seMask"><feFuncA type="linear" slope="2.2" intercept="-0.6"/></feComponentTransfer>',
    );
    step('<feComposite in="__IN__" in2="seMask" operator="in" result="__OUT__"/>');
  }
  if (!parts.length) return '';
  const id = ctx.nextId('f');
  ctx.defs.push(`<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%">${parts.join('')}</filter>`);
  return ` filter="url(#${id})"`;
}

export function reflectionLayer(el: ElementBase, refId: string, ctx: EffectContext): string {
  const reflection = el.effects?.reflection;
  if (!reflection) return '';
  const alpha = Math.max(0, Math.min(1, reflection.alpha));
  if (alpha <= 0 || el.h <= 0) return '';
  const distance = Math.max(0, reflection.distance);
  const top = el.h + distance;
  const band = Math.max(1, el.h * Math.max(0.02, Math.min(1, reflection.size)));
  const x = -el.w * 0.25;
  const width = el.w * 1.5;
  const gradientId = ctx.nextId('rg');
  const maskId = ctx.nextId('rm');
  ctx.defs.push(
    `<linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="0" y1="${round(top)}" `
    + `x2="0" y2="${round(top + band)}"><stop offset="0" stop-color="#fff" stop-opacity="${round(alpha)}"/>`
    + '<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>',
  );
  ctx.defs.push(
    `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${round(x)}" y="${round(top)}" `
    + `width="${round(width)}" height="${round(band)}"><rect x="${round(x)}" y="${round(top)}" `
    + `width="${round(width)}" height="${round(band)}" fill="url(#${gradientId})"/></mask>`,
  );
  return `<g mask="url(#${maskId})" aria-hidden="true"><use href="#${refId}" xlink:href="#${refId}" `
    + `transform="translate(0 ${round(2 * el.h + distance)}) scale(1 -1)"/></g>`;
}
