/**
 * PICT（Apple QuickDraw Picture）→ SVG。
 *
 * Mac 版 PowerPoint 把 OLE 对象的预览快照存成 PICT，Windows 版存 EMF/WMF。
 * 三者都是「绘图指令流」，所以这里只写 opcode 解释，图元 → SVG 的那一层
 * 直接复用 gdi.ts 的 Gfx —— 与 emf.ts / wmf.ts 完全同构。
 *
 * 版本差异：
 *   v1 —— 单字节 opcode，坐标 16 位
 *   v2 —— 双字节 opcode 且**按偶数字节对齐**，多出 RGB 颜色与 PixMap 位图
 * 文件形态的 .pict 前面还有 512 字节的全零 header，需要跳过。
 */

import {
  BS_NULL, BS_SOLID, Gfx, PS_NULL, PS_SOLID, Reader, base64, defFont, encodePng, rgb,
} from './gdi';
import type { Brush, Fnt, Pen, Pt, Rect } from './gdi';
import type { MetafileOptions } from './emf';

const MAX_OPS = 200000;

/** 形状 opcode 的低 3 位是动作：0 描边 / 1 填充 / 2 擦除 / 3 反色 / 4 用图案填充 */
const VERB_FRAME = 0, VERB_PAINT = 1, VERB_ERASE = 2, VERB_INVERT = 3, VERB_FILL = 4;

/**
 * v2 里定长（或长度可直接算出）的 opcode 表：opcode → 需要跳过的数据字节数。
 * 认不出的 opcode 必须能正确跳过，否则后面整条流全部错位——
 * 这跟 wmf.ts 里「未实现的创建类记录也要占对象表槽位」是同一类陷阱。
 */
const FIXED_LEN: Record<number, number> = {
  0x0000: 0, 0x0002: 8, 0x0003: 2, 0x0004: 2, 0x0005: 2, 0x0006: 4, 0x0007: 4,
  0x0008: 2, 0x0009: 8, 0x000a: 8, 0x000b: 4, 0x000c: 4, 0x000d: 2, 0x000e: 4, 0x000f: 4,
  0x0010: 8, 0x0015: 2, 0x0016: 2, 0x0017: 0, 0x0018: 0, 0x0019: 0,
  0x001a: 6, 0x001b: 6, 0x001c: 0, 0x001d: 6, 0x001e: 0, 0x001f: 6,
  0x0023: 2, 0x002d: 6, 0x002e: 0, 0x002f: 0,
  0x003d: 0, 0x003e: 0, 0x003f: 0, 0x004d: 0, 0x004e: 0, 0x004f: 0,
  0x005d: 0, 0x005e: 0, 0x005f: 0, 0x006d: 12, 0x006e: 12, 0x006f: 12,
  0x007d: 0, 0x007e: 0, 0x007f: 0, 0x008d: 0, 0x008e: 0, 0x008f: 0,
};

/** 识别 PICT：v2 的签名是 VersionOp(0x0011) + 0x02FF，v1 是 0x1101 */
export function isPict(b: Uint8Array): boolean {
  return pictStart(b) !== null;
}

/**
 * 定位图片数据起点并读出版本。
 * 文件形态前置 512 字节 header，剪贴板形态没有——两种都要认。
 */
function pictStart(b: Uint8Array): { off: number; v2: boolean; bounds: Rect } | null {
  if (!b || b.length < 16) return null;
  for (const base of [512, 0]) {
    if (base + 12 > b.length) continue;
    const dv = new DataView(b.buffer, b.byteOffset + base, b.length - base);
    // picSize(u16) + picFrame(4×i16, 顺序 top,left,bottom,right)
    const t = dv.getInt16(2, false), l = dv.getInt16(4, false);
    const bo = dv.getInt16(6, false), r = dv.getInt16(8, false);
    if (!(r > l) || !(bo > t)) continue;
    const w0 = dv.getUint16(10, false);
    // v2: 0x0011 VersionOp，随后 0x02FF；v1: 0x1101
    if (w0 === 0x0011 && dv.getUint16(12, false) === 0x02ff) {
      return { off: base + 14, v2: true, bounds: { l, t, r, b: bo } };
    }
    if ((w0 >> 8) === 0x11 && (w0 & 0xff) === 0x01) {
      return { off: base + 12, v2: false, bounds: { l, t, r, b: bo } };
    }
  }
  return null;
}

