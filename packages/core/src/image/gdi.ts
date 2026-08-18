/**
 * EMF / WMF 共用的 GDI 运行时：字节读取、设备上下文（DC）、对象表、
 * 路径累积、DIB 解码、SVG 输出。
 *
 * 坐标处理策略：所有点在 JS 里就地做「世界变换 → 窗口/视口映射」两步仿射变换，
 * 输出到 SVG 的已经是设备坐标，因此 SVG 侧只需要一个 viewBox，不再嵌套 transform。
 * 弧线 / 圆角统一用逻辑空间的三次贝塞尔近似再整体仿射，天然支持旋转与翻转。
 */

import { zlibSync } from 'fflate';

// ---------------- 基础工具 ----------------

let uid = 0;
const nextId = (p: string): string => `${p}${(++uid).toString(36)}`;

/** 数值格式化：非有限值一律回落到 0，保证输出里不会出现 NaN */
export const n = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0');

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface Rect { l: number; t: number; r: number; b: number }
export interface Pt { x: number; y: number }

/** SVG 约定的仿射矩阵 [a b c d e f]：(x,y) → (a·x + c·y + e, b·x + d·y + f) */
export type Mat = [number, number, number, number, number, number];

export const ID_MAT: Mat = [1, 0, 0, 1, 0, 0];

/** 复合变换：点先过 first，再过 then */
export function compose(first: Mat, then: Mat): Mat {
  const [a, b, c, d, e, f] = first;
  const [A, B, C, D, E, F] = then;
  return [
    A * a + C * b, B * a + D * b,
    A * c + C * d, B * c + D * d,
    A * e + C * f + E, B * e + D * f + F,
  ];
}

