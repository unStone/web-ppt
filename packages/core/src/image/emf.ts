/**
 * EMF（Enhanced Metafile，[MS-EMF]）→ SVG。
 * 纯字节解析 + 复用 gdi.ts 的设备上下文，未知记录跳过、越界即停。
 */

import {
  BS_NULL, BS_SOLID, Gfx, ID_MAT, MM_TEXT, PS_NULL,
  Reader, compose, decodeAnsi, defFont, dibToDataUri,
} from './gdi';
import type { Brush, Fnt, Mat, Pen, Pt, Rect } from './gdi';

const EMF_SIG = 0x464d4520; // ' EMF'
const MAX_RECORDS = 100000;

// 记录类型
const R = {
  HEADER: 1, POLYBEZIER: 2, POLYGON: 3, POLYLINE: 4, POLYBEZIERTO: 5, POLYLINETO: 6,
  POLYPOLYLINE: 7, POLYPOLYGON: 8, SETWINDOWEXTEX: 9, SETWINDOWORGEX: 10,
  SETVIEWPORTEXTEX: 11, SETVIEWPORTORGEX: 12, EOF: 14, SETPIXELV: 15, SETMAPMODE: 17,
  SETBKMODE: 18, SETPOLYFILLMODE: 19, SETTEXTALIGN: 22, SETTEXTCOLOR: 24, SETBKCOLOR: 25,
  MOVETOEX: 27, INTERSECTCLIPRECT: 30, SCALEVIEWPORTEXTEX: 31, SCALEWINDOWEXTEX: 32,
  SAVEDC: 33, RESTOREDC: 34, SETWORLDTRANSFORM: 35, MODIFYWORLDTRANSFORM: 36,
  SELECTOBJECT: 37, CREATEPEN: 38, CREATEBRUSHINDIRECT: 39, DELETEOBJECT: 40,
  ELLIPSE: 42, RECTANGLE: 43, ROUNDRECT: 44, ARC: 45, CHORD: 46, PIE: 47,
  LINETO: 54, ARCTO: 55, POLYDRAW: 56, BEGINPATH: 59, ENDPATH: 60, CLOSEFIGURE: 61,
  FILLPATH: 62, STROKEANDFILLPATH: 63, STROKEPATH: 64, SELECTCLIPPATH: 67, ABORTPATH: 68,
  BITBLT: 76, STRETCHBLT: 77, STRETCHDIBITS: 81, EXTCREATEFONTINDIRECTW: 82,
  EXTTEXTOUTA: 83, EXTTEXTOUTW: 84,
  POLYBEZIER16: 85, POLYGON16: 86, POLYLINE16: 87, POLYBEZIERTO16: 88, POLYLINETO16: 89,
  POLYPOLYLINE16: 90, POLYPOLYGON16: 91, POLYDRAW16: 92,
  CREATEMONOBRUSH: 93, CREATEDIBPATTERNBRUSHPT: 94, EXTCREATEPEN: 95,
} as const;

export interface MetafileOptions { width?: number; height?: number }

/** 校验 EMF 魔数：iType == 1 且 40 偏移处为 ' EMF' */
export function isEmf(b: Uint8Array): boolean {
  if (b.length < 88) return false;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return dv.getUint32(0, true) === 1 && dv.getUint32(40, true) === EMF_SIG;
}

export function emfToSvg(bytes: Uint8Array, opts: MetafileOptions = {}): string | null {
  try {
    return parse(bytes, opts);
  } catch {
    return null;
  }
}

