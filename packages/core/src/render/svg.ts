import type {
  CellBorders, ElementBase, GroupElement, ImageElement, LineEnd, MediaInfo, Presentation,
  ShapeElement, Slide, SlideComment, SlideElement, Stroke, TableElement, TextBody,
  UnsupportedElement,
} from '../types';
import { renderTextBodyToHtml } from './text-html';
import { resolveTextScale } from './text-layout';
import { renderTextSvg } from './text-svg';
import { withHyperlink } from './hyperlink';
import { warpSupported } from './text-warp-presets';
import { paint } from './fill';
import { effectFilter, reflectionLayer } from './effect-svg';
import { bevelOverlay, extrusionLayers, mixShapeColor } from './shape-3d';

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
// DrawingML srcRect 以十万分数存储；合法编辑值最小可见比例是 1/100000，不能擅自钳到 1%。
const MIN_CROP_FRACTION = 1 / 100000;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Ctx {
  defs: string[];
  nextId: (prefix: string) => string;
  textMode: 'html' | 'svg';
  media: 'badge' | 'player';
  hidden: ReadonlySet<number> | null;
  includeEditMarkers: boolean;
  resolveLink: (link: string | undefined) => string | undefined;
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
    resolveLink: (link) => link,
  };
}

function presentationLinkResolver(
  pres: Presentation,
  slide: Slide,
): (link: string | undefined) => string | undefined {
  const current = pres.slides.indexOf(slide) + 1;
  return (link) => {
    if (!link) return link;
    if (link.startsWith('slide-part:')) {
      try {
        const part = decodeURIComponent(link.slice('slide-part:'.length));
        const index = pres.slides.findIndex((candidate) => candidate.editInfo?.origin.part === part);
        return index < 0 ? link : `slide:${index + 1}`;
      } catch { return link; }
    }
    if (!link.startsWith('slide:')) return link;
    if (link === 'slide:next') return `slide:${current + 1}`;
    if (link === 'slide:previous') return `slide:${current - 1}`;
    if (link === 'slide:first') return 'slide:1';
    if (link === 'slide:last') return `slide:${pres.slides.length}`;
    return link;
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
  ctx.resolveLink = presentationLinkResolver(pres, slide);
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
  return withHyperlink(out, ctx.resolveLink(el.link));
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
      ? ` stroke="${d3.contourColor ?? mixShapeColor(solidBase, '#000', 0.45)}" stroke-width="${r(d3.contourWidth)}"`
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
    const iw = el.w / Math.max(1 - el.crop.l - el.crop.r, MIN_CROP_FRACTION);
    const ih = el.h / Math.max(1 - el.crop.t - el.crop.b, MIN_CROP_FRACTION);
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
  if (t.paragraphs.some((paragraph) => paragraph.runs.some((run) =>
    run.link?.startsWith('slide-part:') || /^slide:(next|previous|first|last)$/.test(run.link ?? '')))) {
    t = { ...t, paragraphs: t.paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: paragraph.runs.map((run) => {
        const link = ctx.resolveLink(run.link);
        return link === run.link ? run : { ...run, link };
      }),
    })) };
  }
  // 艺术字变形无法用 HTML 排版表达，强制走 SVG 文本路径，保证屏幕与导出一致。
  if (ctx.textMode === 'svg' || warpSupported(t.warp?.preset)) {
    // HTML 公共入口内部也做这一步；这里仅为独立 SVG 路径保留同一语义。
    if (t.autoFitCompute && !t.autoFitShape) {
      const scale = resolveTextScale(t, w, h, undefined, {
        insets: marginsOverride,
        vert: vertOverride,
      });
      if (scale !== t.fontScale) t = { ...t, fontScale: scale };
    }
    const addDef = (markup: string): string => {
      const id = ctx.nextId('tg');
      ctx.defs.push(markup.replace('__ID__', id));
      return id;
    };
    return renderTextSvg(
      vertOverride && vertOverride !== t.vert ? { ...t, vert: vertOverride } : t,
      w, h, addDef, marginsOverride, vAlignOverride, ctx.includeEditMarkers,
    );
  }
  const html = renderTextBodyToHtml(t, w, h, {
    insets: marginsOverride,
    anchor: vAlignOverride,
    vert: vertOverride,
    includeEditMarkers: ctx.includeEditMarkers,
  });
  return `<foreignObject width="${r(w)}" height="${r(h)}" style="overflow:visible">${html}</foreignObject>`;
}
