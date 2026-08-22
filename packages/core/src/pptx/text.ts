import type { Paragraph, TextBody, TextRun, TextVert, TextWarp } from '../types';
import { attr, boolAttr, emu, kid, kids, numAttr, pt100 } from '../xml';
import { ColorCtx, childColor } from './color';
import { mathPlainText, parseOmml } from './omml';

/**
 * 文本样式继承链：
 * 文档默认(defaultTextStyle) ← 母版 txStyles ← 母版占位符 lstStyle ← 版式占位符 lstStyle ← 形状 lstStyle ← 段落 pPr ← run rPr
 */

export type Bullet =
  | { kind: 'none' }
  | { kind: 'char'; char: string; font: string | null }
  | { kind: 'auto'; scheme: string; startAt: number }
  | { kind: 'image'; rid: string };

export interface RunProps {
  sz?: number;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  uColor?: string;
  strike?: boolean;
  color?: string;
  gradient?: string;
  latin?: string;
  ea?: string;
  /** 复杂脚本字体（阿拉伯语 / 希伯来语 / 泰语 / 天城文等），缺失会导致回退到拉丁字体 */
  cs?: string;
  baseline?: number;
  spc?: number;
  caps?: 'none' | 'all' | 'small';
  outline?: { color: string; width: number };
  highlight?: string;
  link?: string;
}

export interface ParaProps {
  algn?: string;
  marL?: number;
  indent?: number;
  bullet?: Bullet;
  buColor?: string;
  buFont?: string;
  buSizePct?: number;
  lnPct?: number;
  lnPx?: number;
  spcBef?: number;
  spcAft?: number;
  rtl?: boolean;
  rp: RunProps;
}

export interface LevelStyles {
  def?: ParaProps;
  lvls: (ParaProps | undefined)[];
}

export interface ThemeFonts {
  major: { latin: string | null; ea: string | null; cs?: string | null };
  minor: { latin: string | null; ea: string | null; cs?: string | null };
}

export interface TextEnv {
  ctx: ColorCtx;
  fonts: ThemeFonts;
  chain: LevelStyles[];
  defaultColor?: string | null;
  slideNum: number;
  /** bodyPr 继承回退：版式 → 母版 */
  bodyPrFallbacks?: (Element | null)[];
  /** relId → 超链接 URL 或 slide:<n> */
  resolveLink?: (rid: string, action: string | null) => string | null;
  /** relId → 图片 blob URL（图片项目符号） */
  resolveImage?: (rid: string) => string | null;
  /** 页脚 / 日期占位符文本 */
  footerText?: string;
  dateText?: string;
}

export function extractLstStyle(el: Element | null, ctx: ColorCtx, fonts: ThemeFonts): LevelStyles {
  const out: LevelStyles = { lvls: [] };
  if (!el) return out;
  const def = kid(el, 'defPPr');
  if (def) out.def = parseParaProps(def, ctx, fonts);
  for (let i = 1; i <= 9; i++) {
    const lvl = kid(el, `lvl${i}pPr`);
    if (lvl) out.lvls[i - 1] = parseParaProps(lvl, ctx, fonts);
  }
  return out;
}

export function parseParaProps(pPr: Element | null, ctx: ColorCtx, fonts: ThemeFonts): ParaProps {
  const out: ParaProps = { rp: {} };
  if (!pPr) return out;
  const algn = attr(pPr, 'algn');
  if (algn) out.algn = algn;
  const marL = numAttr(pPr, 'marL');
  if (marL !== null) out.marL = emu(marL);
  const indent = numAttr(pPr, 'indent');
  if (indent !== null) out.indent = emu(indent);
  if (attr(pPr, 'rtl') !== null) out.rtl = boolAttr(pPr, 'rtl');

  const lnSpc = kid(pPr, 'lnSpc');
  const lnPct = numAttr(kid(lnSpc, 'spcPct'), 'val');
  if (lnPct !== null) out.lnPct = lnPct / 100000;
  const lnPts = numAttr(kid(lnSpc, 'spcPts'), 'val');
  if (lnPts !== null) out.lnPx = pt100(lnPts);
  const bef = numAttr(kid(kid(pPr, 'spcBef'), 'spcPts'), 'val');
  if (bef !== null) out.spcBef = pt100(bef);
  const aft = numAttr(kid(kid(pPr, 'spcAft'), 'spcPts'), 'val');
  if (aft !== null) out.spcAft = pt100(aft);

  if (kid(pPr, 'buNone')) out.bullet = { kind: 'none' };
  const buChar = kid(pPr, 'buChar');
  if (buChar) out.bullet = { kind: 'char', char: attr(buChar, 'char') ?? '•', font: attr(kid(pPr, 'buFont'), 'typeface') };
  const buAuto = kid(pPr, 'buAutoNum');
  if (buAuto) {
    out.bullet = {
      kind: 'auto',
      scheme: attr(buAuto, 'type') ?? 'arabicPeriod',
      startAt: numAttr(buAuto, 'startAt') ?? 1,
    };
  }
  const buBlip = kid(kid(pPr, 'buBlip'), 'blip');
  if (buBlip) {
    const rid = attr(buBlip, 'r:embed');
    if (rid) out.bullet = { kind: 'image', rid };
  }
  const buClr = childColor(kid(pPr, 'buClr'), ctx);
  if (buClr) out.buColor = buClr;
  const buFont = attr(kid(pPr, 'buFont'), 'typeface');
  if (buFont) out.buFont = buFont;
  const buSz = numAttr(kid(pPr, 'buSzPct'), 'val');
  if (buSz !== null) out.buSizePct = buSz / 100000;

  const defRPr = kid(pPr, 'defRPr');
  if (defRPr) out.rp = parseRunProps(defRPr, ctx, fonts);
  return out;
}

