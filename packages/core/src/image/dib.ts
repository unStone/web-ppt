/**
 * EMF / WMF / PICT / EMF+ 共用的位图工具：Base64、纯 JS PNG 编码、DIB 解码。
 * 浏览器与 Node 通用，不依赖 Canvas。
 */
import { zlibSync } from 'fflate';
import { Reader } from './gdi';

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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------------- DIB 解码 ----------------

const MAX_PIXELS = 8192 * 8192;

interface Dib {
  w: number;
  h: number;
  rgba: Uint8Array;
}

function maskShift(mask: number): { shift: number; scale: number } {
  if (!mask) return { shift: 0, scale: 0 };
  let shift = 0;
  let m = mask;
  while ((m & 1) === 0) {
    m >>>= 1;
    shift++;
  }
  let bits = 0;
  while (m & 1) {
    m >>>= 1;
    bits++;
  }
  return { shift, scale: bits > 0 ? 255 / ((1 << bits) - 1) : 0 };
}

/**
 * BI_RLE8 / BI_RLE4 行程编码 → 调色板索引缓冲（w*h）。
 *
 * 两种压缩共用一套控制字节：
 *   [n>0][data]  编码模式：重复 n 个像素（RLE4 时 data 的两个半字节交替）
 *   [0][n>=3]    绝对模式：紧跟 n 个索引，按字（2 字节）对齐
 *   [0][0]       行结束      [0][1]  图结束      [0][2][dx][dy]  位移
 *
 * RLE 位图恒为自底向上，所以从最后一行开始往回填。
 * 越界一律当作图结束——真实世界的文件经常在末尾缺几个字节。
 */
function decodeRle(buf: Uint8Array, start: number, avail: number, w: number, h: number, rle4: boolean): Uint8Array | null {
  if (!(w > 0) || !(h > 0)) return null;
  const idx = new Uint8Array(w * h);
  let p = start;
  const end = Math.min(buf.length, start + avail);
  let x = 0,
    y = h - 1;

  const put = (v: number): void => {
    if (x >= 0 && x < w && y >= 0 && y < h) idx[y * w + x] = v;
    x++;
  };

  while (p + 1 < end && y >= 0) {
    const n = buf[p++];
    const b = buf[p++];
    if (n > 0) {
      // 编码模式
      if (rle4) {
        const hi = (b >> 4) & 0x0f,
          lo = b & 0x0f;
        for (let i = 0; i < n; i++) put(i % 2 === 0 ? hi : lo);
      } else {
        for (let i = 0; i < n; i++) put(b);
      }
      continue;
    }
    if (b === 0) {
      x = 0;
      y--;
      continue;
    } // 行结束
    if (b === 1) break; // 图结束
    if (b === 2) {
      // 位移
      if (p + 1 >= end) break;
      x += buf[p++];
      y -= buf[p++];
      continue;
    }
    // 绝对模式：b 个索引
    if (rle4) {
      const bytes = (b + 1) >> 1;
      if (p + bytes > end) break;
      for (let i = 0; i < b; i++) {
        const byte = buf[p + (i >> 1)];
        put(i % 2 === 0 ? (byte >> 4) & 0x0f : byte & 0x0f);
      }
      p += bytes + (bytes & 1); // 字对齐
    } else {
      if (p + b > end) break;
      for (let i = 0; i < b; i++) put(buf[p + i]);
      p += b + (b & 1); // 字对齐
    }
  }
  return idx;
}

/**
 * 解码 DIB（BITMAPINFOHEADER / BITMAPCOREHEADER + 可选调色板 + 像素）。
 * bmi 与 bits 在 EMF 里是分离的两段；WMF 里是连续的一段（bits 传 null 表示紧跟 bmi）。
 */