export function pictToSvg(bytes: Uint8Array, opts: MetafileOptions = {}): string | null {
  try {
    return parse(bytes, opts);
  } catch {
    return null;
  }
}

// ---------------- QuickDraw 状态 ----------------

interface QdState {
  fg: string;
  bg: string;
  penW: number;
  penH: number;
  /** 画笔图案全 0 表示白，全 1 表示黑；只用它判断「实心还是空」 */
  penSolid: boolean;
  fillSolid: boolean;
  fillColor: string;
  txFont: number;
  txSize: number;
  txFace: number;
  ovalW: number;
  ovalH: number;
  origin: Pt;
}

function defaultState(): QdState {
  return {
    fg: '#000000', bg: '#ffffff', penW: 1, penH: 1, penSolid: true,
    fillSolid: true, fillColor: '#000000',
    txFont: 0, txSize: 12, txFace: 0, ovalW: 0, ovalH: 0, origin: { x: 0, y: 0 },
  };
}

function parse(bytes: Uint8Array, opts: MetafileOptions): string | null {
  const head = pictStart(bytes);
  if (!head) return null;
  const { bounds, v2 } = head;

  const w = bounds.r - bounds.l;
  const h = bounds.b - bounds.t;
  // QuickDraw 是 72dpi 的设备空间，与 CSS px 一一对应
  const gfx = new Gfx({ pxPerMmX: 72 / 25.4, pxPerMmY: 72 / 25.4 });
  const r = new Reader(bytes, head.off, bytes.length);
  const st = defaultState();

  const pen = (): Pen => ({
    kind: 'pen', style: st.penSolid && st.penW > 0 ? PS_SOLID : PS_NULL,
    width: Math.max(st.penW, st.penH), color: st.fg, cap: 0, join: 0,
  });
  const brush = (color: string, on: boolean): Brush =>
    ({ kind: 'brush', style: on ? BS_SOLID : BS_NULL, color, hatch: 0, href: null });

  /** 按动作选定画笔与填充，返回本次要不要真的画 */
  const applyVerb = (verb: number): boolean => {
    switch (verb) {
      case VERB_FRAME:
        gfx.select(pen());
        gfx.select(brush('#000000', false));
        return true;
      case VERB_PAINT:
      case VERB_FILL:
        gfx.select({ ...pen(), style: PS_NULL });
        gfx.select(brush(verb === VERB_FILL ? st.fillColor : st.fg, verb === VERB_FILL ? st.fillSolid : st.penSolid));
        return true;
      case VERB_ERASE:
        gfx.select({ ...pen(), style: PS_NULL });
        gfx.select(brush(st.bg, true));
        return true;
      case VERB_INVERT:
        // 反色在 SVG 里没有对等物，按前景实心近似
        gfx.select({ ...pen(), style: PS_NULL });
        gfx.select(brush(st.fg, true));
        return true;
      default:
        return false;
    }
  };

  const readRect = (): Rect => {
    const t = r.i16be(), l = r.i16be(), b = r.i16be(), rt = r.i16be();
    return { l, t, r: rt, b };
  };
  const readPt = (): Pt => { const y = r.i16be(); const x = r.i16be(); return { x, y }; };
  const readRgb = (): string => {
    // QuickDraw 的 RGBColor 是三个 16 位分量，取高字节
    const rr = r.u16be(), gg = r.u16be(), bb = r.u16be();
    return rgb(rr >> 8, gg >> 8, bb >> 8);
  };

  /** 区域数据：前两字节是总长，只取包围盒当裁剪矩形（区域的复杂路径不还原） */
  const readRgn = (): Rect | null => {
    const size = r.u16be();
    if (size < 10) { r.skip(Math.max(0, size - 2)); return null; }
    const rc = readRect();
    r.skip(size - 10);
    return rc;
  };

  let lastRect: Rect = { l: 0, t: 0, r: 0, b: 0 };
  let lastOval: Rect = { l: 0, t: 0, r: 0, b: 0 };
  let lastRRect: Rect = { l: 0, t: 0, r: 0, b: 0 };
  let lastPoly: Pt[] = [];
  let lastArc: { rect: Rect; start: number; ext: number } | null = null;
  let cur: Pt = { x: 0, y: 0 };
  let drew = false;

  const shape = (kind: 'rect' | 'rrect' | 'oval' | 'poly' | 'arc', verb: number): void => {
    if (!applyVerb(verb)) return;
    switch (kind) {
      case 'rect': gfx.rect(lastRect); break;
      case 'rrect': gfx.roundRect(lastRRect, st.ovalW, st.ovalH); break;
      case 'oval': gfx.ellipse(lastOval); break;
      case 'poly': if (lastPoly.length > 1) gfx.polyline(lastPoly, true); break;
      case 'arc': {
        if (!lastArc) return;
        // QuickDraw 角度：0° 朝上、顺时针；Gfx.arc 收的是起止射线上的点
        const { rect, start, ext } = lastArc;
        const cx = (rect.l + rect.r) / 2, cy = (rect.t + rect.b) / 2;
        const rx = (rect.r - rect.l) / 2, ry = (rect.b - rect.t) / 2;
        const at = (deg: number): Pt => {
          const a = ((90 - deg) * Math.PI) / 180;
          return { x: cx + rx * Math.cos(a), y: cy - ry * Math.sin(a) };
        };
        const s = at(start), e = at(start + ext);
        gfx.arc(rect, s.x, s.y, e.x, e.y, verb === VERB_FRAME ? 'arc' : 'pie');
        break;
      }
    }
    drew = true;
  };

  const text = (x: number, y: number, s: string): void => {
    if (!s) return;
    const f: Fnt = { ...defFont(), height: -Math.max(st.txSize, 1), weight: st.txFace & 1 ? 700 : 400, italic: !!(st.txFace & 2) };
    gfx.select(f);
    // QuickDraw 的文字锚点是**基线**，而 Gfx 默认按顶端（GDI 的 TA_TOP）。
    // 不置 TA_BASELINE 的话每行字都会整体下沉一个字高。
    gfx.dc.textAlign = 24;
    gfx.dc.textColor = st.fg;
    gfx.text(x, y, s, null, null);
    drew = true;
  };

  let ops = 0;
  while (r.has(v2 ? 2 : 1) && ops++ < MAX_OPS) {
    // v2 的 opcode 必须落在偶数字节上
    if (v2 && (r.pos - head.off) % 2 === 1) r.skip(1);
    if (!r.has(v2 ? 2 : 1)) break;
    const op = v2 ? r.u16be() : r.u8();
    if (op === 0x00ff) break;               // OpEndPic

    switch (op) {
      case 0x0001: {                        // Clip
        const rc = readRgn();
        if (rc) gfx.intersectClip(rc);
        break;
      }
      case 0x0007: { const p = readPt(); st.penW = Math.abs(p.x); st.penH = Math.abs(p.y); break; }
      case 0x0009: case 0x000a: {           // PnPat / FillPat
        const pat = [r.u8(), r.u8(), r.u8(), r.u8(), r.u8(), r.u8(), r.u8(), r.u8()];
        const on = pat.some((v) => v !== 0);
        if (op === 0x0009) st.penSolid = on; else { st.fillSolid = on; st.fillColor = st.fg; }
        break;
      }
      case 0x000b: { const p = readPt(); st.ovalW = Math.abs(p.x); st.ovalH = Math.abs(p.y); break; }
      case 0x000c: { const p = readPt(); st.origin = p; break; }
      case 0x000d: st.txSize = r.u16be(); break;
      case 0x0003: st.txFont = r.u16be(); break;
      case 0x0004: st.txFace = r.u8(); r.skip(1); break;
      case 0x000e: case 0x000f: {           // FgColor / BkColor（老式索引色）
        const v = r.u32be();
        const c = v === 0 ? '#000000' : v === 30 ? '#ffffff' : rgb((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
        if (op === 0x000e) st.fg = c; else st.bg = c;
        break;
      }
      case 0x001a: st.fg = readRgb(); break;   // RGBFgCol
      case 0x001b: st.bg = readRgb(); break;   // RGBBkCol

      case 0x0020: {                        // Line
        const a = readPt(), b = readPt();
        gfx.select(pen()); gfx.moveTo(a.x, a.y); gfx.lineTo(b.x, b.y);
        cur = b; drew = true; break;
      }
      case 0x0021: {                        // LineFrom
        const b = readPt();
        gfx.select(pen()); gfx.moveTo(cur.x, cur.y); gfx.lineTo(b.x, b.y);
        cur = b; drew = true; break;
      }
      case 0x0022: {                        // ShortLine
        const a = readPt(); const dx = r.i8(), dy = r.i8();
        gfx.select(pen()); gfx.moveTo(a.x, a.y); gfx.lineTo(a.x + dx, a.y + dy);
        cur = { x: a.x + dx, y: a.y + dy }; drew = true; break;
      }
      case 0x0023: {                        // ShortLineFrom
        const dx = r.i8(), dy = r.i8();
        gfx.select(pen()); gfx.moveTo(cur.x, cur.y); gfx.lineTo(cur.x + dx, cur.y + dy);
        cur = { x: cur.x + dx, y: cur.y + dy }; drew = true; break;
      }

      case 0x0028: { const p = readPt(); text(p.x, p.y, r.ansi(r.u8())); cur = p; break; }
      case 0x0029: { const dh = r.u8(); const s = r.ansi(r.u8()); cur = { x: cur.x + dh, y: cur.y }; text(cur.x, cur.y, s); break; }
      case 0x002a: { const dv = r.u8(); const s = r.ansi(r.u8()); cur = { x: cur.x, y: cur.y + dv }; text(cur.x, cur.y, s); break; }
      case 0x002b: { const dh = r.u8(), dv = r.u8(); const s = r.ansi(r.u8()); cur = { x: cur.x + dh, y: cur.y + dv }; text(cur.x, cur.y, s); break; }
      case 0x002c: { const size = r.u16be(); r.skip(Math.max(0, size)); break; }  // fontName

      // 形状：0x30/40/50/60/70 段带操作数，0x38/48/58/68/78 段复用上一次的
      case 0x0030: case 0x0031: case 0x0032: case 0x0033: case 0x0034:
        lastRect = readRect(); shape('rect', op & 7); break;
      case 0x0038: case 0x0039: case 0x003a: case 0x003b: case 0x003c:
        shape('rect', op & 7); break;
      case 0x0040: case 0x0041: case 0x0042: case 0x0043: case 0x0044:
        lastRRect = readRect(); shape('rrect', op & 7); break;
      case 0x0048: case 0x0049: case 0x004a: case 0x004b: case 0x004c:
        shape('rrect', op & 7); break;
      case 0x0050: case 0x0051: case 0x0052: case 0x0053: case 0x0054:
        lastOval = readRect(); shape('oval', op & 7); break;
      case 0x0058: case 0x0059: case 0x005a: case 0x005b: case 0x005c:
        shape('oval', op & 7); break;
      case 0x0060: case 0x0061: case 0x0062: case 0x0063: case 0x0064: {
        const rc = readRect(); const s = r.i16be(), e = r.i16be();
        lastArc = { rect: rc, start: s, ext: e }; shape('arc', op & 7); break;
      }
      case 0x0068: case 0x0069: case 0x006a: case 0x006b: case 0x006c: {
        const s = r.i16be(), e = r.i16be();
        if (lastArc) lastArc = { rect: lastArc.rect, start: s, ext: e };
        shape('arc', op & 7); break;
      }
      case 0x0070: case 0x0071: case 0x0072: case 0x0073: case 0x0074: {
        const size = r.u16be();
        const end = r.pos + size - 2;
        readRect();                          // polyBBox
        const pts: Pt[] = [];
        while (r.pos + 4 <= end) pts.push(readPt());
        r.seek(end);
        lastPoly = pts; shape('poly', op & 7); break;
      }
      case 0x0078: case 0x0079: case 0x007a: case 0x007b: case 0x007c:
        shape('poly', op & 7); break;

      // 区域：只取包围盒近似
      case 0x0080: case 0x0081: case 0x0082: case 0x0083: case 0x0084: {
        const rc = readRgn();
        if (rc) { lastRect = rc; shape('rect', op & 7); }
        break;
      }
      case 0x0088: case 0x0089: case 0x008a: case 0x008b: case 0x008c:
        shape('rect', op & 7); break;

      case 0x0090: case 0x0091: case 0x0098: case 0x0099:
      case 0x009a: case 0x009b: {
        if (!readBits(r, op, gfx)) return null;
        drew = true; break;
      }

      case 0x00a0: r.skip(2); break;        // ShortComment
      case 0x00a1: { r.skip(2); const size = r.u16be(); r.skip(size); break; }  // LongComment
      case 0x0c00: r.skip(24); break;       // HeaderOp
      case 0x8200: case 0x8201: {           // QuickTime 压缩图
        const size = r.u32be();
        const end = r.pos + size;
        const href = quickTimeImage(r, end);
        if (href) { gfx.image(bounds, href); drew = true; }
        r.seek(Math.min(end, bytes.length));
        break;
      }

      default: {
        const fixed = FIXED_LEN[op];
        if (fixed !== undefined) { r.skip(fixed); break; }
        // 保留区的长度在规范里按段划定；跳不准就只能整段放弃，
        // 继续解析只会把后面的坐标读成垃圾
        const skip = reservedLen(op, r);
        if (skip < 0) { ops = MAX_OPS; break; }
        r.skip(skip);
      }
    }
  }

  if (!drew) return null;
  return gfx.render(bounds, opts.width ?? w, opts.height ?? h);
}

/**
 * 保留 opcode 的数据长度。规范按段规定：0x0100-0x7FFF 每段定长，
 * 0x8000-0x80FF 无数据，0x8100 以上带 4 字节长度前缀。返回 -1 表示无法确定。
 */
function reservedLen(op: number, r: Reader): number {
  if (op >= 0x0100 && op <= 0x7fff) return ((op >> 8) & 0xff) * 2;
  if (op >= 0x8000 && op <= 0x80ff) return 0;
  if (op >= 0x8100) return r.has(4) ? r.u32be() : -1;
  return -1;
}

/** QuickTime 容器里常直接裹着一张 JPEG，按魔数抠出来直通 */
function quickTimeImage(r: Reader, end: number): string | null {
  const start = r.pos;
  const buf = r.take(Math.max(0, Math.min(end, r.limit) - start));
  r.seek(start);
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      return `data:image/jpeg;base64,${base64(buf.subarray(i))}`;
    }
    if (buf[i] === 0x89 && buf[i + 1] === 0x50 && buf[i + 2] === 0x4e && buf[i + 3] === 0x47) {
      return `data:image/png;base64,${base64(buf.subarray(i))}`;
    }
  }
  return null;
}

