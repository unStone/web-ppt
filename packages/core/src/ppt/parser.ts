import type {
  AnimStep, ElementBase, Fill, GroupElement, ImageElement, Paragraph, Presentation, ShapeElement,
  Slide, SlideElement, TableCell, TableElement, TableRow, TextBody, TextRun, Transition,
} from '../types';
import { metafileDataUrl } from '../metafile';
import { presetGeom } from '../geometry';
import { AutoNum, collectAutoNums, formatAutoNum } from './autonum';
import { Cfb } from './cfb';
import { getPptDecryptor } from '../crypto/hook';
import { isPptEncrypted } from '../crypto/ppt';
import {
  ESCHER, EscherProps, MSO_SHAPE, P, Scheme, SP_FLAG, escherColor, extractBlips,
  isTableGroup, MSO_PICTURE_FRAME, parseOpt, readAnchor, readChildAnchor, readSp, readSpgr,
  shapeFill, shapeShadow, shapeStroke, tableRowHeights,
} from './escher';
import { ansi, findAll, findRec, Rec, records, RT, utf16 } from './records';
import { parseAnimations, parseSlideShowInfo } from './timing';

/**
 * .ppt（PowerPoint 97-2003）纯浏览器解析。
 * CFB 容器 → PowerPoint Document 流 → 幻灯片容器 → OfficeArt 图形树 → 统一 Schema。
 */

/** 主坐标单位：1/576 英寸 → CSS px（96dpi） */
const MASTER_TO_PX = 96 / 576;

const DEFAULT_SCHEME: Scheme = ['FFFFFF', '000000', '808080', '000000', 'CCFFFF', 'B2B2B2', '3333CC', '009999'];

interface TextRunProps {
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: number;
  fontIdx?: number;
  asianFontIdx?: number;
}

interface ParaProps {
  align?: number;
  bulletChar?: string;
  hasBullet?: boolean;
  indentLevel?: number;
  leftMargin?: number;
  indent?: number;
}

/** 超链接覆盖的字符区间（左闭右开） */
interface LinkRange {
  begin: number;
  end: number;
  link: string;
}

