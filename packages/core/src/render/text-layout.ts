import type { Paragraph, TextBody, TextRun } from '../types';
import { squeezeTotal } from './cjk-punct';
import { fontSize, mathOf, measureTextWidth } from './text-measure';
import type { TextMeasure } from './text-measure';
import type {
  TextLayout,
  TextLayoutLine,
  TextLayoutOptions,
} from './text-layout-types';
import { publicSegments } from './text-layout-carets';
import { warpSupported } from './text-warp-presets';

export type {
  TextLayout,
  TextLayoutCaret,
  TextLayoutLine,
  TextLayoutOptions,
  TextLayoutSegment,
} from './text-layout-types';
export type { TextMeasure } from './text-measure';

// ---------------- 断行 ----------------

export interface Token {
  text: string;
  run: TextRun;
  runIndex: number;
  from: number;
  to: number;
  bullet: boolean;
  atomic: boolean;
  width: number;
  /** 硬换行 */
  br: boolean;
  space: boolean;
  /** 全角标点的空半格，放不下时可以挤掉（见 cjk-punct.ts） */
  squeeze: number;
}

interface IndexedRun {
  run: TextRun;
  runIndex: number;
  bullet: boolean;
}

/** all-caps 可能把一个源字符展开成多个显示字符（ß → SS），同时保留 UTF-16 源边界。 */
function displayWithSource(run: TextRun): { text: string; starts: number[]; ends: number[] } {
  if (run.caps !== 'all') {
    const boundaries = Array.from({ length: run.text.length + 1 }, (_, i) => i);
    return { text: run.text, starts: boundaries, ends: boundaries };
  }
  let text = '';
  const starts: number[] = [0];
  const ends: number[] = [0];
  for (let from = 0; from < run.text.length;) {
    const cp = run.text.codePointAt(from)!;
    const source = String.fromCodePoint(cp);
    const to = from + source.length;
    const display = source.toUpperCase();
    const base = text.length;
    text += display;
    for (let i = 0; i <= display.length; i++) {
      starts[base + i] = i === display.length ? to : from;
      ends[base + i] = i === 0 ? from : to;
    }
    from = to;
  }
  return { text, starts, ends };
}

function tokenize(runs: IndexedRun[], scale: number, measurer?: TextMeasure): Token[] {
  const out: Token[] = [];
  for (const source of runs) {
    const { run, runIndex, bullet } = source;
    if (run.math?.length) {
      // 公式整体不可断行
      out.push({ text: run.text, run, runIndex, from: 0, to: run.text.length, bullet, atomic: true,
        width: measureTextWidth(run.text, run, scale, measurer), br: false, space: false, squeeze: 0 });
      continue;
    }
    const display = displayWithSource(run);
    const text = display.text;
    if (!text) continue;
    // 保留空格、按 CJK 逐字、按空白与拉丁词切分
    const pieces = text.matchAll(/\n|[^\S\n]+|[⺀-鿿가-퟿＀-｠　-〿]|[^\s⺀-鿿가-퟿＀-｠　-〿]+/g);
    for (const match of pieces) {
      const piece = match[0];
      const start = match.index;
      const end = start + piece.length;
      out.push({
        text: piece,
        run,
        runIndex,
        from: display.starts[start] ?? 0,
        to: display.ends[end] ?? run.text.length,
        bullet,
        atomic: false,
        width: piece === '\n' ? 0 : measureTextWidth(piece, run, scale, measurer),
        br: piece === '\n',
        space: /^[^\S\n]+$/.test(piece),
        squeeze: squeezeTotal(piece) * fontSize(run, scale),
      });
    }
  }
  return out;
}

export interface Seg {
  text: string;
  run: TextRun;
  runIndex?: number;
  from?: number;
  to?: number;
  bullet?: boolean;
  atomic?: boolean;
  tokens?: Token[];
  width: number;
}

export interface Line {
  segs: Seg[];
  width: number;
  size: number;
  /** 本行全角标点合计能挤掉多少 */
  squeeze: number;
  /** 本行确实挤了标点才放得下；渲染时要把位移做出来 */
  squeezed: boolean;
}

/** 行的实际占位宽度。挤压过的行要按挤压后算，否则居中 / 右对齐会偏 */
const lineWidth = (line: Line): number => (line.squeezed ? line.width - line.squeeze : line.width);

