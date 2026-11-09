/**
 * EMF / WMF 共用的 GDI 基础：字节读取、仿射矩阵、GDI 对象与设备上下文（DC）定义、字体回退与单字节解码。
 * 绘图上下文见 gdi-gfx.ts，DIB / PNG 位图工具见 dib.ts。
 *
 * 坐标处理策略：所有点在 JS 里就地做「世界变换 → 窗口/视口映射」两步仿射变换，
 * 输出到 SVG 的已经是设备坐标，因此 SVG 侧只需要一个 viewBox，不再嵌套 transform。
 * 弧线 / 圆角统一用逻辑空间的三次贝塞尔近似再整体仿射，天然支持旋转与翻转。
 */

// ---------------- 基础工具 ----------------

/** 数值格式化：非有限值一律回落到 0，保证输出里不会出现 NaN */
export const n = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0');

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}
export interface Pt {
  x: number;
  y: number;
}

/** SVG 约定的仿射矩阵 [a b c d e f]：(x,y) → (a·x + c·y + e, b·x + d·y + f) */
export type Mat = [number, number, number, number, number, number];

export const ID_MAT: Mat = [1, 0, 0, 1, 0, 0];

/** 复合变换：点先过 first，再过 then */
export function compose(first: Mat, then: Mat): Mat {
  const [a, b, c, d, e, f] = first;
  const [A, B, C, D, E, F] = then;
  return [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
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

  has(len: number): boolean {
    return this.p + len <= this.end;
  }
  get left(): number {
    return Math.max(0, this.end - this.p);
  }
  skip(len: number): void {
    this.p += len;
  }
  seek(off: number): void {
    this.p = off;
  }

  u8(): number {
    if (!this.has(1)) {
      this.p += 1;
      return 0;
    }
    return this.dv.getUint8(this.p++);
  }
  i16(): number {
    if (!this.has(2)) {
      this.p += 2;
      return 0;
    }
    const v = this.dv.getInt16(this.p, true);
    this.p += 2;
    return v;
  }
  u16(): number {
    if (!this.has(2)) {
      this.p += 2;
      return 0;
    }
    const v = this.dv.getUint16(this.p, true);
    this.p += 2;
    return v;
  }
  i32(): number {
    if (!this.has(4)) {
      this.p += 4;
      return 0;
    }
    const v = this.dv.getInt32(this.p, true);
    this.p += 4;
    return v;
  }
  u32(): number {
    if (!this.has(4)) {
      this.p += 4;
      return 0;
    }
    const v = this.dv.getUint32(this.p, true);
    this.p += 4;
    return v;
  }
  f32(): number {
    if (!this.has(4)) {
      this.p += 4;
      return 0;
    }
    const v = this.dv.getFloat32(this.p, true);
    this.p += 4;
    return Number.isFinite(v) ? v : 0;
  }

  /** COLORREF 0x00BBGGRR */
  color(): string {
    const v = this.u32();
    return rgb(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff);
  }

  /** 32 位点（EMF POINTL）*/
  ptL(): Pt {
    return { x: this.i32(), y: this.i32() };
  }
  /** 16 位点（EMF POINT16 / WMF POINT16）*/
  pt16(): Pt {
    return { x: this.i16(), y: this.i16() };
  }
  /** EMF RECTL：左上右下 */
  rectL(): Rect {
    return { l: this.i32(), t: this.i32(), r: this.i32(), b: this.i32() };
  }

  /** UTF-16LE 定长字符串（字节数），截到第一个 NUL */
  utf16(bytes: number): string {
    let s = '';
    const cnt = bytes >> 1;
    for (let i = 0; i < cnt; i++) {
      const c = this.u16();
      if (c === 0) {
        this.skip((cnt - i - 1) * 2);
        break;
      }
      s += String.fromCharCode(c);
    }
    return s;
  }

  /** 单字节字符串（按 latin1 近似），截到第一个 NUL */
  ansi(bytes: number): string {
    let s = '';
    for (let i = 0; i < bytes; i++) {
      const c = this.u8();
      if (c === 0) {
        this.skip(bytes - i - 1);
        break;
      }
      s += String.fromCharCode(c);
    }
    return s;
  }

  // ---- 以下为 PICT（QuickDraw）所需：它是大端，与 EMF/WMF 相反 ----

  get pos(): number {
    return this.p;
  }
  get limit(): number {
    return this.end;
  }

  i8(): number {
    return (this.u8() << 24) >> 24;
  }
  /** 大端 16 位有符号 */
  i16be(): number {
    if (!this.has(2)) {
      this.p += 2;
      return 0;
    }
    const v = this.dv.getInt16(this.p, false);
    this.p += 2;
    return v;
  }
  /** 大端 16 位无符号 */
  u16be(): number {
    if (!this.has(2)) {
      this.p += 2;
      return 0;
    }
    const v = this.dv.getUint16(this.p, false);
    this.p += 2;
    return v;
  }
  /** 大端 32 位无符号 */
  u32be(): number {
    if (!this.has(4)) {
      this.p += 4;
      return 0;
    }
    const v = this.dv.getUint32(this.p, false);
    this.p += 4;
    return v;
  }

  /** 取 len 字节并前移；越界时按剩余长度截断 */
  take(len: number): Uint8Array {
    const n = Math.max(0, Math.min(len, this.end - this.p));
    const out = new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.p, n);
    this.p += len;
    return out;
  }
}

