import type { Effects, Fill, Stroke } from '../types';
import { inflateSync, unzlibSync } from 'fflate';
import { ESCHER, Rec, records, utf16 } from './records';

/**
 * [MS-ODRAW] OfficeArt（Escher）形状属性解析。
 * 属性表 OfficeArtFOPT 是一串 6 字节条目：u16(id|flags) + u32(value)，
 * 复杂属性（fComplex）的实际数据按顺序追加在属性数组之后。
 */

export interface EscherProps {
  simple: Map<number, number>;
  complex: Map<number, { start: number; len: number }>;
}

export function parseOpt(dv: DataView, rec: Rec): EscherProps {
  const simple = new Map<number, number>();
  const complex = new Map<number, { start: number; len: number }>();
  const count = rec.instance;
  let off = rec.start;
  const arrayEnd = rec.start + Math.min(count * 6, rec.len);
  const pending: { id: number; len: number }[] = [];

  for (let i = 0; i < count && off + 6 <= rec.start + rec.len; i++, off += 6) {
    const raw = dv.getUint16(off, true);
    const id = raw & 0x3fff;
    const isComplex = (raw & 0x8000) !== 0;
    const value = dv.getUint32(off + 2, true);
    if (isComplex) pending.push({ id, len: value });
    else simple.set(id, value);
  }

  let dataOff = arrayEnd;
  for (const p of pending) {
    if (dataOff + p.len > rec.start + rec.len) break;
    complex.set(p.id, { start: dataOff, len: p.len });
    dataOff += p.len;
  }
  return { simple, complex };
}

/** OfficeArt 属性 id（仅列出用到的） */
export const P = {
  rotation: 4,
  tableProperties: 927,
  tableRowProperties: 928,
  lTxid: 128,
  dxTextLeft: 129,
  dyTextTop: 130,
  dxTextRight: 131,
  dyTextBottom: 132,
  anchorText: 135,
  txflTextFlow: 136,
  pib: 260,
  pibName: 261,
  geoLeft: 320,
  geoTop: 321,
  geoRight: 322,
  geoBottom: 323,
  shapePath: 324,
  pVertices: 325,
  pSegmentInfo: 326,
  adjustValue: 327,
  adjust2Value: 328,
  adjust3Value: 329,
  adjust4Value: 330,
  fillType: 384,
  fillColor: 385,
  fillOpacity: 386,
  fillBackColor: 387,
  fillBlip: 390,
  fillStyleBooleans: 447,
  lineColor: 448,
  lineOpacity: 449,
  lineWidth: 459,
  lineDashing: 462,
  lineStartArrow: 464,
  lineEndArrow: 465,
  lineStyleBooleans: 511,
  shadowType: 512,
  shadowColor: 513,
  shadowOpacity: 516,
  shadowOffsetX: 517,
  shadowOffsetY: 518,
  shadowStyleBooleans: 575,
  groupShapeBooleans: 959,
} as const;

/** 属性值是 32 位有符号量时的还原（属性表统一按无符号读出） */
const signed = (v: number): number => (v > 0x7fffffff ? v - 0x100000000 : v);

/** PPT 配色方案：8 个 RGB */
export type Scheme = string[];

