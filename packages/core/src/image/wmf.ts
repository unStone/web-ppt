/**
 * WMF（Windows Metafile，[MS-WMF]）→ SVG。
 * 支持 Placeable header（0x9AC6CDD7）与裸 METAHEADER（mtType 1/2）。
 *
 * 注意 WMF 记录的参数普遍是「倒序」的（先 bottom 后 left、先 Y 后 X）。
 */

import {
  BS_NULL, BS_SOLID, Gfx, MM_ANISOTROPIC, PS_NULL, Reader,
  decodeAnsi, defFont, dibHeaderSize, dibToDataUri,
} from './gdi';
import type { Brush, Fnt, Pen, Pt, Rect } from './gdi';
import type { MetafileOptions } from './emf';

const PLACEABLE = 0x9ac6cdd7;
const MAX_RECORDS = 100000;

// 记录函数号
const M = {
  EOF: 0x0000, SAVEDC: 0x001e, SETBKMODE: 0x0102, SETMAPMODE: 0x0103, SETROP2: 0x0104,
  SETPOLYFILLMODE: 0x0106, SETSTRETCHBLTMODE: 0x0107, RESTOREDC: 0x0127,
  SELECTOBJECT: 0x012d, SETTEXTALIGN: 0x012e, DELETEOBJECT: 0x01f0,
  SETBKCOLOR: 0x0201, SETTEXTCOLOR: 0x0209, SETWINDOWORG: 0x020b, SETWINDOWEXT: 0x020c,
  SETVIEWPORTORG: 0x020d, SETVIEWPORTEXT: 0x020e, OFFSETWINDOWORG: 0x020f,
  OFFSETVIEWPORTORG: 0x0211, LINETO: 0x0213, MOVETO: 0x0214,
  CREATEPENINDIRECT: 0x02fa, CREATEFONTINDIRECT: 0x02fb, CREATEBRUSHINDIRECT: 0x02fc,
  POLYGON: 0x0324, POLYLINE: 0x0325, SCALEWINDOWEXT: 0x0410, SCALEVIEWPORTEXT: 0x0412,
  EXCLUDECLIPRECT: 0x0415, INTERSECTCLIPRECT: 0x0416, ELLIPSE: 0x0418, ARC: 0x0817,
  RECTANGLE: 0x041b, SETPIXEL: 0x041f, TEXTOUT: 0x0521, POLYPOLYGON: 0x0538,
  ROUNDRECT: 0x061c, PATBLT: 0x061d, PIE: 0x081a, CHORD: 0x0830, EXTTEXTOUT: 0x0a32,
  DIBBITBLT: 0x0940, DIBSTRETCHBLT: 0x0b41, STRETCHDIB: 0x0f43,
  // 需要占用对象表槽位、但暂不实现的创建类记录
  CREATEPALETTE: 0x00f7, CREATEBRUSH: 0x00f8, CREATEPATTERNBRUSH: 0x01f9,
  DIBCREATEPATTERNBRUSH: 0x0142, CREATEREGION: 0x06ff, CREATEBITMAP: 0x06fe,
  CREATEBITMAPINDIRECT: 0x02fd,
} as const;

/** 校验 WMF 魔数 */
export function isWmf(b: Uint8Array): boolean {
  if (b.length < 20) return false;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) === PLACEABLE) return true;
  const type = dv.getUint16(0, true);
  const hdr = dv.getUint16(2, true);
  const ver = dv.getUint16(4, true);
  return (type === 1 || type === 2) && hdr === 9 && (ver === 0x0100 || ver === 0x0300);
}

export function wmfToSvg(bytes: Uint8Array, opts: MetafileOptions = {}): string | null {
  try {
    return parse(bytes, opts);
  } catch {
    return null;
  }
}

