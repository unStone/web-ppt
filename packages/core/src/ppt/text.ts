/**
 * .ppt 文本：StyleTextPropAtom / TxMasterStyleAtom 的段落与字符属性，以及按母版逐级样式
 * 合成统一 Schema 的 TextBody。
 */
import type { Paragraph, TextBody, TextRun } from '../types';
import { AutoNum, formatAutoNum } from './autonum';
import { Scheme, escherColor } from './escher';
import type { Rec } from './records';
import { MASTER_TO_PX } from './units';

export interface TextRunProps {
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: number;
  fontIdx?: number;
  asianFontIdx?: number;
}

export interface ParaProps {
  align?: number;
  bulletChar?: string;
  hasBullet?: boolean;
  indentLevel?: number;
  leftMargin?: number;
  indent?: number;
}

/** 超链接覆盖的字符区间（左闭右开） */
export interface LinkRange {
  begin: number;
  end: number;
  link: string;
}

export interface StyledText {
  text: string;
  paraProps: { chars: number; props: ParaProps }[];
  charProps: { chars: number; props: TextRunProps }[];
  /** TextHeaderAtom 里的 TextTypeEnum，决定继承哪一套母版样式 */
  textType?: number;
  links?: LinkRange[];
}

// ---------------- TextPFException / TextCFException ----------------

/**
 * [MS-PPT] 2.9.44 TextPFException：字段在数据区里的排列顺序与掩码位顺序**不一致**，
 * 必须严格按下表读取（顺序或宽度错一位，后面的字符属性就整体错位）。
 * 该结构同时用于 StyleTextPropAtom 与 TxMasterStyleAtom。
 */
const PF_BULLET_FLAGS = 0x0000000f;
const PF_TAB_STOPS = 0x00100000;

const PARA_FIELDS: [number, number][] = [
  [PF_BULLET_FLAGS, 2], // bulletFlags：fHasBullet / fBulletHasFont / …
  [0x00000080, 2], // bullet.char
  [0x00000010, 2], // bullet.font
  [0x00000040, 2], // bullet.size
  [0x00000020, 4], // bullet.color
  [0x00000800, 2], // alignment
  [0x00001000, 2], // lineSpacing
  [0x00002000, 2], // spaceBefore
  [0x00004000, 2], // spaceAfter
  [0x00000100, 2], // leftMargin
  [0x00000400, 2], // indent
  [0x00008000, 2], // defaultTabSize
  [PF_TAB_STOPS, -1], // tabStops：u16 count + count×4，长度可变
  [0x00010000, 2], // fontAlign
  [0x000e0000, 2], // wrapFlags
  [0x00200000, 2], // textDirection
];

/** [MS-PPT] 2.9.20 TextCFException：同样按数据区顺序排列 */
const CHAR_FIELDS: [number, number][] = [
  [0x0000ffff, 2], // 样式位（粗 / 斜 / 下划线 …）
  [0x00010000, 2], // font.index
  [0x00200000, 2], // asian.font.index
  [0x00400000, 2], // ansi.font.index
  [0x00800000, 2], // symbol.font.index
  [0x00020000, 2], // font.size
  [0x00040000, 4], // font.color
  [0x00080000, 2], // superscript
];

/** 读一份段落属性；返回读完后的偏移，越界时返回 -1 让调用方放弃后续解析 */
function readParaProps(dv: DataView, start: number, end: number, mask: number, props: ParaProps): number {
  let off = start;
  for (const [flag, size] of PARA_FIELDS) {
    if (!(mask & flag)) continue;
    if (flag === PF_TAB_STOPS) {
      if (off + 2 > end) return -1;
      off += 2 + dv.getUint16(off, true) * 4;
      if (off > end) return -1;
      continue;
    }
    if (off + size > end) return -1;
    const v = size === 2 ? dv.getUint16(off, true) : dv.getUint32(off, true);
    if (flag === PF_BULLET_FLAGS) props.hasBullet = (v & 0x1) !== 0;
    else if (flag === 0x00000080) props.bulletChar = String.fromCharCode(v);
    else if (flag === 0x00000100) props.leftMargin = v;
    else if (flag === 0x00000400) props.indent = v;
    else if (flag === 0x00000800) props.align = v;
    off += size;
  }
  // 有 bullet.char 但没写标志位时按「有符号」处理：部分生成器会漏掉标志位
  if (props.hasBullet === undefined && (mask & 0x80) !== 0) props.hasBullet = true;
  return off;
}