export function xfPt(m: Mat, x: number, y: number): Pt {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** 平均缩放因子（用于线宽 / 字号）*/
export function xfScale(m: Mat): number {
  const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
  const s = Math.sqrt(det);
  return Number.isFinite(s) && s > 1e-9 ? s : 1;
}

export function xfScaleY(m: Mat): number {
  const s = Math.hypot(m[2], m[3]);
  return Number.isFinite(s) && s > 1e-9 ? s : 1;
}

// ---------------- 边界安全的字节读取 ----------------

export class Reader {
  private dv: DataView;
  private end: number;
  /** 绝对偏移（相对传入 Uint8Array 起点）*/
  p = 0;

  constructor(bytes: Uint8Array, start = 0, end?: number) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.end = Math.min(end ?? bytes.length, bytes.length);
    this.p = start;
  }

  has(len: number): boolean { return this.p + len <= this.end; }
  get left(): number { return Math.max(0, this.end - this.p); }
  skip(len: number): void { this.p += len; }
  seek(off: number): void { this.p = off; }

  u8(): number { if (!this.has(1)) { this.p += 1; return 0; } return this.dv.getUint8(this.p++); }
  i16(): number { if (!this.has(2)) { this.p += 2; return 0; } const v = this.dv.getInt16(this.p, true); this.p += 2; return v; }
  u16(): number { if (!this.has(2)) { this.p += 2; return 0; } const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  i32(): number { if (!this.has(4)) { this.p += 4; return 0; } const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
  u32(): number { if (!this.has(4)) { this.p += 4; return 0; } const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
  f32(): number { if (!this.has(4)) { this.p += 4; return 0; } const v = this.dv.getFloat32(this.p, true); this.p += 4; return Number.isFinite(v) ? v : 0; }

  /** COLORREF 0x00BBGGRR */
  color(): string { const v = this.u32(); return rgb(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff); }

  /** 32 位点（EMF POINTL）*/
  ptL(): Pt { return { x: this.i32(), y: this.i32() }; }
  /** 16 位点（EMF POINT16 / WMF POINT16）*/
  pt16(): Pt { return { x: this.i16(), y: this.i16() }; }
  /** EMF RECTL：左上右下 */
  rectL(): Rect { return { l: this.i32(), t: this.i32(), r: this.i32(), b: this.i32() }; }

  /** UTF-16LE 定长字符串（字节数），截到第一个 NUL */
  utf16(bytes: number): string {
    let s = '';
    const cnt = bytes >> 1;
    for (let i = 0; i < cnt; i++) {
      const c = this.u16();
      if (c === 0) { this.skip((cnt - i - 1) * 2); break; }
      s += String.fromCharCode(c);
    }
    return s;
  }

  /** 单字节字符串（按 latin1 近似），截到第一个 NUL */
  ansi(bytes: number): string {
    let s = '';
    for (let i = 0; i < bytes; i++) {
      const c = this.u8();
      if (c === 0) { this.skip(bytes - i - 1); break; }
      s += String.fromCharCode(c);
    }
    return s;
  }
}

const hex2 = (v: number): string => (v & 0xff).toString(16).padStart(2, '0');
export const rgb = (r: number, g: number, b: number): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

// ---------------- GDI 对象 ----------------

export const PS_SOLID = 0, PS_DASH = 1, PS_DOT = 2, PS_DASHDOT = 3, PS_DASHDOTDOT = 4, PS_NULL = 5;

export interface Pen { kind: 'pen'; style: number; width: number; color: string; cap: number; join: number }
export interface Brush { kind: 'brush'; style: number; color: string; hatch: number; href: string | null }
export interface Fnt {
  kind: 'font'; height: number; escapement: number; weight: number;
  italic: boolean; underline: boolean; strike: boolean; face: string; charset: number;
}
export type GdiObj = Pen | Brush | Fnt;

export const BS_SOLID = 0, BS_NULL = 1, BS_HATCHED = 2, BS_PATTERN = 3, BS_DIBPATTERN = 5;

export const defPen = (): Pen => ({ kind: 'pen', style: PS_SOLID, width: 1, color: '#000000', cap: 0, join: 0 });
export const defBrush = (): Brush => ({ kind: 'brush', style: BS_SOLID, color: '#ffffff', hatch: 0, href: null });
export const defFont = (): Fnt => ({
  kind: 'font', height: -12, escapement: 0, weight: 400,
  italic: false, underline: false, strike: false, face: 'Arial', charset: 0,
});

const nullPen = (): Pen => ({ ...defPen(), style: PS_NULL });
const solidBrush = (c: string): Brush => ({ kind: 'brush', style: BS_SOLID, color: c, hatch: 0, href: null });

/** SELECTOBJECT 高位 0x80000000 的库存对象 */
export function stockObject(idx: number): GdiObj | null {
  switch (idx & 0xff) {
    case 0x00: return solidBrush('#ffffff');           // WHITE_BRUSH
    case 0x01: return solidBrush('#c0c0c0');           // LTGRAY_BRUSH
    case 0x02: return solidBrush('#808080');           // GRAY_BRUSH
    case 0x03: return solidBrush('#404040');           // DKGRAY_BRUSH
    case 0x04: return solidBrush('#000000');           // BLACK_BRUSH
    case 0x05: return { ...defBrush(), style: BS_NULL }; // NULL_BRUSH / HOLLOW_BRUSH
    case 0x06: return { ...defPen(), color: '#ffffff' }; // WHITE_PEN
    case 0x07: return defPen();                        // BLACK_PEN
    case 0x08: return nullPen();                       // NULL_PEN
    case 0x0a: case 0x0b: case 0x0c: case 0x0d:
    case 0x0e: case 0x10: case 0x11:
      return defFont();                                // 各类系统字体
    case 0x12: return solidBrush('#ffffff');           // DC_BRUSH
    case 0x13: return defPen();                        // DC_PEN
    default: return null;
  }
}

// ---------------- 设备上下文 ----------------

export const MM_TEXT = 1, MM_ISOTROPIC = 7, MM_ANISOTROPIC = 8;

export interface Dc {
  pen: Pen;
  brush: Brush;
  font: Fnt;
  textColor: string;
  bkColor: string;
  /** 1 = TRANSPARENT, 2 = OPAQUE */
  bkMode: number;
  /** 1 = ALTERNATE(evenodd), 2 = WINDING(nonzero) */
  polyFill: number;
  textAlign: number;
  world: Mat;
  mapMode: number;
  winOrg: Pt; winExt: Pt;
  vpOrg: Pt; vpExt: Pt;
  clip: string | null;
  pos: Pt;
}

function cloneDc(d: Dc): Dc {
  return {
    ...d,
    pen: { ...d.pen }, brush: { ...d.brush }, font: { ...d.font },
    world: [...d.world] as Mat,
    winOrg: { ...d.winOrg }, winExt: { ...d.winExt },
    vpOrg: { ...d.vpOrg }, vpExt: { ...d.vpExt },
    pos: { ...d.pos },
  };
}

/** 设备物理参数，用于 MM_LOMETRIC 之类的固定映射模式 */
export interface DevInfo { pxPerMmX: number; pxPerMmY: number }

/** 各固定映射模式下 1 个逻辑单位对应的毫米数（y 轴向上，需取反）*/
const FIXED_MM: Record<number, number> = {
  2: 0.1,          // MM_LOMETRIC
  3: 0.01,         // MM_HIMETRIC
  4: 25.4 / 100,   // MM_LOENGLISH
  5: 25.4 / 1000,  // MM_HIENGLISH
  6: 25.4 / 1440,  // MM_TWIPS
};

// ---------------- SVG 输出 ----------------

class Svg {
  private els: string[] = [];
  private defs: string[] = [];
  private cache = new Map<string, string>();
  count = 0;

  add(el: string): void { this.els.push(el); this.count++; }

  /** 按 key 去重的 <defs> 条目，返回引用 id */
  def(key: string, prefix: string, make: (id: string) => string): string {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const id = nextId(prefix);
    this.defs.push(make(id));
    this.cache.set(key, id);
    return id;
  }

  render(vb: Rect, w: number, h: number): string {
    const vw = Math.max(1, vb.r - vb.l);
    const vh = Math.max(1, vb.b - vb.t);
    const defs = this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '';
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${n(w)}" height="${n(h)}" viewBox="${n(vb.l)} ${n(vb.t)} ${n(vw)} ${n(vh)}" ` +
      `preserveAspectRatio="xMidYMid meet">` +
      defs + this.els.join('') + '</svg>'
    );
  }
}

// ---------------- 路径累积 ----------------

class Path {
  private d: string[] = [];
  private started = false;

  get empty(): boolean { return this.d.length === 0; }
  get data(): string { return this.d.join(''); }
  clear(): void { this.d = []; this.started = false; }

  move(p: Pt): void {
    if (!ok(p)) return;
    this.d.push(`M${n(p.x)} ${n(p.y)}`);
    this.started = true;
  }
  line(p: Pt): void {
    if (!ok(p)) return;
    if (!this.started) this.move(p);
    else this.d.push(`L${n(p.x)} ${n(p.y)}`);
  }
  cubic(a: Pt, b: Pt, c: Pt): void {
    if (!ok(a) || !ok(b) || !ok(c)) return;
    if (!this.started) this.move(a);
    this.d.push(`C${n(a.x)} ${n(a.y)} ${n(b.x)} ${n(b.y)} ${n(c.x)} ${n(c.y)}`);
  }
  close(): void { if (this.started) this.d.push('Z'); }
}

const ok = (p: Pt): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

// ---------------- 椭圆 / 弧的贝塞尔近似（逻辑空间构造 + 整体仿射）----------------

const K = 0.5522847498307936;

/**
 * 逻辑空间的椭圆弧 → 变换后的三次贝塞尔序列。
 * a0/a1 为参数角（点 = center + (rx·cos t, ry·sin t)），按 a0 → a1 方向走。
 */
function arcSegs(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, m: Mat): Pt[][] {
  const out: Pt[][] = [];
  const total = a1 - a0;
  const steps = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2)));
  const step = total / steps;
  const k = (K * Math.abs(step)) / (Math.PI / 2) * Math.sign(step);
  let t = a0;
  for (let i = 0; i < steps; i++) {
    const t1 = t + step;
    const c0 = Math.cos(t), s0 = Math.sin(t), c1 = Math.cos(t1), s1 = Math.sin(t1);
    const p1 = { x: cx + rx * (c0 - k * s0), y: cy + ry * (s0 + k * c0) };
    const p2 = { x: cx + rx * (c1 + k * s1), y: cy + ry * (s1 - k * c1) };
    const p3 = { x: cx + rx * c1, y: cy + ry * s1 };
    out.push([xfPt(m, p1.x, p1.y), xfPt(m, p2.x, p2.y), xfPt(m, p3.x, p3.y)]);
    t = t1;
  }
  return out;
}