function pushSeg(line: Line, token: Token): void {
  const last = line.segs[line.segs.length - 1];
  if (last && last.run === token.run && last.to === token.from && last.bullet === token.bullet) {
    last.text += token.text;
    last.width += token.width;
    last.to = token.to;
    last.atomic ||= token.atomic;
    last.tokens!.push(token);
  } else {
    line.segs.push({ text: token.text, run: token.run, runIndex: token.runIndex,
      from: token.from, to: token.to, bullet: token.bullet, atomic: token.atomic,
      tokens: [token], width: token.width });
  }
  line.width += token.width;
  line.squeeze += token.squeeze;
  // 公式比正文高，行高得按它的实际高度算，否则上下行会咬在一起
  const mh = token.run.math?.length ? mathOf(token.run, 1) : null;
  line.size = Math.max(line.size, mh ? (mh.h + mh.d) / 1.2 : token.run.size);
}

function wrap(tokens: Token[], maxWidth: number, wrapOn: boolean, firstIndent: number): Line[] {
  const lines: Line[] = [];
  const blank = (): Line => ({ segs: [], width: 0, size: 0, squeeze: 0, squeezed: false });
  let line: Line = blank();
  let limit = Math.max(1, maxWidth - Math.max(0, firstIndent));

  const flush = (): void => {
    // 自然宽度放不下、挤掉标点的空半格才放得下 —— 那就挤
    line.squeezed = line.width > limit && line.width - line.squeeze <= limit;
    lines.push(line);
    line = blank();
    limit = Math.max(1, maxWidth);
  };

  for (const token of tokens) {
    if (token.br) {
      flush();
      continue;
    }
    // 挤压优先于断行：先看挤掉标点空半格后放不放得下，放不下才断
    const fits = line.width + token.width - (line.squeeze + token.squeeze) <= limit;
    if (wrapOn && line.width > 0 && !fits) {
      if (token.space) continue; // 行尾空格丢弃
      flush();
    }
    pushSeg(line, token);
  }
  flush();
  return lines;
}

/**
 * 这个段落在给定宽度下需要挤压标点才放得下吗。
 *
 * 供 HTML 路径使用：那条路的断行归浏览器管，我们只能**先判断**再决定要不要
 * 输出挤压标记。判断复用这里的分词与断行，两条路径的结论因此一致。
 */
export function paraNeedsSqueeze(p: Paragraph, maxWidth: number, scale: number, wrapOn: boolean): boolean {
  if (maxWidth <= 0 || !p.runs.some((run) => squeezeTotal(run.text) > 0)) return false;
  const runs = p.runs.map((run, runIndex) => ({ run, runIndex, bullet: false }));
  return wrap(tokenize(runs, scale), maxWidth, wrapOn, p.indent).some((l) => l.squeezed);
}

// ---------------- 渲染 ----------------

interface LaidPara {
  lines: Line[];
  para: Paragraph;
  before: number;
  after: number;
  lineHeights: number[];
}

const ANCHOR: Record<Paragraph['align'], string> = {
  left: 'start', center: 'middle', right: 'end', justify: 'start',
};

interface RenderItem {
  lp: LaidPara;
  line: LaidPara['lines'][number];
  paragraphIndex: number;
  li: number;
  /** 含段前/段后间距的整行占高，用于分栏时决定断点 */
  h: number;
  padTop: number;
}

/** 段落排版：把每段拆成行并算出行高。renderTextSvg 与自动缩放测量共用。 */
function layoutParagraphs(t: TextBody, boxW: number, scale: number, measurer?: TextMeasure): LaidPara[] {
  return t.paragraphs.map((p) => {
    const first = p.runs[0];
    const bulletRun: TextRun | null = p.bullet && first
      ? { ...first, text: `${p.bullet} `, size: first.size * (p.bulletSize ?? 1), color: p.bulletColor ?? first.color, u: false, strike: false }
      : null;
    const runs: IndexedRun[] = [
      ...(bulletRun ? [{ run: bulletRun, runIndex: -1, bullet: true }] : []),
      ...p.runs.map((run, runIndex) => ({ run, runIndex, bullet: false })),
    ];
    const avail = Math.max(1, boxW - Math.max(0, p.marL));
    const lines = wrap(tokenize(runs, scale, measurer), avail, t.wrap, p.indent);
    const lineHeights = lines.map((l) => {
      const base = (l.size || first?.size || 18) * scale;
      return base * (p.lineHeight ?? 1.2);
    });
    return { lines, para: p, before: p.spaceBefore, after: p.spaceAfter, lineHeights };
  });
}