function readCharProps(dv: DataView, start: number, end: number, mask: number, props: TextRunProps): number {
  let off = start;
  for (const [flag, size] of CHAR_FIELDS) {
    if (!(mask & flag)) continue;
    if (off + size > end) return -1;
    const v = size === 2 ? dv.getUint16(off, true) : dv.getUint32(off, true);
    if (flag === 0x0000ffff) {
      if (mask & 0x1) props.bold = (v & 0x1) !== 0;
      if (mask & 0x2) props.italic = (v & 0x2) !== 0;
      if (mask & 0x4) props.underline = (v & 0x4) !== 0;
    } else if (flag === 0x00010000) props.fontIdx = v;
    else if (flag === 0x00200000) props.asianFontIdx = v;
    else if (flag === 0x00020000) props.size = v;
    else if (flag === 0x00040000) props.color = v;
    off += size;
  }
  return off;
}

// ---------------- StyleTextPropAtom ----------------

interface StyleRuns {
  para: { chars: number; props: ParaProps }[];
  char: { chars: number; props: TextRunProps }[];
}

export function parseStyleTextProp(dv: DataView, rec: Rec, textLen: number): StyleRuns {
  const para: StyleRuns['para'] = [];
  const char: StyleRuns['char'] = [];
  let off = rec.start;
  const end = rec.start + rec.len;
  const total = textLen + 1;

  let covered = 0;
  while (off + 10 <= end && covered < total) {
    const chars = dv.getUint32(off, true);
    const indentLevel = dv.getUint16(off + 4, true);
    const mask = dv.getUint32(off + 6, true);
    const props: ParaProps = { indentLevel };
    const next = readParaProps(dv, off + 10, end, mask, props);
    if (next < 0) break;
    off = next;
    para.push({ chars, props });
    covered += chars;
    if (chars === 0) break;
  }

  covered = 0;
  while (off + 8 <= end && covered < total) {
    const chars = dv.getUint32(off, true);
    // 字符段与段落段错位时读到的长度会离谱，此时放弃字符属性走默认值
    if (chars > total) break;
    const mask = dv.getUint32(off + 4, true);
    const props: TextRunProps = {};
    const next = readCharProps(dv, off + 8, end, mask, props);
    if (next < 0) break;
    off = next;
    char.push({ chars, props });
    covered += chars;
    if (chars === 0) break;
  }

  return { para, char };
}

// ---------------- TxMasterStyleAtom（母版按级别的默认样式） ----------------

export interface LevelStyle {
  para: ParaProps;
  char: TextRunProps;
}

/** TextTypeEnum → 逐级默认样式 */
export type MasterStyles = Map<number, LevelStyle[]>;

/** [MS-PPT] TextTypeEnum */
export const TX = { TITLE: 0, BODY: 1, NOTES: 2, OTHER: 4, CENTER_BODY: 5, CENTER_TITLE: 6 } as const;

/** OEPlaceholderAtom.placeholderId → TextTypeEnum */
export const PH_TEXT_TYPE: Record<number, number> = {
  1: TX.TITLE,
  2: TX.BODY,
  3: TX.CENTER_TITLE,
  4: TX.CENTER_BODY,
  6: TX.NOTES,
  12: TX.NOTES,
  13: TX.TITLE,
  14: TX.BODY,
  15: TX.CENTER_TITLE,
  16: TX.CENTER_BODY,
  17: TX.TITLE,
  18: TX.BODY,
  19: TX.BODY,
};

/**
 * TxMasterStyleAtom：cLevels 后跟每一级的 TextPFException + TextCFException。
 * recInstance ≥ 5 的类型每级前多一个 2 字节的 level 字段。
 */