const arcStart = (cx: number, cy: number, rx: number, ry: number, a: number, m: Mat): Pt =>
  xfPt(m, cx + rx * Math.cos(a), cy + ry * Math.sin(a));

/** 由弧的两条半径射线端点求参数角 */
function radialAngle(cx: number, cy: number, rx: number, ry: number, x: number, y: number): number {
  const dx = rx !== 0 ? (x - cx) / rx : 0;
  const dy = ry !== 0 ? (y - cy) / ry : 0;
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2(dy, dx);
}

// ---------------- 主绘图上下文 ----------------

export type ArcKind = 'arc' | 'chord' | 'pie';

export class Gfx {
  dc: Dc;
  private stack: Dc[] = [];
  private objs: (GdiObj | null)[] = [];
  private svg = new Svg();
  private path = new Path();
  private inPath = false;
  private dev: DevInfo;

  constructor(dev: DevInfo) {
    this.dev = dev;
    this.dc = {
      pen: defPen(), brush: defBrush(), font: defFont(),
      textColor: '#000000', bkColor: '#ffffff', bkMode: 2, polyFill: 1, textAlign: 0,
      world: [...ID_MAT] as Mat, mapMode: MM_TEXT,
      winOrg: { x: 0, y: 0 }, winExt: { x: 1, y: 1 },
      vpOrg: { x: 0, y: 0 }, vpExt: { x: 1, y: 1 },
      clip: null, pos: { x: 0, y: 0 },
    };
  }

  get drawn(): number { return this.svg.count; }

  // -------- 变换 --------

  /** 逻辑坐标 → 设备坐标的完整矩阵 */
  xf(): Mat {
    const d = this.dc;
    let sx: number, sy: number;
    const fixedMm = FIXED_MM[d.mapMode];
    if (d.mapMode === MM_TEXT) {
      sx = 1; sy = 1;
    } else if (fixedMm !== undefined) {
      sx = fixedMm * this.dev.pxPerMmX;
      sy = -fixedMm * this.dev.pxPerMmY;
    } else {
      sx = d.winExt.x !== 0 ? d.vpExt.x / d.winExt.x : 1;
      sy = d.winExt.y !== 0 ? d.vpExt.y / d.winExt.y : 1;
      if (d.mapMode === MM_ISOTROPIC) {
        const s = Math.min(Math.abs(sx), Math.abs(sy));
        sx = s * Math.sign(sx || 1);
        sy = s * Math.sign(sy || 1);
      }
    }
    if (!Number.isFinite(sx) || sx === 0) sx = 1;
    if (!Number.isFinite(sy) || sy === 0) sy = 1;
    const page: Mat = [sx, 0, 0, sy, d.vpOrg.x - d.winOrg.x * sx, d.vpOrg.y - d.winOrg.y * sy];
    return compose(d.world, page);
  }

  private tp(x: number, y: number): Pt { return xfPt(this.xf(), x, y); }

  // -------- DC 栈 / 对象表 --------

  save(): void { this.stack.push(cloneDc(this.dc)); }

  restore(which = -1): void {
    if (!this.stack.length) return;
    // 负数表示相对层数（-1 = 最近一次），正数表示绝对栈深
    let cnt = which < 0 ? -which : Math.max(1, this.stack.length - which);
    cnt = Math.min(cnt, this.stack.length);
    let d: Dc | undefined;
    for (let i = 0; i < cnt; i++) d = this.stack.pop();
    if (d) this.dc = d;
  }

  putObj(idx: number, o: GdiObj): void {
    if (idx < 0 || idx > 0xffff) return;
    this.objs[idx] = o;
  }

  /** WMF：对象放进第一个空槽 */
  addObj(o: GdiObj): void {
    for (let i = 0; i < this.objs.length; i++) {
      if (!this.objs[i]) { this.objs[i] = o; return; }
    }
    if (this.objs.length < 0x10000) this.objs.push(o);
  }

  delObj(idx: number): void {
    if (idx >= 0 && idx < this.objs.length) this.objs[idx] = null;
  }

  selectIdx(idx: number): void {
    const o = (idx & 0x80000000) !== 0 || (idx & 0xffff8000) === 0x8000
      ? stockObject(idx)
      : this.objs[idx] ?? null;
    if (o) this.select(o);
  }

  select(o: GdiObj): void {
    if (o.kind === 'pen') this.dc.pen = o;
    else if (o.kind === 'brush') this.dc.brush = o;
    else this.dc.font = o;
  }

  // -------- 裁剪 --------

  intersectClip(r: Rect): void {
    const m = this.xf();
    const p = [
      xfPt(m, r.l, r.t), xfPt(m, r.r, r.t), xfPt(m, r.r, r.b), xfPt(m, r.l, r.b),
    ];
    if (p.some((q) => !ok(q))) return;
    const d = `M${n(p[0].x)} ${n(p[0].y)}L${n(p[1].x)} ${n(p[1].y)}L${n(p[2].x)} ${n(p[2].y)}L${n(p[3].x)} ${n(p[3].y)}Z`;
    // 多次 IntersectClipRect 用嵌套 clipPath 表达交集
    const parent = this.dc.clip;
    const key = `clip:${d}|${parent ?? ''}`;
    this.dc.clip = this.svg.def(key, 'c', (id) =>
      `<clipPath id="${id}"${parent ? ` clip-path="url(#${parent})"` : ''}><path d="${d}"/></clipPath>`);
  }