interface StyledText {
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

function parseStyleTextProp(dv: DataView, rec: Rec, textLen: number): StyleRuns {
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

interface LevelStyle {
  para: ParaProps;
  char: TextRunProps;
}

/** TextTypeEnum → 逐级默认样式 */
type MasterStyles = Map<number, LevelStyle[]>;

/** [MS-PPT] TextTypeEnum */
const TX = { TITLE: 0, BODY: 1, NOTES: 2, OTHER: 4, CENTER_BODY: 5, CENTER_TITLE: 6 } as const;

/** OEPlaceholderAtom.placeholderId → TextTypeEnum */
const PH_TEXT_TYPE: Record<number, number> = {
  1: TX.TITLE, 2: TX.BODY, 3: TX.CENTER_TITLE, 4: TX.CENTER_BODY,
  6: TX.NOTES, 12: TX.NOTES,
  13: TX.TITLE, 14: TX.BODY, 15: TX.CENTER_TITLE, 16: TX.CENTER_BODY,
  17: TX.TITLE, 18: TX.BODY, 19: TX.BODY,
};

/**
 * TxMasterStyleAtom：cLevels 后跟每一级的 TextPFException + TextCFException。
 * recInstance ≥ 5 的类型每级前多一个 2 字节的 level 字段。
 */
function parseTxMasterStyle(dv: DataView, rec: Rec, out: MasterStyles): void {
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
interface TextEnv {
  fonts: string[];
  scheme: Scheme;
  /** 该文本类型在 lvl 级上的母版默认样式（已按 母版 → 环境 合并） */
  levelStyle: (lvl: number) => LevelStyle;
  /** 认领 ___PPT9 里 paraCount 段的自动编号；认领不到返回 undefined */
  claimAutoNums: (paraCount: number) => (AutoNum | null)[] | undefined;
}

function buildTextBody(styled: StyledText, env: TextEnv, anchorProp: number | undefined): TextBody | null {
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
  const anchor: TextBody['anchor'] = anchorProp === 1 || anchorProp === 5 ? 'middle' : anchorProp === 2 || anchorProp === 6 ? 'bottom' : 'top';
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
  0x6c: '●', 0x6e: '■', 0x6d: '❑', 0x71: '❑', 0x75: '◆', 0x76: '❖',
  0xa7: '▪', 0xa8: '◻', 0xb7: '•', 0xd8: '➢', 0xfc: '✓', 0xfe: '☑',
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

// ---------------- 幻灯片解析 ----------------

/** 组内坐标 → 绝对坐标的映射基准 */
interface Origin {
  x: number;
  y: number;
  sx: number;
  sy: number;
}

interface Ctx {
  dv: DataView;
  scheme: Scheme;
  fonts: string[];
  blobs: (string | null)[];
  /** SlideListWithText 中按 lTxid 索引的文本 */
  listText: StyledText[];
  scale: number;
  /** 母版逐级文本样式（TextTypeEnum → 各级），以及全局环境兜底 */
  styles: MasterStyles;
  envStyles: MasterStyles;
  /** ExHyperlink id → 链接目标（已归一为 URL 或 slide:<n>） */
  links: Map<number, string>;
  /** 当前页序号（1 起）与总页数，用于解析「下一页 / 末页」这类跳转 */
  slideIndex: number;
  slideCount: number;
  /** 解析母版图形时为 true：跳过占位符形状，只保留装饰图形 */
  masterPass: boolean;
  levelCache: Map<string, LevelStyle>;
  /** ___PPT9 里的逐段自动编号，与游标一起按文本对象顺序认领 */
  autoNums: (AutoNum | null)[];
  autoNumCursor: number;
  /** 只在编辑入口保留格式无关的预设几何语义；旧格式没有 OOXML 回写锚点 */
  edit: boolean;
}

/**
 * ___PPT9 的自动编号块没写明属于哪个文本对象，只能按「段数吻合」认领：
 * 从游标处切出与本文本对象段数相同的一段，其中确实含编号才算命中并推进游标。
 * 认不出来就当没有，绝不硬套到别的文本上。
 */
function claimAutoNums(ctx: Ctx, paraCount: number): (AutoNum | null)[] | undefined {
  const from = ctx.autoNumCursor;
  if (paraCount <= 0 || from + paraCount > ctx.autoNums.length) return undefined;
  const slice = ctx.autoNums.slice(from, from + paraCount);
  if (!slice.some((a) => a !== null)) return undefined;
  ctx.autoNumCursor = from + paraCount;
  return slice;
}

/**
 * 母版文本样式解析：优先本类型，其次母版的 other，最后是 Environment 里的全局默认。
 * 越靠前的越具体，用对象展开做「后写覆盖」即可得到合并结果。
 */
function levelStyleOf(ctx: Ctx, textType: number, lvl: number): LevelStyle {
  const key = `${textType}:${lvl}`;
  const hit = ctx.levelCache.get(key);
  if (hit) return hit;
  const pick = (styles: MasterStyles, type: number): LevelStyle | undefined => {
    const list = styles.get(type);
    if (!list || !list.length) return undefined;
    return list[Math.min(lvl, list.length - 1)];
  };
  const chain = [
    pick(ctx.envStyles, TX.OTHER),
    pick(ctx.styles, TX.OTHER),
    pick(ctx.styles, textType),
  ];
  const merged: LevelStyle = {
    para: Object.assign({}, ...chain.map((s) => s?.para ?? {})) as ParaProps,
    char: Object.assign({}, ...chain.map((s) => s?.char ?? {})) as TextRunProps,
  };
  ctx.levelCache.set(key, merged);
  return merged;
}

function textEnv(ctx: Ctx, textType: number): TextEnv {
  return {
    fonts: ctx.fonts,
    scheme: ctx.scheme,
    levelStyle: (lvl) => levelStyleOf(ctx, textType, lvl),
    claimAutoNums: (paraCount) => claimAutoNums(ctx, paraCount),
  };
}

function textFromClientTextbox(ctx: Ctx, rec: Rec): StyledText | null {
  const { dv } = ctx;
  let text: string | null = null;
  let styleRec: Rec | null = null;
  let textType: number | undefined;
  const links: LinkRange[] = [];
  let pendingLink: string | undefined;
  for (const r of records(dv, rec.start, rec.start + rec.len)) {
    if (r.type === RT.TextCharsAtom) text = utf16(dv, r.start, r.len);
    else if (r.type === RT.TextBytesAtom) text = ansi(dv, r.start, r.len);
    else if (r.type === RT.StyleTextPropAtom) styleRec = r;
    else if (r.type === RT.TextHeaderAtom && r.len >= 4) textType = dv.getUint32(r.start, true);
    else if (r.type === RT.InteractiveInfo) pendingLink = interactiveLink(ctx, r);
    else if (r.type === RT.TextInteractiveInfoAtom && r.len >= 8) {
      // 紧跟在 InteractiveInfo 之后，给出该链接覆盖的字符区间
      const begin = dv.getUint32(r.start, true);
      const end = dv.getUint32(r.start + 4, true);
      if (pendingLink && end > begin) links.push({ begin, end, link: pendingLink });
      pendingLink = undefined;
    }
  }
  if (text === null) return null;
  const styles = styleRec ? parseStyleTextProp(dv, styleRec, text.length) : { para: [], char: [] };
  return { text, paraProps: styles.para, charProps: styles.char, textType, links: links.length ? links : undefined };
}

/** ClientData / ClientTextbox 里的 OEPlaceholderAtom.placeholderId */
function placeholderId(ctx: Ctx, rec: Rec): number | null {
  const { dv } = ctx;
  const data = findRec(dv, rec.start, rec.start + rec.len, ESCHER.ClientData);
  if (!data) return null;
  const ph = findRec(dv, data.start, data.start + data.len, RT.OEPlaceholderAtom);
  return ph && ph.len >= 6 ? dv.getUint8(ph.start + 4) : null;
}

// ---------------- 超链接 ----------------

/** InteractiveInfoAtom.jump 枚举 → 目标页 */
const JUMP_SLIDE: Record<number, (i: number, n: number) => number> = {
  1: (i, n) => Math.min(i + 1, n),
  2: (i) => Math.max(i - 1, 1),
  3: () => 1,
  4: (_i, n) => n,
};

/**
 * InteractiveInfo 容器 → 链接串。
 * 优先用 ExHyperlink 的目标字符串，其次退回 InteractiveInfoAtom 自带的翻页动作。
 */
function interactiveLink(ctx: Ctx, rec: Rec): string | undefined {
  const { dv } = ctx;
  const atom = findRec(dv, rec.start, rec.start + rec.len, RT.InteractiveInfoAtom);
  if (!atom || atom.len < 16) return undefined;
  const idRef = dv.getUint32(atom.start + 4, true);
  const hit = ctx.links.get(idRef);
  if (hit) return hit;
  const jump = JUMP_SLIDE[dv.getUint8(atom.start + 10)];
  return jump ? `slide:${jump(ctx.slideIndex, ctx.slideCount)}` : undefined;
}

/** 整个形状的超链接：InteractiveInfo 挂在 ClientData 下 */
function clientDataLink(ctx: Ctx, rec: Rec): string | undefined {
  const { dv } = ctx;
  const data = findRec(dv, rec.start, rec.start + rec.len, ESCHER.ClientData);
  if (!data) return undefined;
  const info = findRec(dv, data.start, data.start + data.len, RT.InteractiveInfo);
  return info ? interactiveLink(ctx, info) : undefined;
}

/** Document > ExObjList 下的 ExHyperlink：id → 目标字符串（未归一） */
function collectHyperlinks(dv: DataView, docRec: Rec): Map<number, string> {
  const out = new Map<number, string>();
  const list = findRec(dv, docRec.start, docRec.start + docRec.len, RT.ExObjList);
  if (!list) return out;
  for (const link of findAll(dv, list.start, list.start + list.len, RT.ExHyperlink)) {
    let id: number | null = null;
    let target: string | null = null;
    let friendly: string | null = null;
    for (const r of records(dv, link.start, link.start + link.len)) {
      if (r.type === RT.ExHyperlinkAtom && r.len >= 4) id = dv.getUint32(r.start, true);
      else if (r.type === RT.CString) {
        const s = utf16(dv, r.start, r.len).replace(/\0+$/, '');
        // recInstance：0 = 显示名，1 = 目标，3 = 目标内定位
        if (r.instance === 1) target = s;
        else if (r.instance === 0) friendly = s;
      }
    }
    const value = target ?? friendly;
    if (id !== null && value) out.set(id, value);
  }
  return out;
}

/**
 * 目标字符串 → 统一链接格式。
 * PowerPoint 用 `<id>,<页序>,<页名>` 表示跳页，LibreOffice 用 `#action?jump=…`。
 */
function resolveLink(target: string, index: number, count: number): string | null {
  const raw = target.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  const action = /^#?action\?jump=(.+)$/.exec(lower) ?? /^#action\?jump=(.+)$/.exec(lower);
  if (action) {
    const what = action[1];
    if (what === 'firstslide') return 'slide:1';
    if (what === 'lastslide') return `slide:${count}`;
    if (what === 'nextslide') return `slide:${Math.min(index + 1, count)}`;
    if (what === 'previousslide') return `slide:${Math.max(index - 1, 1)}`;
    const page = /(\d+)/.exec(what);
    return page ? `slide:${page[1]}` : null;
  }

  const pptJump = /^\s*\d+\s*,\s*(\d+)\s*,/.exec(raw);
  if (pptJump) return `slide:${pptJump[1]}`;

  if (raw.startsWith('#')) {
    const page = /(\d+)\s*$/.exec(raw);
    return page ? `slide:${page[1]}` : null;
  }
  if (/^[a-z][a-z0-9+.-]*:/.test(lower)) return raw;
  if (/^www\./.test(lower)) return `https://${raw}`;
  return raw;
}

/** 解析形状的定位框：顶层用 ClientAnchor（主坐标），组内用 ChildAnchor（组坐标） */
function anchorBox(ctx: Ctx, rec: Rec, origin: Origin): { x: number; y: number; w: number; h: number } | null {
  const { dv } = ctx;
  const clientRec = findRec(dv, rec.start, rec.start + rec.len, ESCHER.ClientAnchor);
  if (clientRec) {
    const a = readAnchor(dv, clientRec);
    if (a) return { x: a.x * ctx.scale, y: a.y * ctx.scale, w: a.w * ctx.scale, h: a.h * ctx.scale };
  }
  const childRec = findRec(dv, rec.start, rec.start + rec.len, ESCHER.ChildAnchor);
  if (childRec) {
    const a = readChildAnchor(dv, childRec);
    if (a) return { x: origin.x + a.x * origin.sx, y: origin.y + a.y * origin.sy, w: a.w * origin.sx, h: a.h * origin.sy };
  }
  return null;
}

/** 定位框 + 旋转 / 翻转 / 阴影 / 形状 id：所有元素共用的基础字段 */
function elementBase(
  box: { x: number; y: number; w: number; h: number },
  sp: { id: number; flags: number },
  props: EscherProps,
  scheme: Scheme,
): ElementBase {
  const rotationRaw = props.simple.get(P.rotation);
  const base: ElementBase = {
    x: box.x, y: box.y, w: box.w, h: box.h,
    rot: rotationRaw !== undefined ? (rotationRaw / 65536) % 360 : 0,
    // 翻转标志在 Sp 记录的 flags 里，不在属性表
    flipH: (sp.flags & SP_FLAG.FLIPH) !== 0,
    flipV: (sp.flags & SP_FLAG.FLIPV) !== 0,
    // 动画按 Escher 形状 id 定位目标
    id: sp.id,
  };
  const shadow = shapeShadow(props, scheme);
  if (shadow) base.effects = { shadow };
  return base;
}

function parseSpContainer(ctx: Ctx, rec: Rec, origin: Origin): SlideElement | null {
  const { dv } = ctx;
  const spRec = findRec(dv, rec.start, rec.start + rec.len, ESCHER.Sp);
  if (!spRec) return null;
  const sp = readSp(dv, spRec);
  if (sp.flags & SP_FLAG.DELETED) return null;
  // 组壳与图形树的根都只是坐标系载体，本身不画东西
  if (sp.flags & (SP_FLAG.PATRIARCH | SP_FLAG.GROUP)) return null;
  if (sp.flags & SP_FLAG.BACKGROUND) return null;

  const ph = placeholderId(ctx, rec);
  // 母版上的占位符只是「请在此键入…」的提示框，本身不该出现在幻灯片上
  if (ctx.masterPass && ph !== null && ph !== 0) return null;

  const shapeType = spRec.instance;
  const optRec = findRec(dv, rec.start, rec.start + rec.len, ESCHER.Opt);
  const props: EscherProps = optRec ? parseOpt(dv, optRec) : { simple: new Map(), complex: new Map() };

  const box = anchorBox(ctx, rec, origin);
  if (!box || box.w <= 0 || box.h <= 0) return null;

  const base = elementBase(box, sp, props, ctx.scheme);
  const shapeLink = clientDataLink(ctx, rec);
  if (shapeLink) base.link = shapeLink;

  const blipUrl = (idx: number): string | null => ctx.blobs[idx - 1] ?? null;

  // 图片
  const pib = props.simple.get(P.pib);
  if (pib !== undefined && (shapeType === MSO_PICTURE_FRAME || pib > 0)) {
    const src = blipUrl(pib);
    if (src) {
      const img: ImageElement = { kind: 'image', ...base, src, crop: null, stroke: shapeStroke(props, ctx.scheme) };
      return img;
    }
  }

  const fill = shapeFill(props, ctx.scheme, blipUrl);
  const stroke = shapeStroke(props, ctx.scheme);

  // 几何
  let path: string | null = null;
  let openGeom = false;
  if (shapeType === 0 && props.complex.has(P.pVertices)) {
    path = customPath(ctx, props, box.w, box.h);
  }
  if (!path) {
    const prst = MSO_SHAPE[shapeType] ?? 'rect';
    const adj = msoAdjusts(props, shapeType);
    const g = presetGeom(prst, box.w, box.h, adj);
    path = g.d;
    openGeom = g.open;
    if (ctx.edit) base.editInfo = { geom: { preset: prst, adj } };
  }

  // 文本
  const tbRec = findRec(dv, rec.start, rec.start + rec.len, ESCHER.ClientTextbox);
  let styled = tbRec ? textFromClientTextbox(ctx, tbRec) : null;
  if (!styled) {
    const txid = props.simple.get(P.lTxid);
    if (txid !== undefined && ctx.listText[txid]) styled = ctx.listText[txid];
  }
  // 文本类型决定继承哪一套母版样式：优先 TextHeaderAtom，其次由占位符类型推断
  const textType = styled?.textType ?? (ph !== null ? PH_TEXT_TYPE[ph] : undefined) ?? TX.OTHER;
  const text = styled ? buildTextBody(styled, textEnv(ctx, textType), props.simple.get(P.anchorText)) : null;

  if (!text && (!fill || fill.type === 'none') && !stroke) return null;

  const shape: ShapeElement = {
    kind: 'shape', ...base, path,
    fill: openGeom ? { type: 'none' } : fill,
    stroke, text, openGeom: openGeom || undefined,
  };
  return shape;
}

/** 以角度为调节值的 MSO 形状（值为 度×65536） */
const ANGLE_SHAPES = new Set([19, 98, 102, 103]);

/**
 * MSO 调节值 → 本项目预设几何期望的 OOXML 口径。
 * MSO 长度类调节值以 1/21600 为单位，OOXML 用 100000 制；
 * 角度类以 度×65536 存储，OOXML 用 1/60000 度。
 * 数值离谱时直接丢弃，让预设走自身默认值。
 */
function msoAdjusts(props: EscherProps, shapeType: number): Record<string, number> {
  const isAngle = ANGLE_SHAPES.has(shapeType);
  const out: Record<string, number> = {};
  const ids: [number, string][] = [
    [P.adjustValue, 'adj1'], [P.adjust2Value, 'adj2'],
    [P.adjust3Value, 'adj3'], [P.adjust4Value, 'adj4'],
  ];
  for (const [id, key] of ids) {
    const raw = props.simple.get(id);
    if (raw === undefined) continue;
    const signed = raw > 0x7fffffff ? raw - 0x100000000 : raw;
    if (isAngle) {
      out[key] = (signed / 65536) * 60000;
      continue;
    }
    // 超出几何盒 4 倍的值视为无效
    if (Math.abs(signed) > 21600 * 4) continue;
    out[key] = (signed / 21600) * 100000;
  }
  if (out.adj1 !== undefined) out.adj = out.adj1;
  return out;
}

/** pVertices + pSegmentInfo → SVG path（复用 pptx 的 custGeom 逻辑不适用，这里直接生成） */
function customPath(ctx: Ctx, props: EscherProps, w: number, h: number): string | null {
  const { dv } = ctx;
  const v = props.complex.get(P.pVertices);
  const s = props.complex.get(P.pSegmentInfo);
  if (!v) return null;
  // 复杂属性数组头：u16 count, u16 countMax, u16 entrySize
  const readArray = (c: { start: number; len: number }, parse: (off: number) => number[]): number[][] => {
    const count = dv.getUint16(c.start, true);
    const entrySize = dv.getInt16(c.start + 4, true);
    const size = entrySize === -4 ? 8 : entrySize;
    const out: number[][] = [];
    for (let i = 0; i < count; i++) {
      const off = c.start + 6 + i * size;
      if (off + size > c.start + c.len) break;
      out.push(parse(off));
    }
    return out;
  };
  const entrySize = dv.getInt16(v.start + 4, true);
  const pts = readArray(v, (off) =>
    entrySize === 4 ? [dv.getInt16(off, true), dv.getInt16(off + 2, true)] : [dv.getInt32(off, true), dv.getInt32(off + 4, true)],
  );
  if (!pts.length) return null;

  const gl = props.simple.get(P.geoLeft) ?? 0;
  const gt = props.simple.get(P.geoTop) ?? 0;
  const gr = props.simple.get(P.geoRight) ?? 21600;
  const gb = props.simple.get(P.geoBottom) ?? 21600;
  const sx = w / Math.max(1, gr - gl);
  const sy = h / Math.max(1, gb - gt);
  const px = (p: number[]): string => `${((p[0] - gl) * sx).toFixed(2)} ${((p[1] - gt) * sy).toFixed(2)}`;

  if (!s) return `M ${pts.map(px).join(' L ')} Z`;

  const segs = readArray(s, (off) => [dv.getUint16(off, true)]);
  const out: string[] = [];
  let pi = 0;
  for (const [seg] of segs) {
    const msoType = seg >> 13;
    if (seg === 0x4000) out.push(`M ${px(pts[pi++] ?? [0, 0])}`);
    else if (seg === 0x6001) out.push('Z');
    else if (seg === 0x8000) break;
    else if (msoType === 0b010 || seg === 0xb300) {
      const a = pts[pi++], b = pts[pi++], c = pts[pi++];
      if (a && b && c) out.push(`C ${px(a)} ${px(b)} ${px(c)}`);
    } else if (seg < 0x4000) {
      const n = seg & 0xfff;
      for (let i = 0; i < Math.max(1, n) && pts[pi]; i++) out.push(`L ${px(pts[pi++])}`);
    }
  }
  return out.length ? out.join(' ') : `M ${pts.map(px).join(' L ')} Z`;
}

/** 组自身：定位框、子坐标系，以及旋转 / 翻转所需的 Sp 与属性表 */
interface GroupSelf {
  rec: Rec;
  sp: { id: number; flags: number };
  props: EscherProps;
  box: { x: number; y: number; w: number; h: number };
  space: { x: number; y: number; w: number; h: number };
}

/**
 * 组内子元素的坐标基准：只把组单位换算成 px，不做组自身的缩放
 * ——缩放交给 GroupElement 的 scaleX/scaleY，这样组被拉伸时文字也跟着变，
 * 与 .pptx 侧 chOff/chExt 的口径一致。
 */
const groupOrigin = (ctx: Ctx): Origin => ({ x: 0, y: 0, sx: ctx.scale, sy: ctx.scale });

/**
 * 组容器。
 * 真正的组产出 GroupElement 保留层级：子元素坐标留在组坐标系里，
 * 由 childX/childY + scaleX/scaleY 描述到父坐标系的映射。
 * 表格组与最外层的 patriarch 例外——前者要还原成表格，后者只是图形树的根。
 */
function parseSpgrContainer(ctx: Ctx, rec: Rec, parent: Origin, depth = 0): SlideElement[] {
  const { dv } = ctx;
  const out: SlideElement[] = [];
  const children = [...records(dv, rec.start, rec.start + rec.len)];
  const first = children.find((c) => c.type === ESCHER.SpContainer);
  const self = first ? readGroupSelf(ctx, first, parent) : null;
  const groupSelf = self?.rec ?? null;

  // 展平用的坐标映射：组框左上角 − 子坐标系原点 × 缩放
  let flat = parent;
  if (self) {
    const sx = self.box.w / self.space.w;
    const sy = self.box.h / self.space.h;
    flat = { x: self.box.x - self.space.x * sx, y: self.box.y - self.space.y * sy, sx, sy };
  }

  const childShapes = (origin: Origin): SlideElement[] => {
    const els: SlideElement[] = [];
    for (const child of children) {
      if (child === groupSelf || child.type !== ESCHER.SpContainer) continue;
      const el = parseSpContainer(ctx, child, origin);
      if (el) els.push(el);
    }
    return els;
  };

  // 表格组：子形状即单元格，按行高与列边界还原成表格元素
  if (self && isTableGroup(self.props)) {
    const cells = childShapes(flat);
    const table = buildTable(cells, tableRowHeights(dv, self.props).map((h) => h * ctx.scale));
    if (table) return [table];
    return cells;
  }

  // 没有表格标记时用网格启发式：导出器常把表格拆成「底色矩形 + 文字框」两层
  if (self && children.filter((c) => c.type === ESCHER.SpContainer).length >= 4) {
    const merged = mergeCellLayers(childShapes(flat));
    if (looksLikeGrid(merged)) {
      const table = buildTable(merged, []);
      if (table) return [table];
    }
  }

  const collect = (origin: Origin, into: SlideElement[]): void => {
    for (const child of children) {
      if (child === groupSelf) continue;
      if (child.type === ESCHER.SpContainer) {
        const el = parseSpContainer(ctx, child, origin);
        if (el) into.push(el);
      } else if (child.type === ESCHER.SpgrContainer && depth < 8) {
        into.push(...parseSpgrContainer(ctx, child, origin, depth + 1));
      }
    }
  };

  if (self) {
    const kids: SlideElement[] = [];
    collect(groupOrigin(ctx), kids);
    if (!kids.length) return [];
    const spaceW = self.space.w * ctx.scale;
    const spaceH = self.space.h * ctx.scale;
    const group: GroupElement = {
      kind: 'group',
      ...elementBase(self.box, self.sp, self.props, ctx.scheme),
      childX: self.space.x * ctx.scale,
      childY: self.space.y * ctx.scale,
      scaleX: self.box.w / spaceW,
      scaleY: self.box.h / spaceH,
      children: kids,
    };
    return [group];
  }

  collect(flat, out);
  return out;
}

/**
 * 组容器的首个 SpContainer 若带 GROUP 标志就是组自身。
 * patriarch（图形树的根）与退化成零尺寸的组不算，交给调用方按展平处理。
 */
function readGroupSelf(ctx: Ctx, rec: Rec, parent: Origin): GroupSelf | null {
  const { dv } = ctx;
  const spgr = findRec(dv, rec.start, rec.start + rec.len, ESCHER.Spgr);
  const spRec = findRec(dv, rec.start, rec.start + rec.len, ESCHER.Sp);
  if (!spgr || !spRec) return null;
  const sp = readSp(dv, spRec);
  if (!(sp.flags & SP_FLAG.GROUP) || (sp.flags & SP_FLAG.PATRIARCH)) return null;
  const space = readSpgr(dv, spgr);
  const box = anchorBox(ctx, rec, parent);
  if (!space || !box || space.w <= 0 || space.h <= 0 || box.w <= 0 || box.h <= 0) return null;
  const optRec = findRec(dv, rec.start, rec.start + rec.len, ESCHER.Opt);
  const props: EscherProps = optRec ? parseOpt(dv, optRec) : { simple: new Map(), complex: new Map() };
  return { rec, sp, props, box, space };
}

/**
 * 把落在同一格的多个图形合并成一个单元格：
 * 包围盒基本重合时，取有填充的那个作底色、有文字的那个作内容。
 */
function mergeCellLayers(els: SlideElement[]): SlideElement[] {
  const shapes = els.filter((e): e is ShapeElement => e.kind === 'shape');
  if (shapes.length !== els.length) return els;

  const TOL = 3;
  const out: ShapeElement[] = [];
  for (const s of shapes) {
    const hit = out.find(
      (o) => Math.abs(o.x - s.x) <= TOL && Math.abs(o.y - s.y) <= TOL &&
        Math.abs(o.w - s.w) <= TOL * 2 && Math.abs(o.h - s.h) <= TOL * 2,
    );
    if (!hit) {
      out.push({ ...s });
      continue;
    }
    if (!hit.text && s.text) hit.text = s.text;
    if ((!hit.fill || hit.fill.type === 'none') && s.fill && s.fill.type !== 'none') hit.fill = s.fill;
    if (!hit.stroke && s.stroke) hit.stroke = s.stroke;
  }
  return out;
}

/**
 * 网格启发式：一组矩形要构成表格，需满足行列都 ≥2、单元格数接近行列乘积、
 * 且相邻单元格紧邻（无明显间隙）。条件从严，避免把普通图形组误判成表格。
 */
function looksLikeGrid(cells: SlideElement[]): boolean {
  const shapes = cells.filter((c): c is ShapeElement => c.kind === 'shape' && c.path !== null);
  if (shapes.length < 4 || shapes.length !== cells.length) return false;

  const TOL = 2.5;
  const cluster = (vals: number[]): number[] => {
    const sorted = [...vals].sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) if (!out.length || v - out[out.length - 1] > TOL) out.push(v);
    return out;
  };
  const cols = cluster(shapes.map((s) => s.x));
  const rows = cluster(shapes.map((s) => s.y));
  if (cols.length < 2 || rows.length < 2) return false;
  if (shapes.length > cols.length * rows.length) return false;
  // 允许合并单元格造成的缺口，但不能太稀疏
  if (shapes.length < cols.length * rows.length * 0.5) return false;

  // 相邻列/行之间不能有空隙：下一条边界应落在上一格右/下边缘附近
  const edgeFits = (edges: number[], starts: number[], ends: number[]): boolean => {
    for (let i = 0; i + 1 < edges.length; i++) {
      const near = starts.some((s, k) => Math.abs(s - edges[i]) <= TOL && Math.abs(ends[k] - edges[i + 1]) <= TOL * 2);
      if (!near) return false;
    }
    return true;
  };
  const okCols = edgeFits(cols, shapes.map((s) => s.x), shapes.map((s) => s.x + s.w));
  const okRows = edgeFits(rows, shapes.map((s) => s.y), shapes.map((s) => s.y + s.h));
  return okCols && okRows;
}

/**
 * 由单元格形状还原表格结构。
 * 二进制格式不直接存列宽，用所有单元格的左边界聚类得到列边界，
 * 单元格跨列数由其宽度覆盖了几个列区间推出。
 */
function buildTable(cells: SlideElement[], rowHeights: number[]): TableElement | null {
  const shapes = cells.filter((c): c is ShapeElement => c.kind === 'shape');
  if (shapes.length < 2) return null;

  const TOL = 2;
  const uniq = (vals: number[]): number[] => {
    const sorted = [...vals].sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) if (!out.length || v - out[out.length - 1] > TOL) out.push(v);
    return out;
  };

  const colEdges = uniq(shapes.map((s) => s.x));
  const rowEdges = uniq(shapes.map((s) => s.y));
  if (colEdges.length < 1 || rowEdges.length < 1) return null;

  const x0 = colEdges[0];
  const y0 = rowEdges[0];
  const right = Math.max(...shapes.map((s) => s.x + s.w));
  const bottom = Math.max(...shapes.map((s) => s.y + s.h));

  const colWidths = colEdges.map((edge, i) => (i + 1 < colEdges.length ? colEdges[i + 1] : right) - edge);
  const heights = rowEdges.map((edge, i) => (i + 1 < rowEdges.length ? rowEdges[i + 1] : bottom) - edge);
  const finalHeights = rowHeights.length === rowEdges.length ? rowHeights : heights;

  const colOf = (x: number): number => {
    let best = 0;
    for (let i = 0; i < colEdges.length; i++) if (x >= colEdges[i] - TOL) best = i;
    return best;
  };
  const rowOf = (y: number): number => {
    let best = 0;
    for (let i = 0; i < rowEdges.length; i++) if (y >= rowEdges[i] - TOL) best = i;
    return best;
  };

  const grid: (TableCell | null)[][] = rowEdges.map(() => colEdges.map(() => null));
  for (const s of shapes) {
    const r = rowOf(s.y);
    const c = colOf(s.x);
    if (grid[r][c]) continue;
    let colSpan = 0;
    for (let i = c; i < colEdges.length && colEdges[i] < s.x + s.w - TOL; i++) colSpan++;
    let rowSpan = 0;
    for (let i = r; i < rowEdges.length && rowEdges[i] < s.y + s.h - TOL; i++) rowSpan++;
    grid[r][c] = {
      colSpan: Math.max(1, colSpan),
      rowSpan: Math.max(1, rowSpan),
      merged: false,
      fill: s.fill,
      text: s.text,
      borders: { l: s.stroke, r: s.stroke, t: s.stroke, b: s.stroke },
      vAlign: s.text?.anchor === 'middle' ? 'middle' : s.text?.anchor === 'bottom' ? 'bottom' : 'top',
    };
    // 被跨越覆盖的格子标记为已合并
    for (let rr = r; rr < r + Math.max(1, rowSpan); rr++) {
      for (let cc = c; cc < c + Math.max(1, colSpan); cc++) {
        if (rr === r && cc === c) continue;
        if (grid[rr]?.[cc] === null) {
          grid[rr][cc] = { colSpan: 1, rowSpan: 1, merged: true, fill: null, text: null };
        }
      }
    }
  }

  const rows: TableRow[] = grid.map((cellRow, i) => ({
    height: finalHeights[i] ?? 0,
    cells: cellRow.map((c) => c ?? { colSpan: 1, rowSpan: 1, merged: false, fill: null, text: null }),
  }));

  return {
    kind: 'table',
    x: x0, y: y0, w: right - x0, h: bottom - y0,
    rot: 0, flipH: false, flipV: false,
    colWidths,
    rows,
    name: '表格',
  };
}

// ---------------- 持久化目录（persistId → 记录） ----------------

/**
 * PersistDirectoryAtom：一串 (startId | count<<20) + count 个流内偏移。
 * 增量保存会追加新的目录，靠后的条目覆盖靠前的，正好等于「按文档顺序后写覆盖先写」。
 */
function persistOffsets(dv: DataView, docLen: number): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of records(dv, 0, docLen)) {
    if (r.type !== RT.PersistDirectoryAtom) continue;
    const end = r.start + r.len;
    let off = r.start;
    while (off + 4 <= end) {
      const head = dv.getUint32(off, true);
      off += 4;
      const startId = head & 0xfffff;
      const count = head >>> 20;
      for (let i = 0; i < count && off + 4 <= end; i++, off += 4) {
        map.set(startId + i, dv.getUint32(off, true));
      }
    }
  }
  return map;
}