function parse(bytes: Uint8Array, opts: MetafileOptions): string | null {
  if (!isEmf(bytes)) return null;
  const h = new Reader(bytes, 0, bytes.length);
  h.skip(8); // iType, nSize
  const rclBounds = h.rectL();
  const rclFrame = h.rectL();
  h.skip(4 + 4 + 4 + 4); // sig, version, nBytes, nRecords
  h.skip(2 + 2 + 4 + 4 + 4); // nHandles, reserved, nDescription, offDescription, nPalEntries
  const devW = h.i32(), devH = h.i32();
  const mmW = h.i32(), mmH = h.i32();

  const pxPerMmX = mmW > 0 && devW > 0 ? devW / mmW : 96 / 25.4;
  const pxPerMmY = mmH > 0 && devH > 0 ? devH / mmH : 96 / 25.4;
  const g = new Gfx({ pxPerMmX, pxPerMmY });

  // 视口坐标系：优先 rclBounds（设备像素），退化时用 rclFrame（0.01mm）换算
  let vb: Rect = rclBounds;
  if (!(vb.r > vb.l) || !(vb.b > vb.t)) {
    const w = Math.round((rclFrame.r - rclFrame.l) * pxPerMmX / 100);
    const hh = Math.round((rclFrame.b - rclFrame.t) * pxPerMmY / 100);
    vb = { l: 0, t: 0, r: w > 0 ? w : 1024, b: hh > 0 ? hh : 768 };
  }
  vb = { l: vb.l, t: vb.t, r: vb.r + 1, b: vb.b + 1 };

  // 默认物理尺寸：rclFrame 是 0.01mm，按 96dpi 折算成 px
  const frameW = (rclFrame.r - rclFrame.l) * 96 / 2540;
  const frameH = (rclFrame.b - rclFrame.t) * 96 / 2540;
  const outW = opts.width ?? (frameW > 0 ? frameW : vb.r - vb.l);
  const outH = opts.height ?? (frameH > 0 ? frameH : vb.b - vb.t);

  // EMF 默认逻辑单位 = 设备单位
  g.dc.mapMode = MM_TEXT;

  let p = 0;
  let count = 0;
  while (p + 8 <= bytes.length && count < MAX_RECORDS) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const type = dv.getUint32(p, true);
    const size = dv.getUint32(p + 4, true);
    if (size < 8 || size % 4 !== 0 || p + size > bytes.length) break;
    if (type === R.EOF) break;
    if (type !== R.HEADER) record(g, bytes, type, p, size);
    p += size;
    count++;
  }

  return g.render(vb, outW, outH);
}

// ---------------- 单条记录 ----------------

