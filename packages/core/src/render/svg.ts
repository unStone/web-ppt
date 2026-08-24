import type {
  CellBorders, Effects, ElementBase, Fill, GroupElement, ImageElement, LineEnd, MediaInfo, Presentation,
  Shape3D, ShapeElement, Slide, SlideComment, SlideElement, Stroke, TableElement, TextBody,
  UnsupportedElement,
} from '../types';
import { renderTextBodyToHtml } from './text-html';
import { resolveTextScale } from './text-layout';
import { renderTextSvg } from './text-svg';
import { warpSupported } from './text-warp-presets';

/** Schema → SVG 字符串。defs id 全局唯一，支持同页多实例（主视图 + 缩略图）。 */

let uid = 0;
const nextGlobalId = (p: string): string => `${p}${++uid}`;

/**
 * SVG id 会同时出现在 XML 属性和 url(#...) 里，不能把调用方字符串原样拼进去。
 * 只保留无歧义的安全字符，其余码点编码；下划线本身也编码，避免两个前缀归一后碰撞。
 */
function encodeIdPrefix(value: string): string {
  let out = '';
  let first = true;
  for (const ch of value) {
    const safe = first ? /[A-Za-z]/.test(ch) : /[A-Za-z0-9-]/.test(ch);
    out += safe ? ch : `_u${ch.codePointAt(0)!.toString(16)}_`;
    first = false;
  }
  return out;
}

const r = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0');

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Ctx {
  defs: string[];
  nextId: (prefix: string) => string;
  textMode: 'html' | 'svg';
  media: 'badge' | 'player';
  hidden: ReadonlySet<number> | null;
  includeEditMarkers: boolean;
}

export interface RenderElementOptions {
  /**
   * SVG defs id 的显式命名空间。传入后计数器在每次渲染时从 1 开始，
   * 因而相同前缀与相同元素会生成逐字节相同的结果，适合编辑器增量更新。
   * 同一 SVG 中并排挂载的元素必须使用不同前缀；省略时继续使用全局唯一 id。
   */
  idPrefix?: string;
  /**
   * 文本渲染方式：
   * - 'html'（默认）：foreignObject + HTML 排版，屏幕效果最佳、文本可选中
   * - 'svg'：原生 <text> + 自实现断行，用于导出独立 SVG 文件
   *   （foreignObject 只有浏览器认，其他 SVG 渲染器会整块丢失文本）
  */
  textMode?: 'html' | 'svg';
  /**
   * 直接渲染成隐藏的元素 id（`Slide.animations` 里的 target）。
   * 用于把「动画播到第 N 步」的状态固化进静态产物——播放时不要用它，
   * 查看器是在已插入的 DOM 上改 visibility，不重新渲染。
   */
  hiddenElements?: readonly number[];
  /**
   * 媒体呈现方式：
   * - 'badge'（默认）：只画封面帧 + 播放标识，纯 SVG，导出安全
   * - 'player'：嵌入真实 <video>/<audio>，可播放
   *
   * 'player' 靠 foreignObject 承载，只有浏览器认；而 textMode 为 'svg' 恰恰意味着
   * 产物要脱离浏览器使用（独立 SVG 文件 / 被光栅化），此时一律退回 badge。
  */
  media?: 'badge' | 'player';
  /** 编辑器命中所需的稳定结构标记；普通预览与导出默认不携带交互元数据。 */
  includeEditMarkers?: boolean;
}

export interface RenderOptions extends RenderElementOptions {
  /** 渲染演讲者备注为隐藏文本（便于搜索） */
  includeNotes?: boolean;
  /** 画批注标记（Slide.comments），默认关闭 */
  showComments?: boolean;
}

export interface RenderElementResult {
  /** 可直接放入现有页面 SVG 的元素节点；不包含 `<svg>` 包装 */
  markup: string;
  /** `markup` 引用的定义；调用方应在同一次更新中替换该元素自己的 defs 分区 */
  defs: string;
}

function createCtx(opts: RenderElementOptions): Ctx {
  const textMode = opts.textMode ?? 'html';
  let localUid = 0;
  const localPrefix = opts.idPrefix === undefined ? null : encodeIdPrefix(opts.idPrefix);
  return {
    defs: [],
    nextId: localPrefix === null
      ? nextGlobalId
      : (prefix) => `${localPrefix}${prefix}${++localUid}`,
    textMode,
    // 'svg' 文本模式是给「交出去的文件」用的，里面不该出现只有浏览器认的 foreignObject
    media: opts.media === 'player' && textMode === 'html' ? 'player' : 'badge',
    hidden: opts.hiddenElements?.length ? new Set(opts.hiddenElements) : null,
    includeEditMarkers: opts.includeEditMarkers === true,
  };
}

/**
 * 渲染一个可独立替换的元素及其 defs。嵌入字体的 `@font-face` 属于页面级资源，
 * 继续由 `renderSlideToSvg` 放在根 defs 中；元素更新只管理这里返回的局部定义。
 */