/** 给定缩放比例下文本占用的总高度 */
function textHeight(t: TextBody, boxW: number, scale: number, measurer?: TextMeasure): number {
  return layoutParagraphs(t, boxW, scale, measurer).reduce(
    (sum, lp) => sum + lp.before + lp.after + lp.lineHeights.reduce((a, b) => a + b, 0),
    0,
  );
}

/**
 * `<a:normAutofit/>` 不带 fontScale 时由渲染器自行算缩放。
 *
 * PowerPoint 只在自己排过版后才把算好的 fontScale 写回文件；从其它工具存出、
 * 或缩放继承自版式的文件里，属性往往是缺的。此时若按标称字号渲染，文字会直接
 * 溢出版面——实测 8 个真实演讲文件共 229 处裸 normAutofit，仅 39 处带 fontScale。
 *
 * 二分求解而非按 PowerPoint 的离散档位（92.5% / 85% / …）：LibreOffice 用连续值，
 * 而它是本项目的保真基准。
 */
interface TextScaleOverrides {
  insets?: readonly [number, number, number, number];
  vert?: TextBody['vert'];
}

export function autoFitScale(
  t: TextBody,
  w: number,
  h: number,
  measurer?: TextMeasure,
  overrides: TextScaleOverrides = {},
): number {
  const [pt, pr, pb, pl] = overrides.insets ?? t.insets;
  const vert = overrides.vert ?? t.vert ?? 'horz';
  // 竖排先把行盒宽高交换；求解器必须使用与最终行盒相同的逻辑内容盒。
  const layoutW = vert === 'vert' || vert === 'wordArtVert' || vert === 'vert270' ? h : w;
  const layoutH = vert === 'vert' || vert === 'wordArtVert' || vert === 'vert270' ? w : h;
  const boxW = Math.max(1, layoutW - pl - pr);
  const boxH = Math.max(1, layoutH - pt - pb);
  if (textHeight(t, boxW, 1, measurer) <= boxH) return 1;

  let lo = MIN_AUTOFIT, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (textHeight(t, boxW, mid, measurer) <= boxH) lo = mid; else hi = mid;
  }
  return lo;
}

/** PowerPoint 的自动缩放下限也是 25% */
const MIN_AUTOFIT = 0.25;

/** TextBody 的最终字号比例；HTML、SVG 和公共行盒共用。 */
export function resolveTextScale(
  t: TextBody,
  w: number,
  h: number,
  measurer?: TextMeasure,
  overrides: TextScaleOverrides = {},
): number {
  const base = Number.isFinite(t.fontScale) && t.fontScale > 0 ? t.fontScale : 1;
  if (!t.autoFitCompute || t.autoFitShape) return base;
  return base * autoFitScale(t, w, h, measurer, overrides);
}

function flattenLayout(paragraphs: LaidPara[]): RenderItem[] {
  const items: RenderItem[] = [];
  paragraphs.forEach((lp, paragraphIndex) => {
    lp.lines.forEach((line, li) => {
      items.push({
        lp,
        line,
        paragraphIndex,
        li,
        h: lp.lineHeights[li] + (li === 0 ? lp.before : 0)
          + (li === lp.lines.length - 1 ? lp.after : 0),
        padTop: li === 0 ? lp.before : 0,
      });
    });
  });
  return items;
}

const itemsHeight = (items: RenderItem[]): number => items.reduce((sum, item) => sum + item.h, 0);

/**
 * 计算原生 SVG 文本路径实际使用的行盒与字符停靠点。
 *
 * 行与字符坐标位于逻辑排版空间；竖排调用方把 `transform` 同时应用到覆盖层和命中点。
 * `from/to/offset` 均为 TextRun.text 的 UTF-16 下标，可直接映射 DOM Range。
 */