function record(g: Gfx, bytes: Uint8Array, type: number, base: number, size: number): void {
  const r = new Reader(bytes, base + 8, base + size);

  switch (type) {
    // ---- 多边形 / 折线 ----
    case R.POLYGON: g.polyline(pointsL(r), true); break;
    case R.POLYLINE: g.polyline(pointsL(r), false); break;
    case R.POLYBEZIER: g.polyBezier(pointsL(r), false); break;
    case R.POLYLINETO: g.polylineTo(pointsL(r)); break;
    case R.POLYBEZIERTO: g.polyBezier(pointsL(r), true); break;
    case R.POLYGON16: g.polyline(points16(r), true); break;
    case R.POLYLINE16: g.polyline(points16(r), false); break;
    case R.POLYBEZIER16: g.polyBezier(points16(r), false); break;
    case R.POLYLINETO16: g.polylineTo(points16(r)); break;
    case R.POLYBEZIERTO16: g.polyBezier(points16(r), true); break;
    case R.POLYPOLYGON: g.polyPoly(polyPolyL(r, false), true); break;
    case R.POLYPOLYLINE: g.polyPoly(polyPolyL(r, false), false); break;
    case R.POLYPOLYGON16: g.polyPoly(polyPolyL(r, true), true); break;
    case R.POLYPOLYLINE16: g.polyPoly(polyPolyL(r, true), false); break;
    case R.POLYDRAW: case R.POLYDRAW16: {
      r.skip(16);
      const cnt = clamp(r.i32());
      const pts: Pt[] = [];
      for (let i = 0; i < cnt; i++) pts.push(type === R.POLYDRAW ? r.ptL() : r.pt16());
      const types: number[] = [];
      for (let i = 0; i < cnt; i++) types.push(r.u8());
      g.polyDraw(pts, types);
      break;
    }

    // ---- 基本图形 ----
    case R.RECTANGLE: g.rect(r.rectL()); break;
    case R.ELLIPSE: g.ellipse(r.rectL()); break;
    case R.ROUNDRECT: { const box = r.rectL(); g.roundRect(box, r.i32(), r.i32()); break; }
    case R.ARC: case R.CHORD: case R.PIE: case R.ARCTO: {
      const box = r.rectL();
      const s = r.ptL(), e = r.ptL();
      const kind = type === R.CHORD ? 'chord' : type === R.PIE ? 'pie' : 'arc';
      g.arc(box, s.x, s.y, e.x, e.y, kind, type === R.ARCTO);
      break;
    }
    case R.MOVETOEX: { const q = r.ptL(); g.moveTo(q.x, q.y); break; }
    case R.LINETO: { const q = r.ptL(); g.lineTo(q.x, q.y); break; }
    case R.SETPIXELV: {
      const q = r.ptL();
      const c = r.color();
      g.dc.brush = { kind: 'brush', style: BS_SOLID, color: c, hatch: 0, href: null };
      g.dc.pen = { ...g.dc.pen, style: PS_NULL };
      g.rect({ l: q.x, t: q.y, r: q.x + 1, b: q.y + 1 });
      break;
    }

    // ---- 路径 ----
    case R.BEGINPATH: g.beginPath(); break;
    case R.ENDPATH: g.endPath(); break;
    case R.CLOSEFIGURE: g.closeFigure(); break;
    case R.FILLPATH: g.finishPath('fill'); break;
    case R.STROKEPATH: g.finishPath('stroke'); break;
    case R.STROKEANDFILLPATH: g.finishPath('both'); break;
    case R.ABORTPATH: g.abortPath(); break;
    case R.SELECTCLIPPATH: g.clipToPath(); break;

    // ---- 对象 ----
    case R.CREATEPEN: { const ih = r.i32(); g.putObj(ih, logPen(r)); break; }
    case R.EXTCREATEPEN: { const ih = r.i32(); g.putObj(ih, extPen(r)); break; }
    case R.CREATEBRUSHINDIRECT: { const ih = r.i32(); g.putObj(ih, logBrush(r)); break; }
    case R.CREATEMONOBRUSH:
    case R.CREATEDIBPATTERNBRUSHPT: { const ih = r.i32(); g.putObj(ih, dibBrush(r, bytes, base)); break; }
    case R.EXTCREATEFONTINDIRECTW: { const ih = r.i32(); g.putObj(ih, logFontW(r)); break; }
    case R.SELECTOBJECT: g.selectIdx(r.u32()); break;
    case R.DELETEOBJECT: g.delObj(r.u32()); break;

    // ---- 变换 / 映射 ----
    case R.SETWORLDTRANSFORM: g.dc.world = xform(r); break;
    case R.MODIFYWORLDTRANSFORM: {
      const m = xform(r);
      const mode = r.u32();
      if (mode === 1) g.dc.world = [...ID_MAT] as Mat;
      else if (mode === 2) g.dc.world = compose(m, g.dc.world);
      else if (mode === 3) g.dc.world = compose(g.dc.world, m);
      break;
    }
    case R.SETWINDOWEXTEX: g.dc.winExt = { x: r.i32(), y: r.i32() }; break;
    case R.SETWINDOWORGEX: g.dc.winOrg = r.ptL(); break;
    case R.SETVIEWPORTEXTEX: g.dc.vpExt = { x: r.i32(), y: r.i32() }; break;
    case R.SETVIEWPORTORGEX: g.dc.vpOrg = r.ptL(); break;
    case R.SETMAPMODE: g.dc.mapMode = r.u32(); break;
    case R.SCALEVIEWPORTEXTEX: {
      const xn = r.i32(), xd = r.i32(), yn = r.i32(), yd = r.i32();
      if (xd) g.dc.vpExt.x = (g.dc.vpExt.x * xn) / xd;
      if (yd) g.dc.vpExt.y = (g.dc.vpExt.y * yn) / yd;
      break;
    }
    case R.SCALEWINDOWEXTEX: {
      const xn = r.i32(), xd = r.i32(), yn = r.i32(), yd = r.i32();
      if (xd) g.dc.winExt.x = (g.dc.winExt.x * xn) / xd;
      if (yd) g.dc.winExt.y = (g.dc.winExt.y * yn) / yd;
      break;
    }

    // ---- 状态 ----
    case R.SAVEDC: g.save(); break;
    case R.RESTOREDC: g.restore(r.i32()); break;
    case R.SETBKMODE: g.dc.bkMode = r.u32(); break;
    case R.SETPOLYFILLMODE: g.dc.polyFill = r.u32(); break;
    case R.SETTEXTALIGN: g.dc.textAlign = r.u32(); break;
    case R.SETTEXTCOLOR: g.dc.textColor = r.color(); break;
    case R.SETBKCOLOR: g.dc.bkColor = r.color(); break;
    case R.INTERSECTCLIPRECT: g.intersectClip(r.rectL()); break;

    // ---- 文本 ----
    case R.EXTTEXTOUTW: case R.EXTTEXTOUTA: extTextOut(g, r, bytes, base, size, type === R.EXTTEXTOUTW); break;

    // ---- 位图 ----
    case R.STRETCHDIBITS: stretchDiBits(g, r, bytes, base); break;
    case R.BITBLT: case R.STRETCHBLT: bitBlt(g, r, bytes, base, type === R.STRETCHBLT); break;

    default: break; // 未知记录：跳过
  }
}