interface PersistEntry {
  rec: Rec;
  /** SlidePersistAtom.slideId：SlideAtom 的 masterIdRef / notesIdRef 按它做关联 */
  slideId: number;
}

/**
 * 按 SlideListWithText 的顺序取出幻灯片 / 母版 / 备注容器。
 * 这是文件里权威的顺序来源；持久化目录解析不出来时由调用方退回文档顺序扫描。
 */
function persistList(
  dv: DataView,
  docRec: Rec,
  instance: number,
  offsets: Map<number, number>,
  byOffset: Map<number, Rec>,
  types: number[],
): PersistEntry[] {
  const out: PersistEntry[] = [];
  for (const list of findAll(dv, docRec.start, docRec.start + docRec.len, RT.SlideListWithText)) {
    if (list.instance !== instance) continue;
    for (const atom of findAll(dv, list.start, list.start + list.len, RT.SlidePersistAtom)) {
      if (atom.len < 16) continue;
      const offset = offsets.get(dv.getUint32(atom.start, true));
      const rec = offset !== undefined ? byOffset.get(offset) : undefined;
      if (rec && types.includes(rec.type)) out.push({ rec, slideId: dv.getUint32(atom.start + 12, true) });
    }
  }
  return out;
}

// ---------------- 母版 ----------------