  private clipAttr(): string { return this.dc.clip ? ` clip-path="url(#${this.dc.clip})"` : ''; }

  // -------- 画笔 / 画刷 → SVG 属性 --------

  private strokeAttrs(): string {
    const p = this.dc.pen;
    if (p.style === PS_NULL) return ' stroke="none"';
    const w = Math.max(p.width, 0) * xfScale(this.xf());
    const width = w < 0.75 ? 0.75 : w;
    let s = ` stroke="${p.color}" stroke-width="${n(width)}"`;
    const dash = dashArray(p.style, width);
    if (dash) s += ` stroke-dasharray="${dash}"`;
    if (dash) s += ' stroke-linecap="butt"';
    else if (p.cap === 0x100) s += ' stroke-linecap="square"';
    else if (p.cap === 0x200) s += ' stroke-linecap="butt"';
    else if (p.cap === 0) s += ' stroke-linecap="round"';
    if (p.join === 0x1000) s += ' stroke-linejoin="bevel"';
    else if (p.join === 0x2000) s += ' stroke-linejoin="miter"';
    else if (p.join === 0) s += ' stroke-linejoin="round"';
    return s;
  }

  private fillAttrs(): string {
    const b = this.dc.brush;
    if (b.style === BS_NULL) return ' fill="none"';
    if (b.style === BS_HATCHED) {
      const bg = this.dc.bkMode === 2 ? this.dc.bkColor : 'none';
      const key = `h:${b.hatch}:${b.color}:${bg}`;
      const id = this.svg.def(key, 'h', (i) => hatchPattern(i, b.hatch, b.color, bg));
      return ` fill="url(#${id})"`;
    }
    if ((b.style === BS_PATTERN || b.style === BS_DIBPATTERN) && b.href) {
      const key = `p:${b.href.length}:${b.href.slice(-32)}`;
      const id = this.svg.def(key, 'q', (i) =>
        `<pattern id="${i}" width="16" height="16" patternUnits="userSpaceOnUse">` +
        `<image xlink:href="${b.href}" width="16" height="16" preserveAspectRatio="none"/></pattern>`);
      return ` fill="url(#${id})"`;
    }
    if (b.style === BS_PATTERN || b.style === BS_DIBPATTERN) return ` fill="${b.color}"`;
    return ` fill="${b.color}"`;
  }

  private ruleAttr(): string {
    return this.dc.polyFill === 1 ? ' fill-rule="evenodd"' : '';
  }

  /** 输出一条 path；mode 决定描边 / 填充 */
  private emit(d: string, mode: 'stroke' | 'fill' | 'both'): void {
    if (!d) return;
    const fill = mode === 'stroke' ? ' fill="none"' : this.fillAttrs() + this.ruleAttr();
    const stroke = mode === 'fill' ? ' stroke="none"' : this.strokeAttrs();
    this.svg.add(`<path d="${d}"${fill}${stroke}${this.clipAttr()}/>`);
  }

  /** 绘图记录的统一出口：路径模式下累积，否则立即输出 */
  private draw(build: (p: Path) => void, mode: 'stroke' | 'fill' | 'both'): void {
    if (this.inPath) { build(this.path); return; }
    const tmp = new Path();
    build(tmp);
    this.emit(tmp.data, mode);
  }

  // -------- 路径模式 --------

  beginPath(): void { this.path.clear(); this.inPath = true; }
  endPath(): void { this.inPath = false; }
  abortPath(): void { this.path.clear(); this.inPath = false; }
  closeFigure(): void { this.path.close(); }

  finishPath(mode: 'stroke' | 'fill' | 'both'): void {
    this.inPath = false;
    this.emit(this.path.data, mode);
    this.path.clear();
  }

  /** SELECTCLIPPATH：把当前路径当作裁剪区 */
  clipToPath(): void {
    const d = this.path.data;
    this.inPath = false;
    if (!d) return;
    const parent = this.dc.clip;
    this.dc.clip = this.svg.def(`clipP:${d}|${parent ?? ''}`, 'c', (id) =>
      `<clipPath id="${id}"${parent ? ` clip-path="url(#${parent})"` : ''}><path d="${d}"/></clipPath>`);
    this.path.clear();
  }

  // -------- 绘图原语（入参均为逻辑坐标）--------

  moveTo(x: number, y: number): void {
    this.dc.pos = { x, y };
    if (this.inPath) this.path.move(this.tp(x, y));
  }

  lineTo(x: number, y: number): void {
    const m = this.xf();
    const from = xfPt(m, this.dc.pos.x, this.dc.pos.y);
    const to = xfPt(m, x, y);
    if (this.inPath) this.path.line(to);
    else this.emit(`M${n(from.x)} ${n(from.y)}L${n(to.x)} ${n(to.y)}`, 'stroke');
    this.dc.pos = { x, y };
  }

  polyline(pts: Pt[], close: boolean): void {
    if (pts.length < 2) return;
    const m = this.xf();
    const dev = pts.map((p) => xfPt(m, p.x, p.y));
    this.draw((path) => {
      path.move(dev[0]);
      for (let i = 1; i < dev.length; i++) path.line(dev[i]);
      if (close) path.close();
    }, close ? 'both' : 'stroke');
    const last = pts[pts.length - 1];
    this.dc.pos = { x: last.x, y: last.y };
  }

