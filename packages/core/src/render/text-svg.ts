import type { Paragraph, TextBody, TextRun } from '../types';
import { isOpening, squeezeEm, squeezeTotal } from './cjk-punct';
import { layoutText } from './text-layout';
import { fontFamily, fontSize, mathOf, measureTextWidth } from './text-measure';
import { warpSupported } from './text-warp-presets';
import { withHyperlink } from './hyperlink';

/**
 * 纯 SVG <text> 输出。断行和坐标统一由 text-layout 提供；这里仅负责 SVG 序列化、
 * 字体样式、公式与艺术字路径，避免编辑命中与独立 SVG 形成两套布局结果。
 */

const r = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0');

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ANCHOR: Record<Paragraph['align'], string> = {
  left: 'start', center: 'middle', right: 'end', justify: 'start',
};

/** RTL 段落：SVG 的 text-anchor 相对书写方向，翻转后才能保持与 HTML 一致的物理对齐 */
const flipAnchor = (anchor: string): string =>
  anchor === 'start' ? 'end' : anchor === 'end' ? 'start' : anchor;

const applyCaps = (text: string, run: TextRun): string =>
  run.caps === 'all' ? text.toUpperCase() : text;

interface Seg {
  text: string;
  run: TextRun;
  width: number;
}

interface Line {
  segs: Seg[];
  width: number;
  size: number;
  squeeze: number;
  squeezed: boolean;
}

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
  // 艺术字变形：整段排到路径上，成功则直接返回；不支持的预设退化为下面的普通排版
  const warped = renderWarp(t, w, h, addDef, [pt, pr, pb, pl], vAlignOverride ?? t.anchor);
  if (warped) return warped;

  const positioned = layoutText(t, w, h, {
    insets: marginsOverride,
    anchor: vAlignOverride,
    vert: 'horz',
    // 调用者已经解析过裸 normAutofit；显式传入防止重复缩放。
    scale,
    includeCarets: false,
  });
  const out: string[] = [];

  for (const line of positioned.lines) {
    const para = t.paragraphs[line.paragraphIndex];
    const first = para.runs[0];
    const segs: Seg[] = line.segments.map((segment) => {
      const run = segment.runIndex >= 0
        ? para.runs[segment.runIndex]
        : { ...first, text: `${para.bullet} `, size: first.size * (para.bulletSize ?? 1),
          color: para.bulletColor ?? first.color, u: false, strike: false };
      return { text: segment.text, run, width: segment.naturalWidth };
    });
    const renderLine: Line = {
      segs,
      width: line.naturalWidth,
      size: 0,
      squeeze: line.naturalWidth - line.width,
      squeezed: line.squeezed,
    };
    if (!segs.length) continue;

    // 高亮底色需要绝对位置：按对齐方式反推行首 x。
    let cursor = line.x;
    for (const seg of segs) {
      if (seg.run.highlight) {
        const size = fontSize(seg.run, scale);
        out.push(
          `<rect x="${r(cursor)}" y="${r(line.baseline - size * 0.82)}" width="${r(seg.width)}" ` +
          `height="${r(size * 1.12)}" fill="${esc(seg.run.highlight)}"/>`,
        );
      }
      cursor += seg.width - (line.squeezed ? squeezeTotal(seg.text) * fontSize(seg.run, scale) : 0);
    }

    const textAnchor = ANCHOR[line.align];
    if (segs.some((segment) => segment.run.math?.length)) {
      // 公式是 <g>，塞不进 <text>。含公式的行按绝对 x 逐段输出。
      let x = line.x;
      for (const seg of segs) {
        const math = seg.run.math?.length ? mathOf(seg.run, scale) : null;
        if (math) {
          out.push(withHyperlink(
            `<g transform="translate(${r(x)} ${r(line.baseline)})">${math.svg}</g>`, seg.run.link,
          ));
        } else {
          out.push(
            `<text x="${r(x)}" y="${r(line.baseline)}" text-anchor="start"` +
            (line.rtl ? ' direction="rtl" unicode-bidi="embed"' : '') +
            ` xml:space="preserve">${spanSvg(seg, scale, addDef)}</text>`,
          );
        }
        x += seg.width - (line.squeezed ? squeezeTotal(seg.text) * fontSize(seg.run, scale) : 0);
      }
    } else {
      const tspans = line.squeezed
        ? squeezedSpans(renderLine, scale, addDef)
        : segs.map((segment) => spanSvg(segment, scale, addDef)).join('');
      out.push(
        `<text x="${r(line.anchorX)}" y="${r(line.baseline)}" ` +
        `text-anchor="${line.rtl ? flipAnchor(textAnchor) : textAnchor}"` +
        (line.rtl ? ' direction="rtl" unicode-bidi="embed"' : '') +
        ` xml:space="preserve">${tspans}</text>`,
      );
    }
  }
  return out.join('');
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
    stops.map((sp) => `<stop offset="${r(sp.pos)}%" stop-color="${esc(sp.color)}"/>`).join('') +
    '</linearGradient>',
  );
  return `url(#${id})`;
}