export function parseRunProps(rPr: Element | null, ctx: ColorCtx, fonts: ThemeFonts): RunProps {
  const out: RunProps = {};
  if (!rPr) return out;
  const sz = numAttr(rPr, 'sz');
  if (sz !== null) out.sz = sz;
  if (attr(rPr, 'b') !== null) out.b = boolAttr(rPr, 'b');
  if (attr(rPr, 'i') !== null) out.i = boolAttr(rPr, 'i');
  const u = attr(rPr, 'u');
  if (u !== null) out.u = u !== 'none';
  const strike = attr(rPr, 'strike');
  if (strike !== null) out.strike = strike !== 'noStrike';
  const baseline = numAttr(rPr, 'baseline');
  if (baseline !== null && baseline !== 0) out.baseline = baseline / 1000;
  const spc = numAttr(rPr, 'spc');
  if (spc !== null && spc !== 0) out.spc = pt100(spc);
  const cap = attr(rPr, 'cap');
  if (cap) out.caps = cap === 'all' ? 'all' : cap === 'small' ? 'small' : 'none';

  const color = childColor(kid(rPr, 'solidFill'), ctx);
  if (color) out.color = color;
  const grad = kid(rPr, 'gradFill');
  if (grad) {
    const stops = kids(kid(grad, 'gsLst'), 'gs')
      .map((gs) => ({ pos: (numAttr(gs, 'pos') ?? 0) / 100000, color: childColor(gs, ctx) ?? '#000' }))
      .sort((a, b) => a.pos - b.pos);
    if (stops.length) {
      const lin = kid(grad, 'lin');
      const deg = lin ? (numAttr(lin, 'ang') ?? 0) / 60000 + 90 : 180;
      out.gradient = `linear-gradient(${Math.round(deg)}deg,${stops.map((s) => `${s.color} ${Math.round(s.pos * 100)}%`).join(',')})`;
      if (!out.color) out.color = stops[0].color;
    }
  }
  const uFill = childColor(kid(rPr, 'uFill'), ctx) ?? childColor(kid(kid(rPr, 'uFill'), 'solidFill'), ctx);
  if (uFill) out.uColor = uFill;
  const hl = childColor(kid(rPr, 'highlight'), ctx);
  if (hl) out.highlight = hl;

  const ln = kid(rPr, 'ln');
  if (ln && !kid(ln, 'noFill')) {
    const lc = childColor(kid(ln, 'solidFill'), ctx);
    if (lc) out.outline = { color: lc, width: emu(numAttr(ln, 'w') ?? 9525) };
  }

  const latin = resolveFont(attr(kid(rPr, 'latin'), 'typeface'), fonts);
  if (latin) out.latin = latin;
  const ea = resolveFont(attr(kid(rPr, 'ea'), 'typeface'), fonts);
  if (ea) out.ea = ea;
  const cs = resolveFont(attr(kid(rPr, 'cs'), 'typeface'), fonts);
  if (cs) out.cs = cs;
  return out;
}

function resolveFont(tf: string | null, fonts: ThemeFonts): string | null {
  if (!tf) return null;
  if (tf === '+mj-lt') return fonts.major.latin;
  if (tf === '+mj-ea') return fonts.major.ea;
  if (tf === '+mj-cs') return fonts.major.cs ?? fonts.major.latin;
  if (tf === '+mn-lt') return fonts.minor.latin;
  if (tf === '+mn-ea') return fonts.minor.ea;
  if (tf === '+mn-cs') return fonts.minor.cs ?? fonts.minor.latin;
  return tf;
}

