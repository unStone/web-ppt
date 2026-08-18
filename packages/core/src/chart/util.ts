/**
 * 图表模块的基础工具：像素/路径/元素构造、文本宽度估算、颜色、填充与线条解析、
 * 数字格式化、坐标轴「nice number」分级。
 */
import { ColorCtx, childColor } from '../pptx/color';
import type { Fill, Paragraph, ShapeElement, Stroke, TextBody, TextRun } from '../types';
import { attr, emu, kid, kids, numAttr } from '../xml';

/** 磅 → px */
export const px = (ptVal: number): number => (ptVal * 96) / 72;

export const nf = (v: number): string => {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const fin = (v: number, dflt = 0): number => (Number.isFinite(v) ? v : dflt);

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------- 元素构造 ----------

export function shapeEl(
  x: number,
  y: number,
  w: number,
  h: number,
  path: string | null,
  fill: Fill | null,
  stroke: Stroke | null,
): ShapeElement {
  return {
    kind: 'shape',
    x: fin(x),
    y: fin(y),
    w: Math.max(fin(w), 0),
    h: Math.max(fin(h), 0),
    rot: 0,
    flipH: false,
    flipV: false,
    path,
    fill,
    stroke,
    text: null,
  };
}

export const rectPath = (w: number, h: number): string =>
  `M 0 0 L ${nf(w)} 0 L ${nf(w)} ${nf(h)} L 0 ${nf(h)} Z`;

export function rectEl(r: Rect, fill: Fill | null, stroke: Stroke | null): ShapeElement {
  return shapeEl(r.x, r.y, r.w, r.h, rectPath(r.w, r.h), fill, stroke);
}

export function lineEl(x1: number, y1: number, x2: number, y2: number, stroke: Stroke | null): ShapeElement | null {
  if (!stroke) return null;
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return shapeEl(x, y, Math.abs(x2 - x1), Math.abs(y2 - y1),
    `M ${nf(x1 - x)} ${nf(y1 - y)} L ${nf(x2 - x)} ${nf(y2 - y)}`, null, stroke);
}

export type Pt = [number, number];

/** 多段折线（每段一个 subpath），坐标为图表局部绝对坐标，内部转成相对包围盒的 path */
export function polyEl(
  runs: Pt[][],
  fill: Fill | null,
  stroke: Stroke | null,
  close: boolean,
): ShapeElement | null {
  const valid = runs
    .map((r) => r.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)))
    .filter((r) => r.length >= (close ? 3 : 2));
  if (!valid.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const run of valid) {
    for (const [x, y] of run) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  const d = valid
    .map((run) => 'M ' + run.map(([x, y]) => `${nf(x - minX)} ${nf(y - minY)}`).join(' L ') + (close ? ' Z' : ''))
    .join(' ');
  return shapeEl(minX, minY, maxX - minX, maxY - minY, d, fill, stroke);
}

/**
 * 等轴测伪 3D 的「深度向量」：正面平面 → 背面平面的屏幕偏移。
 * 约定 dx>0 时背面偏右（可见左侧壁 / 右侧面），dy<0 时背面偏上（俯视，可见顶面）。
 */
export interface Depth3D {
  dx: number;
  dy: number;
}

/** 主色提亮（顶面）/ 压暗（侧面） */
export const lighten = (c: string, t = 0.25): string => mix(c, '#ffffff', t);
export const darken = (c: string, t = 0.2): string => mix(c, '#000000', t);

/** 四点面片 */
export function quadEl(pts: Pt[], fill: Fill | null, stroke: Stroke | null): ShapeElement | null {
  return polyEl([pts], fill, stroke, true);
}

export interface TextOpts {
  size?: number;
  color?: string;
  bold?: boolean;
  align?: Paragraph['align'];
  anchor?: TextBody['anchor'];
  fonts?: string[];
  rot?: number;
}

export function textEl(x: number, y: number, w: number, h: number, text: string, o: TextOpts = {}): ShapeElement {
  const run: TextRun = {
    text,
    b: o.bold ?? false,
    i: false,
    u: false,
    strike: false,
    size: o.size ?? px(10),
    color: o.color ?? 'rgb(0,0,0)',
    fonts: o.fonts ?? [],
  };
  const para: Paragraph = {
    align: o.align ?? 'center',
    lvl: 0,
    marL: 0,
    indent: 0,
    bullet: null,
    lineHeight: 1.15,
    spaceBefore: 0,
    spaceAfter: 0,
    runs: [run],
  };
  const body: TextBody = {
    anchor: o.anchor ?? 'middle',
    insets: [0, 0, 0, 0],
    wrap: false,
    fontScale: 1,
    paragraphs: [para],
  };
  return {
    kind: 'shape',
    x: fin(x),
    y: fin(y),
    w: Math.max(fin(w), 0),
    h: Math.max(fin(h), 0),
    rot: o.rot ?? 0,
    flipH: false,
    flipV: false,
    path: null,
    fill: null,
    stroke: null,
    text: body,
  };
}