  /** POLYLINETO：从当前点续画 */
  polylineTo(pts: Pt[]): void {
    if (!pts.length) return;
    const m = this.xf();
    if (this.inPath) {
      for (const p of pts) this.path.line(xfPt(m, p.x, p.y));
    } else {
      const from = xfPt(m, this.dc.pos.x, this.dc.pos.y);
      let d = `M${n(from.x)} ${n(from.y)}`;
      for (const p of pts) { const q = xfPt(m, p.x, p.y); d += `L${n(q.x)} ${n(q.y)}`; }
      this.emit(d, 'stroke');
    }
    const last = pts[pts.length - 1];
    this.dc.pos = { x: last.x, y: last.y };
  }

  polyBezier(pts: Pt[], fromCurrent: boolean): void {
    const m = this.xf();
    const dev = pts.map((p) => xfPt(m, p.x, p.y));
    const build = (path: Path): void => {
      let i = 0;
      if (fromCurrent) {
        if (!this.inPath) path.move(xfPt(m, this.dc.pos.x, this.dc.pos.y));
      } else {
        if (!dev.length) return;
        path.move(dev[0]);
        i = 1;
      }
      for (; i + 2 < dev.length; i += 3) path.cubic(dev[i], dev[i + 1], dev[i + 2]);
    };
    if (this.inPath) build(this.path);
    else { const tmp = new Path(); build(tmp); this.emit(tmp.data, 'stroke'); }
    if (pts.length) {
      const last = pts[pts.length - 1];
      this.dc.pos = { x: last.x, y: last.y };
    }
  }

  polyPoly(polys: Pt[][], close: boolean): void {
    const m = this.xf();
    this.draw((path) => {
      for (const poly of polys) {
        if (poly.length < 2) continue;
        path.move(xfPt(m, poly[0].x, poly[0].y));
        for (let i = 1; i < poly.length; i++) path.line(xfPt(m, poly[i].x, poly[i].y));
        if (close) path.close();
      }
    }, close ? 'both' : 'stroke');
  }

  rect(r: Rect): void {
    const m = this.xf();
    // 无旋转 / 错切时直接输出 <rect>，输出更小也更好读
    if (!this.inPath && m[1] === 0 && m[2] === 0) {
      const a = xfPt(m, r.l, r.t), b = xfPt(m, r.r, r.b);
      if (ok(a) && ok(b)) {
        const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        this.svg.add(`<rect x="${n(Math.min(a.x, b.x))}" y="${n(Math.min(a.y, b.y))}" ` +
          `width="${n(w)}" height="${n(h)}"${this.fillAttrs()}${this.strokeAttrs()}${this.clipAttr()}/>`);
        return;
      }
    }
    const p = [xfPt(m, r.l, r.t), xfPt(m, r.r, r.t), xfPt(m, r.r, r.b), xfPt(m, r.l, r.b)];
    this.draw((path) => {
      path.move(p[0]); path.line(p[1]); path.line(p[2]); path.line(p[3]); path.close();
    }, 'both');
  }

  ellipse(r: Rect): void {
    const m = this.xf();
    const cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2;
    const rx = Math.abs(r.r - r.l) / 2, ry = Math.abs(r.b - r.t) / 2;
    this.draw((path) => {
      path.move(arcStart(cx, cy, rx, ry, 0, m));
      for (const s of arcSegs(cx, cy, rx, ry, 0, Math.PI * 2, m)) path.cubic(s[0], s[1], s[2]);
      path.close();
    }, 'both');
  }

  roundRect(r: Rect, cw: number, ch: number): void {
    const m = this.xf();
    const l = Math.min(r.l, r.r), t = Math.min(r.t, r.b);
    const rr = Math.max(r.l, r.r), bb = Math.max(r.t, r.b);
    const rx = Math.min(Math.abs(cw) / 2, (rr - l) / 2);
    const ry = Math.min(Math.abs(ch) / 2, (bb - t) / 2);
    if (rx <= 0 || ry <= 0) { this.rect(r); return; }
    this.draw((path) => {
      path.move(xfPt(m, l + rx, t));
      path.line(xfPt(m, rr - rx, t));
      for (const s of arcSegs(rr - rx, t + ry, rx, ry, -Math.PI / 2, 0, m)) path.cubic(s[0], s[1], s[2]);
      path.line(xfPt(m, rr, bb - ry));
      for (const s of arcSegs(rr - rx, bb - ry, rx, ry, 0, Math.PI / 2, m)) path.cubic(s[0], s[1], s[2]);
      path.line(xfPt(m, l + rx, bb));
      for (const s of arcSegs(l + rx, bb - ry, rx, ry, Math.PI / 2, Math.PI, m)) path.cubic(s[0], s[1], s[2]);
      path.line(xfPt(m, l, t + ry));
      for (const s of arcSegs(l + rx, t + ry, rx, ry, Math.PI, Math.PI * 1.5, m)) path.cubic(s[0], s[1], s[2]);
      path.close();
    }, 'both');
  }

  /** GDI 弧默认逆时针（屏幕上看），即参数角递减方向 */
  arc(r: Rect, xs: number, ys: number, xe: number, ye: number, kind: ArcKind, continueFrom = false): void {
    const m = this.xf();
    const cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2;
    const rx = Math.abs(r.r - r.l) / 2, ry = Math.abs(r.b - r.t) / 2;
    if (rx <= 0 || ry <= 0) return;
    const a0 = radialAngle(cx, cy, rx, ry, xs, ys);
    let a1 = radialAngle(cx, cy, rx, ry, xe, ye);
    let sweep = a0 - a1;
    while (sweep <= 0) sweep += Math.PI * 2;
    a1 = a0 - sweep;
    const mode: 'stroke' | 'both' = kind === 'arc' ? 'stroke' : 'both';
    this.draw((path) => {
      const p0 = arcStart(cx, cy, rx, ry, a0, m);
      if (kind === 'pie') { path.move(xfPt(m, cx, cy)); path.line(p0); }
      else if (continueFrom && this.inPath) path.line(p0);
      else path.move(p0);
      for (const s of arcSegs(cx, cy, rx, ry, a0, a1, m)) path.cubic(s[0], s[1], s[2]);
      if (kind !== 'arc') path.close();
    }, mode);
    const end = { x: cx + rx * Math.cos(a1), y: cy + ry * Math.sin(a1) };
    this.dc.pos = end;
  }

