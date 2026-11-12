/**
 * 形状共用属性：xfrm 变换、编辑元数据、填充 / 描边、p:style 主题引用，以及新增形状的默认外观。
 */
import { PLACEHOLDER_DIRECT_BITS, placeholderDirectFlags } from '../edit-metadata';
import type { ElementBase, Fill, ImageTileAlignment, Slide, Stroke } from '../types';
import type { PlaceholderDirectFlags } from '../edit-metadata';
import { attr, boolAttr, emu, kid, kids, numAttr, parseXml } from '../xml';
import { childColor } from './color';
import { parseEffects, parseLineEnd } from './effects';
import { extractLstStyle, parseTextBody } from './text';
import type { LevelStyles } from './text';
import { parseElementAltText } from './alt-text';
import type { Env } from './slide-inheritance';

// ---------------- 变换 ----------------

export interface XfrmInfo extends ElementBase {
  chX: number;
  chY: number;
  chW: number;
  chH: number;
}

export function parseXfrm(x: Element | null): XfrmInfo | null {
  if (!x) return null;
  const off = kid(x, 'off');
  const ext = kid(x, 'ext');
  const chOff = kid(x, 'chOff');
  const chExt = kid(x, 'chExt');
  return {
    x: emu(numAttr(off, 'x')),
    y: emu(numAttr(off, 'y')),
    w: emu(numAttr(ext, 'cx')),
    h: emu(numAttr(ext, 'cy')),
    rot: (numAttr(x, 'rot') ?? 0) / 60000,
    flipH: boolAttr(x, 'flipH'),
    flipV: boolAttr(x, 'flipV'),
    chX: emu(numAttr(chOff, 'x')),
    chY: emu(numAttr(chOff, 'y')),
    chW: emu(numAttr(chExt, 'cx')),
    chH: emu(numAttr(chExt, 'cy')),
  };
}

export const base = (xf: XfrmInfo): ElementBase => ({
  x: xf.x,
  y: xf.y,
  w: xf.w,
  h: xf.h,
  rot: xf.rot,
  flipH: xf.flipH,
  flipV: xf.flipV,
});

export function movementLocked(nv: Element | null): boolean {
  const props = kid(nv, 'cNvSpPr') ?? kid(nv, 'cNvCxnSpPr') ?? kid(nv, 'cNvPicPr') ?? kid(nv, 'cNvGrpSpPr') ?? kid(nv, 'cNvGraphicFramePr');
  const locks =
    kid(props, 'spLocks')
    ?? kid(props, 'cxnSpLocks')
    ?? kid(props, 'picLocks')
    ?? kid(props, 'grpSpLocks')
    ?? kid(props, 'graphicFrameLocks');
  return boolAttr(locks, 'noMove');
}

export function editInfoOf(
  env: Env,
  cNvPr: Element | null,
  ph: Element | null = null,
  geom?: NonNullable<ElementBase['editInfo']>['geom'],
  editable?: NonNullable<ElementBase['editInfo']>['editable'],
  moveLocked = false,
  readonlyLink = false,
  placeholderDirect: PlaceholderDirectFlags = placeholderDirectFlags(0),
  customGeometry?: NonNullable<ElementBase['editInfo']>['customGeometry'],
): Partial<Pick<ElementBase, 'editInfo'>> {
  if (!env.edit) return {};
  const spid = numAttr(cNvPr, 'id');
  const editInfo: NonNullable<ElementBase['editInfo']> = {};
  if (spid !== null) editInfo.origin = { part: env.partPath, spid };
  if (ph) {
    const idx = attr(ph, 'idx');
    editInfo.placeholder = {
      type: attr(ph, 'type') ?? 'obj',
      ...(idx === null ? {} : { idx }),
    };
  }
  if (geom) editInfo.geom = geom;
  if (customGeometry) editInfo.customGeometry = customGeometry;
  if (ph && placeholderDirect) editInfo.placeholderDirect = placeholderDirect;
  if (editable) editInfo.editable = editable;
  if (moveLocked) editInfo.moveLocked = true;
  if (readonlyLink) editInfo.readonlyLink = true;
  const altText = parseElementAltText(cNvPr);
  if (altText) editInfo.altText = altText;
  return editInfo.origin
    || editInfo.placeholder
    || editInfo.placeholderDirect
    || editInfo.geom
    || editInfo.customGeometry
    || editInfo.editable
    || editInfo.moveLocked
    || editInfo.readonlyLink
    || editInfo.altText
    ? { editInfo }
    : {};
}