const mergeRun = (base: RunProps, over: RunProps): RunProps => ({ ...base, ...over });
const mergePara = (base: ParaProps, over: ParaProps): ParaProps => ({ ...base, ...over, rp: mergeRun(base.rp, over.rp) });

function resolveLevel(chain: LevelStyles[], lvl: number): ParaProps {
  let acc: ParaProps = { rp: {} };
  for (const style of chain) {
    if (style.def) acc = mergePara(acc, style.def);
    const l = style.lvls[lvl];
    if (l) acc = mergePara(acc, l);
  }
  return acc;
}

/** Wingdings / Symbol 常见项目符号字符映射到通用 Unicode */
const SYMBOL_BULLETS: Record<string, string> = {
  '': '▪', '': '•', '': '➢', '': '✓',
  '': '●', '': '◆', '': '□', '': '❖',
  '§': '▪', n: '▪', l: '●', u: '◆', p: '❑', v: '❖',
  w: '♦', 'Ø': '➢', 'ü': '✓', F: '☞', q: '❑',
};

function bulletText(bu: Bullet | undefined, counters: number[], lvl: number): string | null {
  if (!bu || bu.kind === 'none' || bu.kind === 'image') return null;
  if (bu.kind === 'char') {
    const mapped = SYMBOL_BULLETS[bu.char];
    if (mapped) return mapped;
    if (bu.font && /wingdings|webdings|symbol/i.test(bu.font)) return '•';
    return bu.char;
  }
  counters.length = lvl + 1;
  counters[lvl] = (counters[lvl] ?? bu.startAt - 1) + 1;
  return formatAutoNum(bu.scheme, counters[lvl]);
}

function formatAutoNum(scheme: string, num: number): string {
  let body: string;
  if (scheme.startsWith('alphaLc')) body = alpha(num).toLowerCase();
  else if (scheme.startsWith('alphaUc')) body = alpha(num);
  else if (scheme.startsWith('romanLc')) body = roman(num).toLowerCase();
  else if (scheme.startsWith('romanUc')) body = roman(num);
  else if (scheme.startsWith('circleNum')) body = circled(num);
  else body = String(num);
  if (scheme.endsWith('ParenBoth')) return `(${body})`;
  if (scheme.endsWith('ParenR')) return `${body})`;
  if (scheme.endsWith('Period')) return `${body}.`;
  return body;
}

function alpha(num: number): string {
  let s = '';
  while (num > 0) {
    s = String.fromCharCode(65 + ((num - 1) % 26)) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

function roman(num: number): string {
  const table: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, sym] of table) while (num >= v) { s += sym; num -= v; }
  return s;
}

const circled = (num: number): string => (num >= 1 && num <= 20 ? String.fromCharCode(0x2460 + num - 1) : String(num));

/** bodyPr/prstTxWarp → TextWarp；avLst 的 fmla 形如 "val 5400000" */
function parseWarp(bodyPrs: (Element | null)[]): TextWarp | undefined {
  for (const b of bodyPrs) {
    const el = kid(b, 'prstTxWarp');
    if (!el) continue;
    const preset = attr(el, 'prst');
    if (!preset || preset === 'textNoShape') return undefined;
    const adj: Record<string, number> = {};
    for (const gd of kids(kid(el, 'avLst'), 'gd')) {
      const name = attr(gd, 'name');
      const v = Number((attr(gd, 'fmla') ?? '').replace(/^val\s+/, ''));
      if (name && Number.isFinite(v)) adj[name] = v;
    }
    return { preset, adj };
  }
  return undefined;
}

/** 未显式指定行距时的倍数，与渲染层保持一致 */
export const DEFAULT_LINE_HEIGHT = 1.2;

const ALIGN: Record<string, Paragraph['align']> = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };
const VERT: Record<string, TextVert> = { horz: 'horz', vert: 'vert', vert270: 'vert270', wordArtVert: 'wordArtVert', eaVert: 'vert', mongolianVert: 'vert' };