const hex2 = (v: number): string => (v & 0xff).toString(16).padStart(2, '0');
export const rgb = (r: number, g: number, b: number): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

// ---------------- GDI 对象 ----------------

/** ExtSelectClipRgn 的组合模式（[MS-EMF] 2.1.20）*/
export const RGN_AND = 1,
  RGN_OR = 2,
  RGN_XOR = 3,
  RGN_DIFF = 4,
  RGN_COPY = 5;
/** RGNDATAHEADER.iType 规范里只定义了这一种 */
export const RDH_RECTANGLES = 1;

export const PS_SOLID = 0,
  PS_DASH = 1,
  PS_DOT = 2,
  PS_DASHDOT = 3,
  PS_DASHDOTDOT = 4,
  PS_NULL = 5;

export interface Pen {
  kind: 'pen';
  style: number;
  width: number;
  color: string;
  cap: number;
  join: number;
}
export interface Brush {
  kind: 'brush';
  style: number;
  color: string;
  hatch: number;
  href: string | null;
}
export interface Fnt {
  kind: 'font';
  height: number;
  escapement: number;
  weight: number;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  face: string;
  charset: number;
}
export type GdiObj = Pen | Brush | Fnt;

export const BS_SOLID = 0,
  BS_NULL = 1,
  BS_HATCHED = 2,
  BS_PATTERN = 3,
  BS_DIBPATTERN = 5;

export const defPen = (): Pen => ({ kind: 'pen', style: PS_SOLID, width: 1, color: '#000000', cap: 0, join: 0 });
export const defBrush = (): Brush => ({ kind: 'brush', style: BS_SOLID, color: '#ffffff', hatch: 0, href: null });
export const defFont = (): Fnt => ({
  kind: 'font',
  height: -12,
  escapement: 0,
  weight: 400,
  italic: false,
  underline: false,
  strike: false,
  face: 'Arial',
  charset: 0,
});

const nullPen = (): Pen => ({ ...defPen(), style: PS_NULL });
const solidBrush = (c: string): Brush => ({ kind: 'brush', style: BS_SOLID, color: c, hatch: 0, href: null });

/** SELECTOBJECT 高位 0x80000000 的库存对象 */
export function stockObject(idx: number): GdiObj | null {
  switch (idx & 0xff) {
    case 0x00:
      return solidBrush('#ffffff'); // WHITE_BRUSH
    case 0x01:
      return solidBrush('#c0c0c0'); // LTGRAY_BRUSH
    case 0x02:
      return solidBrush('#808080'); // GRAY_BRUSH
    case 0x03:
      return solidBrush('#404040'); // DKGRAY_BRUSH
    case 0x04:
      return solidBrush('#000000'); // BLACK_BRUSH
    case 0x05:
      return { ...defBrush(), style: BS_NULL }; // NULL_BRUSH / HOLLOW_BRUSH
    case 0x06:
      return { ...defPen(), color: '#ffffff' }; // WHITE_PEN
    case 0x07:
      return defPen(); // BLACK_PEN
    case 0x08:
      return nullPen(); // NULL_PEN
    case 0x0a:
    case 0x0b:
    case 0x0c:
    case 0x0d:
    case 0x0e:
    case 0x10:
    case 0x11:
      return defFont(); // 各类系统字体
    case 0x12:
      return solidBrush('#ffffff'); // DC_BRUSH
    case 0x13:
      return defPen(); // DC_PEN
    default:
      return null;
  }
}

// ---------------- 设备上下文 ----------------

export const MM_TEXT = 1,
  MM_ISOTROPIC = 7,
  MM_ANISOTROPIC = 8;

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
  winOrg: Pt;
  winExt: Pt;
  vpOrg: Pt;
  vpExt: Pt;
  clip: string | null;
  pos: Pt;
}

/** 设备物理参数，用于 MM_LOMETRIC 之类的固定映射模式 */
export interface DevInfo {
  pxPerMmX: number;
  pxPerMmY: number;
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
  0: 'windows-1252',
  1: 'windows-1252',
  2: 'windows-1252',
  77: 'macintosh',
  128: 'shift_jis',
  129: 'euc-kr',
  130: 'euc-kr',
  134: 'gbk',
  136: 'big5',
  161: 'windows-1253',
  162: 'windows-1254',
  163: 'windows-1258',
  177: 'windows-1255',
  178: 'windows-1256',
  186: 'windows-1257',
  204: 'windows-1251',
  222: 'windows-874',
  238: 'windows-1250',
};

/** 按字体 charset 解码单字节串；TextDecoder 不可用时退回 latin1 */
export function decodeAnsi(bytes: Uint8Array, charset: number): string {
  const label = CHARSET_LABEL[charset];
  if (label && typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder(label, { fatal: false }).decode(bytes).replace(/\0+$/, '');
    } catch {
      /* 退回 latin1 */
    }
  }
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) break;
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}