export function withPhClr(env: Env, phClr: string | null): Env {
  return phClr ? { ...env, ctx: { ...env.ctx, phClr } } : env;
}

// ---------------- 填充 / 描边 ----------------

const FILL_TAGS = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'];

export function placeholderDirectBits(spPr: Element | null, style: Element | null): PlaceholderDirectFlags {
  let bits = 0;
  if (kid(spPr, 'xfrm')) bits |= PLACEHOLDER_DIRECT_BITS.transform;
  if (kid(spPr, 'prstGeom') || kid(spPr, 'custGeom')) bits |= PLACEHOLDER_DIRECT_BITS.geometry;
  if (FILL_TAGS.some((tag) => !!kid(spPr, tag))) bits |= PLACEHOLDER_DIRECT_BITS.fill;
  if (kid(spPr, 'ln')) bits |= PLACEHOLDER_DIRECT_BITS.stroke;
  if (kid(spPr, 'effectLst') || kid(spPr, 'effectDag')) bits |= PLACEHOLDER_DIRECT_BITS.effects;
  if (style) bits |= PLACEHOLDER_DIRECT_BITS.style;
  return placeholderDirectFlags(bits);
}
const TILE_ALIGNMENTS = new Set<ImageTileAlignment>(['tl', 't', 'tr', 'l', 'ctr', 'r', 'bl', 'b', 'br']);

export function parseFillProps(container: Element | null, env: Env): Fill | null {
  if (!container) return null;
  for (const tag of FILL_TAGS) {
    const el = kid(container, tag);
    if (el) return parseFillElement(el, env);
  }
  return null;
}

export function parseFillElement(el: Element | null, env: Env): Fill | null {
  if (!el) return null;
  switch (el.localName) {
    case 'noFill':
      return { type: 'none' };
    case 'solidFill':
      return { type: 'solid', color: childColor(el, env.ctx) ?? 'rgb(0,0,0)' };
    case 'gradFill': {
      const stops = kids(kid(el, 'gsLst'), 'gs')
        .map((gs) => ({ pos: (numAttr(gs, 'pos') ?? 0) / 100000, color: childColor(gs, env.ctx) ?? 'rgb(0,0,0)' }))
        .sort((a, b) => a.pos - b.pos);
      if (!stops.length) return null;
      const path = kid(el, 'path');
      if (path) return { type: 'gradient', angle: 0, stops, radial: true };
      const lin = kid(el, 'lin');
      return { type: 'gradient', angle: lin ? (numAttr(lin, 'ang') ?? 0) / 60000 : 90, stops };
    }
    case 'blipFill': {
      const src = blipUrl(el, env);
      if (!src) return { type: 'none' };
      const tileEl = kid(el, 'tile');
      const alphaMod = numAttr(kid(kid(el, 'blip'), 'alphaModFix'), 'amt');
      // srcRect 不只出现在 p:pic 上——形状的图片填充同样可以裁剪
      const srcRect = kid(el, 'srcRect');
      const frac = (name: string): number => (numAttr(srcRect, name) ?? 0) / 100000;
      const hasCrop = !!srcRect && ['l', 't', 'r', 'b'].some((name) => attr(srcRect, name) !== null);
      const target = blipTarget(el, env);
      const metadata = target && !/^https?:/i.test(target) ? env.pkg.imageMetadata(target) : null;
      const dpi = numAttr(el, 'dpi') ?? 0;
      const physical = metadata
        ? {
            sourceWidth: (metadata.width * 96) / (dpi > 0 ? dpi : metadata.dpiX),
            sourceHeight: (metadata.height * 96) / (dpi > 0 ? dpi : metadata.dpiY),
          }
        : {};
      const alignment = attr(tileEl, 'algn');
      const tileAlignment = TILE_ALIGNMENTS.has(alignment as ImageTileAlignment) ? (alignment as ImageTileAlignment) : 'tl';
      return {
        type: 'image',
        src,
        alpha: alphaMod !== null ? alphaMod / 100000 : undefined,
        crop: hasCrop ? { l: frac('l'), t: frac('t'), r: frac('r'), b: frac('b') } : undefined,
        tile: tileEl
          ? {
              sx: (numAttr(tileEl, 'sx') ?? 100000) / 100000,
              sy: (numAttr(tileEl, 'sy') ?? 100000) / 100000,
              flip: attr(tileEl, 'flip') ?? 'none',
              tx: emu(numAttr(tileEl, 'tx') ?? 0),
              ty: emu(numAttr(tileEl, 'ty') ?? 0),
              algn: tileAlignment,
              ...physical,
            }
          : undefined,
      };
    }
    case 'pattFill':
      return {
        type: 'pattern',
        fg: childColor(kid(el, 'fgClr'), env.ctx) ?? 'rgb(0,0,0)',
        bg: childColor(kid(el, 'bgClr'), env.ctx) ?? 'rgba(0,0,0,0)',
        preset: attr(el, 'prst') ?? 'pct50',
      };
    case 'grpFill':
      return null;
  }
  return null;
}