export function renderElementToSvg(
  el: SlideElement,
  opts: RenderElementOptions = {},
): RenderElementResult {
  const ctx = createCtx(opts);
  return { markup: renderEl(el, ctx), defs: ctx.defs.join('') };
}

export function renderSlideToSvg(pres: Presentation, slide: Slide, opts: RenderOptions = {}): string {
  const ctx = createCtx(opts);
  // 背景解析失败只该丢背景，不该丢整页
  let bgFill = '#fff';
  try {
    if (slide.background) bgFill = paint(slide.background, ctx, pres.width, pres.height);
  } catch { /* 保持白底 */ }
  const bg = `<rect width="${r(pres.width)}" height="${r(pres.height)}" fill="${bgFill}"/>`;
  const body = slide.elements.map((el) => renderEl(el, ctx)).join('')
    + (opts.showComments ? renderComments(slide.comments, pres.width, pres.height) : '');

  const fontFaces = (pres.embeddedFonts ?? [])
    .map((f) => `@font-face{font-family:'${f.family}';src:url(${f.src});font-weight:${f.bold ? 700 : 400};font-style:${f.italic ? 'italic' : 'normal'};}`)
    .join('');
  const styleTag = fontFaces ? `<style>${fontFaces}</style>` : '';
  const notes = opts.includeNotes && slide.notes
    ? `<desc>${esc(slide.notes)}</desc>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${r(pres.width)} ${r(pres.height)}" ` +
    `font-family="Helvetica, Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif">` +
    notes +
    `<defs>${styleTag}${ctx.defs.join('')}</defs>` +
    bg + body + '</svg>'
  );
}

// ---------------- 填充 ----------------

const PATTERN_DEFS: Record<string, string> = {
  pct5: 'M0 0h1v1H0z', pct10: 'M0 0h1v1H0z', pct20: 'M0 0h2v2H0z', pct25: 'M0 0h2v2H0z',
  pct30: 'M0 0h2v2H0zM2 2h2v2H2z', pct40: 'M0 0h2v2H0zM2 2h2v2H2z', pct50: 'M0 0h2v2H0zM2 2h2v2H2z',
  pct60: 'M0 0h3v3H0z', pct70: 'M0 0h3v3H0z', pct75: 'M0 0h3v3H0z', pct80: 'M0 0h4v4H0z', pct90: 'M0 0h4v4H0z',
  ltHorz: 'M0 2h8v1H0z', horz: 'M0 2h8v2H0z', dkHorz: 'M0 1h8v3H0z',
  ltVert: 'M2 0h1v8H0z', vert: 'M2 0h2v8H2z', dkVert: 'M1 0h3v8H1z',
  ltUpDiag: 'M0 8L8 0M-2 2L2 -2M6 10L10 6', upDiag: 'M0 8L8 0M-2 2L2 -2M6 10L10 6',
  ltDnDiag: 'M0 0L8 8M-2 6L2 10M6 -2L10 2', dnDiag: 'M0 0L8 8M-2 6L2 10M6 -2L10 2',
  smGrid: 'M0 0h8v1H0zM0 0h1v8H0z', lgGrid: 'M0 0h8v1H0zM0 0h1v8H0z',
  cross: 'M0 3h8v2H0zM3 0h2v8H3z', diagCross: 'M0 0L8 8M8 0L0 8',
  trellis: 'M0 0L8 8M8 0L0 8', wave: 'M0 4Q2 2 4 4T8 4',
};

const PATTERN_SIZE: Record<string, number> = { pct5: 8, pct10: 6, pct20: 5, pct25: 4, pct30: 4, pct40: 4, pct50: 4, pct60: 4, pct70: 4, pct75: 4, pct80: 5, pct90: 5 };