export function parseTxMasterStyle(dv: DataView, rec: Rec, out: MasterStyles): void {
  const end = rec.start + rec.len;
  let off = rec.start;
  if (off + 2 > end) return;
  const levels = dv.getUint16(off, true);
  off += 2;
  const list: LevelStyle[] = [];
  for (let i = 0; i < levels; i++) {
    if (rec.instance >= 5) off += 2;
    if (off + 4 > end) break;
    const pMask = dv.getUint32(off, true);
    const para: ParaProps = {};
    let next = readParaProps(dv, off + 4, end, pMask, para);
    if (next < 0 || next + 4 > end) break;
    const cMask = dv.getUint32(next, true);
    const char: TextRunProps = {};
    next = readCharProps(dv, next + 4, end, cMask, char);
    if (next < 0) break;
    off = next;
    list.push({ para, char });
  }
  if (list.length) out.set(rec.instance, list);
}

// ---------------- 文本块 ----------------

const ALIGN_MAP: Record<number, Paragraph['align']> = { 0: 'left', 1: 'center', 2: 'right', 3: 'justify', 4: 'justify' };

/** 文本解析环境：字体表、配色方案，以及按段落级别取到的母版默认样式 */
export interface TextEnv {
  fonts: string[];
  scheme: Scheme;
  /** 该文本类型在 lvl 级上的母版默认样式（已按 母版 → 环境 合并） */
  levelStyle: (lvl: number) => LevelStyle;
  /** 认领 ___PPT9 里 paraCount 段的自动编号；认领不到返回 undefined */
  claimAutoNums: (paraCount: number) => (AutoNum | null)[] | undefined;
}

export function buildTextBody(styled: StyledText, env: TextEnv, anchorProp: number | undefined): TextBody | null {
  const raw = styled.text.replace(/\r\n?/g, '\n').replace(/\v/g, '\n');
  if (!raw.trim()) return null;

  // 按段落属性覆盖长度切分文本，再在段内按字符属性切分 run
  const paragraphs: Paragraph[] = [];
  let charPos = 0;
  let charIdx = 0;
  let charUsed = 0;

  const nextRunProps = (need: number): { props: TextRunProps; take: number } => {
    while (charIdx < styled.charProps.length && charUsed >= styled.charProps[charIdx].chars) {
      charUsed = 0;
      charIdx++;
    }
    const entry = styled.charProps[charIdx];
    if (!entry) return { props: {}, take: need };
    const avail = Math.max(1, entry.chars - charUsed);
    return { props: entry.props, take: Math.min(need, avail) };
  };

  // 超链接按绝对字符位置生效，run 不能跨越区间边界
  const links = styled.links ?? [];
  const linkAt = (pos: number): string | undefined => links.find((l) => pos >= l.begin && pos < l.end)?.link;
  const linkBreak = (pos: number, limit: number): number => {
    let stop = limit;
    for (const l of links) {
      if (l.begin > pos && l.begin - pos < stop) stop = l.begin - pos;
      if (l.end > pos && l.end - pos < stop) stop = l.end - pos;
    }
    return Math.max(1, stop);
  };

  const paraList = styled.paraProps.length ? styled.paraProps : [{ chars: raw.length + 1, props: {} as ParaProps }];
  // 自动编号只存在于 ___PPT9 扩展块，按段落序号对齐；计数器按级别维护
  const autoNums = env.claimAutoNums(paraList.length);
  const counters: number[] = [];

  paraList.forEach((pEntry, paraIdx) => {
    const paraText = raw.slice(charPos, charPos + pEntry.chars);
    const paraStart = charPos;
    charPos += pEntry.chars;
    // 段落自带的终止符会切出一条多余的空行，丢掉它（但仍要算进字符属性的游标）
    const parts = paraText.split('\n');
    const dropped = parts.length > 1 && parts[parts.length - 1] === '';
    const lines = dropped ? parts.slice(0, -1) : parts;
    const pp = pEntry.props;
    const dft = env.levelStyle(pp.indentLevel ?? 0);
    const lvl = pp.indentLevel ?? 0;

    // 编号只给段首行，段内的软换行不重新起号
    const anm = autoNums?.[paraIdx] ?? null;
    let numText: string | null = null;
    if (anm) {
      counters.length = lvl + 1;
      counters[lvl] = (counters[lvl] ?? anm.startNum - 1) + 1;
      numText = formatAutoNum(anm.scheme, counters[lvl]);
    }

    let lineStart = paraStart;
    lines.forEach((line, li) => {
      const runs: TextRun[] = [];
      let i = 0;
      while (i < line.length) {
        const { props, take } = nextRunProps(line.length - i);
        const abs = lineStart + i;
        const n = linkBreak(abs, take);
        const slice = line.slice(i, i + n);
        charUsed += n;
        i += n;
        runs.push(makeRun(slice, props, dft.char, env, linkAt(abs)));
      }
      if (li < lines.length - 1 || dropped) charUsed += 1; // 换行符也占一个字符
      if (!runs.length) {
        const { props } = nextRunProps(1);
        runs.push(makeRun('', props, dft.char, env, undefined));
      }
      lineStart += line.length + 1;

      const bulletNum = li === 0 ? numText : null;
      const hasBullet = bulletNum !== null || (pp.hasBullet ?? dft.para.hasBullet ?? false);
      const leftMargin = pp.leftMargin ?? dft.para.leftMargin;
      const marL = leftMargin !== undefined ? leftMargin * MASTER_TO_PX : hasBullet ? 24 : 0;
      paragraphs.push({
        align: ALIGN_MAP[pp.align ?? dft.para.align ?? 0] ?? 'left',
        lvl,
        marL,
        indent: hasBullet ? -Math.min(marL, 24) : 0,
        bullet: bulletNum ?? (hasBullet ? bulletChar(pp.bulletChar ?? dft.para.bulletChar) : null),
        lineHeight: null,
        spaceBefore: 0,
        spaceAfter: 2,
        runs,
      });
    });
  });

  if (!paragraphs.length) return null;
  const anchor: TextBody['anchor'] =
    anchorProp === 1 || anchorProp === 5 ? 'middle' : anchorProp === 2 || anchorProp === 6 ? 'bottom' : 'top';
  return { anchor, insets: [3.6, 7.2, 3.6, 7.2], wrap: true, fontScale: 1, paragraphs };
}