export function layoutText(
  t: TextBody,
  w: number,
  h: number,
  opts: TextLayoutOptions = {},
): TextLayout {
  const vert = opts.vert ?? t.vert ?? 'horz';
  const scale = Number.isFinite(opts.scale) && opts.scale! > 0
    ? opts.scale!
    : resolveTextScale(t, w, h, opts.measureText, { insets: opts.insets, vert: opts.vert });
  const autoFit: TextLayout['autoFit'] = t.autoFitShape ? 'shape' : t.autoFitCompute ? 'normal' : 'none';

  if (vert === 'vert' || vert === 'wordArtVert' || vert === 'vert270') {
    const inner = layoutText({ ...t, vert: undefined }, h, w, {
      ...opts,
      vert: 'horz',
      scale,
    });
    const [, pr, , pl] = opts.insets ?? t.insets;
    // 竖排的物理高度就是内部横排的逻辑宽度；不可断的长词即使只有一行也会溢出。
    const overflowWidth = inner.lines.some((line) =>
      line.x < pl - 1e-9 || line.x + line.width > h - pr + 1e-9);
    return {
      ...inner,
      width: w,
      height: h,
      layoutWidth: h,
      layoutHeight: w,
      scale,
      autoFit,
      vert,
      transform: vert === 'vert270'
        ? [0, -1, 1, 0, 0, h]
        : [0, 1, -1, 0, w, 0],
      unwarped: warpSupported(t.warp?.preset),
      overflow: inner.overflow || overflowWidth,
    };
  }

  const [pt, pr, pb, pl] = opts.insets ?? t.insets;
  const boxW = Math.max(1, w - pl - pr);
  const columns = Math.max(1, Math.min(Math.floor(t.columns ?? 1), 16));
  const gap = t.columnGap ?? 0;
  const colW = columns === 1 ? boxW : Math.max(1, (boxW - gap * (columns - 1)) / columns);
  const items = flattenLayout(layoutParagraphs(t, colW, scale, opts.measureText));
  const buckets: RenderItem[][] = [[]];
  if (columns === 1) {
    buckets[0].push(...items);
  } else {
    const colH = Math.max(1, h - pt - pb);
    let used = 0;
    for (const item of items) {
      if (used > 0 && used + item.h > colH && buckets.length < columns) {
        buckets.push([]);
        used = 0;
      }
      buckets[buckets.length - 1].push(item);
      used += item.h;
    }
  }

  const anchor = opts.anchor ?? t.anchor;
  const lines: TextLayoutLine[] = [];
  buckets.forEach((bucket, columnIndex) => {
    let y = pt;
    const contentHeight = itemsHeight(bucket);
    if (anchor === 'middle') y = pt + Math.max(0, (h - pt - pb - contentHeight) / 2);
    else if (anchor === 'bottom') y = Math.max(pt, h - pb - contentHeight);
    const originX = pl + columnIndex * (colW + gap);

    for (const { lp, line, paragraphIndex, li, padTop } of bucket) {
      y += padTop;
      const height = lp.lineHeights[li];
      const baseline = y + height * 0.78;
      const indent = li === 0 ? lp.para.indent : 0;
      const left = originX + Math.max(0, lp.para.marL) + indent;
      const textAnchor = ANCHOR[lp.para.align];
      const anchorX = textAnchor === 'middle'
        ? originX + colW / 2
        : textAnchor === 'end' ? originX + colW : left;
      const width = lineWidth(line);
      const lineStart = textAnchor === 'middle'
        ? anchorX - width / 2
        : textAnchor === 'end' ? anchorX - width : anchorX;
      const rtl = lp.para.rtl === true;
      lines.push({
        paragraphIndex,
        lineIndex: li,
        columnIndex,
        x: lineStart,
        y,
        width,
        naturalWidth: line.width,
        height,
        baseline,
        anchorX,
        align: lp.para.align,
        rtl,
        squeezed: line.squeezed,
        segments: publicSegments(line, lineStart, scale, rtl, opts.includeCarets !== false, opts.measureText),
      });
      y += height + (li === lp.lines.length - 1 ? lp.after : 0);
    }
  });

  return {
    width: w,
    height: h,
    layoutWidth: w,
    layoutHeight: h,
    scale,
    autoFit,
    columns,
    vert,
    transform: [1, 0, 0, 1, 0, 0],
    unwarped: warpSupported(t.warp?.preset),
    overflow: buckets.some((bucket) => itemsHeight(bucket) > h - pt - pb + 1e-9),
    lines,
  };
}
