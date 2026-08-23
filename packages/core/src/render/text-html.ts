/**
 * TextBody → XHTML 片段。
 *
 * 屏幕预览的 foreignObject 与编辑器的 contenteditable 覆盖层必须调用同一个实现；
 * 排版 CSS 只要分叉一点，进入或退出编辑时就会跳版。这里不访问 DOM，Worker 也能用。
 */

import type { TextBody, TextRun, TextVert } from '../types';
import { isOpening, squeezeEm } from './cjk-punct';
import { paraNeedsSqueeze, resolveTextScale } from './text-layout';
import { mathOf } from './text-measure';

const r = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0');

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ANCHOR_CSS: Record<TextBody['anchor'], string> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

const VERT_CSS: Partial<Record<TextVert, string>> = {
  vert: 'writing-mode:vertical-rl;',
  vert270: 'writing-mode:vertical-rl;transform:rotate(180deg);',
  wordArtVert: 'writing-mode:vertical-rl;text-orientation:upright;',
};

const FONT_FALLBACK = [`'PingFang SC'`, `'Hiragino Sans GB'`, `'Microsoft YaHei'`, 'sans-serif'];

export interface RenderTextBodyHtmlOptions {
  /** 覆盖 TextBody.insets；表格单元格用自己的边距。 */
  insets?: readonly [number, number, number, number];
  /** 覆盖垂直对齐；表格单元格用自己的对齐。 */
  anchor?: TextBody['anchor'];
  /** 覆盖文字方向；表格单元格用自己的方向。 */
  vert?: TextVert;
  /**
   * 输出 data-p / data-r 与反解辅助标记，默认开启。
   * 预览内部关闭它以保持既有 SVG 逐字节不变；编辑覆盖层应保留默认值。
   */
  includeEditMarkers?: boolean;
}

/** 字体名放在 CSS 单引号字符串里，必须同时挡住 CSS 与外层 HTML 属性边界。 */
function cssString(value: string): string {
  let out = '';
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (ch === "'" || ch === '"' || ch === '\\' || ch === '<' || ch === '>' || ch === '&'
      || cp < 0x20 || cp === 0x7f) {
      out += `\\${cp.toString(16)} `;
    } else {
      out += ch;
    }
  }
  return out;
}

/** 字体栈去重，避免主题字体与中文回退重复。 */
function stack(fonts: readonly string[], fallback: readonly string[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of fonts) {
    const key = f.toLowerCase();
    if (f && !seen.has(key)) {
      seen.add(key);
      out.push(`'${cssString(f)}'`);
    }
  }
  for (const f of fallback) {
    const key = f.replace(/'/g, '').toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f);
    }
  }
  return out.join(',');
}

function runStyle(run: TextRun, scale: number): string {
  const size = run.size * scale;
  let css = `font-size:${r(size)}px;`;
  css += run.gradient
    ? `background-image:${run.gradient};-webkit-background-clip:text;background-clip:text;color:transparent;`
    : `color:${run.color};`;
  if (run.b) css += 'font-weight:700;';
  if (run.i) css += 'font-style:italic;';
  const deco: string[] = [];
  if (run.u) deco.push('underline');
  if (run.strike) deco.push('line-through');
  if (deco.length) {
    css += `text-decoration:${deco.join(' ')};`;
    if (run.underlineColor) css += `text-decoration-color:${run.underlineColor};`;
  }
  if (run.fonts.length) css += `font-family:${stack(run.fonts, FONT_FALLBACK)};`;
  if (run.spacing) css += `letter-spacing:${r(run.spacing)}px;`;
  if (run.caps === 'all') css += 'text-transform:uppercase;';
  else if (run.caps === 'small') css += 'font-variant:small-caps;';
  if (run.highlight) css += `background-color:${run.highlight};`;
  if (run.outline) css += `-webkit-text-stroke:${r(run.outline.width)}px ${run.outline.color};`;
  if (run.shadow) css += `text-shadow:${run.shadow};`;
  if (run.baseline) {
    css += `vertical-align:${run.baseline > 0 ? 'super' : 'sub'};font-size:${r(size * 0.65)}px;`;
  }
  return css;
}

/** 字体无关的全角标点挤压，与原生 SVG 文本路径共用同一份判定表。 */
function squeezedHtml(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch === '\n') {
      out += '<br/>';
      continue;
    }
    const em = squeezeEm(ch);
    if (!em) {
      out += esc(ch);
      continue;
    }
    out += `<span style="margin-${isOpening(ch) ? 'left' : 'right'}:-${em}em">${esc(ch)}</span>`;
  }
  return out;
}

const SAFE_LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

function linkAttrs(link: string): string {
  if (link.startsWith('slide:')) {
    return `data-slide="${esc(link.slice(6))}" style="cursor:pointer;text-decoration:underline"`;
  }
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(link.trim())?.[1]?.toLowerCase();
  if (scheme && !SAFE_LINK_SCHEMES.has(scheme)) {
    // 保留数据供属性面板展示，但不给 href，避免 javascript:/file: 被点击执行或泄漏。
    return `data-unsafe-href="${esc(link)}" aria-disabled="true"`;
  }
  return `href="${esc(link)}" target="_blank" rel="noopener noreferrer"`;
}