function paint(fill: Fill, ctx: Ctx, w: number, h: number): string {
  switch (fill.type) {
    case 'none':
      return 'none';
    case 'solid':
      return fill.color;
    case 'gradient': {
      const id = ctx.nextId('g');
      const stops = fill.stops
        .map((s) => `<stop offset="${r(Math.max(0, Math.min(1, s.pos)) * 100)}%" stop-color="${s.color}"/>`)
        .join('');
      if (fill.radial) {
        ctx.defs.push(`<radialGradient id="${id}" cx="50%" cy="50%" r="70%">${stops}</radialGradient>`);
      } else {
        // DrawingML 0° 指向右，顺时针为正
        const rad = (fill.angle * Math.PI) / 180;
        const dx = Math.cos(rad) / 2;
        const dy = Math.sin(rad) / 2;
        ctx.defs.push(
          `<linearGradient id="${id}" x1="${r(0.5 - dx)}" y1="${r(0.5 - dy)}" x2="${r(0.5 + dx)}" y2="${r(0.5 + dy)}">${stops}</linearGradient>`,
        );
      }
      return `url(#${id})`;
    }
    case 'image': {
      const id = ctx.nextId('p');
      if (fill.tile) {
        const tw = Math.max(4, w * 0.25 * fill.tile.sx);
        const th = Math.max(4, h * 0.25 * fill.tile.sy);
        ctx.defs.push(
          `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${r(tw)}" height="${r(th)}">` +
          `<image href="${esc(fill.src)}" width="${r(tw)}" height="${r(th)}" preserveAspectRatio="none"` +
          (fill.alpha !== undefined ? ` opacity="${r(fill.alpha)}"` : '') + '/></pattern>',
        );
      } else if (fill.crop && (fill.crop.l || fill.crop.t || fill.crop.r || fill.crop.b)) {
        // srcRect 裁剪：把原图放大到裁剪后正好铺满，再用 pattern 视口裁掉四周
        const c = fill.crop;
        const iw = w / Math.max(1 - c.l - c.r, 0.01);
        const ih = h / Math.max(1 - c.t - c.b, 0.01);
        ctx.defs.push(
          `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${r(w)}" height="${r(h)}">` +
          `<image href="${esc(fill.src)}" x="${r(-c.l * iw)}" y="${r(-c.t * ih)}" ` +
          `width="${r(iw)}" height="${r(ih)}" preserveAspectRatio="none"` +
          (fill.alpha !== undefined ? ` opacity="${r(fill.alpha)}"` : '') + '/></pattern>',
        );
      } else {
        ctx.defs.push(
          `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${r(w)}" height="${r(h)}">` +
          `<image href="${esc(fill.src)}" width="${r(w)}" height="${r(h)}" preserveAspectRatio="xMidYMid slice"` +
          (fill.alpha !== undefined ? ` opacity="${r(fill.alpha)}"` : '') + '/></pattern>',
        );
      }
      return `url(#${id})`;
    }
    case 'pattern': {
      const id = ctx.nextId('pt');
      const size = PATTERN_SIZE[fill.preset] ?? 8;
      const d = PATTERN_DEFS[fill.preset] ?? PATTERN_DEFS.pct50;
      const stroked = /^[MLQT].*[ML]/.test(d) && !d.includes('h') && !d.includes('v');
      ctx.defs.push(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${size}" height="${size}">` +
        `<rect width="${size}" height="${size}" fill="${fill.bg}"/>` +
        `<path d="${d}" ${stroked ? `stroke="${fill.fg}" stroke-width="1" fill="none"` : `fill="${fill.fg}"`}/>` +
        '</pattern>',
      );
      return `url(#${id})`;
    }
  }
}

// ---------------- 效果 ----------------

function effectFilter(effects: Effects | undefined, ctx: Ctx): string {
  if (!effects) return '';
  const parts: string[] = [];
  // 逐级串联：__IN__ 为上一级输出，__OUT__ 为本级命名结果
  let last = 'SourceGraphic';
  let seq = 0;
  const step = (markup: string): void => {
    const out = `e${++seq}`;
    parts.push(markup.replace(/__IN__/g, last).replace(/__OUT__/g, out));
    last = out;
  };

  if (effects.glow) {
    step(
      `<feDropShadow in="__IN__" dx="0" dy="0" stdDeviation="${r(effects.glow.radius / 2)}" ` +
      `flood-color="${effects.glow.color}" flood-opacity="1" result="__OUT__"/>`,
    );
  }
  const s = effects.shadow;
  if (s && !s.inner) {
    step(`<feDropShadow in="__IN__" dx="${r(s.dx)}" dy="${r(s.dy)}" stdDeviation="${r(s.blur / 2)}" flood-color="${s.color}" result="__OUT__"/>`);
  }
  if (s && s.inner) {
    // 内阴影：反转 SourceAlpha → 模糊 → 位移 → 与原 alpha 相交 → 上色 → 叠回本体
    const p = `is${seq}`;
    parts.push(
      `<feComponentTransfer in="SourceAlpha" result="${p}a"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>` +
      `<feGaussianBlur in="${p}a" stdDeviation="${r(s.blur / 2)}" result="${p}b"/>` +
      `<feOffset in="${p}b" dx="${r(s.dx)}" dy="${r(s.dy)}" result="${p}c"/>` +
      `<feComposite in="${p}c" in2="SourceAlpha" operator="in" result="${p}d"/>` +
      `<feFlood flood-color="${s.color}" result="${p}e"/>` +
      `<feComposite in="${p}e" in2="${p}d" operator="in" result="${p}f"/>`,
    );
    step(`<feComposite in="${p}f" in2="__IN__" operator="over" result="__OUT__"/>`);
  }
  if (effects.softEdge) {
    // 只羽化 alpha 通道，主体与文字保持锐利
    parts.push(
      `<feGaussianBlur in="SourceAlpha" stdDeviation="${r(effects.softEdge / 2)}" result="se"/>` +
      `<feComponentTransfer in="se" result="seMask"><feFuncA type="linear" slope="2.2" intercept="-0.6"/></feComponentTransfer>`,
    );
    step(`<feComposite in="__IN__" in2="seMask" operator="in" result="__OUT__"/>`);
  }
  if (!parts.length) return '';
  const id = ctx.nextId('f');
  ctx.defs.push(`<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%">${parts.join('')}</filter>`);
  return ` filter="url(#${id})"`;
}