function decodeDib(buf: Uint8Array, bmiOff: number, bmiLen: number, bitsOff: number, bitsLen: number): Dib | null {
  if (bmiOff < 0 || bmiLen < 12 || bmiOff + 12 > buf.length) return null;
  const r = new Reader(buf, bmiOff, Math.min(buf.length, bmiOff + Math.max(bmiLen, 12)));
  const hdrSize = r.u32();
  let w: number,
    h: number,
    bpp: number,
    comp = 0,
    clrUsed = 0;
  let core = false;
  if (hdrSize === 12) {
    core = true;
    w = r.i16();
    h = r.i16();
    r.u16();
    bpp = r.u16();
  } else if (hdrSize >= 16) {
    w = r.i32();
    h = r.i32();
    r.u16();
    bpp = r.u16();
    if (hdrSize >= 24) {
      comp = r.u32();
      r.u32();
    }
    if (hdrSize >= 36) {
      r.u32();
      r.u32();
      clrUsed = r.u32();
    }
  } else return null;

  const topDown = h < 0;
  h = Math.abs(h);
  if (!(w > 0) || !(h > 0) || w * h > MAX_PIXELS) return null;

  // BI_JPEG / BI_PNG：像素段本身就是完整图片
  if (comp === 4 || comp === 5) return null;
  // comp: 0=BI_RGB 1=BI_RLE8 2=BI_RLE4 3=BI_BITFIELDS
  const rle8 = comp === 1,
    rle4 = comp === 2;
  if (comp !== 0 && comp !== 3 && !rle8 && !rle4) return null;
  if (rle8 && bpp !== 8) return null;
  if (rle4 && bpp !== 4) return null;
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) return null;

  // 位域掩码
  let rm = 0,
    gm = 0,
    bm = 0;
  if (comp === 3) {
    const mr = new Reader(buf, bmiOff + hdrSize, buf.length);
    rm = mr.u32();
    gm = mr.u32();
    bm = mr.u32();
  } else if (bpp === 16) {
    rm = 0x7c00;
    gm = 0x03e0;
    bm = 0x001f;
  } else if (bpp === 32) {
    rm = 0xff0000;
    gm = 0x00ff00;
    bm = 0x0000ff;
  }

  // 调色板
  let pal: Uint8Array | null = null;
  if (bpp <= 8) {
    const entries = clrUsed > 0 ? Math.min(clrUsed, 1 << bpp) : 1 << bpp;
    const entrySize = core ? 3 : 4;
    const palOff = bmiOff + hdrSize + (comp === 3 ? 12 : 0);
    pal = new Uint8Array(entries * 3);
    const pr = new Reader(buf, palOff, buf.length);
    for (let i = 0; i < entries; i++) {
      const b = pr.u8(),
        g = pr.u8(),
        rr = pr.u8();
      if (entrySize === 4) pr.u8();
      pal[i * 3] = rr;
      pal[i * 3 + 1] = g;
      pal[i * 3 + 2] = b;
    }
  }

  const stride = ((w * bpp + 31) >> 5) << 2;
  const start = bitsOff;
  const avail = Math.min(bitsLen > 0 ? bitsLen : buf.length - start, buf.length - start);
  if (start < 0 || start >= buf.length) return null;

  // RLE 走独立解码：它没有固定行距，长度也无法由 w/h 反推
  if (rle8 || rle4) {
    const idx = decodeRle(buf, start, avail, w, h, rle4);
    if (!idx) return null;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < idx.length; i++) {
      const pi = idx[i] * 3;
      const o = i * 4;
      if (pal && pi + 2 < pal.length) {
        rgba[o] = pal[pi];
        rgba[o + 1] = pal[pi + 1];
        rgba[o + 2] = pal[pi + 2];
      }
      rgba[o + 3] = 255;
    }
    return { w, h, rgba };
  }

  if (avail < stride) return null;
  const rows = Math.min(h, Math.floor(avail / stride));
  if (rows <= 0) return null;

  const rgba = new Uint8Array(w * h * 4);
  const rs = maskShift(rm),
    gs = maskShift(gm),
    bs = maskShift(bm);
  let anyAlpha = false;

  for (let sy = 0; sy < rows; sy++) {
    const dy = topDown ? sy : h - 1 - sy;
    let src = start + sy * stride;
    let dst = dy * w * 4;
    for (let x = 0; x < w; x++) {
      let rr = 0,
        gg = 0,
        bb = 0,
        aa = 255;
      if (bpp === 24) {
        bb = buf[src];
        gg = buf[src + 1];
        rr = buf[src + 2];
        src += 3;
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
        const idx = bpp === 8 ? byte : bpp === 4 ? (bitPos % 8 === 0 ? byte >> 4 : byte & 0x0f) : (byte >> (7 - (bitPos & 7))) & 1;
        const pi = idx * 3;
        if (pal && pi + 2 < pal.length) {
          rr = pal[pi];
          gg = pal[pi + 1];
          bb = pal[pi + 2];
        } else {
          rr = gg = bb = idx ? 255 : 0;
        }
      }
      rgba[dst] = rr | 0;
      rgba[dst + 1] = gg | 0;
      rgba[dst + 2] = bb | 0;
      rgba[dst + 3] = aa;
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
export function dibToDataUri(buf: Uint8Array, bmiOff: number, bmiLen: number, bitsOff: number, bitsLen: number): string | null {
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