function renderRun(run: TextRun, scale: number, squeeze: boolean, marker: string): string {
  // 公式在编辑模型里是一个原子；data-r 放在 SVG 根上不会引入额外 inline 盒，
  // 因而带标记与不带标记的排版完全相同。
  if (run.math?.length) {
    const m = mathOf(run, scale);
    if (m && m.w > 0) {
      return `<svg${marker} xmlns="http://www.w3.org/2000/svg" width="${r(m.w)}" height="${r(m.h + m.d)}"` +
        ` viewBox="0 ${r(-m.h)} ${r(m.w)} ${r(m.h + m.d)}"` +
        ` style="display:inline-block;vertical-align:${r(-m.d)}px;overflow:visible">${m.svg}</svg>`;
    }
  }
  const empty = !run.text;
  const content = run.text
    ? (squeeze ? squeezedHtml(run.text) : esc(run.text).replace(/\n/g, '<br/>'))
    : '&#160;';
  const emptyMarker = marker && empty ? ' data-empty="true"' : '';
  const span = `<span${marker}${emptyMarker} style="${esc(runStyle(run, scale))}">${content}</span>`;
  return run.link ? `<a ${linkAttrs(run.link)}>${span}</a>` : span;
}

function fittedText(t: TextBody, w: number, h: number): TextBody {
  const scale = resolveTextScale(t, w, h);
  return scale === t.fontScale ? t : { ...t, fontScale: scale };
}

/**
 * 生成可直接作为 HTML 覆盖层内容的 XHTML 根 `<div>`；不包含 foreignObject，
 * 也不设置 contenteditable。调用方拥有焦点、IME 与生命周期，core 只负责确定性排版。
 * 艺术字变形无法由 HTML 表达；编辑时返回未变形文字，提交后的静态预览仍走 SVG 路径。
 */
export function renderTextBodyToHtml(
  source: TextBody,
  w: number,
  h: number,
  opts: RenderTextBodyHtmlOptions = {},
): string {
  const t = fittedText(source, w, h);
  const [pt, pr, pb, pl] = opts.insets ?? t.insets;
  const scale = t.fontScale;
  const markers = opts.includeEditMarkers !== false;

  const paras = t.paragraphs.map((p, pi) => {
    const first = p.runs[0];
    const baseSize = (first?.size ?? 18) * scale;
    const squeeze = t.wrap
      && paraNeedsSqueeze(p, w - pl - pr - Math.max(0, p.marL), scale, true);
    const runs = p.runs.map((run, ri) =>
      renderRun(run, scale, squeeze, markers ? ` data-r="${pi}.${ri}"` : '')).join('');

    let bullet = '';
    // 项目符号由段落属性控制，不是正文字符；编辑层里禁止直接把光标落进去。
    const bulletMarker = markers ? ' data-bullet="true" contenteditable="false"' : '';
    if (p.bulletImage) {
      bullet = `<img${bulletMarker} src="${esc(p.bulletImage)}" style="height:${r(baseSize * 0.8)}px;vertical-align:middle;margin-right:4px"/>`;
    } else if (p.bullet) {
      const size = baseSize * (p.bulletSize ?? 1);
      const color = p.bulletColor ?? first?.color ?? '#000';
      const font = p.bulletFont && !/wingdings|webdings|symbol/i.test(p.bulletFont)
        ? `font-family:${stack([p.bulletFont], FONT_FALLBACK)};`
        : '';
      bullet = `<span${bulletMarker} style="${esc(`font-size:${r(size)}px;color:${color};${font}`)}">${esc(p.bullet)}&#160;</span>`;
    }

    const style =
      `margin:${r(p.spaceBefore)}px 0 ${r(p.spaceAfter)}px 0;` +
      `text-align:${p.align};` +
      `padding-left:${r(Math.max(0, p.marL))}px;` +
      `text-indent:${r(p.indent)}px;` +
      `line-height:${p.lineHeight !== null ? r(p.lineHeight) : '1.2'};` +
      (p.rtl ? 'direction:rtl;' : '') +
      `white-space:${t.wrap ? 'pre-wrap' : 'pre'};word-break:break-word;`;
    const paraMarker = markers ? ` data-p="${pi}"` : '';
    return `<div${paraMarker} style="${esc(style)}">${bullet}${runs}</div>`;
  }).join('');

  const anchor = opts.anchor ?? t.anchor;
  const vert = opts.vert ?? t.vert;
  const boxStyle =
    `width:${r(w)}px;height:${r(h)}px;box-sizing:border-box;` +
    `display:flex;flex-direction:column;justify-content:${ANCHOR_CSS[anchor]};` +
    (t.anchorCtr ? 'align-items:center;' : '') +
    `padding:${r(pt)}px ${r(pr)}px ${r(pb)}px ${r(pl)}px;` +
    (t.columns ? `column-count:${t.columns};column-gap:${r(t.columnGap ?? 0)}px;display:block;` : '') +
    (vert ? VERT_CSS[vert] ?? '' : '') +
    'overflow:visible;';
  const mode = t.autoFitShape ? 'shape' : source.autoFitCompute ? 'normal' : 'none';
  const rootMarkers = markers
    ? ` data-font-scale="${r(scale)}" data-autofit="${mode}"`
    : '';
  return `<div${rootMarkers} xmlns="http://www.w3.org/1999/xhtml" style="${esc(boxStyle)}">${paras}</div>`;
}