/**
 * 倒影：把本体内容用 <use> 引出一份，沿底边镜像后向下平移 distance，
 * 再用线性渐变遮罩从 alpha 渐隐到 0；size 决定可见高度占本体的比例。
 * 倒影绘制在本体之前（层级更低），且不参与本体的滤镜。
 */
function reflectionLayer(el: ElementBase, refId: string, ctx: Ctx): string {
  const refl = el.effects?.reflection;
  if (!refl) return '';
  const alpha = Math.max(0, Math.min(1, refl.alpha));
  if (alpha <= 0 || el.h <= 0) return '';
  const dist = Math.max(0, refl.distance);
  const top = el.h + dist;
  const band = Math.max(1, el.h * Math.max(0.02, Math.min(1, refl.size)));
  // 横向留出余量，避免溢出形状框的文字被遮罩裁掉
  const mx = -el.w * 0.25;
  const mw = el.w * 1.5;
  const gid = ctx.nextId('rg');
  const mid = ctx.nextId('rm');
  ctx.defs.push(
    `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="${r(top)}" x2="0" y2="${r(top + band)}">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="${r(alpha)}"/>` +
    `<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`,
  );
  ctx.defs.push(
    `<mask id="${mid}" maskUnits="userSpaceOnUse" x="${r(mx)}" y="${r(top)}" width="${r(mw)}" height="${r(band)}">` +
    `<rect x="${r(mx)}" y="${r(top)}" width="${r(mw)}" height="${r(band)}" fill="url(#${gid})"/></mask>`,
  );
  return (
    `<g mask="url(#${mid})" aria-hidden="true">` +
    `<use href="#${refId}" xlink:href="#${refId}" transform="translate(0 ${r(2 * el.h + dist)}) scale(1 -1)"/></g>`
  );
}

/** 元素外层包装：定位 + 效果滤镜 + 倒影 */
function wrapEl(el: ElementBase, inner: string, ctx: Ctx): string {
  const filter = effectFilter(el.effects, ctx);
  if (!el.effects?.reflection) return `<g transform="${baseTransform(el)}"${filter}>${inner}</g>`;
  const rid = ctx.nextId('rc');
  const body = `<g id="${rid}">${inner}</g>`;
  return (
    `<g transform="${baseTransform(el)}">` +
    reflectionLayer(el, rid, ctx) +
    (filter ? `<g${filter}>${body}</g>` : body) +
    '</g>'
  );
}

// ---------------- 线端箭头 ----------------

const END_PATHS: Record<LineEnd['type'], { d: string; fill: boolean }> = {
  none: { d: '', fill: false },
  triangle: { d: 'M0 0 L10 5 L0 10 z', fill: true },
  stealth: { d: 'M0 0 L10 5 L0 10 L3 5 z', fill: true },
  diamond: { d: 'M0 5 L5 0 L10 5 L5 10 z', fill: true },
  oval: { d: 'M0 5 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0', fill: true },
  arrow: { d: 'M0 0 L10 5 L0 10', fill: false },
};

function marker(end: LineEnd, color: string, ctx: Ctx, atStart: boolean): string {
  const spec = END_PATHS[end.type];
  if (!spec.d) return '';
  const id = ctx.nextId('m');
  const mw = Math.max(1, end.h);
  const mh = Math.max(1, end.w);
  ctx.defs.push(
    `<marker id="${id}" viewBox="0 0 10 10" refX="${atStart ? 0 : 10}" refY="5" ` +
    `markerWidth="${r(mw)}" markerHeight="${r(mh)}" markerUnits="strokeWidth" ` +
    `orient="${atStart ? 'auto-start-reverse' : 'auto'}">` +
    `<path d="${spec.d}" ${spec.fill ? `fill="${color}"` : `fill="none" stroke="${color}" stroke-width="1.6"`}/></marker>`,
  );
  return `url(#${id})`;
}

function strokeAttrs(stroke: Stroke | null | undefined, ctx: Ctx): string {
  if (!stroke) return '';
  let out = ` stroke="${stroke.color}" stroke-width="${r(stroke.width)}"`;
  if (stroke.dash) out += ` stroke-dasharray="${stroke.dash.map(r).join(' ')}"`;
  if (stroke.cap) out += ` stroke-linecap="${stroke.cap}"`;
  if (stroke.join) out += ` stroke-linejoin="${stroke.join}"`;
  if (stroke.head) {
    const m = marker(stroke.head, stroke.color, ctx, true);
    if (m) out += ` marker-start="${m}"`;
  }
  if (stroke.tail) {
    const m = marker(stroke.tail, stroke.color, ctx, false);
    if (m) out += ` marker-end="${m}"`;
  }
  return out;
}

// ---------------- 变换 ----------------

function baseTransform(el: ElementBase): string {
  const parts: string[] = [];
  if (el.rot) parts.push(`rotate(${r(el.rot)} ${r(el.x + el.w / 2)} ${r(el.y + el.h / 2)})`);
  parts.push(`translate(${r(el.x)} ${r(el.y)})`);
  return parts.join(' ');
}