/** 文本宽度估算（无 canvas 依赖）：CJK 按 1em，西文按经验宽度 */
export function measure(s: string, size: number): number {
  let units = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 32;
    if (c >= 0x1100 && c <= 0x1fff) units += 1;
    else if (c >= 0x2e80 && c <= 0xa4cf) units += 1;
    else if (c >= 0xac00 && c <= 0xd7a3) units += 1;
    else if (c >= 0xf900 && c <= 0xfaff) units += 1;
    else if (c >= 0xfe30 && c <= 0xff60) units += 1;
    else if ('iljtf.,:;\'"|!I[]()'.includes(ch)) units += 0.3;
    else if ('mwMW@%'.includes(ch)) units += 0.85;
    else if (ch >= 'A' && ch <= 'Z') units += 0.66;
    else units += 0.53;
  }
  return units * size;
}

// ---------- 颜色 ----------

export const solid = (color: string): Fill => ({ type: 'solid', color });

export function themeColor(ctx: ColorCtx, name: string): string {
  const mapped = ctx.clrMap[name] ?? name;
  const hex = (ctx.theme[mapped] ?? ctx.theme[name] ?? '000000').replace(/^#/, '');
  return '#' + (hex.length >= 6 ? hex.slice(0, 6) : hex.padStart(6, '0'));
}

export function toRgb(color: string): [number, number, number] {
  const s = color.trim();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padStart(6, '0');
    return [
      parseInt(full.slice(0, 2), 16) || 0,
      parseInt(full.slice(2, 4), 16) || 0,
      parseInt(full.slice(4, 6), 16) || 0,
    ];
  }
  const m = s.match(/-?[\d.]+/g);
  if (m && m.length >= 3) return [Number(m[0]) || 0, Number(m[1]) || 0, Number(m[2]) || 0];
  return [0, 0, 0];
}