  /** POLYDRAW：点 + 类型数组（PT_MOVETO 6 / PT_LINETO 2 / PT_BEZIERTO 4 / PT_CLOSEFIGURE 1）*/
  polyDraw(pts: Pt[], types: number[]): void {
    const m = this.xf();
    const cnt = Math.min(pts.length, types.length);
    this.draw((path) => {
      for (let i = 0; i < cnt; i++) {
        const t = types[i] & 0x06;
        if (t === 0x04 && i + 2 < cnt) {
          path.cubic(xfPt(m, pts[i].x, pts[i].y), xfPt(m, pts[i + 1].x, pts[i + 1].y), xfPt(m, pts[i + 2].x, pts[i + 2].y));
          i += 2;
        } else if (t === 0x06) {
          path.move(xfPt(m, pts[i].x, pts[i].y));
        } else {
          path.line(xfPt(m, pts[i].x, pts[i].y));
        }
        if (types[i] & 0x01) path.close();
      }
    }, 'stroke');
    if (cnt) this.dc.pos = { x: pts[cnt - 1].x, y: pts[cnt - 1].y };
  }

  // -------- 文本 --------

  text(x: number, y: number, s: string, dx: number[] | null, opaqueRect: Rect | null): void {
    if (!s) return;
    const m = this.xf();
    const p = xfPt(m, x, y);
    if (!ok(p)) return;
    const f = this.dc.font;
    // lfHeight 为负 = 字符高度（em）；为正 = 单元格高度（含内部行距），按经验折算
    const em = f.height < 0 ? -f.height : f.height * 0.87;
    const size = em * xfScaleY(m);
    if (!(size > 0) || !Number.isFinite(size)) return;

    if (opaqueRect && this.dc.bkMode === 2) {
      const a = xfPt(m, opaqueRect.l, opaqueRect.t);
      const b = xfPt(m, opaqueRect.r, opaqueRect.b);
      if (ok(a) && ok(b)) {
        this.svg.add(`<rect x="${n(Math.min(a.x, b.x))}" y="${n(Math.min(a.y, b.y))}" ` +
          `width="${n(Math.abs(b.x - a.x))}" height="${n(Math.abs(b.y - a.y))}" ` +
          `fill="${this.dc.bkColor}"${this.clipAttr()}/>`);
      }
    }

    const al = this.dc.textAlign;
    const anchor = (al & 6) === 2 ? 'end' : (al & 6) === 6 ? 'middle' : 'start';
    const base = (al & 24) === 24 ? '' : (al & 24) === 8 ? 'text-after-edge' : 'text-before-edge';

    let a = ` x="${n(p.x)}" y="${n(p.y)}"`;
    if (f.escapement) {
      // lfEscapement 单位 0.1 度，逆时针为正
      a += ` transform="rotate(${n(-f.escapement / 10)} ${n(p.x)} ${n(p.y)})"`;
    }
    a += ` font-family="${esc(fontStack(f.face))}" font-size="${n(size)}" fill="${this.dc.textColor}"`;
    if (f.weight >= 600) a += ` font-weight="${f.weight}"`;
    if (f.italic) a += ' font-style="italic"';
    if (f.underline && f.strike) a += ' text-decoration="underline line-through"';
    else if (f.underline) a += ' text-decoration="underline"';
    else if (f.strike) a += ' text-decoration="line-through"';
    if (anchor !== 'start') a += ` text-anchor="${anchor}"`;
    if (base) a += ` dominant-baseline="${base}"`;

    // 有字间距数组时用 textLength 锁定 GDI 量出的宽度，抵消浏览器字体度量差异
    if (dx && dx.length) {
      let sum = 0;
      for (const v of dx) sum += v;
      const w = sum * xfScale(m);
      if (w > 0 && Number.isFinite(w)) a += ` textLength="${n(w)}" lengthAdjust="spacingAndGlyphs"`;
    }
    this.svg.add(`<text${a} xml:space="preserve"${this.clipAttr()}>${esc(s)}</text>`);
  }

  // -------- 位图 --------

  image(dst: Rect, href: string): void {
    const m = this.xf();
    const w = dst.r - dst.l, h = dst.b - dst.t;
    const a = xfPt(m, dst.l, dst.t);
    const b = xfPt(m, dst.l + w, dst.t + h);
    if (!ok(a) || !ok(b)) return;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const dw = Math.abs(b.x - a.x), dh = Math.abs(b.y - a.y);
    if (!(dw > 0) || !(dh > 0)) return;
    this.svg.add(`<image x="${n(x)}" y="${n(y)}" width="${n(dw)}" height="${n(dh)}" ` +
      `preserveAspectRatio="none" xlink:href="${href}"${this.clipAttr()}/>`);
  }

  render(vb: Rect, w: number, h: number): string { return this.svg.render(vb, w, h); }
}

// ---------------- 画笔虚线 ----------------

function dashArray(style: number, w: number): string {
  const u = Math.max(w, 1);
  switch (style) {
    case PS_DASH: return `${n(u * 6)} ${n(u * 3)}`;
    case PS_DOT: return `${n(u)} ${n(u * 3)}`;
    case PS_DASHDOT: return `${n(u * 6)} ${n(u * 3)} ${n(u)} ${n(u * 3)}`;
    case PS_DASHDOTDOT: return `${n(u * 6)} ${n(u * 3)} ${n(u)} ${n(u * 3)} ${n(u)} ${n(u * 3)}`;
    default: return '';
  }
}