export function parseTextBody(txBody: Element | null, env: TextEnv): TextBody | null {
  if (!txBody) return null;
  const bodyPr = kid(txBody, 'bodyPr');
  const bodyPrs = [bodyPr, ...(env.bodyPrFallbacks ?? [])];
  const attrOf = (name: string): string | null => {
    for (const b of bodyPrs) {
      const v = attr(b, name);
      if (v !== null) return v;
    }
    return null;
  };
  const anchorRaw = attrOf('anchor') ?? 't';
  const anchor: TextBody['anchor'] = anchorRaw === 'ctr' ? 'middle' : anchorRaw === 'b' ? 'bottom' : 'top';
  const ins = (name: string, dflt: number): number => {
    const v = attrOf(name);
    return v === null ? emu(dflt) : emu(Number(v));
  };
  const insets: TextBody['insets'] = [ins('tIns', 45720), ins('rIns', 91440), ins('bIns', 45720), ins('lIns', 91440)];
  const wrap = attrOf('wrap') !== 'none';

  let autofitEl: Element | null = null;
  let spAutoFit = false;
  for (const b of bodyPrs) {
    if (!b) continue;
    if (kid(b, 'normAutofit')) { autofitEl = kid(b, 'normAutofit'); break; }
    if (kid(b, 'spAutoFit')) { spAutoFit = true; break; }
  }
  const explicitScale = autofitEl ? numAttr(autofitEl, 'fontScale') : null;
  const fontScale = explicitScale !== null && explicitScale !== undefined ? explicitScale / 100000 : 1;
  const autoFitCompute = !!autofitEl && (explicitScale === null || explicitScale === undefined);
  const lnSpcReduction = autofitEl ? (numAttr(autofitEl, 'lnSpcReduction') ?? 0) / 100000 : 0;

  const vert = VERT[attrOf('vert') ?? 'horz'] ?? 'horz';
  const anchorCtr = attrOf('anchorCtr') === '1';
  const numCol = Number(attrOf('numCol') ?? '1');
  const spcCol = Number(attrOf('spcCol') ?? '0');

  const counters: number[] = [];
  const paragraphs: Paragraph[] = [];
  let hasContent = false;

  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr');
    const lvl = numAttr(pPr, 'lvl') ?? 0;
    const merged = mergePara(resolveLevel(env.chain, lvl), parseParaProps(pPr, env.ctx, env.fonts));

    const runs: TextRun[] = [];
    const collectRuns = (parent: Element, depth: number): void => {
    for (let node = parent.firstElementChild; node; node = node.nextElementSibling) {
      if (node.localName === 'r' || node.localName === 'fld') {
        const rPr = kid(node, 'rPr');
        const rp = mergeRun(merged.rp, parseRunProps(rPr, env.ctx, env.fonts));
        const hlink = kid(rPr, 'hlinkClick');
        if (hlink && env.resolveLink) {
          const url = env.resolveLink(attr(hlink, 'r:id') ?? '', attr(hlink, 'action'));
          if (url) rp.link = url;
        }
        let text = kid(node, 't')?.textContent ?? '';
        if (node.localName === 'fld' && !text) text = fieldText(attr(node, 'type'), env);
        runs.push(finalizeRun(text, rp, env));
        if (text.trim()) hasContent = true;
      } else if (node.localName === 'br') {
        runs.push(finalizeRun('\n', merged.rp, env));
      } else if (node.localName === 'AlternateContent') {
        // mc:AlternateContent 里 Choice 是新版内容、Fallback 是兼容内容，取其一即可
        const branch = kid(node, 'Choice') ?? kid(node, 'Fallback');
        if (branch && depth > 0) collectRuns(branch, depth - 1);
      } else if (node.localName === 'oMathPara' || node.localName === 'oMath') {
        // OMML：解析成格式无关的公式树，排版交给渲染层（排版要测文本宽度）。
        // text 字段保留线性文本，搜索与纯文本导出仍然可用。
        const math = parseOmml(node);
        const text = math.length ? mathPlainText(math) : mathText(node);
        if (math.length || text) {
          const run = finalizeRun(text, { ...merged.rp, i: true }, env);
          if (math.length) run.math = math;
          runs.push(run);
          hasContent = true;
        }
      } else if (depth > 0 && (node.localName === 'Choice' || node.localName === 'Fallback')) {
        collectRuns(node, depth - 1);
      }
    }
    };
    collectRuns(p, 4);
    if (runs.length === 0) {
      const endRPr = kid(p, 'endParaRPr');
      runs.push(finalizeRun('', mergeRun(merged.rp, parseRunProps(endRPr, env.ctx, env.fonts)), env));
    }

    const maxSize = Math.max(...runs.map((r) => r.size), 1);
    // spcPct 是「单倍行距」的百分比，而单倍行距是**字体的行高**（≈1.2em），不是字号。
    // 直接把 150% 当成 CSS 的 line-height:1.5 用，每行会矮两成。实测一份课件里
    // 150% 行距的文本框：PowerPoint 存的 spAutoFit 框高 164.7px，按 1.5 算只有
    // 137.6px，按 1.2×1.5 算是 163.2px —— 后者才对得上。
    let lineHeight: number | null = merged.lnPct !== undefined ? merged.lnPct * DEFAULT_LINE_HEIGHT : null;
    if (lineHeight === null && merged.lnPx) lineHeight = merged.lnPx / maxSize;
    // normAutofit 的行距压缩对默认行距同样生效——早期只在显式设过行距时才减，
    // 导致大多数自动缩放文本框的压缩量被静默丢弃。
    if (lnSpcReduction) lineHeight = Math.max(0.5, (lineHeight ?? DEFAULT_LINE_HEIGHT) - lnSpcReduction);

    const buImage = merged.bullet?.kind === 'image' && env.resolveImage ? env.resolveImage(merged.bullet.rid) : null;

    paragraphs.push({
      align: ALIGN[merged.algn ?? 'l'] ?? 'left',
      lvl,
      marL: merged.marL ?? 0,
      indent: merged.indent ?? 0,
      bullet: bulletText(merged.bullet, counters, lvl),
      lineHeight,
      spaceBefore: merged.spcBef ?? 0,
      spaceAfter: merged.spcAft ?? 0,
      runs,
      bulletColor: merged.buColor ?? null,
      bulletFont: merged.buFont ?? null,
      bulletSize: merged.buSizePct ?? null,
      bulletImage: buImage,
      rtl: merged.rtl,
    });
  }

  if (!hasContent) return null;
  return {
    anchor, insets, wrap, fontScale, paragraphs,
    ...(autoFitCompute ? { autoFitCompute: true } : {}),
    lnSpcReduction: lnSpcReduction || undefined,
    vert: vert !== 'horz' ? vert : undefined,
    anchorCtr: anchorCtr || undefined,
    autoFitShape: spAutoFit || undefined,
    columns: numCol > 1 ? numCol : undefined,
    columnGap: numCol > 1 ? emu(spcCol) : undefined,
    warp: parseWarp(bodyPrs),
  };
}