/** Escher 颜色值 → CSS。0x0BBGGRR，高位字节标明取色方式 */
export function escherColor(value: number, scheme: Scheme, alpha = 1): string {
  const kind = (value >> 24) & 0xff;
  let r: number, g: number, b: number;
  if (kind === 0x08 || kind === 0x01) {
    // 取自配色方案
    const idx = value & 0xff;
    const hex = scheme[idx] ?? '000000';
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    r = value & 0xff;
    g = (value >> 8) & 0xff;
    b = (value >> 16) & 0xff;
  }
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${Math.round(alpha * 1000) / 1000})`;
}

const bit = (v: number | undefined, mask: number): boolean | null => {
  if (v === undefined) return null;
  // 高 16 位是「该位是否被显式设置」，低 16 位是取值
  if ((v & (mask << 16)) === 0) return null;
  return (v & mask) !== 0;
};

export function shapeFill(props: EscherProps, scheme: Scheme, blipUrl: (idx: number) => string | null): Fill | null {
  const filled = bit(props.simple.get(P.fillStyleBooleans), 0x10);
  if (filled === false) return { type: 'none' };
  const type = props.simple.get(P.fillType) ?? 0;
  const opacity = (props.simple.get(P.fillOpacity) ?? 65536) / 65536;

  if (type === 3 || type === 2) {
    const idx = props.simple.get(P.fillBlip) ?? props.simple.get(P.pib);
    const src = idx !== undefined ? blipUrl(idx) : null;
    if (src) return { type: 'image', src, alpha: opacity < 1 ? opacity : undefined };
  }
  if (type === 4 || type === 5 || type === 6 || type === 7) {
    const c1 = props.simple.get(P.fillColor);
    const c2 = props.simple.get(P.fillBackColor);
    if (c1 !== undefined || c2 !== undefined) {
      return {
        type: 'gradient',
        angle: 90,
        stops: [
          { pos: 0, color: escherColor(c1 ?? 0xffffff, scheme, opacity) },
          { pos: 1, color: escherColor(c2 ?? 0xffffff, scheme, opacity) },
        ],
      };
    }
  }
  const color = props.simple.get(P.fillColor);
  if (color === undefined) return filled === true ? { type: 'solid', color: escherColor(0xffffff, scheme) } : null;
  return { type: 'solid', color: escherColor(color, scheme, opacity) };
}

const DASH_MAP: Record<number, number[]> = {
  1: [4, 3], 2: [1, 3], 3: [4, 3, 1, 3], 4: [4, 3, 1, 3, 1, 3],
  5: [8, 3], 6: [8, 3, 1, 3], 7: [8, 3, 1, 3, 1, 3], 8: [1, 1], 9: [3, 3], 10: [3, 3, 1, 3],
};

const ARROW_MAP: Record<number, 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow'> = {
  1: 'triangle', 2: 'stealth', 3: 'diamond', 4: 'oval', 5: 'arrow',
};

export function shapeStroke(props: EscherProps, scheme: Scheme): Stroke | null {
  const hasLine = bit(props.simple.get(P.lineStyleBooleans), 0x08);
  if (hasLine === false) return null;
  const color = props.simple.get(P.lineColor);
  if (color === undefined && hasLine !== true) return null;
  const widthEmu = props.simple.get(P.lineWidth) ?? 9525;
  const width = widthEmu / 9525;
  const dashId = props.simple.get(P.lineDashing);
  const opacity = (props.simple.get(P.lineOpacity) ?? 65536) / 65536;
  const start = props.simple.get(P.lineStartArrow);
  const end = props.simple.get(P.lineEndArrow);
  return {
    color: escherColor(color ?? 0x000000, scheme, opacity),
    width,
    dash: dashId ? (DASH_MAP[dashId] ?? [4, 3]).map((m) => m * Math.max(width, 1)) : null,
    head: start && ARROW_MAP[start] ? { type: ARROW_MAP[start], w: 3, h: 3 } : undefined,
    tail: end && ARROW_MAP[end] ? { type: ARROW_MAP[end], w: 3, h: 3 } : undefined,
  };
}

/**
 * 阴影。Escher 只存偏移 / 颜色 / 不透明度，**没有模糊半径**，
 * 因此这里给一个温和的固定模糊，避免渲染成硬邦邦的复制层。
 * 发光与柔化边缘在二进制格式里没有对应属性，不做推测。
 */
export function shapeShadow(props: EscherProps, scheme: Scheme): Effects['shadow'] | undefined {
  if (bit(props.simple.get(P.shadowStyleBooleans), 0x2) !== true) return undefined;
  // 默认偏移取 MSO 的 2pt，与 PowerPoint 新建形状时的阴影一致
  const dx = signed(props.simple.get(P.shadowOffsetX) ?? 25400) / 9525;
  const dy = signed(props.simple.get(P.shadowOffsetY) ?? 25400) / 9525;
  const alpha = Math.max(0, Math.min(1, (props.simple.get(P.shadowOpacity) ?? 65536) / 65536));
  const color = props.simple.get(P.shadowColor) ?? 0x808080;
  // 偏移与不透明度都为 0 时形同没有阴影，别塞一个看不见的滤镜进去
  if (alpha <= 0 || (dx === 0 && dy === 0)) return undefined;
  return { dx, dy, blur: 4, color: escherColor(color, scheme, alpha) };
}

/**
 * MSO 形状类型（MSOSPT 枚举）→ 本项目预设几何名。
 * 编号严格按 [MS-ODRAW] 2.4.24，任何偏移都会让形状张冠李戴。
 */
export const MSO_SHAPE: Record<number, string> = {
  1: 'rect', 2: 'roundRect', 3: 'ellipse', 4: 'diamond', 5: 'triangle', 6: 'rtTriangle',
  7: 'parallelogram', 8: 'trapezoid', 9: 'hexagon', 10: 'octagon', 11: 'plus', 12: 'star5',
  13: 'rightArrow', 14: 'rightArrow', 15: 'homePlate', 16: 'cube', 17: 'wedgeRoundRectCallout',
  18: 'star8', 19: 'arc', 20: 'line', 21: 'plaque', 22: 'can', 23: 'donut',
  // 24-31 为文本形状，统一按矩形文本框处理
  24: 'rect', 25: 'octagon', 26: 'hexagon', 27: 'rect', 28: 'wave', 29: 'donut', 30: 'rect', 31: 'donut',
  32: 'straightConnector1', 33: 'bentConnector2', 34: 'bentConnector3', 35: 'bentConnector4',
  36: 'bentConnector5', 37: 'curvedConnector2', 38: 'curvedConnector3', 39: 'curvedConnector4',
  40: 'curvedConnector5',
  41: 'callout1', 42: 'callout2', 43: 'callout2',
  44: 'callout1', 45: 'callout2', 46: 'callout2',
  47: 'borderCallout1', 48: 'borderCallout2', 49: 'borderCallout2',
  50: 'borderCallout1', 51: 'borderCallout2', 52: 'borderCallout2',
  53: 'ribbon', 54: 'ribbon2', 55: 'chevron', 56: 'pentagon', 57: 'noSmoking',
  58: 'star8', 59: 'star16', 60: 'star32',
  61: 'wedgeRectCallout', 62: 'wedgeRoundRectCallout', 63: 'wedgeEllipseCallout',
  64: 'wave', 65: 'foldedCorner',
  66: 'leftArrow', 67: 'downArrow', 68: 'upArrow', 69: 'leftRightArrow', 70: 'upDownArrow',
  71: 'irregularSeal1', 72: 'irregularSeal2', 73: 'lightningBolt', 74: 'heart',
  75: 'rect', // pictureFrame：按图片处理，几何退化为矩形
  76: 'quadArrow',
  77: 'leftArrowCallout', 78: 'rightArrowCallout', 79: 'upArrowCallout', 80: 'downArrowCallout',
  81: 'leftRightArrowCallout', 82: 'upArrowCallout', 83: 'quadArrow',
  84: 'bevel', 85: 'leftBracket', 86: 'rightBracket', 87: 'leftBrace', 88: 'rightBrace',
  89: 'leftRightUpArrow', 90: 'bentArrow', 91: 'bentArrow', 92: 'star24',
  93: 'stripedRightArrow', 94: 'notchedRightArrow', 95: 'blockArc', 96: 'smileyFace',
  97: 'verticalScroll', 98: 'horizontalScroll', 99: 'circularArrow', 100: 'circularArrow',
  101: 'uturnArrow', 102: 'curvedRightArrow', 103: 'curvedLeftArrow', 104: 'curvedUpArrow',
  105: 'curvedDownArrow', 106: 'cloudCallout', 107: 'ribbon', 108: 'ribbon2',
  109: 'flowChartProcess', 110: 'flowChartDecision', 111: 'flowChartInputOutput',
  112: 'flowChartPredefinedProcess', 113: 'flowChartInternalStorage', 114: 'flowChartDocument',
  115: 'flowChartMultidocument', 116: 'flowChartTerminator', 117: 'flowChartPreparation',
  118: 'flowChartManualInput', 119: 'flowChartManualOperation', 120: 'flowChartConnector',
  121: 'flowChartPunchedCard', 122: 'flowChartPunchedTape', 123: 'flowChartSummingJunction',
  124: 'flowChartOr', 125: 'flowChartCollate', 126: 'flowChartSort', 127: 'flowChartExtract',
  128: 'flowChartMerge', 129: 'flowChartOnlineStorage', 130: 'flowChartOnlineStorage',
  131: 'flowChartMagneticTape', 132: 'flowChartMagneticDisk', 133: 'flowChartMagneticDrum',
  134: 'flowChartDisplay', 135: 'flowChartDelay',
  176: 'flowChartAlternateProcess', 177: 'flowChartOffpageConnector',
  178: 'callout1', 179: 'callout1', 180: 'borderCallout1', 181: 'borderCallout1',
  182: 'leftRightUpArrow', 183: 'sun', 184: 'moon', 185: 'bracketPair', 186: 'bracePair',
  187: 'star4', 188: 'doubleWave',
  189: 'actionButtonBlank', 190: 'actionButtonHome', 191: 'actionButtonHelp',
  192: 'actionButtonInformation', 193: 'actionButtonForwardNext', 194: 'actionButtonBackPrevious',
  195: 'actionButtonEnd', 196: 'actionButtonBeginning', 197: 'actionButtonReturn',
  198: 'actionButtonDocument', 199: 'actionButtonSound', 200: 'actionButtonMovie',
  202: 'rect', // textBox
};

/** pictureFrame 的形状类型编号 */
export const MSO_PICTURE_FRAME = 75;

/**
 * 从 Pictures 流按顺序抽取 BLIP 图片。
 *
 * BLIP 结构：记录头 → 1~2 个 16 字节 UID（instance 为奇数时是两个）→ 文件头 → 图像数据。
 * 光栅图的文件头只有 1 字节 tag；图元文件（EMF/WMF/PICT）的文件头有 34 字节，
 * 其中 m_fCompression 标明数据是否经 DEFLATE 压缩——PPT 里图元文件默认压缩，
 * 不解压直接交给解码器只会得到一堆乱码。
 */
export function extractBlips(pictures: Uint8Array): { mime: string; data: Uint8Array }[] {
  const out: { mime: string; data: Uint8Array }[] = [];
  if (!pictures.length) return out;
  const dv = new DataView(pictures.buffer, pictures.byteOffset, pictures.byteLength);

  const RASTER: Record<number, string> = {
    0xf01d: 'image/jpeg', 0xf01e: 'image/png', 0xf01f: 'image/bmp', 0xf029: 'image/tiff',
    0xf02a: 'image/jpeg',
  };
  const METAFILE: Record<number, string> = {
    0xf01a: 'image/emf', 0xf01b: 'image/wmf', 0xf01c: 'image/pict',
  };

  for (const rec of records(dv, 0, pictures.length)) {
    const isMeta = rec.type in METAFILE;
    const mime = isMeta ? METAFILE[rec.type] : RASTER[rec.type];
    if (!mime) continue;

    // instance 为奇数表示带两个 UID
    let off = rec.start + ((rec.instance & 1) === 1 ? 32 : 16);
    const end = rec.start + rec.len;
    if (off >= end) continue;

    if (!isMeta) {
      out.push({ mime, data: pictures.subarray(off + 1, end) });
      continue;
    }

    if (off + 34 > end) continue;
    const uncompressedSize = dv.getUint32(off, true);
    const compression = dv.getUint8(off + 32);
    const body = pictures.subarray(off + 34, end);
    // 0 = DEFLATE，254 = 未压缩
    if (compression === 0) {
      try {
        const raw = unzlibSync(body, uncompressedSize ? { out: new Uint8Array(uncompressedSize) } : undefined);
        out.push({ mime, data: raw });
      } catch {
        try {
          out.push({ mime, data: inflateSync(body) });
        } catch {
          // 解压失败就跳过这张图，不影响其余内容
        }
      }
    } else {
      out.push({ mime, data: body });
    }
  }
  return out;
}

/** ClientAnchor：4 个 int16，顺序为 top,left,bottom(右),right —— 与 POI 的读法一致 */
export function readAnchor(dv: DataView, rec: Rec): { x: number; y: number; w: number; h: number } | null {
  if (rec.len < 8) return null;
  const y1 = dv.getInt16(rec.start, true);
  const x1 = dv.getInt16(rec.start + 2, true);
  const x2 = dv.getInt16(rec.start + 4, true);
  const y2 = dv.getInt16(rec.start + 6, true);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** ChildAnchor：4 个 int32（组内坐标系） */
export function readChildAnchor(dv: DataView, rec: Rec): { x: number; y: number; w: number; h: number } | null {
  if (rec.len < 16) return null;
  const x1 = dv.getInt32(rec.start, true);
  const y1 = dv.getInt32(rec.start + 4, true);
  const x2 = dv.getInt32(rec.start + 8, true);
  const y2 = dv.getInt32(rec.start + 12, true);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Spgr 记录：组的子坐标系矩形 */
export function readSpgr(dv: DataView, rec: Rec): { x: number; y: number; w: number; h: number } | null {
  if (rec.len < 16) return null;
  const x1 = dv.getInt32(rec.start, true);
  const y1 = dv.getInt32(rec.start + 4, true);
  const x2 = dv.getInt32(rec.start + 8, true);
  const y2 = dv.getInt32(rec.start + 12, true);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Sp 记录：shape id + flags；shape 类型在 instance 里 */
export function readSp(dv: DataView, rec: Rec): { id: number; flags: number } {
  return { id: dv.getUint32(rec.start, true), flags: dv.getUint32(rec.start + 4, true) };
}

export const SP_FLAG = {
  GROUP: 0x1, CHILD: 0x2, PATRIARCH: 0x4, DELETED: 0x8,
  OLE: 0x10, HAVEMASTER: 0x20, FLIPH: 0x40, FLIPV: 0x80,
  CONNECTOR: 0x100, HAVEANCHOR: 0x200, BACKGROUND: 0x400, HAVESPT: 0x800,
};

/** 复杂属性里的 Unicode 字符串（如 pibName） */
export function complexString(dv: DataView, props: EscherProps, id: number): string | null {
  const c = props.complex.get(id);
  return c ? utf16(dv, c.start, c.len).replace(/\0+$/, '') : null;
}

export { ESCHER };

/** 表格行高数组（复杂属性 928）：头部 u16 count/countMax/entrySize，其后为 int32 行高 */
export function tableRowHeights(dv: DataView, props: EscherProps): number[] {
  const c = props.complex.get(P.tableRowProperties);
  if (!c || c.len < 6) return [];
  const count = dv.getUint16(c.start, true);
  const entry = dv.getInt16(c.start + 4, true);
  const size = entry > 0 ? entry : 4;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const off = c.start + 6 + i * size;
    if (off + 4 > c.start + c.len) break;
    out.push(dv.getInt32(off, true));
  }
  return out;
}

/** 该组是否是一个表格 */
export function isTableGroup(props: EscherProps): boolean {
  return props.simple.has(P.tableProperties) || props.complex.has(P.tableRowProperties);
}
