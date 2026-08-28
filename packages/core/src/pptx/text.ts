import { textRunDirectFlags, TEXT_RUN_DIRECT_BITS } from '../edit-metadata';
import type {
  Paragraph, TextBody, TextRun, TextWarp,
} from '../types';
import type { TextFontSlots, TextRunDirectFlags } from '../edit-metadata';
import { attr, boolAttr, emu, kid, kids, numAttr, pt100 } from '../xml';
import { ColorCtx, childColor } from './color';
import { mathPlainText, parseOmml } from './omml';
import { mergeParagraphProps, resolveParagraphLevel } from './paragraph-props';
import { materializeParagraph } from './text-materialization';
import { directTextBodyProperties, parseTextBodyLayout } from './text-body';

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
  uColor?: string | null;
  strike?: boolean;
  color?: string;
  gradient?: string | null;
  latin?: string;
  ea?: string;
  /** 复杂脚本字体（阿拉伯语 / 希伯来语 / 泰语 / 天城文等），缺失会导致回退到拉丁字体 */
  cs?: string;
  baseline?: number;
  spc?: number;
  caps?: 'none' | 'all' | 'small';
  outline?: { color: string; width: number } | null;
  highlight?: string | null;
  link?: string;
}

export interface ParaProps {
  lvl?: number;
  algn?: string;
  marL?: number;
  indent?: number;
  bullet?: Bullet;
  buColor?: string | null;
  buFont?: string | null;
  buSizePct?: number | null;
  buSizePts?: number;
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
  /** 编辑模式才保留继承格式元数据，普通解析与渲染零增量。 */
  edit?: boolean;
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
  return parseParaPropsDetailed(pPr, ctx, fonts).props;
}

export function parseParaPropsDetailed(
  pPr: Element | null,
  ctx: ColorCtx,
  fonts: ThemeFonts,
): { props: ParaProps; directRun: TextRunDirectFlags } {
  const out: ParaProps = { rp: {} };
  if (!pPr) return { props: out, directRun: textRunDirectFlags(0) };
  const lvl = numAttr(pPr, 'lvl');
  if (lvl !== null) out.lvl = lvl;
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
  const buClr = kid(pPr, 'buClr');
  if (buClr) out.buColor = childColor(buClr, ctx) ?? null;
  else if (kid(pPr, 'buClrTx')) out.buColor = null;
  const buFont = kid(pPr, 'buFont');
  if (buFont) out.buFont = attr(buFont, 'typeface');
  else if (kid(pPr, 'buFontTx')) out.buFont = null;
  const buSz = numAttr(kid(pPr, 'buSzPct'), 'val');
  if (buSz !== null) out.buSizePct = buSz / 100000;
  else {
    const buSzPts = numAttr(kid(pPr, 'buSzPts'), 'val');
    if (buSzPts !== null) out.buSizePts = pt100(buSzPts);
    else if (kid(pPr, 'buSzTx')) out.buSizePct = null;
  }

  const defRPr = kid(pPr, 'defRPr');
  const parsedRun = parseRunPropsDetailed(defRPr, ctx, fonts);
  out.rp = parsedRun.props;
  return { props: out, directRun: parsedRun.direct };
}

export function parseRunProps(rPr: Element | null, ctx: ColorCtx, fonts: ThemeFonts): RunProps {
  return parseRunPropsDetailed(rPr, ctx, fonts).props;
}

