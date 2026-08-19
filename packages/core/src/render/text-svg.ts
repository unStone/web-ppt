import type { Paragraph, TextBody, TextRun } from '../types';

/**
 * 纯 SVG <text> 排版：自己做文本测量与断行。
 * 用途：产出要脱离浏览器使用的 SVG（独立文件、打印 HTML）——<foreignObject> 只有浏览器认，
 * 别的 SVG 渲染器打开会整块丢失文本。屏幕渲染与 PNG 导出仍走 foreignObject，
 * 让浏览器自己排版，省掉第二套断行实现带来的偏差。
 */

const r = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0');

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FALLBACK = `'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif`;

let measureCtx: CanvasRenderingContext2D | null = null;
let measureProbed = false;

/**
 * 拿一个用来量文字宽度的 2D 上下文，拿不到就返回 null（调用方退到字符宽度估算）。
 *
 * 「拿不到」这件事必须只判一次：Node / jsdom / 反指纹浏览器里 getContext('2d')
 * 恒为 null，不缓存这个结论就会在每次测字时新建一个 <canvas>，一页文本能造出上千个。
 * 同时只认真的能测字的上下文——有些环境（测试替身、canvas 拦截插件）会给出残缺对象，
 * 直接调 measureText 会抛，而排版不该因为量不到字就整页失败。
 */