/** 取 OMML 子树里的线性文本（m:t 节点），保留必要的分隔 */
function mathText(el: Element): string {
  const parts: string[] = [];
  const walk = (n: Element, depth: number): void => {
    for (let c = n.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName === 't') parts.push(c.textContent ?? '');
      else if (depth > 0) walk(c, depth - 1);
    }
  };
  walk(el, 12);
  return parts.join('').trim();
}

function fieldText(type: string | null, env: TextEnv): string {
  if (!type) return '';
  if (type === 'slidenum') return String(env.slideNum);
  if (type.startsWith('datetime')) return env.dateText ?? new Date().toLocaleDateString();
  if (type === 'footer') return env.footerText ?? '';
  return '';
}

function finalizeRun(text: string, rp: RunProps, env: TextEnv): TextRun {
  // run 里没写 a:latin 不等于「没有字体」——ECMA-376 的继承链走到最后落在
  // 主题的 minorFont 上。不补这一层，渲染会掉到 CSS 的通用回退（Helvetica）
  // 上，字宽与 PowerPoint 对不齐；collectFonts 也会以为这份文件没用字体。
  const latin = rp.latin ?? env.fonts.minor.latin;
  const ea = rp.ea ?? env.fonts.minor.ea;
  const cs = rp.cs ?? env.fonts.minor.cs ?? null;

  // 字体栈按 latin → ea → cs 排，浏览器会逐个回退直到找到含该字形的字体
  const fonts: string[] = [];
  if (latin) fonts.push(latin);
  if (ea && ea !== latin) fonts.push(ea);
  if (cs && cs !== latin && cs !== ea) fonts.push(cs);
  const size = pt100(rp.sz ?? 1800);
  return {
    text,
    b: rp.b ?? false,
    i: rp.i ?? false,
    u: rp.u ?? false,
    strike: rp.strike ?? false,
    size,
    color: rp.color ?? env.defaultColor ?? 'rgb(0,0,0)',
    fonts,
    baseline: rp.baseline,
    spacing: rp.spc,
    caps: rp.caps && rp.caps !== 'none' ? rp.caps : undefined,
    outline: rp.outline ?? null,
    gradient: rp.gradient ?? null,
    link: rp.link,
    highlight: rp.highlight ?? null,
    underlineColor: rp.uColor ?? null,
  };
}