export function parseRunPropsDetailed(
  rPr: Element | null,
  ctx: ColorCtx,
  fonts: ThemeFonts,
): { props: RunProps; direct: TextRunDirectFlags } {
  const out: RunProps = {};
  let bits = 0;
  if (!rPr) return { props: out, direct: textRunDirectFlags(bits) };
  const sz = numAttr(rPr, 'sz');
  if (sz !== null) { out.sz = sz; bits |= TEXT_RUN_DIRECT_BITS.size; }
  if (attr(rPr, 'b') !== null) { out.b = boolAttr(rPr, 'b'); bits |= TEXT_RUN_DIRECT_BITS.b; }
  if (attr(rPr, 'i') !== null) { out.i = boolAttr(rPr, 'i'); bits |= TEXT_RUN_DIRECT_BITS.i; }
  const u = attr(rPr, 'u');
  if (u !== null) { out.u = u !== 'none'; bits |= TEXT_RUN_DIRECT_BITS.u; }
  const strike = attr(rPr, 'strike');
  if (strike !== null) { out.strike = strike !== 'noStrike'; bits |= TEXT_RUN_DIRECT_BITS.strike; }
  const baseline = numAttr(rPr, 'baseline');
  if (baseline !== null) { out.baseline = baseline / 1000; bits |= TEXT_RUN_DIRECT_BITS.baseline; }
  const spc = numAttr(rPr, 'spc');
  if (spc !== null) { out.spc = pt100(spc); bits |= TEXT_RUN_DIRECT_BITS.spacing; }
  const cap = attr(rPr, 'cap');
  if (cap) {
    out.caps = cap === 'all' ? 'all' : cap === 'small' ? 'small' : 'none';
    bits |= TEXT_RUN_DIRECT_BITS.caps;
  }

  const solidFill = kid(rPr, 'solidFill');
  const color = childColor(solidFill, ctx);
  if (color) out.color = color;
  if (solidFill) out.gradient = null;
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
  if (kid(rPr, 'noFill')) {
    out.color = 'transparent';
    out.gradient = null;
  }
  if (solidFill || grad || ['noFill', 'blipFill', 'pattFill', 'grpFill']
    .some((name) => !!kid(rPr, name))) {
    bits |= TEXT_RUN_DIRECT_BITS.color | TEXT_RUN_DIRECT_BITS.gradient;
  }
  if (!solidFill && !grad && ['blipFill', 'pattFill', 'grpFill']
    .some((name) => !!kid(rPr, name))) {
    out.color = 'transparent';
    out.gradient = null;
  }
  const uFill = childColor(kid(rPr, 'uFill'), ctx) ?? childColor(kid(kid(rPr, 'uFill'), 'solidFill'), ctx);
  if (uFill) out.uColor = uFill;
  if (kid(rPr, 'uFillTx') || kid(rPr, 'uFill') && !uFill) out.uColor = null;
  if (kid(rPr, 'uFillTx') || kid(rPr, 'uFill')) bits |= TEXT_RUN_DIRECT_BITS.underlineColor;
  const highlight = kid(rPr, 'highlight');
  if (highlight) out.highlight = childColor(highlight, ctx) ?? null;
  if (highlight) bits |= TEXT_RUN_DIRECT_BITS.highlight;

  const ln = kid(rPr, 'ln');
  if (kid(ln, 'noFill')) out.outline = null;
  else if (ln) {
    const lc = childColor(kid(ln, 'solidFill'), ctx);
    if (lc) out.outline = { color: lc, width: emu(numAttr(ln, 'w') ?? 9525) };
    else out.outline = null;
  }
  if (ln) bits |= TEXT_RUN_DIRECT_BITS.outline;

  const latinNode = kid(rPr, 'latin');
  const latin = resolveFont(attr(latinNode, 'typeface'), fonts);
  if (latin) out.latin = latin;
  if (attr(latinNode, 'typeface') !== null) bits |= TEXT_RUN_DIRECT_BITS.fontLatin;
  const eaNode = kid(rPr, 'ea');
  const ea = resolveFont(attr(eaNode, 'typeface'), fonts);
  if (ea) out.ea = ea;
  if (attr(eaNode, 'typeface') !== null) bits |= TEXT_RUN_DIRECT_BITS.fontEastAsian;
  const csNode = kid(rPr, 'cs');
  const cs = resolveFont(attr(csNode, 'typeface'), fonts);
  if (cs) out.cs = cs;
  if (attr(csNode, 'typeface') !== null) bits |= TEXT_RUN_DIRECT_BITS.fontComplexScript;
  return { props: out, direct: textRunDirectFlags(bits) };
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

export function parseTextBody(txBody: Element | null, env: TextEnv, includeEmpty = false): TextBody | null {
  if (!txBody) return null;
  const bodyPr = kid(txBody, 'bodyPr');
  const bodyPrs = [bodyPr, ...(env.bodyPrFallbacks ?? [])];
  const layout = parseTextBodyLayout(bodyPrs);
  const hasBodyFallback = (env.bodyPrFallbacks ?? []).some(Boolean);
  // 普通预览是热路径；只有编辑清除直设时才需要单独求一次回退值。
  const inheritedLayout = env.edit && hasBodyFallback
    ? parseTextBodyLayout(bodyPrs.slice(1)) : undefined;

  const counters: number[] = [];
  const paragraphs: Paragraph[] = [];
  let hasContent = false;

  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr');
    const lvl = numAttr(pPr, 'lvl') ?? 0;
    const inherited = resolveParagraphLevel(env.chain, lvl);
    const parsedParagraph = parseParaPropsDetailed(pPr, env.ctx, env.fonts);
    const direct = parsedParagraph.props;
    const merged = mergeParagraphProps(inherited, direct);

    const runs: TextRun[] = [];
    const collectRuns = (parent: Element, depth: number): void => {
    for (let node = parent.firstElementChild; node; node = node.nextElementSibling) {
      if (node.localName === 'r' || node.localName === 'fld') {
        const rPr = kid(node, 'rPr');
        const parsedRun = parseRunPropsDetailed(rPr, env.ctx, env.fonts);
        const rp = mergeRun(merged.rp, parsedRun.props);
        const hlink = kid(rPr, 'hlinkClick');
        let readonlyLink = false;
        if (hlink && env.resolveLink) {
          const url = env.resolveLink(attr(hlink, 'r:id') ?? '', attr(hlink, 'action'));
          if (url) rp.link = url;
          else readonlyLink = true;
        }
        let text = kid(node, 't')?.textContent ?? '';
        if (node.localName === 'fld' && !text) text = fieldText(attr(node, 'type'), env);
        const run = finalizeRun(text, rp, env, merged.rp, parsedRun.direct);
        if (env.edit && readonlyLink && run.editInfo) run.editInfo = { ...run.editInfo, readonlyLink: true };
        runs.push(node.localName === 'fld'
          ? { ...run, field: attr(node, 'type') ?? 'unknown' }
          : run);
        if (text.trim()) hasContent = true;
      } else if (node.localName === 'br') {
        // a:br 自带 rPr；忽略它会让带格式硬换行保存重开后退回段落默认字符格式。
        const rPr = kid(node, 'rPr');
        const parsedRun = parseRunPropsDetailed(rPr, env.ctx, env.fonts);
        const rp = mergeRun(merged.rp, parsedRun.props);
        runs.push(finalizeRun('\n', rp, env, merged.rp, parsedRun.direct));
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
          const run = finalizeRun(text, { ...merged.rp, i: true }, env, merged.rp);
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
      const parsedRun = parseRunPropsDetailed(endRPr, env.ctx, env.fonts);
      runs.push(finalizeRun(
        '', mergeRun(merged.rp, parsedRun.props), env, merged.rp, parsedRun.direct,
      ));
    }

    paragraphs.push(materializeParagraph({
      lvl,
      resolved: merged,
      inherited,
      direct,
      directRun: parsedParagraph.directRun,
      runs,
      counters,
      lnSpcReduction: layout.lnSpcReduction ?? 0,
      env,
    }));
  }

  // 编辑解析必须保留空段落及 endParaRPr 的格式入口；普通查看仍把它收敛成 null，避免空形状生成 DOM。
  if (!hasContent && !includeEmpty) return null;
  return {
    ...layout,
    paragraphs,
    warp: parseWarp(bodyPrs),
    ...(env.edit ? { editInfo: {
      direct: directTextBodyProperties(bodyPr),
      ...(inheritedLayout ? { inherited: inheritedLayout } : {}),
    } } : {}),
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

function effectiveFontSlots(rp: RunProps, env: TextEnv): TextFontSlots {
  // run 里没写 a:latin 不等于「没有字体」——ECMA-376 的继承链走到最后落在
  // 主题的 minorFont 上。不补这一层，渲染会掉到 CSS 的通用回退（Helvetica）
  // 上，字宽与 PowerPoint 对不齐；collectFonts 也会以为这份文件没用字体。
  return {
    latin: rp.latin ?? env.fonts.minor.latin,
    eastAsian: rp.ea ?? env.fonts.minor.ea,
    complexScript: rp.cs ?? env.fonts.minor.cs ?? null,
  };
}

function fontStack(slots: TextFontSlots): string[] {
  const { latin, eastAsian: ea, complexScript: cs } = slots;

  // 字体栈按 latin → ea → cs 排，浏览器会逐个回退直到找到含该字形的字体
  const fonts: string[] = [];
  if (latin) fonts.push(latin);
  if (ea && ea !== latin) fonts.push(ea);
  if (cs && cs !== latin && cs !== ea) fonts.push(cs);
  return fonts;
}

function effectiveFonts(rp: RunProps, env: TextEnv): string[] {
  return fontStack(effectiveFontSlots(rp, env));
}

function inheritedRunProps(rp: RunProps, env: TextEnv): NonNullable<TextRun['editInfo']>['inheritedRunProps'] {
  return {
    b: rp.b ?? false,
    i: rp.i ?? false,
    u: rp.u ?? false,
    strike: rp.strike ?? false,
    size: pt100(rp.sz ?? 1800),
    color: rp.color ?? env.defaultColor ?? 'rgb(0,0,0)',
    fonts: effectiveFonts(rp, env),
    baseline: rp.baseline || undefined,
    spacing: rp.spc || undefined,
    caps: rp.caps && rp.caps !== 'none' ? rp.caps : undefined,
    outline: rp.outline ?? null,
    gradient: rp.gradient ?? null,
    highlight: rp.highlight ?? null,
    underlineColor: rp.uColor ?? null,
  };
}

export function finalizeRun(
  text: string,
  rp: RunProps,
  env: TextEnv,
  inherited?: RunProps,
  direct: TextRunDirectFlags = textRunDirectFlags(0),
): TextRun {
  const fontSlots = effectiveFontSlots(rp, env);
  const fonts = fontStack(fontSlots);
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
    baseline: rp.baseline || undefined,
    spacing: rp.spc || undefined,
    caps: rp.caps && rp.caps !== 'none' ? rp.caps : undefined,
    outline: rp.outline ?? null,
    gradient: rp.gradient ?? null,
    link: rp.link,
    highlight: rp.highlight ?? null,
    underlineColor: rp.uColor ?? null,
    ...(env.edit && inherited ? { editInfo: {
      inheritedRunProps: inheritedRunProps(inherited, env),
      direct,
      fontSlots,
    } } : {}),
  };
}