// ---------------- 点集 ----------------

const MAX_POINTS = 1 << 20;
const clamp = (v: number): number => (v > 0 && v < MAX_POINTS ? v | 0 : 0);

function pointsL(r: Reader): Pt[] {
  r.skip(16); // Bounds
  const cnt = Math.min(clamp(r.i32()), r.left >> 3);
  const out: Pt[] = [];
  for (let i = 0; i < cnt; i++) out.push(r.ptL());
  return out;
}

function points16(r: Reader): Pt[] {
  r.skip(16);
  const cnt = Math.min(clamp(r.i32()), r.left >> 2);
  const out: Pt[] = [];
  for (let i = 0; i < cnt; i++) out.push(r.pt16());
  return out;
}

function polyPolyL(r: Reader, small: boolean): Pt[][] {
  r.skip(16);
  const nPoly = clamp(r.i32());
  const nPts = clamp(r.i32());
  if (!nPoly || !nPts || nPoly > nPts) return [];
  const counts: number[] = [];
  let sum = 0;
  for (let i = 0; i < nPoly; i++) { const c = clamp(r.i32()); counts.push(c); sum += c; }
  if (sum > nPts) return [];
  const avail = small ? r.left >> 2 : r.left >> 3;
  const out: Pt[][] = [];
  let read = 0;
  for (const c of counts) {
    const poly: Pt[] = [];
    for (let i = 0; i < c && read < avail; i++, read++) poly.push(small ? r.pt16() : r.ptL());
    out.push(poly);
  }
  return out;
}

// ---------------- 对象构造 ----------------

function logPen(r: Reader): Pen {
  const style = r.u32();
  const w = r.i32();
  r.i32(); // width.y
  return {
    kind: 'pen', style: style & 0x0f, width: Math.abs(w) || 1,
    color: r.color(), cap: 0, join: 0,
  };
}

function extPen(r: Reader): Pen {
  r.skip(16); // offBmi / cbBmi / offBits / cbBits
  const penStyle = r.u32();
  const width = r.u32();
  const brushStyle = r.u32();
  const color = r.color();
  return {
    kind: 'pen',
    style: brushStyle === BS_NULL ? PS_NULL : penStyle & 0x0f,
    width: Math.max(width || 1, 1),
    color,
    cap: penStyle & 0x00000f00,
    join: penStyle & 0x0000f000,
  };
}

function logBrush(r: Reader): Brush {
  const style = r.u32();
  const color = r.color();
  const hatch = r.u32();
  return { kind: 'brush', style, color, hatch, href: null };
}

function dibBrush(r: Reader, bytes: Uint8Array, base: number): Brush {
  r.u32(); // iUsage / style
  const offBmi = r.u32(); const cbBmi = r.u32();
  const offBits = r.u32(); const cbBits = r.u32();
  const href = cbBmi > 0 ? dibToDataUri(bytes, base + offBmi, cbBmi, base + offBits, cbBits) : null;
  return { kind: 'brush', style: href ? 5 : BS_SOLID, color: '#808080', hatch: 0, href };
}