function parse(bytes: Uint8Array, opts: MetafileOptions): string | null {
  if (!isWmf(bytes)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let p = 0;
  let bbox: Rect | null = null;
  let inch = 1440;
  if (dv.getUint32(0, true) === PLACEABLE) {
    bbox = {
      l: dv.getInt16(6, true), t: dv.getInt16(8, true),
      r: dv.getInt16(10, true), b: dv.getInt16(12, true),
    };
    inch = dv.getUint16(14, true) || 1440;
    p = 22;
  }
  if (p + 18 > bytes.length) return null;
  p += 18; // METAHEADER

  if (!bbox || !(bbox.r > bbox.l) || !(bbox.b > bbox.t)) {
    bbox = scanExtent(bytes, dv, p);
    inch = 96;
  }
  const bw = bbox.r - bbox.l;
  const bh = bbox.b - bbox.t;

  const pxPerMm = inch / 25.4;
  const g = new Gfx({ pxPerMmX: pxPerMm, pxPerMmY: pxPerMm });
  // 设备空间 = placeable bbox；窗口默认与之等同，文件改窗口时自动重新缩放
  g.dc.mapMode = MM_ANISOTROPIC;
  g.dc.winOrg = { x: bbox.l, y: bbox.t };
  g.dc.winExt = { x: bw, y: bh };
  g.dc.vpOrg = { x: bbox.l, y: bbox.t };
  g.dc.vpExt = { x: bw, y: bh };

  const outW = opts.width ?? (bw / inch) * 96;
  const outH = opts.height ?? (bh / inch) * 96;

  let count = 0;
  while (p + 6 <= bytes.length && count < MAX_RECORDS) {
    const words = dv.getUint32(p, true);
    const fn = dv.getUint16(p + 4, true);
    if (words < 3) break;
    const size = words * 2;
    if (p + size > bytes.length) break;
    if (fn === M.EOF) break;
    record(g, bytes, fn, p, size);
    p += size;
    count++;
  }

  return g.render({ l: bbox.l, t: bbox.t, r: bbox.r, b: bbox.b }, outW, outH);
}

/** 无 placeable 头时，从 SETWINDOWORG/EXT 反推画布尺寸 */
function scanExtent(bytes: Uint8Array, dv: DataView, start: number): Rect {
  let org: Pt = { x: 0, y: 0 };
  let ext: Pt | null = null;
  let p = start;
  let n = 0;
  while (p + 6 <= bytes.length && n < 2000) {
    const words = dv.getUint32(p, true);
    const fn = dv.getUint16(p + 4, true);
    if (words < 3 || p + words * 2 > bytes.length || fn === M.EOF) break;
    if (fn === M.SETWINDOWORG && words >= 5) org = { x: dv.getInt16(p + 8, true), y: dv.getInt16(p + 6, true) };
    if (fn === M.SETWINDOWEXT && words >= 5 && !ext) ext = { x: dv.getInt16(p + 8, true), y: dv.getInt16(p + 6, true) };
    p += words * 2;
    n++;
  }
  const w = ext ? Math.abs(ext.x) : 0;
  const h = ext ? Math.abs(ext.y) : 0;
  return { l: org.x, t: org.y, r: org.x + (w || 1024), b: org.y + (h || 768) };
}

// ---------------- 单条记录 ----------------

function record(g: Gfx, bytes: Uint8Array, fn: number, base: number, size: number): void {
  const end = base + size;
  const r = new Reader(bytes, base + 6, end);

  switch (fn) {
    // ---- 多边形 / 折线 ----
    case M.POLYGON: g.polyline(points(r), true); break;
    case M.POLYLINE: g.polyline(points(r), false); break;
    case M.POLYPOLYGON: {
      const nPoly = r.u16();
      if (!nPoly || nPoly > 0x4000) break;
      const counts: number[] = [];
      for (let i = 0; i < nPoly; i++) counts.push(r.u16());
      const polys: Pt[][] = [];
      for (const c of counts) {
        const poly: Pt[] = [];
        for (let i = 0; i < c && r.has(4); i++) poly.push(r.pt16());
        polys.push(poly);
      }
      g.polyPoly(polys, true);
      break;
    }

    // ---- 基本图形（参数倒序）----
    case M.RECTANGLE: g.rect(rectR(r)); break;
    case M.ELLIPSE: g.ellipse(rectR(r)); break;
    case M.ROUNDRECT: { const ch = r.i16(), cw = r.i16(); g.roundRect(rectR(r), cw, ch); break; }
    case M.ARC: case M.CHORD: case M.PIE: {
      const ye = r.i16(), xe = r.i16(), ys = r.i16(), xs = r.i16();
      const box = rectR(r);
      g.arc(box, xs, ys, xe, ye, fn === M.CHORD ? 'chord' : fn === M.PIE ? 'pie' : 'arc');
      break;
    }
    case M.MOVETO: { const y = r.i16(), x = r.i16(); g.moveTo(x, y); break; }
    case M.LINETO: { const y = r.i16(), x = r.i16(); g.lineTo(x, y); break; }
    case M.SETPIXEL: {
      const c = r.color();
      const y = r.i16(), x = r.i16();
      g.dc.brush = { kind: 'brush', style: BS_SOLID, color: c, hatch: 0, href: null };
      g.dc.pen = { ...g.dc.pen, style: PS_NULL };
      g.rect({ l: x, t: y, r: x + 1, b: y + 1 });
      break;
    }
    case M.PATBLT: {
      r.u32(); // ROP
      const h = r.i16(), w = r.i16(), y = r.i16(), x = r.i16();
      g.dc.pen = { ...g.dc.pen, style: PS_NULL };
      g.rect({ l: x, t: y, r: x + w, b: y + h });
      break;
    }

    // ---- 对象 ----
    case M.CREATEPENINDIRECT: g.addObj(penIndirect(r)); break;
    case M.CREATEBRUSHINDIRECT: g.addObj(brushIndirect(r)); break;
    case M.CREATEFONTINDIRECT: g.addObj(fontIndirect(r)); break;
    case M.SELECTOBJECT: g.selectIdx(r.u16()); break;
    case M.DELETEOBJECT: g.delObj(r.u16()); break;
    // 未实现的创建类记录也要占槽，否则后续索引全部错位
    case M.CREATEPALETTE: case M.CREATEBRUSH: case M.CREATEREGION:
    case M.CREATEBITMAP: case M.CREATEBITMAPINDIRECT:
      g.addObj({ kind: 'brush', style: BS_NULL, color: '#000000', hatch: 0, href: null });
      break;
    case M.CREATEPATTERNBRUSH: case M.DIBCREATEPATTERNBRUSH:
      g.addObj(patternBrush(bytes, base, size, fn));
      break;

    // ---- 映射 ----
    case M.SETWINDOWORG: { const y = r.i16(), x = r.i16(); g.dc.winOrg = { x, y }; break; }
    case M.SETWINDOWEXT: { const y = r.i16(), x = r.i16(); g.dc.winExt = { x, y }; break; }
    case M.SETVIEWPORTORG: { const y = r.i16(), x = r.i16(); g.dc.vpOrg = { x, y }; break; }
    case M.SETVIEWPORTEXT: { const y = r.i16(), x = r.i16(); g.dc.vpExt = { x, y }; break; }
    case M.OFFSETWINDOWORG: { const y = r.i16(), x = r.i16(); g.dc.winOrg = { x: g.dc.winOrg.x + x, y: g.dc.winOrg.y + y }; break; }
    case M.OFFSETVIEWPORTORG: { const y = r.i16(), x = r.i16(); g.dc.vpOrg = { x: g.dc.vpOrg.x + x, y: g.dc.vpOrg.y + y }; break; }
    case M.SCALEWINDOWEXT: {
      const yd = r.i16(), yn = r.i16(), xd = r.i16(), xn = r.i16();
      if (xd) g.dc.winExt.x = (g.dc.winExt.x * xn) / xd;
      if (yd) g.dc.winExt.y = (g.dc.winExt.y * yn) / yd;
      break;
    }
    case M.SCALEVIEWPORTEXT: {
      const yd = r.i16(), yn = r.i16(), xd = r.i16(), xn = r.i16();
      if (xd) g.dc.vpExt.x = (g.dc.vpExt.x * xn) / xd;
      if (yd) g.dc.vpExt.y = (g.dc.vpExt.y * yn) / yd;
      break;
    }
    case M.SETMAPMODE: g.dc.mapMode = r.u16(); break;

    // ---- 状态 ----
    case M.SAVEDC: g.save(); break;
    case M.RESTOREDC: g.restore(r.i16()); break;
    case M.SETBKMODE: g.dc.bkMode = r.u16(); break;
    case M.SETBKCOLOR: g.dc.bkColor = r.color(); break;
    case M.SETTEXTCOLOR: g.dc.textColor = r.color(); break;
    case M.SETTEXTALIGN: g.dc.textAlign = r.u16(); break;
    case M.SETPOLYFILLMODE: g.dc.polyFill = r.u16(); break;
    case M.INTERSECTCLIPRECT: g.intersectClip(rectR(r)); break;

    // ---- 文本 ----
    case M.TEXTOUT: {
      const len = r.u16();
      if (len > 0x8000) break;
      const at = r.p;
      const padded = len + (len & 1);
      r.skip(padded);
      const y = r.i16(), x = r.i16();
      const s = decodeAnsi(bytes.subarray(at, Math.min(at + len, end)), g.dc.font.charset);
      g.text(x, y, s, null, null);
      break;
    }
    case M.EXTTEXTOUT: {
      const y = r.i16(), x = r.i16();
      const len = r.u16();
      const opts = r.u16();
      if (len > 0x8000) break;
      // ETO_OPAQUE(0x02) / ETO_CLIPPED(0x04) 时带一个矩形
      let rect: Rect | null = null;
      if (opts & 0x06) {
        const l = r.i16(), t = r.i16(), rr = r.i16(), bb = r.i16();
        rect = { l, t, r: rr, b: bb };
      }
      const at = r.p;
      const padded = len + (len & 1);
      r.skip(padded);
      let dx: number[] | null = null;
      if (r.left >= len * 2 && len > 0) {
        dx = [];
        for (let i = 0; i < len; i++) dx.push(r.i16());
      }
      const s = decodeAnsi(bytes.subarray(at, Math.min(at + len, end)), g.dc.font.charset);
      g.text(x, y, s, dx, opts & 0x02 ? rect : null);
      break;
    }

    // ---- 位图 ----
    case M.STRETCHDIB: {
      r.u32(); r.u16();          // ROP, ColorUsage
      r.i16(); r.i16();          // SrcHeight, SrcWidth
      r.i16(); r.i16();          // YSrc, XSrc
      const dh = r.i16(), dw = r.i16(), dy = r.i16(), dx = r.i16();
      blit(g, bytes, r.p, end, dx, dy, dw, dh);
      break;
    }
    case M.DIBSTRETCHBLT: {
      const noSrc = size === 14 * 2;
      r.u32();                   // ROP
      r.i16(); r.i16();          // SrcHeight, SrcWidth
      r.i16(); r.i16();          // YSrc, XSrc
      if (noSrc) break;
      const dh = r.i16(), dw = r.i16(), dy = r.i16(), dx = r.i16();
      blit(g, bytes, r.p, end, dx, dy, dw, dh);
      break;
    }
    case M.DIBBITBLT: {
      const noSrc = size === 12 * 2;
      r.u32();                   // ROP
      r.i16(); r.i16();          // YSrc, XSrc
      if (noSrc) break;
      const dh = r.i16(), dw = r.i16(), dy = r.i16(), dx = r.i16();
      blit(g, bytes, r.p, end, dx, dy, dw, dh);
      break;
    }

    default: break; // 未知记录：跳过
  }
}

function blit(
  g: Gfx, bytes: Uint8Array, dibOff: number, end: number,
  dx: number, dy: number, dw: number, dh: number,
): void {
  if (dibOff >= end || dw === 0 || dh === 0) return;
  const hdr = dibHeaderSize(bytes, dibOff);
  if (!hdr) return;
  const href = dibToDataUri(bytes, dibOff, hdr, dibOff + hdr, end - dibOff - hdr);
  if (!href) return;
  g.image({ l: dx, t: dy, r: dx + dw, b: dy + dh }, href);
}

// ---------------- 解析辅助 ----------------

const MAX_POINTS = 1 << 18;

function points(r: Reader): Pt[] {
  const cnt = r.u16();
  if (!cnt || cnt > MAX_POINTS) return [];
  const max = Math.min(cnt, r.left >> 2);
  const out: Pt[] = [];
  for (let i = 0; i < max; i++) out.push(r.pt16());
  return out;
}

/** WMF 矩形参数顺序：bottom, right, top, left */
function rectR(r: Reader): Rect {
  const b = r.i16(), rr = r.i16(), t = r.i16(), l = r.i16();
  return { l, t, r: rr, b };
}

function penIndirect(r: Reader): Pen {
  const style = r.u16();
  const w = r.i16();
  r.i16(); // width.y
  return {
    kind: 'pen',
    style: style & 0x0f,
    width: Math.abs(w) || 1,
    color: r.color(),
    cap: style & 0x0f00,
    join: style & 0xf000,
  };
}

function brushIndirect(r: Reader): Brush {
  const style = r.u16();
  const color = r.color();
  const hatch = r.u16();
  return { kind: 'brush', style, color, hatch, href: null };
}

function fontIndirect(r: Reader): Fnt {
  const height = r.i16();
  r.i16(); // width
  const escapement = r.i16();
  r.i16(); // orientation
  const weight = r.i16();
  const italic = r.u8() !== 0;
  const underline = r.u8() !== 0;
  const strike = r.u8() !== 0;
  const charset = r.u8();
  r.skip(4); // outPrecision / clipPrecision / quality / pitchAndFamily
  const face = r.ansi(Math.min(32, r.left));
  const f = defFont();
  return {
    kind: 'font',
    height: height || f.height,
    escapement, weight: weight > 0 ? weight : 400,
    italic, underline, strike, charset,
    face: face || f.face,
  };
}

/** 图案画刷：DIBCREATEPATTERNBRUSH 带 DIB，CREATEPATTERNBRUSH 只有位图（降级为灰） */
function patternBrush(bytes: Uint8Array, base: number, size: number, fn: number): Brush {
  const gray: Brush = { kind: 'brush', style: BS_SOLID, color: '#808080', hatch: 0, href: null };
  if (fn !== M.DIBCREATEPATTERNBRUSH) return gray;
  const dibOff = base + 6 + 4; // Style(2) + ColorUsage(2)
  const end = base + size;
  const hdr = dibHeaderSize(bytes, dibOff);
  if (!hdr || dibOff + hdr >= end) return gray;
  const href = dibToDataUri(bytes, dibOff, hdr, dibOff + hdr, end - dibOff - hdr);
  return href ? { kind: 'brush', style: 5, color: '#808080', hatch: 0, href } : gray;
}