function flipTransform(el: ElementBase): string {
  if (!el.flipH && !el.flipV) return '';
  return `translate(${r(el.w / 2)} ${r(el.h / 2)}) scale(${el.flipH ? -1 : 1} ${el.flipV ? -1 : 1}) translate(${r(-el.w / 2)} ${r(-el.h / 2)})`;
}

/** 超链接包装：外部链接用 <a href>，内部跳转标记 data-slide 由 Viewer 处理 */
function withLink(inner: string, link: string | undefined): string {
  if (!link) return inner;
  if (link.startsWith('slide:')) {
    return `<a data-slide="${esc(link.slice(6))}" style="cursor:pointer">${inner}</a>`;
  }
  return `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
}

// ---------------- 元素分发 ----------------

/**
 * 单个元素渲染失败时的占位框。
 *
 * 存在的理由：一份 PPT 里只要有一个畸形形状，整页就会白屏——而用户看不出是哪一个。
 * 画成红色虚线框并把错误挂在 <title> 上，其余元素照常渲染；
 * 调用方可以用 `[data-render-error]` 统计失败数。
 */
function renderFailure(el: SlideElement, err: unknown): string {
  // 占位框自己也要能失败：元素坏到连 x/y/w/h 都读不出时，直接什么都不画，
  // 否则「一个元素不拖垮整页」这句保证就是假的
  try {
    const msg = err instanceof Error ? err.message : String(err);
    const label = el.name ? `${el.kind} · ${el.name}` : el.kind;
    return (
      `<g transform="${baseTransform(el)}" data-render-error="1">` +
      `<title>${esc(label)} 渲染失败：${esc(msg.slice(0, 200))}</title>` +
      `<rect width="${r(el.w)}" height="${r(el.h)}" fill="rgba(220,38,38,0.06)" ` +
      `stroke="#dc2626" stroke-width="1" stroke-dasharray="5 4"/></g>`
    );
  } catch {
    return '';
  }
}

function renderEl(el: SlideElement, ctx: Ctx): string {
  let out: string;
  try {
    switch (el.kind) {
      case 'shape': out = renderShape(el, ctx); break;
      case 'image': out = renderImage(el, ctx); break;
      case 'group': out = renderGroup(el, ctx); break;
      case 'table': out = renderTable(el, ctx); break;
      case 'unsupported': out = renderUnsupported(el); break;
    }
  } catch (e) {
    out = renderFailure(el, e);
  }
  // 动画需要按形状 id 定位到具体节点
  if (el.id !== undefined) {
    const hide = ctx.hidden?.has(el.id) ? 'visibility:hidden;' : '';
    out = `<g data-el="${el.id}" style="${hide}transform-box:fill-box;transform-origin:center">${out}</g>`;
  }
  return withLink(out, el.link);
}

/** 沿挤出方向复制若干层路径，形成等轴测风格的立体侧面 */
function extrusionLayers(el: ShapeElement, d3: Shape3D, baseColor: string): string {
  const depth = Math.min(d3.extrusion ?? 0, Math.max(el.w, el.h));
  if (depth <= 0.5) return '';
  const rotY = d3.rotY ?? 0;
  const rotX = d3.rotX ?? 0;
  // 观察角决定偏移方向：默认略微右下
  const ang = ((rotY || 35) * Math.PI) / 180;
  const dx = Math.cos(ang) * depth;
  const dy = Math.sin(((rotX || 20) * Math.PI) / 180) * depth;
  const side = d3.extrusionColor ?? mix(baseColor, '#000', 0.32);
  const steps = Math.max(2, Math.min(14, Math.round(depth)));
  const out: string[] = [];
  for (let i = steps; i >= 1; i--) {
    const t = i / steps;
    out.push(
      `<g transform="translate(${r(dx * t)} ${r(dy * t)})">` +
      `<path d="${el.path}" fill="${side}" fill-rule="nonzero"/></g>`,
    );
  }
  return out.join('');
}

/** 顶部斜角：沿轮廓内侧叠一圈浅色描边模拟受光边，裁进形状避免溢出 */
function bevelOverlay(el: ShapeElement, d3: Shape3D, baseColor: string, ctx: Ctx): string {
  const b = d3.bevelTop ?? 0;
  if (b <= 0.3 || !el.path) return '';
  const light = mix(baseColor, '#fff', 0.5);
  const dark = mix(baseColor, '#000', 0.25);
  const w = Math.min(b * 2, Math.min(el.w, el.h) / 3);
  const id = ctx.nextId('bv');
  ctx.defs.push(`<clipPath id="${id}"><path d="${el.path}"/></clipPath>`);
  // 描边宽度的一半落在轮廓外，被裁掉后正好只剩内侧一圈
  return (
    `<g clip-path="url(#${id})">` +
    `<path d="${el.path}" fill="none" stroke="${light}" stroke-width="${r(w)}" stroke-linejoin="round" opacity="0.55"/>` +
    `<path d="${el.path}" fill="none" stroke="${dark}" stroke-width="${r(w / 3)}" stroke-linejoin="round" opacity="0.35" transform="translate(0 ${r(w / 3)})"/>` +
    '</g>'
  );
}

/** 颜色混合：css 颜色 + 目标色，ratio 为目标色占比 */
function mix(color: string, target: string, ratio: number): string {
  const parse = (c: string): [number, number, number] => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map((v) => Number(v.trim()));
      return [p[0] || 0, p[1] || 0, p[2] || 0];
    }
    const hex = c.replace('#', '');
    if (hex.length >= 6) {
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }
    return [128, 128, 128];
  };
  const a = parse(color);
  const b = parse(target);
  const out = a.map((v, i) => Math.round(v * (1 - ratio) + b[i] * ratio));
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}

function renderShape(el: ShapeElement, ctx: Ctx): string {
  let inner = '';
  if (el.path) {
    const fillVal = el.openGeom ? 'none' : el.fill ? paint(el.fill, ctx, el.w, el.h) : 'none';
    const solidBase = el.fill?.type === 'solid' ? el.fill.color
      : el.fill?.type === 'gradient' && el.fill.stops.length ? el.fill.stops[0].color
      : 'rgb(128,128,128)';

    // 立体：先画挤出侧面，再画正面，最后叠斜角高光
    const d3 = el.scene3d;
    if (d3) inner += extrusionLayers(el, d3, solidBase);

    const contour = d3?.contourWidth
      ? ` stroke="${d3.contourColor ?? mix(solidBase, '#000', 0.45)}" stroke-width="${r(d3.contourWidth)}"`
      : strokeAttrs(el.stroke, ctx);
    const pathEl = `<path d="${el.path}" fill="${fillVal}" fill-rule="nonzero"${contour}/>`;
    const flip = flipTransform(el);
    inner += flip ? `<g transform="${flip}">${pathEl}</g>` : pathEl;

    if (d3) inner += bevelOverlay(el, d3, solidBase, ctx);
  }
  if (el.text) inner += renderText(el.text, el.w, el.h, ctx);
  return wrapEl(el, inner, ctx);
}

// ---------------- 媒体标识 ----------------

/**
 * 音视频对象的播放标识：半透明圆底 + 播放三角（音频用喇叭）。
 * 尺寸随元素收缩，太小的对象只画一个实心圆点，避免糊成一团。
 */
function mediaBadge(el: ImageElement, media: MediaInfo): string {
  const rad = Math.max(6, Math.min(Math.min(el.w, el.h) * 0.22, 34));
  const cx = el.w / 2;
  const cy = el.h / 2;
  const ring =
    `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rad)}" fill="rgba(17,17,17,0.55)" ` +
    `stroke="rgba(255,255,255,0.92)" stroke-width="${r(Math.max(1, rad * 0.09))}"/>`;

  let glyph: string;
  if (media.kind === 'audio') {
    // 喇叭：矩形箱体 + 三角号角 + 两道声波
    const u = rad * 0.42;
    const bx = cx - u * 1.15;
    glyph =
      `<path d="M${r(bx)} ${r(cy - u * 0.42)} H${r(bx + u * 0.62)} L${r(bx + u * 1.5)} ${r(cy - u)} ` +
      `V${r(cy + u)} L${r(bx + u * 0.62)} ${r(cy + u * 0.42)} H${r(bx)} Z" fill="#fff"/>` +
      `<path d="M${r(cx + u * 0.65)} ${r(cy - u * 0.6)} A ${r(u * 0.75)} ${r(u * 0.75)} 0 0 1 ${r(cx + u * 0.65)} ${r(cy + u * 0.6)}" ` +
      `fill="none" stroke="#fff" stroke-width="${r(Math.max(1, u * 0.26))}" stroke-linecap="round"/>` +
      `<path d="M${r(cx + u * 1.15)} ${r(cy - u * 1.05)} A ${r(u * 1.35)} ${r(u * 1.35)} 0 0 1 ${r(cx + u * 1.15)} ${r(cy + u * 1.05)}" ` +
      `fill="none" stroke="#fff" stroke-width="${r(Math.max(1, u * 0.26))}" stroke-linecap="round" opacity="0.85"/>`;
  } else {
    const t = rad * 0.46;
    glyph =
      `<path d="M${r(cx - t * 0.62)} ${r(cy - t)} L${r(cx + t)} ${r(cy)} L${r(cx - t * 0.62)} ${r(cy + t)} Z" fill="#fff"/>`;
  }

  const label = media.kind === 'audio' ? '音频' : '视频';
  const note = media.src ? (media.external ? `${label}（外链）` : label) : `${label}（源不可用）`;
  return `<g aria-hidden="true" pointer-events="none"><title>${esc(note)}</title>${ring}${glyph}</g>`;
}