function ctx2d(): CanvasRenderingContext2D | null {
  if (measureProbed) return measureCtx;
  measureProbed = true;
  try {
    const g = document.createElement('canvas').getContext('2d');
    measureCtx = g && typeof g.measureText === 'function' ? g : null;
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

function fontFamily(run: TextRun): string {
  return run.fonts.length ? `${run.fonts.map((f) => `'${f}'`).join(',')},${FALLBACK}` : `Helvetica,Arial,${FALLBACK}`;
}

function fontSize(run: TextRun, scale: number): number {
  const base = run.size * scale;
  return run.baseline ? base * 0.65 : base;
}

function measure(text: string, run: TextRun, scale: number): number {
  if (!text) return 0;
  const g = ctx2d();
  const size = fontSize(run, scale);
  if (!g) return text.length * size * 0.55;
  g.font = `${run.i ? 'italic ' : ''}${run.b ? '700 ' : '400 '}${size}px ${fontFamily(run)}`;
  const w = g.measureText(text).width;
  return w + (run.spacing ?? 0) * text.length;
}

function applyCaps(text: string, run: TextRun): string {
  return run.caps === 'all' ? text.toUpperCase() : text;
}

// ---------------- 断行 ----------------

interface Token {
  text: string;
  run: TextRun;
  width: number;
  /** 硬换行 */
  br: boolean;
  space: boolean;
}

function tokenize(runs: TextRun[], scale: number): Token[] {
  const out: Token[] = [];
  for (const run of runs) {
    const text = applyCaps(run.text, run);
    if (!text) continue;
    // 保留空格、按 CJK 逐字、按空白与拉丁词切分
    const pieces = text.match(/\n|[^\S\n]+|[⺀-鿿가-퟿＀-｠　-〿]|[^\s⺀-鿿가-퟿＀-｠　-〿]+/g) ?? [];
    for (const piece of pieces) {
      out.push({
        text: piece,
        run,
        width: piece === '\n' ? 0 : measure(piece, run, scale),
        br: piece === '\n',
        space: /^[^\S\n]+$/.test(piece),
      });
    }
  }
  return out;
}

interface Seg {
  text: string;
  run: TextRun;
  width: number;
}

interface Line {
  segs: Seg[];
  width: number;
  size: number;
}

function pushSeg(line: Line, token: Token): void {
  const last = line.segs[line.segs.length - 1];
  if (last && last.run === token.run) {
    last.text += token.text;
    last.width += token.width;
  } else {
    line.segs.push({ text: token.text, run: token.run, width: token.width });
  }
  line.width += token.width;
  line.size = Math.max(line.size, token.run.size);
}

function wrap(tokens: Token[], maxWidth: number, wrapOn: boolean, firstIndent: number): Line[] {
  const lines: Line[] = [];
  let line: Line = { segs: [], width: 0, size: 0 };
  let limit = Math.max(1, maxWidth - Math.max(0, firstIndent));

  const flush = (): void => {
    lines.push(line);
    line = { segs: [], width: 0, size: 0 };
    limit = Math.max(1, maxWidth);
  };

  for (const token of tokens) {
    if (token.br) {
      flush();
      continue;
    }
    if (wrapOn && line.width > 0 && line.width + token.width > limit) {
      if (token.space) continue; // 行尾空格丢弃
      flush();
    }
    pushSeg(line, token);
  }
  lines.push(line);
  return lines;
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

/** RTL 段落：SVG 的 text-anchor 相对书写方向，翻转后才能保持与 HTML 一致的物理对齐 */
const flipAnchor = (a: string): string => (a === 'start' ? 'end' : a === 'end' ? 'start' : a);

interface RenderItem {
  lp: LaidPara;
  line: LaidPara['lines'][number];
  li: number;
  /** 含段前/段后间距的整行占高，用于分栏时决定断点 */
  h: number;
  padTop: number;
}

/** 段落排版：把每段拆成行并算出行高。renderTextSvg 与自动缩放测量共用。 */
function layout(t: TextBody, boxW: number, scale: number): LaidPara[] {
  return t.paragraphs.map((p) => {
    const first = p.runs[0];
    const bulletRun: TextRun | null = p.bullet && first
      ? { ...first, text: `${p.bullet} `, size: first.size * (p.bulletSize ?? 1), color: p.bulletColor ?? first.color, u: false, strike: false }
      : null;
    const runs = bulletRun ? [bulletRun, ...p.runs] : p.runs;
    const avail = Math.max(1, boxW - Math.max(0, p.marL));
    const lines = wrap(tokenize(runs, scale), avail, t.wrap, p.indent);
    const lineHeights = lines.map((l) => {
      const base = (l.size || first?.size || 18) * scale;
      return base * (p.lineHeight ?? 1.2);
    });
    return { lines, para: p, before: p.spaceBefore, after: p.spaceAfter, lineHeights };
  });
}

/** 给定缩放比例下文本占用的总高度 */
function textHeight(t: TextBody, boxW: number, scale: number): number {
  return layout(t, boxW, scale).reduce(
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
export function autoFitScale(t: TextBody, w: number, h: number): number {
  const [pt, pr, pb, pl] = t.insets;
  const boxW = Math.max(1, w - pl - pr);
  const boxH = Math.max(1, h - pt - pb);
  if (textHeight(t, boxW, 1) <= boxH) return 1;

  let lo = MIN_AUTOFIT, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (textHeight(t, boxW, mid) <= boxH) lo = mid; else hi = mid;
  }
  return lo;
}

/** PowerPoint 的自动缩放下限也是 25% */
const MIN_AUTOFIT = 0.25;

export function renderTextSvg(
  t: TextBody,
  w: number,
  h: number,
  addDef: (markup: string) => string,
  marginsOverride?: [number, number, number, number],
  vAlignOverride?: 'top' | 'middle' | 'bottom',
): string {
  // 竖排：按横排排完再整体旋转 90°（交换宽高）
  if (t.vert === 'vert' || t.vert === 'wordArtVert') {
    const inner = renderTextSvg({ ...t, vert: undefined }, h, w, addDef, marginsOverride, vAlignOverride);
    return `<g transform="translate(${r(w)} 0) rotate(90)">${inner}</g>`;
  }
  if (t.vert === 'vert270') {
    const inner = renderTextSvg({ ...t, vert: undefined }, h, w, addDef, marginsOverride, vAlignOverride);
    return `<g transform="translate(0 ${r(h)}) rotate(-90)">${inner}</g>`;
  }

  const [pt, pr, pb, pl] = marginsOverride ?? t.insets;
  const scale = t.fontScale;
  const boxW = Math.max(1, w - pl - pr);

  // 艺术字变形：整段排到路径上，成功则直接返回；不支持的预设退化为下面的普通排版
  const warped = renderWarp(t, w, h, addDef, [pt, pr, pb, pl], vAlignOverride ?? t.anchor);
  if (warped) return warped;

  const laid = layout(t, boxW, scale);
  const anchor = vAlignOverride ?? t.anchor;

  /** 把排好的段落摊成「一行一项」，分栏时按行切列用得上 */
  const flatten = (ls: LaidPara[]): RenderItem[] => {
    const items: RenderItem[] = [];
    ls.forEach((lp) => {
      lp.lines.forEach((line, li) => {
        items.push({
          lp, line, li,
          h: lp.lineHeights[li] + (li === 0 ? lp.before : 0)
            + (li === lp.lines.length - 1 ? lp.after : 0),
          padTop: li === 0 ? lp.before : 0,
        });
      });
    });
    return items;
  };

  const sum = (items: RenderItem[]): number => items.reduce((a, it) => a + it.h, 0);

  /** 渲染一列：originX 是该列左边界，colW 是列宽 */
  const paint = (items: RenderItem[], originX: number, colW: number): string => {
    const colH = sum(items);
    let y = pt;
    if (anchor === 'middle') y = pt + Math.max(0, (h - pt - pb - colH) / 2);
    else if (anchor === 'bottom') y = Math.max(pt, h - pb - colH);

    const out: string[] = [];
    for (const { lp, line, li, padTop } of items) {
      y += padTop;
      const lh = lp.lineHeights[li];
      const baseline = y + lh * 0.78;
      const indent = li === 0 ? lp.para.indent : 0;
      const left = originX + Math.max(0, lp.para.marL) + indent;

      let x: number;
      // 物理对齐用于定位，写到属性上的 anchor 在 RTL 下需要翻转
      const textAnchor = ANCHOR[lp.para.align];
      const rtl = lp.para.rtl === true;
      if (textAnchor === 'middle') x = originX + colW / 2;
      else if (textAnchor === 'end') x = originX + colW;
      else x = left;

      if (line.segs.length) {
        // 高亮底色需要绝对位置：按对齐方式反推行首 x
        const lineStart = textAnchor === 'middle' ? x - line.width / 2 : textAnchor === 'end' ? x - line.width : x;
        let cursor = lineStart;
        for (const seg of line.segs) {
          if (seg.run.highlight) {
            const sz = fontSize(seg.run, scale);
            out.push(
              `<rect x="${r(cursor)}" y="${r(baseline - sz * 0.82)}" width="${r(seg.width)}" ` +
              `height="${r(sz * 1.12)}" fill="${seg.run.highlight}"/>`,
            );
          }
          cursor += seg.width;
        }
        const tspans = line.segs.map((seg) => spanSvg(seg, scale, addDef)).join('');
        out.push(
          `<text x="${r(x)}" y="${r(baseline)}" text-anchor="${rtl ? flipAnchor(textAnchor) : textAnchor}"` +
          (rtl ? ' direction="rtl" unicode-bidi="embed"' : '') +
          ` xml:space="preserve">${tspans}</text>`,
        );
      }
      y += lh + (li === lp.lines.length - 1 ? lp.after : 0);
    }
    return out.join('');
  };

  const cols = Math.max(1, Math.min(Math.floor(t.columns ?? 1), 16));
  if (cols === 1) return paint(flatten(laid), pl, boxW);

  // 分栏：按列宽重新排版，再按可用高度把行依次装进各列。
  // PowerPoint 在行边界断栏，最后一列装不下的部分溢出，与它一致。
  const gap = t.columnGap ?? 0;
  const colW = Math.max(1, (boxW - gap * (cols - 1)) / cols);
  const colItems = flatten(layout(t, colW, scale));
  const colH = Math.max(1, h - pt - pb);

  const buckets: RenderItem[][] = [[]];
  let used = 0;
  for (const it of colItems) {
    if (used > 0 && used + it.h > colH && buckets.length < cols) {
      buckets.push([]);
      used = 0;
    }
    buckets[buckets.length - 1].push(it);
    used += it.h;
  }
  return buckets
    .map((items, i) => paint(items, pl + i * (colW + gap), colW))
    .join('');
}

/** "linear-gradient(90deg,#a 0%,#b 100%)" → SVG linearGradient，返回 url(#id) */
function gradientFill(css: string, addDef: (m: string) => string): string | null {
  const body = css.match(/linear-gradient\(([^]*)\)$/)?.[1];
  if (!body) return null;
  const parts = body.split(/,(?![^(]*\))/).map((p) => p.trim());
  const degMatch = parts[0].match(/^(-?[\d.]+)deg$/);
  const deg = degMatch ? Number(degMatch[1]) : 180;
  const stopParts = degMatch ? parts.slice(1) : parts;
  const stops = stopParts
    .map((p) => {
      const m = p.match(/^(.*?)\s+([\d.]+)%$/);
      return m ? { color: m[1].trim(), pos: Number(m[2]) } : { color: p, pos: null as number | null };
    })
    .map((sp, i, arr) => ({ color: sp.color, pos: sp.pos ?? (arr.length > 1 ? (i / (arr.length - 1)) * 100 : 0) }));
  if (!stops.length) return null;
  // CSS 角度 0deg 向上、顺时针；换算成单位向量
  const rad = ((deg - 90) * Math.PI) / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  const id = addDef(
    `<linearGradient id="__ID__" x1="${r(0.5 - dx)}" y1="${r(0.5 - dy)}" x2="${r(0.5 + dx)}" y2="${r(0.5 + dy)}">` +
    stops.map((sp) => `<stop offset="${r(sp.pos)}%" stop-color="${sp.color}"/>`).join('') +
    '</linearGradient>',
  );
  return `url(#${id})`;
}

function spanSvg(seg: Seg, scale: number, addDef: (m: string) => string): string {
  const run = seg.run;
  const size = fontSize(run, scale);
  const grad = run.gradient ? gradientFill(run.gradient, addDef) : null;
  const attrs: string[] = [
    `font-size="${r(size)}"`,
    `font-family="${esc(fontFamily(run))}"`,
    `fill="${grad ?? run.color}"`,
  ];
  if (run.b) attrs.push('font-weight="700"');
  if (run.i) attrs.push('font-style="italic"');
  if (run.spacing) attrs.push(`letter-spacing="${r(run.spacing)}"`);
  const deco: string[] = [];
  if (run.u) deco.push('underline');
  if (run.strike) deco.push('line-through');
  if (deco.length) attrs.push(`text-decoration="${deco.join(' ')}"`);
  if (run.baseline) attrs.push(`dy="${r(run.baseline > 0 ? -size * 0.45 : size * 0.25)}"`);
  if (run.outline) attrs.push(`stroke="${run.outline.color}" stroke-width="${r(run.outline.width)}" paint-order="stroke"`);
  const span = `<tspan ${attrs.join(' ')}>${esc(seg.text)}</tspan>`;
  // 上下标用 dy 偏移后需要复位，避免影响后续 tspan
  return run.baseline ? `${span}<tspan dy="${r(run.baseline > 0 ? size * 0.45 : -size * 0.25)}"></tspan>` : span;
}

// ---------------- 艺术字变形（prstTxWarp） ----------------

/**
 * 已实现曲线的预设；其余（含 textNoShape）退化为普通横排。
 * 说明：<textPath> 只能让基线弯曲，无法按位置缩放字形，
 * 因此 inflate / deflate / triangle / can 一类"包络型"预设只近似出弯曲方向。
 */
const WARP_PRESETS = new Set([
  'textArchUp', 'textArchDown', 'textArchUpPour', 'textArchDownPour', 'textCircle',
  'textWave1', 'textWave2', 'textCurveUp', 'textCurveDown', 'textCanUp', 'textCanDown',
  'textTriangle', 'textChevron', 'textInflate', 'textDeflate',
]);

export const warpSupported = (preset: string | undefined): boolean => !!preset && WARP_PRESETS.has(preset);

interface WarpGeom {
  d: string;
  /** 路径长度估计，用于文字过长时整体缩小 */
  len: number;
  /** 环形族：短文字按字间距摊开铺满弧线（arch / circle 的标志性观感） */
  fill?: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 椭圆弧（角度制，屏幕坐标 y 向下；a1 > a0 为顺时针） */
function arcGeom(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): WarpGeom {
  const at = (deg: number): [number, number] => {
    const t = (deg * Math.PI) / 180;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
  };
  const [x0, y0] = at(a0);
  const [x1, y1] = at(a1);
  const span = Math.abs(a1 - a0);
  return {
    d: `M${r(x0)} ${r(y0)}A${r(rx)} ${r(ry)} 0 ${span > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${r(x1)} ${r(y1)}`,
    len: ((span * Math.PI) / 180) * ((rx + ry) / 2),
    fill: true,
  };
}

/** y = f(x) 采样后转平滑三次贝塞尔（Catmull-Rom），顺带累计折线长度 */
function curveGeom(f: (u: number) => number, w: number, n = 28): WarpGeom {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) pts.push([(w * i) / n, f(i / n)]);
  let d = `M${r(pts[0][0])} ${r(pts[0][1])}`;
  let len = 0;
  for (let i = 0; i < n; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n, i + 2)];
    d +=
      `C${r(p1[0] + (p2[0] - p0[0]) / 6)} ${r(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${r(p2[0] - (p3[0] - p1[0]) / 6)} ${r(p2[1] - (p3[1] - p1[1]) / 6)} ${r(p2[0])} ${r(p2[1])}`;
    len += Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  }
  return { d, len };
}

/** 弯曲基线的振幅系数（相对框高），正数为中间隆起 */
const CURVE_AMP: Record<string, number> = {
  textCurveUp: 0.30, textCurveDown: -0.30,
  textCanUp: 0.16, textCanDown: -0.16,
  textDeflate: 0.22, textInflate: -0.22,
  textTriangle: 0.20, textChevron: 0.34,
};

const SHARP = new Set(['textTriangle', 'textChevron']);

/**
 * 生成变形基线。
 * - 环形族（arch / circle）铺在整框的椭圆上，adj 为弧度扫角（1/60000 度）
 * - 曲线族用 y = f(x)，pad 为该段最大字号，用于给字形留出高度
 */
function warpGeom(
  preset: string, adj: Record<string, number>, w: number, h: number, pad: number,
  anchor: 'top' | 'middle' | 'bottom',
): WarpGeom | null {
  const cx = w / 2;
  const cy = h / 2;
  const sweep = clamp((adj.adj ?? adj.adj1 ?? 10800000) / 60000, 20, 350);

  if (preset === 'textCircle') {
    const rx = Math.max(1, cx - pad * 0.3);
    const ry = Math.max(1, cy - pad * 0.3);
    // 从底部起顺时针绕一圈，路径中点落在正上方，便于居中
    return {
      d: `M${r(cx)} ${r(cy + ry)}A${r(rx)} ${r(ry)} 0 1 1 ${r(cx)} ${r(cy - ry)}` +
        `A${r(rx)} ${r(ry)} 0 1 1 ${r(cx)} ${r(cy + ry)}`,
      len: Math.PI * (rx + ry),
      fill: true,
    };
  }

  if (preset.startsWith('textArch')) {
    const down = preset.startsWith('textArchDown');
    // pour 变体把文字灌进内环，半径更小、弯曲更明显
    const pour = preset.endsWith('Pour');
    const inset = pad * 0.4;
    const rx = Math.max(1, (cx - pad * 0.1) * (pour ? 0.72 : 1));
    const ry = Math.max(1, (cy - inset) * (pour ? 0.72 : 1));
    return down
      ? arcGeom(cx, cy - inset, rx, ry, 90 + sweep / 2, 90 - sweep / 2)
      : arcGeom(cx, cy + inset, rx, ry, -90 - sweep / 2, -90 + sweep / 2);
  }

  const wave = preset === 'textWave1' ? 1 : preset === 'textWave2' ? -1 : 0;
  const mid = anchor === 'top' ? pad * 0.85 : anchor === 'bottom' ? h - pad * 0.2 : cy + pad * 0.32;
  if (wave) {
    const amp = h * 0.16 * clamp((adj.adj1 ?? 6250) / 6250, 0.25, 3);
    return curveGeom((u) => mid - wave * amp * Math.sin(2 * Math.PI * u), w);
  }

  const a = CURVE_AMP[preset];
  if (a === undefined) return null;
  const amp = a * h;
  const shape = SHARP.has(preset)
    ? (u: number): number => 1 - Math.abs(2 * u - 1)
    : (u: number): number => Math.sin(Math.PI * u);
  return curveGeom((u) => mid + amp / 2 - amp * shape(u), w);
}

/** 把每个段落排到一条变形路径上；返回 null 表示该预设不支持，交回普通排版 */
function renderWarp(
  t: TextBody,
  w: number,
  h: number,
  addDef: (markup: string) => string,
  margins: [number, number, number, number],
  anchor: 'top' | 'middle' | 'bottom',
): string | null {
  const warp = t.warp;
  if (!warp || !warpSupported(warp.preset)) return null;

  const [pt, pr, pb, pl] = margins;
  const boxW = Math.max(1, w - pl - pr);
  const boxH = Math.max(1, h - pt - pb);
  const scale = t.fontScale;
  const paras = t.paragraphs.filter((p) => p.runs.some((run) => run.text.trim()));
  if (!paras.length) return null;

  const segH = boxH / paras.length;
  const out: string[] = [];
  paras.forEach((p, i) => {
    const runs = p.runs.filter((run) => run.text);
    if (!runs.length) return;
    const size = Math.max(...runs.map((run) => run.size), 1) * scale;
    const geom = warpGeom(warp.preset, warp.adj, boxW, segH, size, paras.length > 1 ? 'middle' : anchor);
    if (!geom) return;

    const segs: Seg[] = runs.map((run) => ({
      text: applyCaps(run.text, run).replace(/\n/g, ' '),
      run,
      width: measure(run.text, run, scale),
    }));
    // 文字比路径长时整体缩字，避免绕出路径末端被截断
    const total = segs.reduce((sum, s) => sum + s.width, 0);
    const fit = total > geom.len ? Math.max(0.25, geom.len / total) : 1;
    // 变形语义是把文本铺满包络，短文字按字间距拉开（上限 2.2 倍，避免拉散）
    const drawn = total * fit;
    const chars = segs.reduce((n, s) => n + s.text.length, 0);
    const spread = geom.fill && chars > 1 && drawn > 0
      ? (drawn * clamp(geom.len / drawn, 1, 2.2) - drawn) / chars
      : 0;

    const id = addDef(`<path id="__ID__" fill="none" d="${geom.d}"/>`);
    const base = ANCHOR[p.align];
    const rtl = p.rtl === true;
    const offset = base === 'end' ? '100%' : base === 'middle' ? '50%' : '0%';
    const spans = segs.map((s) => spanSvg(s, scale * fit, addDef)).join('');
    out.push(
      `<g transform="translate(${r(pl)} ${r(pt + segH * i)})">` +
      `<text text-anchor="${rtl ? flipAnchor(base) : base}"` +
      (spread > 0.05 ? ` letter-spacing="${r(spread)}"` : '') +
      (rtl ? ' direction="rtl" unicode-bidi="embed"' : '') +
      ' xml:space="preserve">' +
      `<textPath href="#${id}" xlink:href="#${id}" startOffset="${offset}">${spans}</textPath>` +
      '</text></g>',
    );
  });
  return out.length ? out.join('') : null;
}