export function withAlpha(color: string, a: number): string {
  const [r, g, b] = toRgb(color);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.round(clamp(a, 0, 1) * 1000) / 1000})`;
}

/** t=0 返回 a，t=1 返回 b */
export function mix(a: string, b: string, t: number): string {
  const A = toRgb(a);
  const B = toRgb(b);
  const k = clamp(t, 0, 1);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** 主题 accent1-6 循环；超过 6 个系列后依次提亮/加深 */
export function accentColor(ctx: ColorCtx, i: number): string {
  const idx = ((i % 6) + 6) % 6;
  const base = themeColor(ctx, `accent${idx + 1}`);
  const cycle = Math.floor(i / 6);
  if (cycle <= 0) return base;
  return cycle % 2 === 1
    ? mix(base, '#ffffff', clamp(0.3 * Math.ceil(cycle / 2), 0, 0.72))
    : mix(base, '#000000', clamp(0.22 * (cycle / 2), 0, 0.6));
}

// ---------- 填充 / 线条 ----------

export function parseFill(props: Element | null, ctx: ColorCtx): Fill | null {
  if (!props) return null;
  if (kid(props, 'noFill')) return { type: 'none' };
  const sf = kid(props, 'solidFill');
  if (sf) return solid(childColor(sf, ctx) ?? 'rgb(0,0,0)');
  const grad = kid(props, 'gradFill');
  if (grad) {
    const stops = kids(kid(grad, 'gsLst'), 'gs')
      .map((gs) => ({ pos: (numAttr(gs, 'pos') ?? 0) / 100000, color: childColor(gs, ctx) ?? 'rgb(0,0,0)' }))
      .sort((a, b) => a.pos - b.pos);
    if (!stops.length) return null;
    const lin = kid(grad, 'lin');
    return { type: 'gradient', angle: lin ? (numAttr(lin, 'ang') ?? 0) / 60000 : 90, stops };
  }
  const patt = kid(props, 'pattFill');
  if (patt) {
    const fg = childColor(kid(patt, 'fgClr'), ctx);
    if (fg) return solid(fg);
  }
  return null;
}

const DASH: Record<string, number[]> = {
  dash: [4, 3], dashDot: [4, 3, 1, 3], dot: [1, 3], lgDash: [8, 3],
  lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 3], sysDashDot: [3, 3, 1, 3], sysDashDotDot: [3, 3, 1, 3, 1, 3], sysDot: [1, 1],
};

export interface LnSpec {
  color: string | null;
  width: number | null;
  dash: number[] | null;
  /** 显式 noFill */
  none: boolean;
  present: boolean;
}

export const EMPTY_LN: LnSpec = { color: null, width: null, dash: null, none: false, present: false };

export function parseLn(ln: Element | null, ctx: ColorCtx): LnSpec {
  if (!ln) return { ...EMPTY_LN };
  const out: LnSpec = { color: null, width: null, dash: null, none: false, present: true };
  if (kid(ln, 'noFill')) {
    out.none = true;
    return out;
  }
  out.color = childColor(kid(ln, 'solidFill'), ctx);
  const w = numAttr(ln, 'w');
  if (w !== null) out.width = emu(w);
  const name = attr(kid(ln, 'prstDash'), 'val');
  if (name && name !== 'solid') out.dash = (DASH[name] ?? [4, 3]).map((m) => m * Math.max(out.width ?? 1, 1));
  return out;
}

export function strokeFrom(spec: LnSpec | null, defColor: string | null, defWidth: number): Stroke | null {
  const s = spec ?? EMPTY_LN;
  if (s.none) return null;
  const color = s.color ?? defColor;
  if (!color) return null;
  const width = s.width ?? defWidth;
  if (!(width > 0)) return null;
  return { color, width, dash: s.dash };
}

// ---------- 数字格式 ----------

function splitSections(code: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') { quoted = !quoted; cur += ch; continue; }
    if (ch === '\\') { cur += ch + (code[i + 1] ?? ''); i++; continue; }
    if (ch === ';' && !quoted) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const literal = (s: string): string =>
  s.replace(/\\(.)/g, '$1').replace(/"/g, '').replace(/[*_](.)/g, '').replace(/@/g, '');

function general(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e11 || a < 1e-4)) return v.toExponential(2);
  return String(Math.round(v * 1e6) / 1e6);
}

function group3(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function applySection(value: number, sec: string): string {
  const s = sec.replace(/\[[^\]]*\]/g, '');
  let v = value;
  const neg = v < 0;
  v = Math.abs(v);
  const percentCount = (s.match(/%/g) ?? []).length;
  if (percentCount) v *= Math.pow(100, percentCount);
  const m = s.match(/[#0?][#0?,]*(\.[#0?]+)?/);
  if (!m) return (neg ? '-' : '') + literal(s);
  const patt = m[0];
  const at = m.index ?? 0;
  const pre = literal(s.slice(0, at));
  const suf = literal(s.slice(at + patt.length));
  const dot = patt.indexOf('.');
  let intPatt = dot < 0 ? patt : patt.slice(0, dot);
  const decPatt = dot < 0 ? '' : patt.slice(dot + 1);
  const trail = intPatt.match(/,+$/);
  if (trail) {
    v /= Math.pow(1000, trail[0].length);
    intPatt = intPatt.slice(0, -trail[0].length);
  }
  const grouped = intPatt.includes(',');
  const maxDec = decPatt.length;
  const minDec = (decPatt.match(/0/g) ?? []).length;
  let body = v.toFixed(Math.min(maxDec, 20));
  if (maxDec > minDec) {
    body = body.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    const cut = body.split('.')[1] ?? '';
    if (cut.length < minDec) body = v.toFixed(minDec);
  }
  let [ip, dp] = body.split('.');
  const minInt = (intPatt.match(/0/g) ?? []).length;
  if (ip.length < minInt) ip = ip.padStart(minInt, '0');
  if (minInt === 0 && ip === '0' && dp) ip = '';
  if (grouped) ip = group3(ip);
  return (neg ? '-' : '') + pre + ip + (dp ? '.' + dp : '') + suf;
}

export function formatNumber(v: number, code: string | null): string {
  if (!Number.isFinite(v)) return '';
  const c = (code ?? '').trim();
  if (!c || /^general$/i.test(c)) return general(v);
  if (/e[+-]/i.test(c)) return v.toExponential(2);
  const secs = splitSections(c);
  if (v < 0 && secs.length > 1 && secs[1].trim()) return applySection(-v, secs[1]);
  if (v === 0 && secs.length > 2 && secs[2].trim()) return applySection(0, secs[2]);
  return applySection(v, secs[0] ?? '');
}

// ---------- 刻度分级 ----------

export interface Scale {
  min: number;
  max: number;
  step: number;
}

const round12 = (v: number): number => Number(v.toPrecision(12));

/** 1/2/5 × 10^n 分级 */
export function niceScale(lo: number, hi: number, target = 5): Scale {
  let a = Number.isFinite(lo) ? lo : 0;
  let b = Number.isFinite(hi) ? hi : 1;
  if (b < a) [a, b] = [b, a];
  if (a === b) {
    if (a === 0) { a = 0; b = 1; }
    else { const d = Math.abs(a) * 0.5; a -= d; b += d; }
  }
  const raw = (b - a) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const min = round12(Math.floor(a / step + 1e-9) * step);
  let max = round12(Math.ceil(b / step - 1e-9) * step);
  if (!(max > min)) max = round12(min + step);
  return { min, max, step };
}

export function tickValues(s: Scale): number[] {
  const out: number[] = [];
  if (!(s.step > 0) || !Number.isFinite(s.min) || !Number.isFinite(s.max)) return [s.min];
  const n = Math.floor((s.max - s.min) / s.step + 1e-6);
  const count = Math.min(n, 60);
  for (let i = 0; i <= count; i++) out.push(round12(s.min + i * s.step));
  const last = out[out.length - 1];
  if (last !== undefined && s.max - last > s.step * 1e-6) out.push(round12(s.max));
  return out;
}