// ---------------- 阴影线画刷 ----------------

const HATCH_D: Record<number, string> = {
  0: 'M0 4H8',                      // HS_HORIZONTAL
  1: 'M4 0V8',                      // HS_VERTICAL
  2: 'M0 0L8 8',                    // HS_FDIAGONAL
  3: 'M0 8L8 0',                    // HS_BDIAGONAL
  4: 'M0 4H8M4 0V8',                // HS_CROSS
  5: 'M0 0L8 8M0 8L8 0',            // HS_DIAGCROSS
};

function hatchPattern(id: string, hatch: number, color: string, bg: string): string {
  const d = HATCH_D[hatch] ?? HATCH_D[0];
  const back = bg === 'none' ? '' : `<rect width="8" height="8" fill="${bg}"/>`;
  return `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse">` +
    `${back}<path d="${d}" stroke="${color}" stroke-width="1" fill="none"/></pattern>`;
}

// ---------------- 字体族回退 ----------------

const GENERIC = `, 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif`;

export function fontStack(face: string): string {
  const f = face.trim();
  if (!f) return `Arial${GENERIC}`;
  if (/^(symbol|wingdings|webdings)/i.test(f)) return `'${f}'`;
  return `'${f}'${GENERIC}`;
}

// ---------------- 单字节文本解码（WMF / EXTTEXTOUTA）----------------

/** lfCharSet → TextDecoder 标签 */
const CHARSET_LABEL: Record<number, string> = {
  0: 'windows-1252', 1: 'windows-1252', 2: 'windows-1252',
  77: 'macintosh', 128: 'shift_jis', 129: 'euc-kr', 130: 'euc-kr',
  134: 'gbk', 136: 'big5', 161: 'windows-1253', 162: 'windows-1254',
  163: 'windows-1258', 177: 'windows-1255', 178: 'windows-1256',
  186: 'windows-1257', 204: 'windows-1251', 222: 'windows-874', 238: 'windows-1250',
};

/** 按字体 charset 解码单字节串；TextDecoder 不可用时退回 latin1 */
export function decodeAnsi(bytes: Uint8Array, charset: number): string {
  const label = CHARSET_LABEL[charset];
  if (label && typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder(label, { fatal: false }).decode(bytes).replace(/\0+$/, '');
    } catch { /* 退回 latin1 */ }
  }
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) break;
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

// ---------------- Base64 ----------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64(u: Uint8Array): string {
  let s = '';
  let i = 0;
  for (; i + 2 < u.length; i += 3) {
    const v = (u[i] << 16) | (u[i + 1] << 8) | u[i + 2];
    s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
  }
  const rem = u.length - i;
  if (rem === 1) {
    const v = u[i] << 16;
    s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + '==';
  } else if (rem === 2) {
    const v = (u[i] << 16) | (u[i + 1] << 8);
    s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + '=';
  }
  return s;
}

// ---------------- PNG 编码（纯 JS，浏览器 / Node 通用）----------------

let crcTable: Int32Array | null = null;