// ---------------- 位图 ----------------

/**
 * BitsRect / PackBitsRect / DirectBitsRect 及各自的 Rgn 变体。
 *
 * PixMap 的行数据用 PackBits（RLE）压缩，行长 < 8 时不压缩——
 * 这个例外不处理的话，小图会整片错位。
 */
function readBits(r: Reader, op: number, gfx: Gfx): boolean {
  const direct = op === 0x009a || op === 0x009b;
  const withRgn = op === 0x0091 || op === 0x0099 || op === 0x009b;
  if (direct) r.skip(4);                    // baseAddr 占位

  const rowBytes = r.u16be() & 0x7fff;
  const bt = r.i16be(), bl = r.i16be(), bb = r.i16be(), br = r.i16be();
  const bw = br - bl, bh = bb - bt;
  if (bw <= 0 || bh <= 0 || bw > 20000 || bh > 20000) return false;

  const packed = rowBytes >= 8;
  let pixelSize = 1, cmpCount = 1, cmpSize = 1;
  let palette: number[][] = [];

  const isPixmap = direct || (rowBytes & 0x8000) !== 0 || op === 0x0098 || op === 0x0099;
  if (isPixmap) {
    r.skip(2);                              // pmVersion
    const packType = r.u16be();
    r.skip(4);                              // packSize
    r.skip(8);                              // hRes / vRes
    r.skip(2);                              // pixelType
    pixelSize = r.u16be();
    cmpCount = r.u16be();
    cmpSize = r.u16be();
    r.skip(4);                              // planeBytes
    r.skip(8);                              // pmTable / pmReserved
    if (!direct) {
      // 索引色跟着一张调色板
      r.skip(4);                            // ctSeed
      r.skip(2);                            // ctFlags
      const n = r.u16be() + 1;
      if (n > 0 && n <= 256) {
        palette = new Array(n);
        for (let i = 0; i < n; i++) {
          r.skip(2);                        // value（按顺序排，不使用）
          palette[i] = [r.u16be() >> 8, r.u16be() >> 8, r.u16be() >> 8];
        }
      }
    }
    if (packType === 1) { /* 不压缩，下面按 packed=false 处理 */ }
  } else {
    // 老式 BitsRect：1 位黑白
    pixelSize = 1;
  }

  const srcRect = { t: r.i16be(), l: r.i16be(), b: r.i16be(), r: r.i16be() };
  const dstRect = { t: r.i16be(), l: r.i16be(), b: r.i16be(), r: r.i16be() };
  r.skip(2);                                // mode
  if (withRgn) { const sz = r.u16be(); r.skip(Math.max(0, sz - 2)); }

  const rowLen = rowBytes;
  if (rowLen * bh > 64 * 1024 * 1024) return false;
  const raw = new Uint8Array(rowLen * bh).fill(0xff);
  // 行数据不全时画出已有部分即可。实测语料里就有被截断的 PICT blip
  // （1085 行只存了 41 行），整张放弃等于把能看的内容也丢了。
  let rows = 0;
  for (let y = 0; y < bh; y++) {
    if (!packed) {
      if (!r.has(rowLen)) break;
      raw.set(r.take(rowLen), y * rowLen);
      rows++;
      continue;
    }
    const len = rowBytes > 250 ? r.u16be() : r.u8();
    if (len <= 0 || !r.has(len)) break;
    unpackBits(r.take(len), raw, y * rowLen, rowLen);
    rows++;
  }
  if (!rows) return false;

  const rgba = new Uint8Array(bw * bh * 4);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let cr = 0, cg = 0, cb = 0;
      if (direct && pixelSize === 32) {
        // 32 位 direct 是按分量分平面存的：整行 R，再整行 G，再整行 B
        const base = y * rowLen;
        const off = cmpCount === 3 ? 0 : bw;
        cr = raw[base + off + x];
        cg = raw[base + off + bw + x];
        cb = raw[base + off + bw * 2 + x];
      } else if (direct && pixelSize === 16) {
        const v = (raw[y * rowLen + x * 2] << 8) | raw[y * rowLen + x * 2 + 1];
        cr = ((v >> 10) & 31) * 8; cg = ((v >> 5) & 31) * 8; cb = (v & 31) * 8;
      } else if (pixelSize === 8) {
        const idx = raw[y * rowLen + x];
        const p = palette[idx] ?? [idx, idx, idx];
        [cr, cg, cb] = p;
      } else if (pixelSize === 4) {
        const byte = raw[y * rowLen + (x >> 1)];
        const idx = x & 1 ? byte & 15 : byte >> 4;
        const p = palette[idx] ?? [0, 0, 0];
        [cr, cg, cb] = p;
      } else {
        const byte = raw[y * rowLen + (x >> 3)];
        const bit = (byte >> (7 - (x & 7))) & 1;
        const p = palette[bit] ?? (bit ? [0, 0, 0] : [255, 255, 255]);
        [cr, cg, cb] = p;
      }
      const o = (y * bw + x) * 4;
      rgba[o] = cr; rgba[o + 1] = cg; rgba[o + 2] = cb; rgba[o + 3] = 255;
    }
  }

  const href = `data:image/png;base64,${base64(encodePng(rgba, bw, bh))}`;
  gfx.image({ l: dstRect.l, t: dstRect.t, r: dstRect.r, b: dstRect.b }, href);
  void srcRect; void cmpSize;
  return true;
}

/** PackBits 解压：正数表示后跟 n+1 个原样字节，负数表示某字节重复 1-n 次 */
function unpackBits(src: Uint8Array, dst: Uint8Array, dstOff: number, maxLen: number): void {
  let i = 0, o = dstOff;
  const end = dstOff + maxLen;
  while (i < src.length && o < end) {
    const n = src[i++] << 24 >> 24;          // 转成有符号
    if (n >= 0) {
      const cnt = Math.min(n + 1, end - o, src.length - i);
      dst.set(src.subarray(i, i + cnt), o);
      i += cnt; o += cnt;
    } else {
      if (i >= src.length) break;
      const cnt = Math.min(1 - n, end - o);
      dst.fill(src[i++], o, o + cnt);
      o += cnt;
    }
  }
}