interface MasterInfo {
  scheme: Scheme;
  styles: MasterStyles;
  background: Fill | null;
  elements: SlideElement[];
}

/** 幻灯片 / 母版容器里的 ColorSchemeAtom → 8 色配色方案 */
function readScheme(dv: DataView, rec: Rec, instance: number): Scheme | null {
  for (const r of findAll(dv, rec.start, rec.start + rec.len, RT.ColorSchemeAtom)) {
    if (r.instance !== instance || r.len < 32) continue;
    const out: Scheme = [];
    for (let i = 0; i < 8; i++) {
      const v = dv.getUint32(r.start + i * 4, true);
      const parts = [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
      out.push(parts.map((c) => c.toString(16).padStart(2, '0')).join(''));
    }
    return out;
  }
  return null;
}

/** PPDrawing → DgContainer 直属的背景形状（fBackground），其填充即整页底色 */
function drawingBackground(dv: DataView, drawing: Rec, scheme: Scheme, blipUrl: (i: number) => string | null): Fill | null {
  const dg = findRec(dv, drawing.start, drawing.start + drawing.len, ESCHER.DgContainer);
  if (!dg) return null;
  for (const sp of findAll(dv, dg.start, dg.start + dg.len, ESCHER.SpContainer)) {
    const spRec = findRec(dv, sp.start, sp.start + sp.len, ESCHER.Sp);
    if (!spRec || !(readSp(dv, spRec).flags & SP_FLAG.BACKGROUND)) continue;
    const optRec = findRec(dv, sp.start, sp.start + sp.len, ESCHER.Opt);
    if (!optRec) continue;
    const props = parseOpt(dv, optRec);
    // 只有真的写了填充属性才算数：转换器常留一个「已填充但没给颜色」的空壳
    if (!props.simple.has(P.fillColor) && !props.simple.has(P.fillType) && !props.simple.has(P.fillBlip)) continue;
    const fill = shapeFill(props, scheme, blipUrl);
    if (fill && fill.type !== 'none') return fill;
  }
  return null;
}

/** 遍历 PPDrawing 的图形树 */
function drawingElements(ctx: Ctx, drawing: Rec): SlideElement[] {
  const out: SlideElement[] = [];
  const dg = findRec(ctx.dv, drawing.start, drawing.start + drawing.len, ESCHER.DgContainer);
  if (!dg) return out;
  for (const spgr of findAll(ctx.dv, dg.start, dg.start + dg.len, ESCHER.SpgrContainer)) {
    out.push(...parseSpgrContainer(ctx, spgr, { x: 0, y: 0, sx: ctx.scale, sy: ctx.scale }));
  }
  return out;
}

function parseMaster(dv: DataView, rec: Rec, shared: Shared): MasterInfo {
  const scheme = readScheme(dv, rec, 1) ?? readScheme(dv, rec, 6) ?? DEFAULT_SCHEME;
  const styles: MasterStyles = new Map();
  for (const r of findAll(dv, rec.start, rec.start + rec.len, RT.TxMasterStyleAtom)) {
    parseTxMasterStyle(dv, r, styles);
  }

  const drawing = findRec(dv, rec.start, rec.start + rec.len, RT.PPDrawing);
  const blipUrl = (idx: number): string | null => shared.blobs[idx - 1] ?? null;
  const background = drawing ? drawingBackground(dv, drawing, scheme, blipUrl) : null;

  const ctx: Ctx = {
    dv, scheme, fonts: shared.fonts, blobs: shared.blobs, listText: [], scale: shared.scale,
    styles, envStyles: shared.envStyles, links: new Map(), masterPass: true,
    levelCache: new Map(), slideIndex: 1, slideCount: 1,
    autoNums: collectAutoNums(dv, rec), autoNumCursor: 0,
    edit: shared.edit,
  };
  const elements = drawing ? drawingElements(ctx, drawing) : [];
  return { scheme, styles, background, elements };
}

// ---------------- 演讲者备注 ----------------

/** Notes 容器里 TextTypeEnum 为 notes 的文本即备注正文（页码 / 页脚域不算） */
function notesText(dv: DataView, rec: Rec): string {
  const lines: string[] = [];
  let type = -1;
  const walk = (start: number, end: number, depth: number): void => {
    for (const r of records(dv, start, end)) {
      if (r.type === RT.TextHeaderAtom && r.len >= 4) type = dv.getUint32(r.start, true);
      else if (r.type === RT.TextCharsAtom || r.type === RT.TextBytesAtom) {
        if (type === TX.NOTES) {
          const raw = r.type === RT.TextCharsAtom ? utf16(dv, r.start, r.len) : ansi(dv, r.start, r.len);
          const text = raw.replace(/\r\n?/g, '\n').replace(/\v/g, '\n').replace(/\0/g, '').trim();
          if (text) lines.push(text);
        }
        type = -1;
      } else if (r.isContainer && depth < 8) walk(r.start, r.start + r.len, depth + 1);
    }
  };
  walk(rec.start, rec.start + rec.len, 0);
  return lines.join('\n');
}

// ---------------- 入口 ----------------

interface Shared {
  fonts: string[];
  blobs: (string | null)[];
  scale: number;
  envStyles: MasterStyles;
  edit: boolean;
}

export function parsePpt(bytes: Uint8Array, password?: string, edit = false): Presentation {
  const cfb = new Cfb(bytes);

  // 加密的 .pptx 已在 parse() 里被 EncryptedPackage 流拦下并解密，走不到这里
  if (cfb.stream('EncryptedPackage') || cfb.stream('EncryptionInfo')) {
    throw new Error('该文件是加密的 OOXML 容器，请用 parse(input, { password })');
  }

  let doc = cfb.stream('PowerPoint Document');
  if (!doc) throw new Error('无效的 .ppt：找不到 PowerPoint Document 流');

  // 老式 .ppt 的 RC4 CryptoAPI 加密。判据在 Current User 流的 headerToken 上，
  // 不看这一处就只会得到「.ppt 中未找到幻灯片」——实测 POI 语料里 5 个加密文件
  // 全都被这样误诊过。
  const currentUser = cfb.stream('Current User');
  if (isPptEncrypted(currentUser) && currentUser) {
    const decrypt = getPptDecryptor();
    if (!decrypt) throw new Error('该 .ppt 已加密，但未注入解密器（setPptDecryptor）');
    if (password === undefined) throw new Error('该 .ppt 已加密，请通过 parse(input, { password }) 提供打开密码');
    const plain = decrypt(doc, currentUser, password);
    if (!plain) throw new Error('该 .ppt 已加密，但加密结构无法识别');
    doc = plain;
  }
  const dv = new DataView(doc.buffer, doc.byteOffset, doc.byteLength);

  let width = 720 * (96 / 72);
  let height = 540 * (96 / 72);

  // 图片
  const pictures = cfb.stream('Pictures');
  const blips = pictures ? extractBlips(pictures) : [];
  const blobs = blips.map((b) => {
    try {
      // 图元文件浏览器无法直接解码，转成 SVG data URI。
      // PICT 是 Mac 版存的，同样要走解码器——直接丢给 <img> 只会是裂图
      if (b.mime === 'image/emf' || b.mime === 'image/wmf' || b.mime === 'image/pict') {
        return metafileDataUrl(b.data);
      }
      return URL.createObjectURL(new Blob([b.data.slice().buffer], { type: b.mime }));
    } catch {
      return null;
    }
  });

  // 顶层记录索引：持久化目录里的偏移是记录头的位置
  const byOffset = new Map<number, Rec>();
  const topLevel: Rec[] = [];
  for (const r of records(dv, 0, doc.length)) {
    byOffset.set(r.start - 8, r);
    topLevel.push(r);
  }

  // 字体表与 Environment 的全局默认文本样式
  const fonts: string[] = [];
  const envStyles: MasterStyles = new Map();
  const docRec = findRec(dv, 0, doc.length, RT.Document);
  const scan = (start: number, end: number, depth: number): void => {
    for (const r of records(dv, start, end)) {
      if (r.type === RT.DocumentAtom && r.len >= 8) {
        width = dv.getInt32(r.start, true) * MASTER_TO_PX;
        height = dv.getInt32(r.start + 4, true) * MASTER_TO_PX;
      } else if (r.type === RT.FontEntityAtom) {
        const name = utf16(dv, r.start, Math.min(r.len, 64)).replace(/\0.*$/, '');
        // recInstance 即字体索引；异常时退回追加顺序
        if (name) fonts[r.instance < 512 ? r.instance : fonts.length] = name;
      } else if (r.type === RT.TxMasterStyleAtom) {
        parseTxMasterStyle(dv, r, envStyles);
      }
      if (r.isContainer && depth < 4) scan(r.start, r.start + r.len, depth + 1);
    }
  };
  if (docRec) scan(docRec.start, docRec.start + docRec.len, 0);

  const shared: Shared = { fonts, blobs, scale: MASTER_TO_PX, envStyles, edit };
  const offsets = persistOffsets(dv, doc.length);

  // 幻灯片 / 母版 / 备注：优先按持久化目录的顺序，缺失时退回文档顺序
  const byType = (type: number): Rec[] => topLevel.filter((r) => r.type === type);
  let slideEntries = docRec ? persistList(dv, docRec, 0, offsets, byOffset, [RT.Slide]) : [];
  if (!slideEntries.length) slideEntries = byType(RT.Slide).map((rec) => ({ rec, slideId: 0 }));
  const masterEntries = docRec ? persistList(dv, docRec, 1, offsets, byOffset, [RT.MainMaster, RT.Slide]) : [];
  const notesEntries = docRec ? persistList(dv, docRec, 2, offsets, byOffset, [RT.Notes]) : [];

  const masterCache = new Map<number, MasterInfo>();
  const masterById = new Map<number, Rec>();
  for (const m of masterEntries) masterById.set(m.slideId, m.rec);
  const fallbackMaster = masterEntries[0]?.rec ?? byType(RT.MainMaster)[0] ?? null;
  const masterFor = (id: number): MasterInfo | null => {
    const rec = masterById.get(id) ?? fallbackMaster;
    if (!rec) return null;
    const key = rec.start;
    let info = masterCache.get(key);
    if (!info) {
      info = parseMaster(dv, rec, shared);
      masterCache.set(key, info);
    }
    return info;
  };

  // 备注：先按 notesIdRef 关联，取不到时退回 NotesAtom.slideIdRef 反查
  const notesById = new Map<number, Rec>();
  for (const n of notesEntries) notesById.set(n.slideId, n.rec);
  const notesBySlideId = new Map<number, Rec>();
  for (const rec of byType(RT.Notes)) {
    const atom = findRec(dv, rec.start, rec.start + rec.len, RT.NotesAtom);
    if (atom && atom.len >= 4) notesBySlideId.set(dv.getUint32(atom.start, true), rec);
  }

  const hyperlinks = docRec ? collectHyperlinks(dv, docRec) : new Map<number, string>();

  const count = slideEntries.length;
  let slides: Slide[] = slideEntries.map((entry, i) => {
    const atom = findRec(dv, entry.rec.start, entry.rec.start + entry.rec.len, RT.SlideAtom);
    const masterIdRef = atom && atom.len >= 24 ? dv.getUint32(atom.start + 12, true) : 0;
    const notesIdRef = atom && atom.len >= 24 ? dv.getUint32(atom.start + 16, true) : 0;
    // [MS-PPT] SlideFlags：bit0 = 跟随母版图形，bit2 = 跟随母版背景
    const flags = atom && atom.len >= 24 ? dv.getUint16(atom.start + 20, true) : 0x7;
    const notes = notesById.get(notesIdRef) ?? notesBySlideId.get(entry.slideId) ?? null;
    return parseSlide(dv, entry.rec, shared, {
      master: masterFor(masterIdRef),
      followMasterObjects: (flags & 0x1) !== 0,
      followMasterBackground: (flags & 0x4) !== 0,
      notes: notes ? notesText(dv, notes) : '',
      hyperlinks,
      index: i + 1,
      count,
    });
  });

  // 兜底：没有 Slide 容器（或图形树为空）时，退回 SlideListWithText 的纯文本
  if (!slides.length || slides.every((s) => !s.elements.length)) {
    const textOnly = slidesFromTextList(dv, doc.length, width, height);
    if (textOnly.length) slides = textOnly;
  }

  if (!slides.length) throw new Error('.ppt 中未找到幻灯片');
  const editAssets = edit ? blobs.flatMap((url, index) => {
    const blip = url?.startsWith('blob:') ? blips[index] : undefined;
    return url && blip ? [{ url, mime: blip.mime, bytes: blip.data.slice() }] : [];
  }) : [];
  let disposed = false;
  return {
    width, height, slides, source: 'ppt',
    ...(edit ? { editInfo: { layouts: [], assets: editAssets } } : {}),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const url of blobs) if (url?.startsWith('blob:')) {
        try { URL.revokeObjectURL(url); } catch { /* data URI 与已释放 URL 无需处理。 */ }
      }
    },
  };
}

