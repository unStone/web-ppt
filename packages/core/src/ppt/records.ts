/** [MS-PPT] / [MS-ODRAW] 二进制记录遍历与通用解码 */

export interface Rec {
  type: number;
  /** 版本+实例字段的 instance 部分（Escher 里常用来存形状类型/BLIP 类型） */
  instance: number;
  version: number;
  isContainer: boolean;
  /** 记录体起始偏移 */
  start: number;
  /** 记录体长度 */
  len: number;
}

export function* records(dv: DataView, start: number, end: number): Generator<Rec> {
  let off = start;
  while (off + 8 <= end) {
    const verInst = dv.getUint16(off, true);
    const type = dv.getUint16(off + 2, true);
    const len = dv.getUint32(off + 4, true);
    const bodyStart = off + 8;
    if (len < 0 || bodyStart + len > end) return;
    const version = verInst & 0xf;
    yield { type, instance: verInst >> 4, version, isContainer: version === 0xf, start: bodyStart, len };
    off = bodyStart + len;
  }
}

/** 在容器内查找首个指定类型的子记录 */
export function findRec(dv: DataView, start: number, end: number, type: number): Rec | null {
  for (const r of records(dv, start, end)) if (r.type === type) return r;
  return null;
}

export function findAll(dv: DataView, start: number, end: number, type: number): Rec[] {
  const out: Rec[] = [];
  for (const r of records(dv, start, end)) if (r.type === type) out.push(r);
  return out;
}

/** 递归查找（深度优先），用于跨层定位 */
export function findDeep(dv: DataView, start: number, end: number, type: number, depth = 6): Rec | null {
  for (const r of records(dv, start, end)) {
    if (r.type === type) return r;
    if (r.isContainer && depth > 0) {
      const hit = findDeep(dv, r.start, r.start + r.len, type, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

export function utf16(dv: DataView, start: number, len: number): string {
  let s = '';
  for (let i = 0; i + 2 <= len; i += 2) s += String.fromCharCode(dv.getUint16(start + i, true));
  return s;
}

export function ansi(dv: DataView, start: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(dv.getUint8(start + i));
  return s;
}

/**
 * 容器下指定名字的 ProgBinaryTag 数据块。
 * PowerPoint 97 之后新增的能力（自动编号、动画）都以 ___PPT9 / ___PPT10
 * 命名的二进制扩展块挂在这里，块内又是一棵普通的记录树。
 */
export function progBinaryBlobs(dv: DataView, container: Rec, name: string): Rec[] {
  const out: Rec[] = [];
  const walk = (start: number, end: number, depth: number): void => {
    for (const r of records(dv, start, end)) {
      if (r.type === RT.ProgBinaryTag) {
        let tag = '';
        for (const c of records(dv, r.start, r.start + r.len)) {
          if (c.type === RT.CString) tag = utf16(dv, c.start, c.len).replace(/\0+$/, '');
          else if (c.type === RT.BinaryTagDataBlob && tag === name) out.push(c);
        }
        continue;
      }
      if (r.isContainer && depth > 0) walk(r.start, r.start + r.len, depth - 1);
    }
  };
  walk(container.start, container.start + container.len, 6);
  return out;
}

// ---------------- 记录类型常量 ----------------

export const RT = {
  Document: 0x03e8,
  DocumentAtom: 0x03e9,
  Slide: 0x03ee,
  SlideAtom: 0x03ef,
  Notes: 0x03f0,
  NotesAtom: 0x03f1,
  MainMaster: 0x03f8,
  /** 放映设置：切换效果、隐藏标记、自动换片 */
  SSSlideInfoAtom: 0x03f9,
  SlidePersistAtom: 0x03f3,
  ExObjList: 0x0409,
  PPDrawingGroup: 0x040b,
  PPDrawing: 0x040c,
  ColorSchemeAtom: 0x07f0,
  List: 0x07d0,
  FontCollection: 0x07d5,
  SlideListWithText: 0x0ff0,
  TextHeaderAtom: 0x0f9f,
  TextCharsAtom: 0x0fa0,
  TextBytesAtom: 0x0fa8,
  StyleTextPropAtom: 0x0fa1,
  TextSpecInfoAtom: 0x0fa2,
  TxMasterStyleAtom: 0x0fa3,
  OutlineTextRefAtom: 0x0f9e,
  /** 母版 / 环境里的字体表条目；recInstance 即字体索引 */
  FontEntityAtom: 0x0fb7,
  EnvironmentAtom: 0x03f2,
  OEPlaceholderAtom: 0x0bc3,
  ExHyperlinkAtom: 0x0fd3,
  ExHyperlink: 0x0fd7,
  CString: 0x0fba,
  /** 超链接作用的文本范围 */
  TextInteractiveInfoAtom: 0x0fdf,
  InteractiveInfo: 0x0ff2,
  InteractiveInfoAtom: 0x0ff3,
  PersistDirectoryAtom: 0x1772,
  /** PowerPoint 97 之后追加的能力都塞在 ProgTags 下的二进制扩展块里 */
  ProgTags: 0x1388,
  ProgBinaryTag: 0x138a,
  BinaryTagDataBlob: 0x138b,
  /** ___PPT9 扩展块：自动编号等 PowerPoint 2000 新增的段落属性 */
  StyleTextProp9Atom: 0x0fac,
} as const;

/** ___PPT10 扩展块里的动画时间树（[MS-PPT] 2.8） */
export const TIME = {
  ExtTimeNodeContainer: 0xf144,
  TimeNodeAtom: 0xf127,
  TimeConditionContainer: 0xf125,
  TimeConditionAtom: 0xf128,
  ClientVisualElement: 0xf13c,
  TimePropertyList: 0xf13d,
  TimeVariant: 0xf142,
  /** ClientVisualElement 里指向形状的原子 */
  VisualShapeAtom: 0x2afb,
} as const;

/** [MS-ODRAW] Escher 记录 */
export const ESCHER = {
  DggContainer: 0xf000,
  Bstore: 0xf001,
  DgContainer: 0xf002,
  SpgrContainer: 0xf003,
  SpContainer: 0xf004,
  BSE: 0xf007,
  Dg: 0xf008,
  Spgr: 0xf009,
  Sp: 0xf00a,
  Opt: 0xf00b,
  ClientTextbox: 0xf00d,
  ChildAnchor: 0xf00f,
  ClientAnchor: 0xf010,
  ClientData: 0xf011,
  SplitMenuColors: 0xf11e,
  BlipStart: 0xf018,
  BlipEnd: 0xf117,
  TertiaryOpt: 0xf122,
  SecondaryOpt: 0xf121,
} as const;
