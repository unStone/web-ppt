/**
 * GDI 绘图上下文的 SVG 输出件：元素与 defs 收集、路径累积、椭圆弧贝塞尔近似、虚线与阴影线画刷。
 */
import { PS_DASH, PS_DASHDOT, PS_DASHDOTDOT, PS_DOT, n, xfPt } from './gdi';
import type { Mat, Pt, Rect } from './gdi';

let uid = 0;
const nextId = (p: string): string => `${p}${(++uid).toString(36)}`;

// ---------------- SVG 输出 ----------------

export class Svg {
  private els: string[] = [];
  private defs: string[] = [];
  private cache = new Map<string, string>();
  count = 0;

  add(el: string): void {
    this.els.push(el);
    this.count++;
  }

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
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" `
      + `width="${n(w)}" height="${n(h)}" viewBox="${n(vb.l)} ${n(vb.t)} ${n(vw)} ${n(vh)}" `
      + `preserveAspectRatio="xMidYMid meet">`
      + defs
      + this.els.join('')
      + '</svg>'
    );
  }
}

// ---------------- 路径累积 ----------------

export class Path {
  private d: string[] = [];
  private started = false;

  get empty(): boolean {
    return this.d.length === 0;
  }
  get data(): string {
    return this.d.join('');
  }
  clear(): void {
    this.d = [];
    this.started = false;
  }

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
  close(): void {
    if (this.started) this.d.push('Z');
  }
}

export const ok = (p: Pt): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

// ---------------- 椭圆 / 弧的贝塞尔近似（逻辑空间构造 + 整体仿射）----------------

const K = 0.5522847498307936;

/**
 * 逻辑空间的椭圆弧 → 变换后的三次贝塞尔序列。
 * a0/a1 为参数角（点 = center + (rx·cos t, ry·sin t)），按 a0 → a1 方向走。
 */
export function arcSegs(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, m: Mat): Pt[][] {
  const out: Pt[][] = [];
  const total = a1 - a0;
  const steps = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2)));
  const step = total / steps;
  const k = ((K * Math.abs(step)) / (Math.PI / 2)) * Math.sign(step);
  let t = a0;
  for (let i = 0; i < steps; i++) {
    const t1 = t + step;
    const c0 = Math.cos(t),
      s0 = Math.sin(t),
      c1 = Math.cos(t1),
      s1 = Math.sin(t1);
    const p1 = { x: cx + rx * (c0 - k * s0), y: cy + ry * (s0 + k * c0) };
    const p2 = { x: cx + rx * (c1 + k * s1), y: cy + ry * (s1 - k * c1) };
    const p3 = { x: cx + rx * c1, y: cy + ry * s1 };
    out.push([xfPt(m, p1.x, p1.y), xfPt(m, p2.x, p2.y), xfPt(m, p3.x, p3.y)]);
    t = t1;
  }
  return out;
}

export const arcStart = (cx: number, cy: number, rx: number, ry: number, a: number, m: Mat): Pt =>
  xfPt(m, cx + rx * Math.cos(a), cy + ry * Math.sin(a));

/** 由弧的两条半径射线端点求参数角 */
export function radialAngle(cx: number, cy: number, rx: number, ry: number, x: number, y: number): number {
  const dx = rx !== 0 ? (x - cx) / rx : 0;
  const dy = ry !== 0 ? (y - cy) / ry : 0;
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2(dy, dx);
}

// ---------------- 画笔虚线 ----------------

export function dashArray(style: number, w: number): string {
  const u = Math.max(w, 1);
  switch (style) {
    case PS_DASH:
      return `${n(u * 6)} ${n(u * 3)}`;
    case PS_DOT:
      return `${n(u)} ${n(u * 3)}`;
    case PS_DASHDOT:
      return `${n(u * 6)} ${n(u * 3)} ${n(u)} ${n(u * 3)}`;
    case PS_DASHDOTDOT:
      return `${n(u * 6)} ${n(u * 3)} ${n(u)} ${n(u * 3)} ${n(u)} ${n(u * 3)}`;
    default:
      return '';
  }
}

// ---------------- 阴影线画刷 ----------------

const HATCH_D: Record<number, string> = {
  0: 'M0 4H8', // HS_HORIZONTAL
  1: 'M4 0V8', // HS_VERTICAL
  2: 'M0 0L8 8', // HS_FDIAGONAL
  3: 'M0 8L8 0', // HS_BDIAGONAL
  4: 'M0 4H8M4 0V8', // HS_CROSS
  5: 'M0 0L8 8M0 8L8 0', // HS_DIAGCROSS
};

export function hatchPattern(id: string, hatch: number, color: string, bg: string): string {
  const d = HATCH_D[hatch] ?? HATCH_D[0];
  const back = bg === 'none' ? '' : `<rect width="8" height="8" fill="${bg}"/>`;
  return (
    `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse">`
    + `${back}<path d="${d}" stroke="${color}" stroke-width="1" fill="none"/></pattern>`
  );
}