/**
 * 兜底路径：只从 SlideListWithText 抽文本，按标题 / 正文两个文本框排版。
 * 用于图形树缺失或非常规结构的文件，保证至少能读到内容。
 */
function slidesFromTextList(dv: DataView, docLen: number, width: number, height: number): Slide[] {
  const listRec = (function find(start: number, end: number, depth: number): Rec | null {
    for (const r of records(dv, start, end)) {
      if (r.type === RT.SlideListWithText && r.instance === 0) return r;
      if (r.isContainer && depth < 4) {
        const hit = find(r.start, r.start + r.len, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  })(0, docLen, 0);
  if (!listRec) return [];

  const out: { titles: string[]; bodies: string[] }[] = [];
  let cur: { titles: string[]; bodies: string[] } | null = null;
  let txType = 4;
  for (const r of records(dv, listRec.start, listRec.start + listRec.len)) {
    if (r.type === RT.SlidePersistAtom) {
      cur = { titles: [], bodies: [] };
      out.push(cur);
    } else if (r.type === RT.TextHeaderAtom && r.len >= 4) {
      txType = dv.getUint32(r.start, true);
    } else if (cur && (r.type === RT.TextCharsAtom || r.type === RT.TextBytesAtom)) {
      const text = r.type === RT.TextCharsAtom ? utf16(dv, r.start, r.len) : ansi(dv, r.start, r.len);
      (txType === 0 || txType === 6 ? cur.titles : cur.bodies).push(text);
    }
  }

  const mkRun = (text: string, size: number, b: boolean, color: string): TextRun => ({
    text, b, i: false, u: false, strike: false, size, color, fonts: [],
  });
  const mkPara = (runs: TextRun[], bullet: string | null): Paragraph => ({
    align: 'left', lvl: 0, marL: bullet ? 24 : 0, indent: bullet ? -24 : 0,
    bullet, lineHeight: null, spaceBefore: 0, spaceAfter: 6, runs,
  });
  const splitLines = (t: string): string[] => t.split(/[\r\n\v]/).map((x) => x.trim()).filter(Boolean);

  return out
    .filter((s) => s.titles.length || s.bodies.length)
    .map((s): Slide => {
      const elements: ShapeElement[] = [];
      if (s.titles.length) {
        elements.push({
          kind: 'shape', x: width * 0.06, y: height * 0.05, w: width * 0.88, h: height * 0.16,
          rot: 0, flipH: false, flipV: false, path: null, fill: null, stroke: null,
          text: {
            anchor: 'middle', insets: [4, 8, 4, 8], wrap: true, fontScale: 1,
            paragraphs: s.titles.flatMap((t) => splitLines(t).map((l) => mkPara([mkRun(l, 34, true, 'rgb(30,30,30)')], null))),
          },
        });
      }
      if (s.bodies.length) {
        elements.push({
          kind: 'shape', x: width * 0.06, y: height * 0.24, w: width * 0.88, h: height * 0.68,
          rot: 0, flipH: false, flipV: false, path: null, fill: null, stroke: null,
          text: {
            anchor: 'top', insets: [4, 8, 4, 8], wrap: true, fontScale: 1,
            paragraphs: s.bodies.flatMap((t) => splitLines(t).map((l) => mkPara([mkRun(l, 20, false, 'rgb(50,50,50)')], '•'))),
          },
        });
      }
      return { background: { type: 'solid', color: 'rgb(255,255,255)' }, elements };
    });
}

/** 一页所继承的母版信息与关联内容 */
interface SlideEnv {
  master: MasterInfo | null;
  followMasterObjects: boolean;
  followMasterBackground: boolean;
  notes: string;
  hyperlinks: Map<number, string>;
  index: number;
  count: number;
}

function parseSlide(dv: DataView, slideRec: Rec, shared: Shared, env: SlideEnv): Slide {
  const end = slideRec.start + slideRec.len;
  const scheme = readScheme(dv, slideRec, 1) ?? env.master?.scheme ?? DEFAULT_SCHEME;

  // 幻灯片内的文本列表（占位符文本按 TextHeaderAtom 顺序）
  const listText: StyledText[] = [];
  let pendingStyle: Rec | null = null;
  let pendingText: string | null = null;
  let pendingType: number | undefined;
  const flush = (): void => {
    if (pendingText === null) return;
    const st = pendingStyle ? parseStyleTextProp(dv, pendingStyle, pendingText.length) : { para: [], char: [] };
    listText.push({ text: pendingText, paraProps: st.para, charProps: st.char, textType: pendingType });
    pendingText = null;
    pendingStyle = null;
    pendingType = undefined;
  };
  for (const r of records(dv, slideRec.start, end)) {
    if (r.type === RT.TextHeaderAtom) {
      flush();
      if (r.len >= 4) pendingType = dv.getUint32(r.start, true);
    } else if (r.type === RT.TextCharsAtom) pendingText = utf16(dv, r.start, r.len);
    else if (r.type === RT.TextBytesAtom) pendingText = ansi(dv, r.start, r.len);
    else if (r.type === RT.StyleTextPropAtom) pendingStyle = r;
  }
  flush();

  // 超链接目标按当前页序号归一（「下一页」「末页」这类跳转与页码相关）
  const links = new Map<number, string>();
  for (const [id, target] of env.hyperlinks) {
    const resolved = resolveLink(target, env.index, env.count);
    if (resolved) links.set(id, resolved);
  }

  const ctx: Ctx = {
    dv, scheme, fonts: shared.fonts, blobs: shared.blobs, listText, scale: shared.scale,
    styles: env.master?.styles ?? new Map(), envStyles: shared.envStyles, links,
    masterPass: false, levelCache: new Map(), slideIndex: env.index, slideCount: env.count,
    autoNums: collectAutoNums(dv, slideRec), autoNumCursor: 0,
    edit: shared.edit,
  };

  // 母版图形垫在最底层，其次才是本页自己的图形
  const elements: SlideElement[] = [];
  if (env.master && env.followMasterObjects) elements.push(...env.master.elements);
  const drawing = findRec(dv, slideRec.start, end, RT.PPDrawing);
  if (drawing) elements.push(...drawingElements(ctx, drawing));

  // 背景：本页自带的背景形状 → 母版背景 → 配色方案第 0 项
  const blipUrl = (idx: number): string | null => shared.blobs[idx - 1] ?? null;
  const own = drawing ? drawingBackground(dv, drawing, scheme, blipUrl) : null;
  const inherited = env.followMasterBackground ? env.master?.background ?? null : null;
  const background: Fill = inherited ?? own ?? { type: 'solid', color: escherColor(0x08000000, scheme) };

  // 放映信息：隐藏标记、切换效果、动画
  const show = parseSlideShowInfo(dv, slideRec);
  const transition: Transition | undefined = show?.transition;
  const animations: AnimStep[] | undefined = parseAnimations(dv, slideRec);

  return {
    background,
    elements,
    notes: env.notes || undefined,
    hidden: show?.hidden ? true : undefined,
    transition,
    animations,
  };
}
