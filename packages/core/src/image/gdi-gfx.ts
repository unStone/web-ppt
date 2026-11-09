/**
 * GDI 主绘图上下文：DC 栈与对象表、裁剪、画笔 / 画刷到 SVG 属性的映射与绘图原语。
 * 坐标处理策略见 gdi.ts 顶部说明，SVG 输出件见 gdi-svg.ts。
 */
import {
  BS_DIBPATTERN, BS_HATCHED, BS_NULL, BS_PATTERN, ID_MAT, MM_ISOTROPIC, MM_TEXT, PS_NULL,
  compose, defBrush, defFont, defPen, esc, fontStack, n, stockObject, xfPt, xfScale, xfScaleY,
} from './gdi';
import type { Dc, DevInfo, GdiObj, Mat, Pt, Rect } from './gdi';
import { Path, Svg, arcSegs, arcStart, dashArray, hatchPattern, ok, radialAngle } from './gdi-svg';

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

/** 各固定映射模式下 1 个逻辑单位对应的毫米数（y 轴向上，需取反）*/
const FIXED_MM: Record<number, number> = {
  2: 0.1,          // MM_LOMETRIC
  3: 0.01,         // MM_HIMETRIC
  4: 25.4 / 100,   // MM_LOENGLISH
  5: 25.4 / 1000,  // MM_HIENGLISH
  6: 25.4 / 1440,  // MM_TWIPS
};

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

  /** EXTSELECTCLIPRGN 用：清除裁剪 */
  clearClip(): void { this.dc.clip = null; }

  /**
   * 用一组矩形（区域）设置裁剪。intersect=true 时与当前裁剪求交（嵌套 clipPath），
   * 否则替换。矩形之间是并集——clipPath 的多个子元素天然如此。
   */
  setClipRects(rects: Rect[], intersect: boolean): void {
    const m = this.xf();
    const parts: string[] = [];
    for (const rc of rects) {
      const a = xfPt(m, rc.l, rc.t);
      const b = xfPt(m, rc.r, rc.b);
      if (!ok(a) || !ok(b)) continue;
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      if (!(w > 0) || !(h > 0)) continue;
      parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/>`);
    }
    if (!parts.length) return;
    const parent = intersect ? this.dc.clip : null;
    const body = parts.join('');
    const key = `rgn:${body}|${parent ?? ''}`;
    this.dc.clip = this.svg.def(key, 'c', (id) =>
      `<clipPath id="${id}"${parent ? ` clip-path="url(#${parent})"` : ''}>${body}</clipPath>`);
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
