import { findAll, progBinaryBlobs, Rec, RT } from './records';

/**
 * 自动编号项目符号。
 *
 * 基础的 TextPFException 里没有编号字段，PowerPoint 2000 把它放进了
 * ___PPT9 扩展块的 StyleTextProp9Atom（0x0FAC）：一段一条记录，
 * 每条依次是 TextPFException9 + TextCFException9 + TextSIException，
 * 三段都以 4 字节掩码打头，可选字段按掩码位顺序追加。
 */

/** PFMasks 里与自动编号有关的三位（[MS-PPT] 2.9.13） */
const PF_BULLET_BLIP = 0x00800000;
const PF_BULLET_SCHEME = 0x01000000;
const PF_BULLET_HAS_SCHEME = 0x02000000;

/** CFMasks.pp10ext */
const CF_PP10_EXT = 0x00100000;

/** SIMasks：各可选字段的位与宽度 */
const SI_FIELDS: [number, number][] = [
  [0x00000001, 2], // spell
  [0x00000002, 2], // lang
  [0x00000004, 2], // altLang
  [0x00000020, 2], // bidi
  [0x00000040, 4], // pp10ext
  [0x00000080, 4], // pp11ext
];
const SI_SMART_TAG = 0x00000100;

export interface AutoNum {
  /** TextAutoNumberSchemeEnum */
  scheme: number;
  startNum: number;
}

/**
 * StyleTextProp9Atom → 逐段的自动编号（无编号处为 null）。
 * 解析必须**恰好**用完整条记录，长度对不上说明结构与预期不符，
 * 这时宁可整体丢弃也不要输出半截错位的结果。
 */
export function parseStyleTextProp9(dv: DataView, rec: Rec): (AutoNum | null)[] {
  const out: (AutoNum | null)[] = [];
  const end = rec.start + rec.len;
  let off = rec.start;

  while (off + 4 <= end) {
    // --- TextPFException9 ---
    const pf = dv.getUint32(off, true);
    off += 4;
    if (pf & PF_BULLET_BLIP) off += 2;
    let hasAutoNum: boolean | null = null;
    if (pf & PF_BULLET_HAS_SCHEME) {
      if (off + 2 > end) return [];
      hasAutoNum = dv.getUint16(off, true) !== 0;
      off += 2;
    }
    let anm: AutoNum | null = null;
    if (pf & PF_BULLET_SCHEME) {
      if (off + 4 > end) return [];
      anm = { scheme: dv.getUint16(off, true), startNum: dv.getUint16(off + 2, true) || 1 };
      off += 4;
    }

    // --- TextCFException9 ---
    if (off + 4 > end) return [];
    const cf = dv.getUint32(off, true);
    off += 4;
    if (cf & CF_PP10_EXT) off += 4;

    // --- TextSIException ---
    if (off + 4 > end) return [];
    const si = dv.getUint32(off, true);
    off += 4;
    for (const [flag, size] of SI_FIELDS) if (si & flag) off += size;
    if (si & SI_SMART_TAG) {
      if (off + 4 > end) return [];
      off += 4 + dv.getUint32(off, true) * 4;
    }
    if (off > end) return [];

    out.push(hasAutoNum === false ? null : anm);
  }

  return off === end ? out : [];
}

/** 幻灯片下所有 ___PPT9 块里的 StyleTextProp9Atom，按出现顺序拼接 */
export function collectAutoNums(dv: DataView, slideRec: Rec): (AutoNum | null)[] {
  const out: (AutoNum | null)[] = [];
  for (const blob of progBinaryBlobs(dv, slideRec, '___PPT9')) {
    for (const atom of findAll(dv, blob.start, blob.start + blob.len, RT.StyleTextProp9Atom)) {
      out.push(...parseStyleTextProp9(dv, atom));
    }
  }
  return out;
}

/**
 * TextAutoNumberSchemeEnum → 编号文本。
 * 0x00-0x0F 已用 showcase 对照过（0x06 = 小写罗马加点、0x08 = 小写字母加括号）。
 */
export function formatAutoNum(scheme: number, num: number): string {
  const kind = SCHEME_BODY[scheme] ?? 'arabic';
  const body = kind === 'alphaLc' ? alpha(num).toLowerCase()
    : kind === 'alphaUc' ? alpha(num)
      : kind === 'romanLc' ? roman(num).toLowerCase()
        : kind === 'romanUc' ? roman(num)
          : kind === 'circle' ? circled(num)
            : String(num);
  const wrap = SCHEME_WRAP[scheme] ?? '';
  if (wrap === 'both') return `(${body})`;
  if (wrap === 'right') return `${body})`;
  if (wrap === 'period') return `${body}.`;
  if (wrap === 'minus') return `-${body}-`;
  return body;
}

type Body = 'alphaLc' | 'alphaUc' | 'romanLc' | 'romanUc' | 'arabic' | 'circle';

const SCHEME_BODY: Record<number, Body> = {
  0x00: 'alphaLc', 0x01: 'alphaUc', 0x02: 'arabic', 0x03: 'arabic',
  0x04: 'romanLc', 0x05: 'romanLc', 0x06: 'romanLc', 0x07: 'romanUc',
  0x08: 'alphaLc', 0x09: 'alphaLc', 0x0a: 'alphaUc', 0x0b: 'alphaUc',
  0x0c: 'arabic', 0x0d: 'arabic', 0x0e: 'romanUc', 0x0f: 'romanUc',
  0x10: 'arabic', 0x11: 'arabic',
  0x12: 'circle', 0x13: 'circle', 0x14: 'circle',
  0x15: 'arabic', 0x16: 'arabic', 0x17: 'arabic', 0x18: 'arabic',
  0x19: 'arabic', 0x1a: 'arabic', 0x1b: 'arabic', 0x1c: 'arabic', 0x1d: 'arabic',
  0x1e: 'arabic', 0x1f: 'arabic', 0x20: 'arabic',
};

const SCHEME_WRAP: Record<number, 'period' | 'right' | 'both' | 'minus'> = {
  0x00: 'period', 0x01: 'period', 0x02: 'right', 0x03: 'period',
  0x04: 'both', 0x05: 'right', 0x06: 'period', 0x07: 'period',
  0x08: 'both', 0x09: 'right', 0x0a: 'both', 0x0b: 'right',
  0x0c: 'both', 0x0e: 'both', 0x0f: 'right',
  0x11: 'period', 0x15: 'period', 0x17: 'period', 0x19: 'period',
  0x1b: 'period', 0x1d: 'period',
  0x1e: 'minus', 0x1f: 'minus', 0x20: 'minus',
};

function alpha(num: number): string {
  let s = '';
  let n = num;
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || 'A';
}

function roman(num: number): string {
  const table: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let s = '';
  let n = num;
  for (const [v, sym] of table) while (n >= v) { s += sym; n -= v; }
  return s || 'I';
}

const circled = (num: number): string => (num >= 1 && num <= 20 ? String.fromCharCode(0x2460 + num - 1) : String(num));