/** 真实播放器：<video> 用封面帧做 poster，<audio> 贴底显示以免盖住封面 */
function mediaPlayer(el: ImageElement, media: MediaInfo): string {
  const common = 'width:100%;height:100%;display:block;object-fit:contain;background:#000';
  const inner = media.kind === 'audio'
    ? `<audio controls preload="none" src="${esc(media.src ?? '')}" style="width:100%;display:block"></audio>`
    : `<video controls preload="metadata" src="${esc(media.src ?? '')}"`
      + (el.src ? ` poster="${esc(el.src)}"` : '')
      + ` style="${common}"></video>`;
  // 音频控件本身很矮，贴在元素底部，上面仍露出封面帧
  const h = media.kind === 'audio' ? Math.min(el.h, 54) : el.h;
  const y = media.kind === 'audio' ? el.h - h : 0;
  return `<foreignObject x="0" y="${r(y)}" width="${r(el.w)}" height="${r(h)}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%">${inner}</div>`
    + '</foreignObject>';
}

function renderImage(el: ImageElement, ctx: Ctx): string {
  const attrs =
    (el.alpha !== undefined && el.alpha < 1 ? ` opacity="${r(el.alpha)}"` : '') +
    (el.filter ? ` style="filter:${el.filter}"` : '');

  let img: string;
  if (!el.src) {
    // 媒体对象没有封面帧时给个深色底板，播放标识才有依托
    img = `<rect width="${r(el.w)}" height="${r(el.h)}" fill="rgb(38,42,48)"/>`;
  } else if (el.crop && (el.crop.l || el.crop.t || el.crop.r || el.crop.b)) {
    const iw = el.w / Math.max(1 - el.crop.l - el.crop.r, 0.01);
    const ih = el.h / Math.max(1 - el.crop.t - el.crop.b, 0.01);
    const id = ctx.nextId('c');
    ctx.defs.push(`<clipPath id="${id}"><rect width="${r(el.w)}" height="${r(el.h)}"/></clipPath>`);
    img =
      `<g clip-path="url(#${id})"><image href="${esc(el.src)}" x="${r(-el.crop.l * iw)}" y="${r(-el.crop.t * ih)}"` +
      ` width="${r(iw)}" height="${r(ih)}" preserveAspectRatio="none"${attrs}/></g>`;
  } else {
    img = `<image href="${esc(el.src)}" width="${r(el.w)}" height="${r(el.h)}" preserveAspectRatio="none"${attrs}/>`;
  }

  if (el.clipPath) {
    const cid = ctx.nextId('cs');
    ctx.defs.push(`<clipPath id="${cid}"><path d="${el.clipPath}"/></clipPath>`);
    img = `<g clip-path="url(#${cid})">${img}</g>`;
  }
  if (el.stroke) {
    img += `<path d="${el.clipPath ?? `M0 0 H${r(el.w)} V${r(el.h)} H0 Z`}" fill="none"${strokeAttrs(el.stroke, ctx)}/>`;
  }

  const flip = flipTransform(el);
  if (flip) img = `<g transform="${flip}">${img}</g>`;
  // 播放标识画在翻转之外，避免图标被镜像
  if (el.media) {
    img += ctx.media === 'player' && el.media.src
      ? mediaPlayer(el, el.media)
      : mediaBadge(el, el.media);
  }
  return wrapEl(el, img, ctx);
}