function crc32(buf: Uint8Array): number {
  if (!crcTable) {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    crcTable = t;
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(data.length + 8, crc32(out.subarray(4, data.length + 8)));
  return out;
}

/** RGBA 像素 → PNG 字节流 */
export function encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: None
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ---------------- DIB 解码 ----------------

const MAX_PIXELS = 8192 * 8192;

interface Dib { w: number; h: number; rgba: Uint8Array }

function maskShift(mask: number): { shift: number; scale: number } {
  if (!mask) return { shift: 0, scale: 0 };
  let shift = 0;
  let m = mask;
  while ((m & 1) === 0) { m >>>= 1; shift++; }
  let bits = 0;
  while (m & 1) { m >>>= 1; bits++; }
  return { shift, scale: bits > 0 ? 255 / ((1 << bits) - 1) : 0 };
}

/**
 * 解码 DIB（BITMAPINFOHEADER / BITMAPCOREHEADER + 可选调色板 + 像素）。
 * bmi 与 bits 在 EMF 里是分离的两段；WMF 里是连续的一段（bits 传 null 表示紧跟 bmi）。
 */
function decodeDib(buf: Uint8Array, bmiOff: number, bmiLen: number, bitsOff: number, bitsLen: number): Dib | null {
  if (bmiOff < 0 || bmiLen < 12 || bmiOff + 12 > buf.length) return null;
  const r = new Reader(buf, bmiOff, Math.min(buf.length, bmiOff + Math.max(bmiLen, 12)));
  const hdrSize = r.u32();
  let w: number, h: number, bpp: number, comp = 0, clrUsed = 0;
  let core = false;
  if (hdrSize === 12) {
    core = true;
    w = r.i16(); h = r.i16(); r.u16(); bpp = r.u16();
  } else if (hdrSize >= 16) {
    w = r.i32(); h = r.i32(); r.u16(); bpp = r.u16();
    if (hdrSize >= 24) { comp = r.u32(); r.u32(); }
    if (hdrSize >= 36) { r.u32(); r.u32(); clrUsed = r.u32(); }
  } else return null;

  const topDown = h < 0;
  h = Math.abs(h);
  if (!(w > 0) || !(h > 0) || w * h > MAX_PIXELS) return null;

  // BI_JPEG / BI_PNG：像素段本身就是完整图片
  if (comp === 4 || comp === 5) return null;
  if (comp !== 0 && comp !== 3) return null; // RLE 暂不支持
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) return null;

  // 位域掩码
  let rm = 0, gm = 0, bm = 0;
  if (comp === 3) {
    const mr = new Reader(buf, bmiOff + hdrSize, buf.length);
    rm = mr.u32(); gm = mr.u32(); bm = mr.u32();
  } else if (bpp === 16) { rm = 0x7c00; gm = 0x03e0; bm = 0x001f; }
  else if (bpp === 32) { rm = 0xff0000; gm = 0x00ff00; bm = 0x0000ff; }

  // 调色板
  let pal: Uint8Array | null = null;
  if (bpp <= 8) {
    const entries = clrUsed > 0 ? Math.min(clrUsed, 1 << bpp) : 1 << bpp;
    const entrySize = core ? 3 : 4;
    const palOff = bmiOff + hdrSize + (comp === 3 ? 12 : 0);
    pal = new Uint8Array(entries * 3);
    const pr = new Reader(buf, palOff, buf.length);
    for (let i = 0; i < entries; i++) {
      const b = pr.u8(), g = pr.u8(), rr = pr.u8();
      if (entrySize === 4) pr.u8();
      pal[i * 3] = rr; pal[i * 3 + 1] = g; pal[i * 3 + 2] = b;
    }
  }

  const stride = (((w * bpp + 31) >> 5) << 2);
  const start = bitsOff;
  const avail = Math.min(bitsLen > 0 ? bitsLen : buf.length - start, buf.length - start);
  if (start < 0 || start >= buf.length || avail < stride) return null;
  const rows = Math.min(h, Math.floor(avail / stride));
  if (rows <= 0) return null;

  const rgba = new Uint8Array(w * h * 4);
  const rs = maskShift(rm), gs = maskShift(gm), bs = maskShift(bm);
  let anyAlpha = false;

  for (let sy = 0; sy < rows; sy++) {
    const dy = topDown ? sy : h - 1 - sy;
    let src = start + sy * stride;
    let dst = dy * w * 4;
    for (let x = 0; x < w; x++) {
      let rr = 0, gg = 0, bb = 0, aa = 255;
      if (bpp === 24) {
        bb = buf[src]; gg = buf[src + 1]; rr = buf[src + 2]; src += 3;
      } else if (bpp === 32) {
        const v = buf[src] | (buf[src + 1] << 8) | (buf[src + 2] << 16) | (buf[src + 3] << 24);
        rr = rs.scale ? ((v & rm) >>> rs.shift) * rs.scale : 0;
        gg = gs.scale ? ((v & gm) >>> gs.shift) * gs.scale : 0;
        bb = bs.scale ? ((v & bm) >>> bs.shift) * bs.scale : 0;
        aa = buf[src + 3];
        if (aa !== 0) anyAlpha = true;
        src += 4;
      } else if (bpp === 16) {
        const v = buf[src] | (buf[src + 1] << 8);
        rr = ((v & rm) >>> rs.shift) * rs.scale;
        gg = ((v & gm) >>> gs.shift) * gs.scale;
        bb = ((v & bm) >>> bs.shift) * bs.scale;
        src += 2;
      } else {
        const bitPos = x * bpp;
        const byte = buf[start + sy * stride + (bitPos >> 3)] ?? 0;
        const idx = bpp === 8 ? byte
          : bpp === 4 ? (bitPos % 8 === 0 ? byte >> 4 : byte & 0x0f)
            : (byte >> (7 - (bitPos & 7))) & 1;
        const pi = idx * 3;
        if (pal && pi + 2 < pal.length) { rr = pal[pi]; gg = pal[pi + 1]; bb = pal[pi + 2]; }
        else { rr = gg = bb = idx ? 255 : 0; }
      }
      rgba[dst] = rr | 0; rgba[dst + 1] = gg | 0; rgba[dst + 2] = bb | 0; rgba[dst + 3] = aa;
      dst += 4;
    }
  }
  // 32 位 BI_RGB 的第 4 字节常年为 0，按不透明处理
  if (bpp === 32 && !anyAlpha) {
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  }
  return { w, h, rgba };
}

/** DIB → data URI；失败返回 null（调用方跳过该记录）*/
export function dibToDataUri(
  buf: Uint8Array, bmiOff: number, bmiLen: number, bitsOff: number, bitsLen: number,
): string | null {
  try {
    // BI_JPEG / BI_PNG 直通
    if (bmiOff >= 0 && bmiOff + 20 <= buf.length) {
      const hr = new Reader(buf, bmiOff, buf.length);
      const hs = hr.u32();
      if (hs >= 24) {
        hr.skip(12);
        const comp = hr.u32();
        if ((comp === 4 || comp === 5) && bitsLen > 0 && bitsOff + bitsLen <= buf.length) {
          const mime = comp === 4 ? 'image/jpeg' : 'image/png';
          return `data:${mime};base64,${base64(buf.subarray(bitsOff, bitsOff + bitsLen))}`;
        }
      }
    }
    const dib = decodeDib(buf, bmiOff, bmiLen, bitsOff, bitsLen);
    if (!dib) return null;
    return `data:image/png;base64,${base64(encodePng(dib.rgba, dib.w, dib.h))}`;
  } catch {
    return null;
  }
}

/** 计算 DIB 头部（含调色板 / 掩码）的字节数，用于定位紧随其后的像素段 */
export function dibHeaderSize(buf: Uint8Array, off: number): number {
  if (off + 4 > buf.length) return 0;
  const r = new Reader(buf, off, buf.length);
  const hdrSize = r.u32();
  if (hdrSize === 12) {
    r.skip(4);
    const bpp = new Reader(buf, off + 10, buf.length).u16();
    return 12 + (bpp <= 8 ? (1 << bpp) * 3 : 0);
  }
  if (hdrSize < 16 || hdrSize > 200) return 0;
  const bpp = new Reader(buf, off + 14, buf.length).u16();
  const comp = hdrSize >= 20 ? new Reader(buf, off + 16, buf.length).u32() : 0;
  let clrUsed = hdrSize >= 36 ? new Reader(buf, off + 32, buf.length).u32() : 0;
  if (bpp <= 8) clrUsed = clrUsed > 0 ? Math.min(clrUsed, 1 << bpp) : 1 << bpp;
  else clrUsed = 0;
  return hdrSize + (comp === 3 ? 12 : 0) + clrUsed * 4;
}