/**
 * 挤压过的行：用 `<tspan dx>` 把标点的空半格收掉。
 *
 * `dx` 是**逐字符**的位移列表，所以只要在该收的下标处放一个负值即可，
 * 后面的字符会跟着整体左移。这样做与字体无关——不依赖字体是否提供
 * `halt` 半角替换字形，量多少就是多少。
 *
 * 位移可能落在段与段的交界上（比如标点和它后面的字属于不同 run），
 * 那就带到下一段的第一个字符上去。
 */
function squeezedSpans(line: Line, scale: number, addDef: (m: string) => string): string {
  let carry = 0; // 位移落在段与段交界上时，带给下一段的第一个字符
  return line.segs.map((seg) => {
    const em = fontSize(seg.run, scale);
    const chars = [...seg.text];
    const dx = chars.map(() => 0);
    let any = carry !== 0;
    if (chars.length) dx[0] = carry;
    carry = 0;

    for (let i = 0; i < chars.length; i++) {
      const amount = squeezeEm(chars[i]) * em;
      if (!amount) continue;
      any = true;
      if (isOpening(chars[i])) dx[i] -= amount;              // 起始标点：自己左移
      else if (i + 1 < chars.length) dx[i + 1] -= amount;    // 收尾标点：后面的字左移
      else carry -= amount;                                  // 落在段末：带给下一段
    }
    return spanSvg(seg, scale, addDef, any ? dx : undefined);
  }).join('');
}

/** `dx` 非空时按逐字符位移输出（标点挤压用，见 squeezedSpans） */
function spanSvg(seg: Seg, scale: number, addDef: (m: string) => string, dx?: number[]): string {
  const run = seg.run;
  const size = fontSize(run, scale);
  const grad = run.gradient ? gradientFill(run.gradient, addDef) : null;
  const attrs: string[] = [
    `font-size="${r(size)}"`,
    `font-family="${esc(fontFamily(run))}"`,
    `fill="${esc(grad ?? run.color)}"`,
  ];
  if (run.b) attrs.push('font-weight="700"');
  if (run.i) attrs.push('font-style="italic"');
  if (run.spacing) attrs.push(`letter-spacing="${r(run.spacing)}"`);
  const deco: string[] = [];
  if (run.u) deco.push('underline');
  if (run.strike) deco.push('line-through');
  if (deco.length) attrs.push(`text-decoration="${deco.join(' ')}"`);
  if (run.baseline) attrs.push(`dy="${r(run.baseline > 0 ? -size * 0.45 : size * 0.25)}"`);
  if (run.outline) attrs.push(`stroke="${esc(run.outline.color)}" stroke-width="${r(run.outline.width)}" paint-order="stroke"`);
  if (dx?.some((v) => v !== 0)) attrs.push(`dx="${dx.map((v) => r(v)).join(' ')}"`);
  const span = `<tspan ${attrs.join(' ')}>${esc(seg.text)}</tspan>`;
  // 上下标用 dy 偏移后需要复位，避免影响后续 tspan
  const restored = run.baseline
    ? `${span}<tspan dy="${r(run.baseline > 0 ? size * 0.45 : -size * 0.25)}"></tspan>` : span;
  return withHyperlink(restored, run.link);
}

// ---------------- 艺术字变形（prstTxWarp） ----------------

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
      width: measureTextWidth(run.text, run, scale),
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