/** 形状自带属性 → 母版按级默认值 → 内建兜底 */
function makeRun(text: string, own: TextRunProps, dft: TextRunProps, env: TextEnv, link: string | undefined): TextRun {
  const color = own.color ?? dft.color;
  const fonts: string[] = [];
  for (const idx of [own.fontIdx ?? dft.fontIdx, own.asianFontIdx ?? dft.asianFontIdx]) {
    const name = idx !== undefined ? env.fonts[idx] : undefined;
    if (name && !fonts.includes(name)) fonts.push(name);
  }
  return {
    text,
    b: own.bold ?? dft.bold ?? false,
    i: own.italic ?? dft.italic ?? false,
    u: own.underline ?? dft.underline ?? false,
    strike: false,
    size: (own.size ?? dft.size ?? 18) * (96 / 72),
    color: color !== undefined ? escherColor(color, env.scheme) : 'rgb(0,0,0)',
    fonts,
    link,
  };
}

/**
 * Wingdings / Symbol 的符号字体码位（0xF000 私用区）→ 通用 Unicode。
 * 直接原样输出会渲染成豆腐块，必须映射成常见符号。
 */
const SYMBOL_BULLET: Record<number, string> = {
  0x6c: '●',
  0x6e: '■',
  0x6d: '❑',
  0x71: '❑',
  0x75: '◆',
  0x76: '❖',
  0xa7: '▪',
  0xa8: '◻',
  0xb7: '•',
  0xd8: '➢',
  0xfc: '✓',
  0xfe: '☑',
};

function bulletChar(ch: string | undefined): string {
  if (!ch) return '•';
  const code = ch.charCodeAt(0);
  const low = code >= 0xf000 && code <= 0xf0ff ? code - 0xf000 : code;
  const mapped = SYMBOL_BULLET[low];
  if (mapped && (code >= 0xf000 || code > 0x7f)) return mapped;
  if (code >= 0xf000) return '•';
  if (code < 32 || code === 0xfffd) return '•';
  return ch;
}