function logFontW(r: Reader): Fnt {
  const height = r.i32();
  r.i32(); // width
  const escapement = r.i32();
  r.i32(); // orientation
  const weight = r.i32();
  const italic = r.u8() !== 0;
  const underline = r.u8() !== 0;
  const strike = r.u8() !== 0;
  const charset = r.u8();
  r.skip(4); // outPrecision / clipPrecision / quality / pitchAndFamily
  const face = r.utf16(64);
  const f = defFont();
  return {
    kind: 'font',
    height: height || f.height,
    escapement, weight: weight > 0 ? weight : 400,
    italic, underline, strike, charset,
    face: face || f.face,
  };
}

function xform(r: Reader): Mat {
  return [r.f32(), r.f32(), r.f32(), r.f32(), r.f32(), r.f32()];
}

// ---------------- 文本 ----------------

function extTextOut(g: Gfx, r: Reader, bytes: Uint8Array, base: number, size: number, wide: boolean): void {
  r.skip(16); // Bounds
  r.u32();    // iGraphicsMode
  const exScale = r.f32();
  r.f32();    // eyScale
  const ref = r.ptL();
  const chars = r.u32();
  const offString = r.u32();
  const options = r.u32();
  const rect = r.rectL();
  const offDx = r.u32();
  if (!chars || chars > 0x10000) return;

  const strAt = base + offString;
  const bytesNeeded = wide ? chars * 2 : chars;
  if (offString < 8 || strAt + bytesNeeded > base + size) return;
  const text = wide
    ? new Reader(bytes, strAt, strAt + bytesNeeded).utf16(bytesNeeded)
    : decodeAnsi(bytes.subarray(strAt, strAt + bytesNeeded), g.dc.font.charset);
  if (!text) return;

  let dx: number[] | null = null;
  const dxAt = base + offDx;
  if (offDx >= 8 && dxAt + chars * 4 <= base + size) {
    const dr = new Reader(bytes, dxAt, dxAt + chars * 4);
    dx = [];
    for (let i = 0; i < chars; i++) dx.push(dr.i32());
    // exScale 用于 ETO_PDY 之外的缩放场景，异常值忽略
    if (exScale > 0 && exScale !== 1 && Number.isFinite(exScale)) dx = dx.map((v) => v * exScale);
  }
  // ETO_OPAQUE = 0x0002
  const opaque = (options & 0x0002) !== 0 ? rect : null;
  g.text(ref.x, ref.y, text, dx, opaque);
}

// ---------------- 位图 ----------------

function stretchDiBits(g: Gfx, r: Reader, bytes: Uint8Array, base: number): void {
  r.skip(16); // Bounds
  const xDest = r.i32(), yDest = r.i32();
  r.i32(); r.i32(); r.i32(); r.i32(); // xSrc, ySrc, cxSrc, cySrc
  const offBmi = r.u32(), cbBmi = r.u32();
  const offBits = r.u32(), cbBits = r.u32();
  r.u32(); r.u32(); // UsageSrc, ROP
  const cxDest = r.i32(), cyDest = r.i32();
  if (!cbBmi || !cbBits) return;
  const href = dibToDataUri(bytes, base + offBmi, cbBmi, base + offBits, cbBits);
  if (!href) return;
  g.image({ l: xDest, t: yDest, r: xDest + cxDest, b: yDest + cyDest }, href);
}

function bitBlt(g: Gfx, r: Reader, bytes: Uint8Array, base: number, stretch: boolean): void {
  r.skip(16); // Bounds
  const xDest = r.i32(), yDest = r.i32();
  const cxDest = r.i32(), cyDest = r.i32();
  r.u32();          // ROP
  r.i32(); r.i32(); // xSrc, ySrc
  r.skip(24);       // XformSrc
  r.u32();          // BkColorSrc
  r.u32();          // UsageSrc
  const offBmi = r.u32(), cbBmi = r.u32();
  const offBits = r.u32(), cbBits = r.u32();
  if (stretch) { r.i32(); r.i32(); } // cxSrc, cySrc
  if (!cbBmi || !cbBits) return;
  const href = dibToDataUri(bytes, base + offBmi, cbBmi, base + offBits, cbBits);
  if (!href) return;
  g.image({ l: xDest, t: yDest, r: xDest + cxDest, b: yDest + cyDest }, href);
}