function blipTarget(blipFill: Element | null, env: Env): string | null {
  const blip = kid(blipFill, 'blip');
  // PowerPoint 总在 a:blip 上留位图兼容副本；WPS 插入的图标常只写 extLst 里的 asvg:svgBlip。
  const svgBlip =
    kids(kid(blip, 'extLst'), 'ext')
      .map((ext) => kid(ext, 'svgBlip'))
      .find((node): node is Element => node !== null) ?? null;
  const rid = attr(blip, 'r:embed') ?? attr(blip, 'r:link') ?? attr(svgBlip, 'r:embed') ?? attr(svgBlip, 'r:link');
  return rid ? (env.rels[rid]?.target ?? null) : null;
}

export function blipUrl(blipFill: Element | null, env: Env): string | null {
  const target = blipTarget(blipFill, env);
  if (!target) return null;
  if (/^https?:/i.test(target)) return target;
  return env.pkg.mediaUrl(target);
}

/** blip 的图像效果 → CSS filter */
export function blipFilter(blipFill: Element | null): string | undefined {
  const blip = kid(blipFill, 'blip');
  if (!blip) return undefined;
  const parts: string[] = [];
  if (kid(blip, 'grayscl')) parts.push('grayscale(1)');
  const lum = kid(blip, 'lum');
  if (lum) {
    const bright = (numAttr(lum, 'bright') ?? 0) / 100000;
    const contrast = (numAttr(lum, 'contrast') ?? 0) / 100000;
    if (bright) parts.push(`brightness(${(1 + bright).toFixed(2)})`);
    if (contrast) parts.push(`contrast(${(1 + contrast).toFixed(2)})`);
  }
  return parts.length ? parts.join(' ') : undefined;
}

const DASH: Record<string, number[]> = {
  dash: [4, 3],
  dashDot: [4, 3, 1, 3],
  dot: [1, 3],
  lgDash: [8, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 3],
  sysDashDot: [3, 3, 1, 3],
  sysDashDotDot: [3, 3, 1, 3, 1, 3],
  sysDot: [1, 1],
};

const CAPS: Record<string, Stroke['cap']> = { flat: 'butt', rnd: 'round', sq: 'square' };

/** 解析 a:ln 元素；themeLn 为主题线样式（已带 phClr 的 env） */
export function parseLnElement(ln: Element | null, env: Env, fallback: Stroke | null): Stroke | null {
  if (!ln) return fallback;
  if (kid(ln, 'noFill')) return null;
  const width = numAttr(ln, 'w') !== null ? emu(numAttr(ln, 'w')!) : (fallback?.width ?? 1);
  const fill = parseFillProps(ln, env);
  let color = fallback?.color ?? null;
  if (fill?.type === 'solid') color = fill.color;
  else if (fill?.type === 'gradient' && fill.stops.length) color = fill.stops[0].color;
  if (!color) return fallback ? { ...fallback, width } : null;

  const dashName = attr(kid(ln, 'prstDash'), 'val');
  const unit = Math.max(width, 1);
  const dash = dashName ? (dashName === 'solid' ? null : (DASH[dashName] ?? [4, 3]).map((m) => m * unit)) : (fallback?.dash ?? null);

  const head = parseLineEnd(kid(ln, 'headEnd')) ?? fallback?.head;
  const tail = parseLineEnd(kid(ln, 'tailEnd')) ?? fallback?.tail;
  const cap = CAPS[attr(ln, 'cap') ?? ''] ?? fallback?.cap;
  const join = kid(ln, 'round') ? 'round' : kid(ln, 'bevel') ? 'bevel' : kid(ln, 'miter') ? 'miter' : fallback?.join;

  return { color, width, dash, cap, join, head, tail, compound: attr(ln, 'cmpd') ?? fallback?.compound };
}

