import { attr, kid, numAttr } from '../xml';

export interface ColorCtx {
  /** clrScheme 名 → "RRGGBB" */
  theme: Record<string, string>;
  /** bg1 → lt1 等映射（来自母版 clrMap） */
  clrMap: Record<string, string>;
  /** 主题样式引用时的占位色（schemeClr val="phClr"），形如 "rgb(r,g,b)" */
  phClr?: string;
}

type RGB = [number, number, number];

const SYS: Record<string, string> = { window: 'FFFFFF', windowText: '000000' };

const PRST: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', lime: '00FF00',
  blue: '0000FF', yellow: 'FFFF00', cyan: '00FFFF', magenta: 'FF00FF', gray: '808080',
  ltGray: 'C0C0C0', dkGray: '404040', orange: 'FFA500', purple: '800080', brown: 'A52A2A',
};

const COLOR_TAGS = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr'];

/** 在 parent 的直接子节点中找颜色元素并解析；找不到返回 null */
export function childColor(parent: Element | null, ctx: ColorCtx): string | null {
  if (!parent) return null;
  for (const tag of COLOR_TAGS) {
    const el = kid(parent, tag);
    if (el) return parseColor(el, ctx);
  }
  return null;
}

export function parseColor(el: Element, ctx: ColorCtx): string {
  let rgb = baseColor(el, ctx);
  let alpha = 1;
  for (let n = el.firstElementChild; n; n = n.nextElementSibling) {
    const val = (numAttr(n, 'val') ?? 0) / 100000;
    switch (n.localName) {
      case 'alpha': alpha = val; break;
      // shade / tint 在**线性** RGB 空间做，直接对 sRGB 分量乘会明显偏暗 / 偏艳。
      // 实测对照 LibreOffice：线性空间误差 Δ≤8，sRGB 直乘最大 Δ≈69。
      case 'shade': rgb = inLinear(rgb, (c) => c * val); break;
      case 'tint': rgb = inLinear(rgb, (c) => c * val + (1 - val)); break;
      case 'lumMod': rgb = adjustHsl(rgb, (h, s, l) => [h, s, l * val]); break;
      case 'lumOff': rgb = adjustHsl(rgb, (h, s, l) => [h, s, l + val]); break;
      case 'satMod': rgb = adjustHsl(rgb, (h, s, l) => [h, s * val, l]); break;
    }
  }
  const [r, g, b] = rgb.map((c) => Math.round(clamp(c, 0, 255)));
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${Math.round(alpha * 1000) / 1000})`;
}

function baseColor(el: Element, ctx: ColorCtx): RGB {
  switch (el.localName) {
    case 'srgbClr':
      return hex(attr(el, 'val') ?? '000000');
    case 'sysClr':
      return hex(attr(el, 'lastClr') ?? SYS[attr(el, 'val') ?? ''] ?? '000000');
    case 'prstClr':
      return hex(PRST[attr(el, 'val') ?? ''] ?? '808080');
    case 'scrgbClr':
      return [
        ((numAttr(el, 'r') ?? 0) / 100000) * 255,
        ((numAttr(el, 'g') ?? 0) / 100000) * 255,
        ((numAttr(el, 'b') ?? 0) / 100000) * 255,
      ];
    case 'hslClr':
      return hslToRgb(
        ((numAttr(el, 'hue') ?? 0) / 60000) / 360,
        (numAttr(el, 'sat') ?? 0) / 100000,
        (numAttr(el, 'lum') ?? 0) / 100000,
      );
    case 'schemeClr': {
      const name = attr(el, 'val') ?? 'tx1';
      if (name === 'phClr') return ctx.phClr ? parseCssRgb(ctx.phClr) : [128, 128, 128];
      const mapped = ctx.clrMap[name] ?? name;
      return hex(ctx.theme[mapped] ?? ctx.theme[name] ?? '000000');
    }
  }
  return [0, 0, 0];
}

/** "rgb(1,2,3)" / "rgba(...)" / "#RRGGBB" → RGB */
export function parseCssRgb(v: string): RGB {
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').map((s) => Number(s.trim()));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  }
  return hex(v);
}

function hex(v: string): RGB {
  const s = v.replace('#', '').padStart(6, '0');
  return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const srgbToLinear = (c: number): number => {
  const n = c / 255;
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb = (c: number): number => {
  const n = clamp(c, 0, 1);
  return (n <= 0.0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - 0.055) * 255;
};

/** 在线性 RGB 空间上逐分量运算，再转回 sRGB */
function inLinear(rgb: RGB, fn: (c: number) => number): RGB {
  return rgb.map((c) => linearToSrgb(fn(srgbToLinear(c)))) as RGB;
}

function adjustHsl(rgb: RGB, fn: (h: number, s: number, l: number) => [number, number, number]): RGB {
  const [h, s, l] = rgbToHsl(rgb);
  const [h2, s2, l2] = fn(h, s, l);
  return hslToRgb(h2, clamp(s2, 0, 1), clamp(l2, 0, 1));
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