function renderGroup(el: GroupElement, ctx: Ctx): string {
  const childXf = `scale(${r(el.scaleX || 1)} ${r(el.scaleY || 1)}) translate(${r(-el.childX)} ${r(-el.childY)})`;
  const children = el.children.map((c) => renderEl(c, ctx)).join('');
  return wrapEl(el, `<g transform="${flipTransform(el)} ${childXf}">${children}</g>`, ctx);
}

// ---------------- 表格 ----------------

const DEFAULT_BORDER: Stroke = { color: 'rgba(0,0,0,0.25)', width: 1, dash: null };

function borderLine(s: Stroke | null | undefined, x1: number, y1: number, x2: number, y2: number, ctx: Ctx): string {
  if (s === null) return '';
  const stroke = s ?? DEFAULT_BORDER;
  return `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}"${strokeAttrs(stroke, ctx)}/>`;
}

function renderTable(el: TableElement, ctx: Ctx): string {
  const parts: string[] = [];
  const lines: string[] = [];
  let y = 0;
  el.rows.forEach((row, ri) => {
    let x = 0;
    row.cells.forEach((cell, ci) => {
      const cw = el.colWidths.slice(ci, ci + cell.colSpan).reduce((a, b) => a + b, 0) || el.colWidths[ci] || 0;
      if (cell.merged) {
        x += el.colWidths[ci] ?? 0;
        return;
      }
      const ch = el.rows.slice(ri, ri + cell.rowSpan).reduce((a, b) => a + b.height, 0) || row.height;
      const fillVal = cell.fill ? paint(cell.fill, ctx, cw, ch) : 'none';
      const b: CellBorders = cell.borders ?? {};

      parts.push(
        `<g${ctx.includeEditMarkers ? ` data-table-cell="${ri}:${ci}"` : ''} transform="translate(${r(x)} ${r(y)})">` +
        `<rect width="${r(cw)}" height="${r(ch)}" fill="${fillVal}"/>` +
        (cell.text ? renderText(cell.text, cw, ch, ctx, cell.margins, cell.vAlign, cell.vert) : '') +
        '</g>',
      );
      // 边框单独一层，避免被后续单元格背景遮挡
      lines.push(
        `<g transform="translate(${r(x)} ${r(y)})">` +
        borderLine(b.t, 0, 0, cw, 0, ctx) +
        borderLine(b.b, 0, ch, cw, ch, ctx) +
        borderLine(b.l, 0, 0, 0, ch, ctx) +
        borderLine(b.r, cw, 0, cw, ch, ctx) +
        '</g>',
      );
      x += el.colWidths[ci] ?? 0;
    });
    y += row.height;
  });
  const content = parts.join('') + lines.join('');
  return wrapEl(el, el.flipH || el.flipV
    ? `<g transform="${flipTransform(el)}">${content}</g>`
    : content, ctx);
}