/**
 * 非占位符形状的 fontRef 颜色压过 presentation defaultTextStyle 的方案色：
 * PowerPoint 新建形状的白字靠它，而 defaultTextStyle 几乎总写着 tx1。
 * 只把它当兜底色会让每个真实文件里的白字变黑；形状自己的 lstStyle 与 rPr 仍在它之后。
 */
export function styleTextColorLayer(color: string | null): LevelStyles[] {
  return color ? [{ def: { rp: { color } }, lvls: [] }] : [];
}

/** p:style 的主题引用 → 底层样式 */
export function resolveStyleRefs(
  style: Element | null,
  env: Env,
): { fill: Fill | null; stroke: Stroke | null; fontColor: string | null; effects: ReturnType<typeof parseEffects> } {
  if (!style) return { fill: null, stroke: null, fontColor: null, effects: undefined };
  const pick = (refName: string, list: Element[]): { el: Element | null; env: Env } => {
    const ref = kid(style, refName);
    const idx = Number(attr(ref, 'idx') ?? '0');
    if (!ref || !idx) return { el: null, env };
    const phClr = childColor(ref, env.ctx);
    return { el: list[Math.min(idx, list.length) - 1] ?? null, env: withPhClr(env, phClr) };
  };
  const f = pick('fillRef', env.theme.fillStyles);
  const l = pick('lnRef', env.theme.lnStyles);
  const e = pick('effectRef', env.theme.effectStyles);
  return {
    fill: f.el ? parseFillElement(f.el, f.env) : null,
    stroke: l.el ? parseLnElement(l.el, l.env, null) : null,
    fontColor: childColor(kid(style, 'fontRef'), env.ctx),
    effects: e.el ? parseEffects(kid(e.el, 'effectLst') ?? e.el, e.env.ctx) : undefined,
  };
}

let creationShapeParts: { style: Element; text: Element } | null = null;
const CREATION_SHAPE_STYLE = `<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef>
<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>
<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>`;
const CREATION_SHAPE_TEXT = `<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="zh-CN"/></a:p></p:txBody>`;

function defaultShapeParts(): { style: Element; text: Element } {
  if (creationShapeParts) return creationShapeParts;
  const root =
    parseXml(`<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
${CREATION_SHAPE_STYLE}
${CREATION_SHAPE_TEXT}
</root>`);
  creationShapeParts = { style: kid(root, 'style')!, text: kid(root, 'txBody')! };
  return creationShapeParts;
}

/** 与真正写入的 p:style/txBody 共用语义，在当前页主题上先求值供即时投影使用。 */
export function defaultShapeEditInfo(env: Env): NonNullable<Slide['editInfo']>['defaultShape'] {
  const source = defaultShapeParts();
  const style = resolveStyleRefs(source.style, env);
  const textTemplate = parseTextBody(
    source.text,
    {
      ctx: env.ctx,
      fonts: env.theme.fonts,
      chain: [
        env.docDefaults,
        ...styleTextColorLayer(style.fontColor),
        extractLstStyle(kid(source.text, 'lstStyle'), env.ctx, env.theme.fonts),
      ],
      defaultColor: style.fontColor,
      slideNum: env.slideNum,
      edit: true,
    },
    true,
  );
  if (!textTemplate) throw new Error('无法构造新增形状文字模板');
  return {
    fill: style.fill,
    stroke: style.stroke,
    effects: style.effects,
    textTemplate,
    styleMarkup: CREATION_SHAPE_STYLE,
    textBodyMarkup: CREATION_SHAPE_TEXT,
  };
}

// ---------------- 表格 ----------------

export const TABLE_FORMAT_READER = { fill: parseFillProps, line: parseLnElement } as const;