// ---------------- 批注标记 ----------------

/**
 * 批注：锚点处画一个带序号的小气泡，hover 出作者 / 时间 / 正文。
 * 只在 RenderOptions.showComments 打开时绘制，坐标裁进画布避免跑到视口外。
 */
function renderComments(comments: SlideComment[] | undefined, W: number, H: number): string {
  if (!comments?.length) return '';
  const s = Math.max(14, Math.min(W, H) * 0.036);
  const out: string[] = [];
  comments.forEach((c, i) => {
    const x = Math.max(0, Math.min(Number.isFinite(c.x) ? c.x : 0, W - s));
    const y = Math.max(0, Math.min(Number.isFinite(c.y) ? c.y : 0, H - s));
    const label = String(c.idx ?? i + 1);
    const tip = [c.author, c.date, c.text].filter(Boolean).join(' · ');
    out.push(
      `<g class="ppt-comment" data-comment="${esc(label)}" transform="translate(${r(x)} ${r(y)})">` +
      `<title>${esc(tip)}</title>` +
      // 气泡本体 + 左下角小尾巴
      `<path d="M${r(s * 0.16)} 0 H${r(s * 0.84)} A ${r(s * 0.16)} ${r(s * 0.16)} 0 0 1 ${r(s)} ${r(s * 0.16)} ` +
      `V${r(s * 0.62)} A ${r(s * 0.16)} ${r(s * 0.16)} 0 0 1 ${r(s * 0.84)} ${r(s * 0.78)} ` +
      `H${r(s * 0.42)} L${r(s * 0.16)} ${r(s)} V${r(s * 0.78)} A ${r(s * 0.16)} ${r(s * 0.16)} 0 0 1 0 ${r(s * 0.62)} ` +
      `V${r(s * 0.16)} A ${r(s * 0.16)} ${r(s * 0.16)} 0 0 1 ${r(s * 0.16)} 0 Z" ` +
      `fill="rgb(255,196,60)" stroke="rgba(120,80,0,0.55)" stroke-width="${r(Math.max(0.6, s * 0.045))}"/>` +
      `<text x="${r(s * 0.5)}" y="${r(s * 0.42)}" text-anchor="middle" dominant-baseline="central" ` +
      `fill="rgb(60,40,0)" font-size="${r(s * 0.52)}" font-weight="700">${esc(label)}</text>` +
      '</g>',
    );
  });
  return out.join('');
}

function renderUnsupported(el: UnsupportedElement): string {
  const fs = Math.max(10, Math.min(16, el.h / 6));
  return (
    `<g transform="${baseTransform(el)}">` +
    `<rect width="${r(el.w)}" height="${r(el.h)}" fill="rgba(127,127,127,0.07)" stroke="#aaa" stroke-dasharray="6 4"/>` +
    `<text x="${r(el.w / 2)}" y="${r(el.h / 2)}" text-anchor="middle" dominant-baseline="middle" fill="#888" font-size="${r(fs)}">${esc(el.label)}</text>` +
    '</g>'
  );
}

// ---------------- 文本 ----------------

function renderText(
  t: TextBody,
  w: number,
  h: number,
  ctx: Ctx,
  marginsOverride?: [number, number, number, number],
  vAlignOverride?: 'top' | 'middle' | 'bottom',
  vertOverride?: TextBody['vert'],
): string {
  // 艺术字变形无法用 HTML 排版表达，强制走 SVG 文本路径，保证屏幕与导出一致。
  if (ctx.textMode === 'svg' || warpSupported(t.warp?.preset)) {
    // HTML 公共入口内部也做这一步；这里仅为独立 SVG 路径保留同一语义。
    if (t.autoFitCompute && !t.autoFitShape) {
      const scale = resolveTextScale(t, w, h);
      if (scale !== t.fontScale) t = { ...t, fontScale: scale };
    }
    const addDef = (markup: string): string => {
      const id = ctx.nextId('tg');
      ctx.defs.push(markup.replace('__ID__', id));
      return id;
    };
    return renderTextSvg(t, w, h, addDef, marginsOverride, vAlignOverride);
  }
  const html = renderTextBodyToHtml(t, w, h, {
    insets: marginsOverride,
    anchor: vAlignOverride,
    vert: vertOverride,
    includeEditMarkers: false,
  });
  return `<foreignObject width="${r(w)}" height="${r(h)}" style="overflow:visible">${html}</foreignObject>`;
}
