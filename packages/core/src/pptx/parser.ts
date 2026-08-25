import { unzipSync } from 'fflate';
import type {
  CellBorders, EmbeddedFont, ElementBase, Fill, GroupElement, ImageElement, MediaInfo,
  OpcPackage, Presentation, Section, ShapeElement, Slide, SlideComment, SlideElement, Stroke, TableCell,
  TableCreationDefaults,
  TableElement, TableRow, TextBody, UnsupportedElement,
} from '../types';
import { METAFILE_EXT, metafileDataUrl } from '../metafile';
import { embeddedFontToSfnt } from '../font/eot';
import { attr, boolAttr, emu, kid, kids, numAttr, parseXml, walk } from '../xml';
import { getChartParser } from '../chart/hook';
import { childColor } from './color';
import { parse3D, parseEffects, parseLineEnd } from './effects';
import { parseTiming, parseTransition } from './animation';
import { custGeomPath, parseAdjustments, presetGeom } from './geometry';
import { extractLstStyle, LevelStyles, parseTextBody, TextEnv } from './text';
import {
  buildDiagram, isVertical, layoutFamily, parseDataModel, parseDiagramColors, pointTxBody, wrapDiagram,
} from './diagram';
import { PackageAssetStore } from './asset-store';
import type { AssetMode, DeferredAsset } from './asset-store';
import { builtInTableStyleMarkup } from './builtin-table-styles';
import { layoutCatalogPaths, layoutPlaceholderTemplate } from './layout-catalog';
import {
  Env, findPh, PH_EQUIV, relByType, Rels, slideInheritance, SlideInheritance,
} from './slide-inheritance';

export type { AssetMode, DeferredAsset } from './asset-store';

const decoder = new TextDecoder();
const EMPTY_BYTES = new Uint8Array(0);

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff',
};

/** 音视频容器 → MIME；未知扩展名按媒体类型给个兜底值 */
const MEDIA_MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  ogv: 'video/ogg', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', mpg: 'video/mpeg', mpeg: 'video/mpeg',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', wma: 'audio/x-ms-wma',
  ogg: 'audio/ogg', oga: 'audio/ogg', aac: 'audio/aac', mid: 'audio/midi', midi: 'audio/midi',
};

class Pkg {
  files: Record<string, Uint8Array>;
  private readonly assetStore: PackageAssetStore;
  private xmlCache = new Map<string, Element | null>();
  private relsCache = new Map<string, Rels>();
  private sourceBytes: Uint8Array | null = null;
  private opcHandle: OpcPackage | undefined;
  private isDisposed = false;

  constructor(bytes: Uint8Array, keepPackage = false) {
    this.files = unzipSync(bytes);
    this.assetStore = new PackageAssetStore(keepPackage);
    if (keepPackage) {
      // 50MB 演示若再复制一份原包，会把编辑模式的内存预算直接吃掉；
      // 按公开契约持有只读视图，File/Blob 路径本身已是解析器创建的独占缓冲。
      this.sourceBytes = bytes;
      const owner = this;
      this.opcHandle = Object.freeze({
        format: 'pptx' as const,
        get bytes(): Uint8Array { return owner.sourceBytes ?? EMPTY_BYTES; },
        get parts(): Readonly<Record<string, Uint8Array>> { return owner.files; },
        get assets(): Readonly<Record<string, { mime: string; bytes: Uint8Array }>> {
          return owner.assetStore.published;
        },
        get disposed(): boolean { return owner.isDisposed; },
      });
    }
  }

  set assetMode(value: AssetMode) { this.assetStore.mode = value; }
  get deferred(): DeferredAsset[] { return this.assetStore.deferred; }
  get opcPackage(): OpcPackage | undefined { return this.opcHandle; }

  xml(path: string): Element | null {
    if (!this.xmlCache.has(path)) {
      const data = this.files[path];
      let root: Element | null = null;
      if (data) {
        try {
          root = parseXml(decoder.decode(data));
        } catch {
          root = null;
        }
      }
      this.xmlCache.set(path, root);
    }
    return this.xmlCache.get(path) ?? null;
  }

  rels(partPath: string): Rels {
    if (!this.relsCache.has(partPath)) {
      const dir = partPath.slice(0, partPath.lastIndexOf('/') + 1);
      const out: Rels = {};
      const root = this.xml(`${dir}_rels/${partPath.slice(dir.length)}.rels`);
      for (const rel of kids(root, 'Relationship')) {
        const id = attr(rel, 'Id');
        const target = attr(rel, 'Target');
        if (!id || !target) continue;
        const external = attr(rel, 'TargetMode') === 'External';
        out[id] = { type: attr(rel, 'Type') ?? '', target: external ? target : resolvePath(dir, target) };
      }
      this.relsCache.set(partPath, out);
    }
    return this.relsCache.get(partPath)!;
  }

  blobUrl(path: string, mime: string): string | null {
    const data = this.files[path];
    return data ? this.assetStore.store(`${mime}|${path}`, data, mime) : null;
  }

  /**
   * 嵌入字体的可用地址。
   *
   * fntdata 是 EOT 容器而不是裸 TTF，得先还原成 sfnt（见 font/eot.ts）。
   * 还原不出来就返回 null —— 与其声明一个浏览器注定拒绝的 @font-face，
   * 不如干脆不声明，让文本老实回退到替换字体。
   */
  fontUrl(path: string): string | null {
    const raw = this.files[path];
    if (!raw) return null;
    const font = embeddedFontToSfnt(raw);
    return font ? this.assetStore.store(`font|${path}`, font.data, font.mime) : null;
  }

  /** 释放全部 blob URL，并清空缓存以便 zip 数据被回收 */
  dispose(): void {
    this.assetStore.dispose();
    this.xmlCache.clear();
    this.relsCache.clear();
    this.files = {};
    this.sourceBytes = null;
    this.isDisposed = true;
  }

  mediaUrl(path: string): string | null {
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    if (METAFILE_EXT.has(ext)) {
      const key = `mf|${path}`;
      return this.assetStore.cached(key, () => {
        const data = this.files[path];
        return data ? metafileDataUrl(data) : null;
      });
    }
    const mime = MIME[ext];
    return mime ? this.blobUrl(path, mime) : null;
  }
}

function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const out: string[] = [];
  for (const seg of (baseDir + target).split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

// ---------------- 变换 ----------------

interface XfrmInfo extends ElementBase {
  chX: number;
  chY: number;
  chW: number;
  chH: number;
}

function parseXfrm(x: Element | null): XfrmInfo | null {
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

const base = (xf: XfrmInfo): ElementBase => ({
  x: xf.x, y: xf.y, w: xf.w, h: xf.h, rot: xf.rot, flipH: xf.flipH, flipV: xf.flipV,
});

function movementLocked(nv: Element | null): boolean {
  const props = kid(nv, 'cNvSpPr') ?? kid(nv, 'cNvCxnSpPr') ?? kid(nv, 'cNvPicPr')
    ?? kid(nv, 'cNvGrpSpPr') ?? kid(nv, 'cNvGraphicFramePr');
  const locks = kid(props, 'spLocks') ?? kid(props, 'cxnSpLocks') ?? kid(props, 'picLocks')
    ?? kid(props, 'grpSpLocks') ?? kid(props, 'graphicFrameLocks');
  return boolAttr(locks, 'noMove');
}

function editInfoOf(
  env: Env,
  cNvPr: Element | null,
  ph: Element | null = null,
  geom?: NonNullable<ElementBase['editInfo']>['geom'],
  editable?: NonNullable<ElementBase['editInfo']>['editable'],
  moveLocked = false,
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
  if (editable) editInfo.editable = editable;
  if (moveLocked) editInfo.moveLocked = true;
  return editInfo.origin || editInfo.placeholder || editInfo.geom || editInfo.editable || editInfo.moveLocked
    ? { editInfo } : {};
}

function withPhClr(env: Env, phClr: string | null): Env {
  return phClr ? { ...env, ctx: { ...env.ctx, phClr } } : env;
}

// ---------------- 填充 / 描边 ----------------

const FILL_TAGS = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'];

function parseFillProps(container: Element | null, env: Env): Fill | null {
  if (!container) return null;
  for (const tag of FILL_TAGS) {
    const el = kid(container, tag);
    if (el) return parseFillElement(el, env);
  }
  return null;
}

function parseFillElement(el: Element | null, env: Env): Fill | null {
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
      return {
        type: 'image',
        src,
        alpha: alphaMod !== null ? alphaMod / 100000 : undefined,
        crop: srcRect ? { l: frac('l'), t: frac('t'), r: frac('r'), b: frac('b') } : undefined,
        tile: tileEl
          ? { sx: (numAttr(tileEl, 'sx') ?? 100000) / 100000, sy: (numAttr(tileEl, 'sy') ?? 100000) / 100000, flip: attr(tileEl, 'flip') ?? 'none' }
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

function blipUrl(blipFill: Element | null, env: Env): string | null {
  const blip = kid(blipFill, 'blip');
  const rid = attr(blip, 'r:embed') ?? attr(blip, 'r:link');
  const target = rid ? env.rels[rid]?.target : null;
  if (!target) return null;
  if (/^https?:/i.test(target)) return target;
  return env.pkg.mediaUrl(target);
}

/** blip 的图像效果 → CSS filter */
function blipFilter(blipFill: Element | null): string | undefined {
  const blip = kid(blipFill, 'blip');
  if (!blip) return undefined;
  const parts: string[] = [];
  if (kid(blip, 'grayscl')) parts.push('grayscale(1)');
  if (kid(blip, 'duotone')) parts.push('grayscale(1) contrast(1.1)');
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
  dash: [4, 3], dashDot: [4, 3, 1, 3], dot: [1, 3], lgDash: [8, 3],
  lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 3], sysDashDot: [3, 3, 1, 3], sysDashDotDot: [3, 3, 1, 3, 1, 3], sysDot: [1, 1],
};

const CAPS: Record<string, Stroke['cap']> = { flat: 'butt', rnd: 'round', sq: 'square' };

/** 解析 a:ln 元素；themeLn 为主题线样式（已带 phClr 的 env） */
function parseLnElement(ln: Element | null, env: Env, fallback: Stroke | null): Stroke | null {
  if (!ln) return fallback;
  if (kid(ln, 'noFill')) return null;
  const width = numAttr(ln, 'w') !== null ? emu(numAttr(ln, 'w')!) : fallback?.width ?? 1;
  const fill = parseFillProps(ln, env);
  let color = fallback?.color ?? null;
  if (fill?.type === 'solid') color = fill.color;
  else if (fill?.type === 'gradient' && fill.stops.length) color = fill.stops[0].color;
  if (!color) return fallback ? { ...fallback, width } : null;

  const dashName = attr(kid(ln, 'prstDash'), 'val');
  const unit = Math.max(width, 1);
  const dash = dashName
    ? dashName === 'solid' ? null : (DASH[dashName] ?? [4, 3]).map((m) => m * unit)
    : fallback?.dash ?? null;

  const head = parseLineEnd(kid(ln, 'headEnd')) ?? fallback?.head;
  const tail = parseLineEnd(kid(ln, 'tailEnd')) ?? fallback?.tail;
  const cap = CAPS[attr(ln, 'cap') ?? ''] ?? fallback?.cap;
  const join = kid(ln, 'round') ? 'round' : kid(ln, 'bevel') ? 'bevel' : kid(ln, 'miter') ? 'miter' : fallback?.join;

  return { color, width, dash, cap, join, head, tail, compound: attr(ln, 'cmpd') ?? fallback?.compound };
}

/** p:style 的主题引用 → 底层样式 */
function resolveStyleRefs(style: Element | null, env: Env): { fill: Fill | null; stroke: Stroke | null; fontColor: string | null; effects: ReturnType<typeof parseEffects> } {
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
  const root = parseXml(`<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
${CREATION_SHAPE_STYLE}
${CREATION_SHAPE_TEXT}
</root>`);
  creationShapeParts = { style: kid(root, 'style')!, text: kid(root, 'txBody')! };
  return creationShapeParts;
}

/** 与真正写入的 p:style/txBody 共用语义，在当前页主题上先求值供即时投影使用。 */
function defaultShapeEditInfo(env: Env): NonNullable<Slide['editInfo']>['defaultShape'] {
  const source = defaultShapeParts();
  const style = resolveStyleRefs(source.style, env);
  const textTemplate = parseTextBody(source.text, {
    ctx: env.ctx,
    fonts: env.theme.fonts,
    chain: [env.docDefaults, extractLstStyle(kid(source.text, 'lstStyle'), env.ctx, env.theme.fonts)],
    defaultColor: style.fontColor,
    slideNum: env.slideNum,
    edit: true,
  }, true);
  if (!textTemplate) throw new Error('无法构造新增形状文字模板');
  return {
    fill: style.fill, stroke: style.stroke, textTemplate,
    styleMarkup: CREATION_SHAPE_STYLE, textBodyMarkup: CREATION_SHAPE_TEXT,
  };
}

// ---------------- 形状树 ----------------

function parseShapeTree(tree: Element | null, env: Env, skipPh: boolean): SlideElement[] {
  const out: SlideElement[] = [];
  if (!tree) return out;
  for (let node = tree.firstElementChild; node; node = node.nextElementSibling) {
    let el: SlideElement | SlideElement[] | null = null;
    // 单个形状解析失败不应连累整页——真实文件里常见某个可选节点缺失/畸形，
    // 一路抛到顶层会让整张幻灯片变成错误占位。
    try {
      el = parseOneShape(node, env, skipPh);
    } catch (err) {
      el = brokenShapePlaceholder(node, err, env);
    }
    if (Array.isArray(el)) out.push(...el);
    else if (el) out.push(el);
  }
  return out;
}

/** 解析形状树里的单个节点 */
function parseOneShape(node: Element, env: Env, skipPh: boolean): SlideElement | SlideElement[] | null {
  {
    let el: SlideElement | SlideElement[] | null = null;
    switch (node.localName) {
      case 'sp':
      case 'cxnSp': {
        const nv = node.localName === 'sp' ? 'nvSpPr' : 'nvCxnSpPr';
        const ph = walk(node, nv, 'nvPr', 'ph');
        if (skipPh && ph) break;
        if (ph && env.hiddenPh.has(attr(ph, 'type') ?? '')) break;
        el = parseSp(node, env);
        break;
      }
      case 'pic':
        el = parsePic(node, env);
        break;
      case 'grpSp':
        el = parseGroup(node, env, skipPh);
        break;
      case 'graphicFrame':
        el = parseGraphicFrame(node, env);
        break;
      case 'contentPart':
        el = parseContentPart(node, env);
        break;
      case 'AlternateContent': {
        // Choice 里多为 a14/p14 扩展（墨迹等）；解析不出内容时回退到 Fallback 的图片
        const choice = kid(node, 'Choice');
        let got = choice ? parseShapeTree(choice, env, skipPh) : [];
        if (!got.length) {
          const fb = kid(node, 'Fallback');
          if (fb) got = parseShapeTree(fb, env, skipPh);
        }
        return got;
      }
    }
    return el;
  }
}

/** 解析失败时给一个可见但不打断阅读的占位，方便定位问题而不是整页丢失 */
function brokenShapePlaceholder(node: Element, err: unknown, env: Env): UnsupportedElement | null {
  const nv = kid(node, 'nvSpPr') ?? kid(node, 'nvPicPr') ?? kid(node, 'nvGrpSpPr')
    ?? kid(node, 'nvCxnSpPr') ?? kid(node, 'nvGraphicFramePr');
  const xf = parseXfrm(walk(node, 'spPr', 'xfrm') ?? walk(node, 'grpSpPr', 'xfrm') ?? kid(node, 'xfrm'));
  if (!xf || xf.w <= 0 || xf.h <= 0) return null;
  const cNvPr = kid(nv, 'cNvPr');
  const name = attr(cNvPr, 'name') ?? node.localName;
  const reason = err instanceof Error ? err.message : String(err);
  return {
    kind: 'unsupported',
    ...base(xf),
    label: `${name}（解析失败：${reason.slice(0, 40)}）`,
    ...editInfoOf(env, cNvPr, walk(nv, 'nvPr', 'ph'), undefined, 'frame', movementLocked(nv)),
  };
}

function hyperlinkOf(cNvPr: Element | null, env: Env): string | undefined {
  const h = kid(cNvPr, 'hlinkClick');
  if (!h) return undefined;
  return resolveLink(env, attr(h, 'r:id') ?? '', attr(h, 'action')) ?? undefined;
}

function resolveLink(env: Env, rid: string, action: string | null): string | null {
  if (action?.includes('nextslide')) return env.edit ? 'slide:next' : `slide:${env.slideNum + 1}`;
  if (action?.includes('previousslide')) return env.edit ? 'slide:previous' : `slide:${env.slideNum - 1}`;
  if (action?.includes('firstslide')) return env.edit ? 'slide:first' : 'slide:1';
  if (action?.includes('lastslide')) return 'slide:last';
  const rel = env.rels[rid];
  if (!rel) return null;
  if (/^https?:|^mailto:/i.test(rel.target)) return rel.target;
  const idx = env.slideIdMap[rel.target];
  if (idx !== undefined) return env.edit
    ? `slide-part:${encodeURIComponent(rel.target)}`
    : `slide:${idx}`;
  return null;
}

function parseSp(sp: Element, env: Env): ShapeElement | null {
  const nvName = sp.localName === 'cxnSp' ? 'nvCxnSpPr' : 'nvSpPr';
  const nv = kid(sp, nvName);
  const cNvPr = kid(nv, 'cNvPr');
  const ph = walk(nv, 'nvPr', 'ph');
  const phType = attr(ph, 'type');
  const phIdx = attr(ph, 'idx');
  const spPr = kid(sp, 'spPr');

  const layoutSp = ph ? findPh(env.layoutPh, phType, phIdx) : null;
  const masterSp = ph ? findPh(env.masterPh, phType, phIdx) : null;

  let xf = parseXfrm(kid(spPr, 'xfrm'));
  if (!xf && ph) xf = parseXfrm(walk(layoutSp, 'spPr', 'xfrm')) ?? parseXfrm(walk(masterSp, 'spPr', 'xfrm'));
  if (!xf) return null;

  const styleRef = resolveStyleRefs(kid(sp, 'style'), env);

  // 几何：自身 → 占位符继承
  let geomHost = spPr;
  if (!kid(spPr, 'prstGeom') && !kid(spPr, 'custGeom') && ph) {
    geomHost = walk(layoutSp, 'spPr') ?? walk(masterSp, 'spPr') ?? spPr;
  }
  const prstGeom = kid(geomHost, 'prstGeom');
  const custGeom = kid(geomHost, 'custGeom');
  let path: string | null = null;
  let openGeom = false;
  let editableGeom: NonNullable<ElementBase['editInfo']>['geom'] | undefined;
  if (prstGeom) {
    const preset = attr(prstGeom, 'prst') ?? 'rect';
    const adj = parseAdjustments(kid(prstGeom, 'avLst'));
    const g = presetGeom(preset, xf.w, xf.h, adj);
    path = g.d;
    openGeom = g.open;
    if (env.edit) editableGeom = { preset, adj };
  } else if (custGeom) {
    const g = custGeomPath(custGeom, xf.w, xf.h);
    if (g) {
      path = g.d;
      openGeom = g.open;
    }
  }

  let fill = parseFillProps(spPr, env);
  if (!fill && ph) fill = parseFillProps(walk(layoutSp, 'spPr'), env) ?? parseFillProps(walk(masterSp, 'spPr'), env);
  if (!fill) fill = styleRef.fill;
  if (openGeom) fill = { type: 'none' };

  let stroke = parseLnElement(kid(spPr, 'ln'), env, styleRef.stroke);
  if (!kid(spPr, 'ln') && ph) {
    stroke = parseLnElement(walk(layoutSp, 'spPr', 'ln') ?? walk(masterSp, 'spPr', 'ln'), env, stroke);
  }

  const effects = parseEffects(kid(spPr, 'effectLst'), env.ctx) ?? styleRef.effects;

  // 无几何但有填充/描边时按矩形处理（常见于省略 prstGeom 的文本框）
  if (!path && (fill || stroke)) path = presetGeom('rect', xf.w, xf.h, {}).d;

  const txBody = kid(sp, 'txBody');
  let text: TextBody | null = null;
  let textTemplate: TextBody | undefined;
  if (txBody) {
    const chain: LevelStyles[] = [env.docDefaults];
    if (ph) {
      const cat = phType === 'title' || phType === 'ctrTitle' ? 'title'
        : !phType || PH_EQUIV.body.includes(phType) ? 'body' : 'other';
      chain.push(env.masterStyles[cat]);
      chain.push(extractLstStyle(walk(masterSp, 'txBody', 'lstStyle'), env.ctx, env.theme.fonts));
      chain.push(extractLstStyle(walk(layoutSp, 'txBody', 'lstStyle'), env.ctx, env.theme.fonts));
    }
    chain.push(extractLstStyle(kid(txBody, 'lstStyle'), env.ctx, env.theme.fonts));
    const textEnv: TextEnv = {
      ctx: env.ctx,
      fonts: env.theme.fonts,
      chain,
      defaultColor: styleRef.fontColor,
      slideNum: env.slideNum,
      bodyPrFallbacks: [walk(layoutSp, 'txBody', 'bodyPr'), walk(masterSp, 'txBody', 'bodyPr')],
      resolveLink: (rid, action) => resolveLink(env, rid, action),
      resolveImage: (rid) => {
        const t = env.rels[rid]?.target;
        return t ? env.pkg.mediaUrl(t) : null;
      },
      edit: env.edit,
    };
    text = parseTextBody(txBody, textEnv);
    if (!text && env.edit) {
      textTemplate = parseTextBody(txBody, textEnv, true) ?? undefined;
    }
  }

  if (!path && !text && !textTemplate) return null;
  const editing = editInfoOf(env, cNvPr, ph, editableGeom, undefined, movementLocked(nv));
  if (editing.editInfo && textTemplate) editing.editInfo.textTemplate = textTemplate;
  return {
    kind: 'shape', ...base(xf), path, fill, stroke, text,
    openGeom: openGeom || undefined,
    effects,
    scene3d: parse3D(spPr, env.ctx),
    link: hyperlinkOf(cNvPr, env),
    name: attr(cNvPr, 'name') ?? undefined,
    id: numAttr(cNvPr, 'id') ?? undefined,
    ...editing,
  };
}

// ---------------- 媒体（音频 / 视频） ----------------

const VIDEO_TAGS = new Set(['videoFile', 'quickTimeFile', 'media']);
const AUDIO_TAGS = new Set(['audioFile', 'wavAudioFile', 'audioCd']);

const isExternalTarget = (t: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(t);

/** 在 p:nvPr（含 extLst 里的 p14:media）中找音视频引用 */
function parseMedia(nvPr: Element | null, env: Env): MediaInfo | undefined {
  if (!nvPr) return undefined;
  let kind: MediaInfo['kind'] | null = null;
  let node: Element | null = null;
  const all = nvPr.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const ln = all[i].localName;
    if (AUDIO_TAGS.has(ln)) {
      kind = 'audio';
      node = all[i];
      break;
    }
    if (VIDEO_TAGS.has(ln) && !node) {
      // p14:media 只是嵌入副本，若后面还有 audioFile 说明其实是音频
      kind = 'video';
      node = all[i];
    }
  }
  if (!kind || !node) return undefined;

  const rid = attr(node, 'r:link') ?? attr(node, 'r:embed');
  const rel = rid ? env.rels[rid] : undefined;
  if (!rel) return { kind, src: null };
  if (isExternalTarget(rel.target)) return { kind, src: rel.target, external: true };
  const ext = rel.target.slice(rel.target.lastIndexOf('.') + 1).toLowerCase();
  const mime = MEDIA_MIME[ext] ?? (kind === 'audio' ? 'audio/mpeg' : 'video/mp4');
  return { kind, src: env.pkg.blobUrl(rel.target, mime), mime };
}

function parsePic(pic: Element, env: Env): ImageElement | UnsupportedElement | null {
  const nv = kid(pic, 'nvPicPr');
  const spPr = kid(pic, 'spPr');
  // 内容占位符里放的图片常常是空 <p:spPr/>，位置尺寸全靠版式/母版继承。
  // 不做这一步整张图会被丢掉——真实文件里这种写法很常见。
  const ph = walk(nv, 'nvPr', 'ph');
  let xf = parseXfrm(kid(spPr, 'xfrm'));
  if (!xf && ph) {
    const phType = attr(ph, 'type');
    const phIdx = attr(ph, 'idx');
    xf = parseXfrm(walk(findPh(env.layoutPh, phType, phIdx), 'spPr', 'xfrm'))
      ?? parseXfrm(walk(findPh(env.masterPh, phType, phIdx), 'spPr', 'xfrm'));
  }
  if (!xf) return null;
  const cNvPr = kid(nv, 'cNvPr');
  const blipFill = kid(pic, 'blipFill');
  const src = blipUrl(blipFill, env);
  const label = attr(cNvPr, 'name') ?? '图片';
  const media = parseMedia(kid(nv, 'nvPr'), env);
  // 媒体对象即使没有封面帧也要出现（渲染层画深色底 + 播放标识）
  if (!src && !media) {
    return {
      kind: 'unsupported', ...base(xf), label: `${label}（格式不支持）`,
      link: hyperlinkOf(cNvPr, env),
      name: attr(cNvPr, 'name') ?? undefined,
      id: numAttr(cNvPr, 'id') ?? undefined,
      ...editInfoOf(env, cNvPr, ph, undefined, 'frame', movementLocked(nv)),
    };
  }

  const srcRect = kid(blipFill, 'srcRect');
  const frac = (name: string): number => (numAttr(srcRect, name) ?? 0) / 100000;
  const crop = srcRect ? { l: frac('l'), t: frac('t'), r: frac('r'), b: frac('b') } : null;

  // 非矩形轮廓 → 裁剪路径。默认预览仍只看图片自己的 spPr；编辑态另外记录继承语义。
  let clipPath: string | null = null;
  const prstGeom = kid(spPr, 'prstGeom');
  const custGeom = kid(spPr, 'custGeom');
  let editableGeom: NonNullable<ElementBase['editInfo']>['geom'] | undefined;
  if (prstGeom) {
    const preset = attr(prstGeom, 'prst') ?? 'rect';
    const adj = parseAdjustments(kid(prstGeom, 'avLst'));
    if (preset !== 'rect') clipPath = presetGeom(preset, xf.w, xf.h, adj).d;
    if (env.edit) editableGeom = { preset, adj };
  } else if (custGeom) {
    clipPath = custGeomPath(custGeom, xf.w, xf.h)?.d ?? null;
  } else if (env.edit && ph) {
    const phType = attr(ph, 'type');
    const phIdx = attr(ph, 'idx');
    const inherited = walk(findPh(env.layoutPh, phType, phIdx), 'spPr', 'prstGeom')
      ?? walk(findPh(env.masterPh, phType, phIdx), 'spPr', 'prstGeom');
    if (inherited) {
      editableGeom = {
        preset: attr(inherited, 'prst') ?? 'rect',
        adj: parseAdjustments(kid(inherited, 'avLst')),
      };
    }
  }

  const alphaMod = numAttr(kid(kid(blipFill, 'blip'), 'alphaModFix'), 'amt');

  return {
    kind: 'image', ...base(xf), src: src ?? '', crop, clipPath,
    alpha: alphaMod !== null ? alphaMod / 100000 : undefined,
    filter: blipFilter(blipFill),
    stroke: parseLnElement(kid(spPr, 'ln'), env, null),
    effects: parseEffects(kid(spPr, 'effectLst'), env.ctx),
    link: hyperlinkOf(cNvPr, env),
    name: attr(cNvPr, 'name') ?? undefined,
    id: numAttr(cNvPr, 'id') ?? undefined,
    media,
    ...editInfoOf(env, cNvPr, ph, editableGeom, media ? 'frame' : undefined, movementLocked(nv)),
  };
}

// ---------------- 墨迹批注（p14:contentPart + InkML） ----------------

interface InkBrush {
  color: string;
  width: number;
}

/**
 * InkML 的 trace 数据解码。每个点由若干通道值组成，值可带前缀：
 * `!` 显式、`'` 一阶差分、`"` 二阶差分，无前缀则沿用该通道上一次的编码方式。
 */
function decodeTrace(text: string, xi: number, yi: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const val: number[] = [];
  const delta: number[] = [];
  const mode: string[] = [];
  let first = true;
  for (const chunk of text.split(',')) {
    const tokens = chunk.trim().split(/[\s]+/).filter((t) => t !== '');
    if (!tokens.length) continue;
    tokens.forEach((tok, j) => {
      // 前缀只有 ! ' "；负号必须留给数值本身，否则差分方向会全部翻正
      const m = tok.match(/^(!|'|")?\s*(-?[\d.]+(?:[eE][-+]?\d+)?)$/);
      if (!m) return;
      const n = Number(m[2]);
      if (!Number.isFinite(n)) return;
      const op = m[1] ?? '';
      if (first || op === '!') {
        val[j] = n;
        delta[j] = 0;
        mode[j] = '!';
        return;
      }
      if (op) mode[j] = op;
      switch (mode[j] ?? '!') {
        case "'":
          delta[j] = n;
          val[j] = (val[j] ?? 0) + n;
          break;
        case '"':
          delta[j] = (delta[j] ?? 0) + n;
          val[j] = (val[j] ?? 0) + delta[j];
          break;
        default:
          val[j] = n;
      }
    });
    const x = val[xi];
    const y = val[yi];
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
    first = false;
  }
  return pts;
}

/** 找 traceFormat 里 X / Y 通道的下标 */
function inkChannels(root: Element): [number, number] {
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName !== 'traceFormat') continue;
    const names = kids(all[i], 'channel').map((c) => (attr(c, 'name') ?? '').toUpperCase());
    const xi = names.indexOf('X');
    const yi = names.indexOf('Y');
    if (xi >= 0 && yi >= 0) return [xi, yi];
  }
  return [0, 1];
}

function inkBrushes(root: Element): Map<string, InkBrush> {
  const out = new Map<string, InkBrush>();
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el.localName !== 'brush') continue;
    const id = attr(el, 'xml:id') ?? attr(el, 'id');
    if (!id) continue;
    const brush: InkBrush = { color: 'rgb(0,0,0)', width: 0 };
    for (const p of kids(el, 'brushProperty')) {
      const name = (attr(p, 'name') ?? '').toLowerCase();
      const value = attr(p, 'value') ?? '';
      if (name === 'color') brush.color = /^#?[0-9a-f]{6}$/i.test(value) ? `#${value.replace(/^#/, '')}` : value;
      else if (name === 'width' || name === 'height') {
        const n = Number(value);
        if (Number.isFinite(n) && n > brush.width) brush.width = n;
      }
    }
    out.set(id, brush);
  }
  return out;
}

/**
 * InkML → 局部坐标（0,0-w,h）的开放路径形状。
 * 墨迹自带坐标系（多为 HIMETRIC），统一按整体包围盒等比映射进 contentPart 的框内。
 */
function inkStrokes(root: Element, w: number, h: number): ShapeElement[] {
  const [xi, yi] = inkChannels(root);
  const brushes = inkBrushes(root);
  const traces: Array<{ pts: Array<[number, number]>; brush: InkBrush | undefined }> = [];
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName !== 'trace') continue;
    const pts = decodeTrace(all[i].textContent ?? '', xi, yi);
    if (pts.length < 2) continue;
    const ref = (attr(all[i], 'brushRef') ?? '').replace(/^#/, '');
    traces.push({ pts, brush: brushes.get(ref) ?? brushes.values().next().value });
  }
  if (!traces.length) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of traces) {
    for (const [x, y] of t.pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const scale = Math.min(spanX > 0 ? w / spanX : Infinity, spanY > 0 ? h / spanY : Infinity);
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const offX = (w - spanX * k) / 2;
  const offY = (h - spanY * k) / 2;

  const out: ShapeElement[] = [];
  for (const t of traces) {
    const pts = t.pts.map(([x, y]): [number, number] => [offX + (x - minX) * k, offY + (y - minY) * k]);
    let bx = Infinity;
    let by = Infinity;
    let bx2 = -Infinity;
    let by2 = -Infinity;
    for (const [x, y] of pts) {
      if (x < bx) bx = x;
      if (y < by) by = y;
      if (x > bx2) bx2 = x;
      if (y > by2) by2 = y;
    }
    const n = (v: number): string => String(Math.round(v * 100) / 100);
    const d = 'M ' + pts.map(([x, y]) => `${n(x - bx)} ${n(y - by)}`).join(' L ');
    const width = Math.max(0.75, Math.min((t.brush?.width ?? 0) * k || 2, 24));
    out.push({
      kind: 'shape',
      x: bx, y: by, w: Math.max(bx2 - bx, 0), h: Math.max(by2 - by, 0),
      rot: 0, flipH: false, flipV: false,
      path: d,
      fill: { type: 'none' },
      stroke: { color: t.brush?.color ?? 'rgb(0,0,0)', width, dash: null, cap: 'round', join: 'round' },
      text: null,
      openGeom: true,
    });
  }
  return out;
}

/** <p14:contentPart>：墨迹批注，r:id 指向 InkML part */
function parseContentPart(node: Element, env: Env): GroupElement | null {
  const xf = parseXfrm(kid(node, 'xfrm'));
  if (!xf || xf.w <= 0 || xf.h <= 0) return null;
  const rid = attr(node, 'r:id');
  const target = rid ? env.rels[rid]?.target : null;
  const root = target ? env.pkg.xml(target) : null;
  if (!root) return null;
  let children: ShapeElement[];
  try {
    children = inkStrokes(root, xf.w, xf.h);
  } catch {
    return null;
  }
  if (!children.length) return null;
  const cNvPr = walk(node, 'nvContentPartPr', 'cNvPr');
  return {
    kind: 'group', ...base(xf),
    childX: 0, childY: 0, scaleX: 1, scaleY: 1,
    children,
    name: attr(cNvPr, 'name') ?? '墨迹',
    id: numAttr(cNvPr, 'id') ?? undefined,
    ...editInfoOf(env, cNvPr, null, undefined, 'frame'),
  };
}

function parseGroup(grp: Element, env: Env, skipPh: boolean): GroupElement | null {
  const nv = kid(grp, 'nvGrpSpPr');
  const grpSpPr = kid(grp, 'grpSpPr');
  const xf = parseXfrm(kid(grpSpPr, 'xfrm'));
  if (!xf) return null;
  const children = parseShapeTree(grp, env, skipPh);
  if (!children.length) return null;
  const cNvPr = kid(nv, 'cNvPr');
  return {
    kind: 'group',
    ...base(xf),
    childX: xf.chX,
    childY: xf.chY,
    scaleX: xf.chW ? xf.w / xf.chW : 1,
    scaleY: xf.chH ? xf.h / xf.chH : 1,
    children,
    effects: parseEffects(kid(grpSpPr, 'effectLst'), env.ctx),
    name: attr(cNvPr, 'name') ?? undefined,
    id: numAttr(cNvPr, 'id') ?? undefined,
    ...editInfoOf(env, cNvPr, null, undefined, undefined, movementLocked(nv)),
  };
}

function parseGraphicFrame(frame: Element, env: Env): SlideElement | SlideElement[] | null {
  const nv = kid(frame, 'nvGraphicFramePr');
  const xf = parseXfrm(kid(frame, 'xfrm'));
  if (!xf) return null;
  const data = walk(frame, 'graphic', 'graphicData');
  const uri = attr(data, 'uri') ?? '';
  const frameCNvPr = kid(nv, 'cNvPr');
  const framePh = walk(nv, 'nvPr', 'ph');
  const name = attr(frameCNvPr, 'name') ?? undefined;
  const frameId = numAttr(frameCNvPr, 'id') ?? undefined;
  const frameEditInfo = editInfoOf(env, frameCNvPr, framePh, undefined, undefined, movementLocked(nv));
  const frameOnlyEditInfo = editInfoOf(
    env, frameCNvPr, framePh, undefined, 'frame', movementLocked(nv),
  );

  const tbl = kid(data, 'tbl');
  if (tbl) {
    const parsed = parseTable(tbl, xf, env, name);
    const editInfo = env.edit
      ? { ...parsed.editInfo, ...frameEditInfo.editInfo }
      : undefined;
    return {
      ...parsed, id: frameId, ...frameEditInfo,
      ...(editInfo ? { editInfo } : {}),
    };
  }

  if (uri.endsWith('/chart')) {
    const chart = parseChartFrame(data, xf, env);
    if (chart) return { ...chart, id: frameId, ...frameOnlyEditInfo };
    return { kind: 'unsupported', ...base(xf), label: '图表', name, id: frameId, ...frameOnlyEditInfo };
  }

  if (uri.endsWith('/diagram')) {
    const dgm = parseDiagram(data, xf, env);
    if (dgm) return { ...dgm, id: frameId, ...frameOnlyEditInfo };
    return { kind: 'unsupported', ...base(xf), label: 'SmartArt', name, id: frameId, ...frameOnlyEditInfo };
  }

  // graphicData 的 URI 是 .../presentationml/2006/ole，不含 oleObject —— 原先的
  // includes('oleObject') 从来没匹配上，OLE 一直落到「不支持的对象」分支
  if (uri.endsWith('/ole') || uri.includes('oleObject')) {
    const oleObj = kid(data, 'oleObj');
    if (oleObj) {
      // Office 2010+ 把预览图直接写成 p:oleObj 的 p:pic 子元素，
      // 走它能连裁剪 / 效果一起拿到；旧式的 VML 快照是后备路径
      const pic = kid(oleObj, 'pic');
      if (pic) {
        const img = parsePic(pic, env);
        // p:pic 自己的 xfrm 是相对 frame 的，位置以 frame 为准
        if (img && img.kind === 'image' && img.src) {
          return { ...img, ...base(xf), name: name ?? img.name, id: frameId, ...frameOnlyEditInfo };
        }
      }
      const src = olePreview(oleObj, env);
      if (src) return { kind: 'image', ...base(xf), src, crop: null, name, id: frameId, ...frameOnlyEditInfo };
    }
    return { kind: 'unsupported', ...base(xf), label: 'OLE 对象', name, id: frameId, ...frameOnlyEditInfo };
  }

  const label = uri.includes('/media') || uri.includes('video') ? '媒体对象' : '不支持的对象';
  return { kind: 'unsupported', ...base(xf), label, name, id: frameId, ...frameOnlyEditInfo };
}

/**
 * OLE 对象的预览图。
 *
 * PowerPoint 把嵌入对象的渲染快照放在旧式 VML 部件里：幻灯片的
 * vmlDrawing 关系 → <v:shape id="{oleObj@spid}"> → <v:imagedata o:relid>
 * → 该 VML 部件自己的关系 → 媒体文件。
 *
 * 预览格式随创作平台而变：Windows 通常是 EMF/WMF（我们能解），
 * Mac 版存的是 PICT（解不了）。mediaUrl 对认不出的扩展名返回 null，
 * 此时退回占位框而不是塞一张裂图。
 */
function olePreview(oleObj: Element, env: Env): string | null {
  const spid = attr(oleObj, 'spid');
  if (!spid) return null;
  const vmlPath = relByType(env.rels, '/vmlDrawing');
  if (!vmlPath) return null;
  // Pkg.rels 存的 target 已是包内绝对路径，不要再 resolvePath 一次
  const root = env.pkg.xml(vmlPath);
  if (!root) return null;

  for (const shape of root.getElementsByTagName('*')) {
    if (shape.localName !== 'shape' || attr(shape, 'id') !== spid) continue;
    for (const data of shape.getElementsByTagName('*')) {
      if (data.localName !== 'imagedata') continue;
      const rid = attr(data, 'o:relid') ?? attr(data, 'r:id');
      const target = rid ? env.pkg.rels(vmlPath)[rid]?.target : null;
      if (!target) return null;
      return env.pkg.mediaUrl(target);
    }
  }
  return null;
}

function parseChartFrame(data: Element | null, xf: XfrmInfo, env: Env): GroupElement | null {
  if (!data) return null;
  const render = getChartParser();
  const rid = attr(kid(data, 'chart'), 'r:id');
  const target = rid ? env.rels[rid]?.target : null;
  if (!render || !target) return null;
  const root = env.pkg.xml(target);
  if (!root) return null;
  let children: SlideElement[];
  try {
    children = render(root, xf.w, xf.h, { ctx: env.ctx, fonts: env.theme.fonts, rels: env.pkg.rels(target) });
  } catch {
    return null;
  }
  if (!children.length) return null;
  return {
    kind: 'group', ...base(xf),
    childX: 0, childY: 0, scaleX: 1, scaleY: 1,
    children,
    name: '图表',
  };
}

/** SmartArt：读 dgm:relIds → 数据模型的 dataModelExt → 幻灯片 rels 中的 drawing part */
function parseDiagram(data: Element | null, xf: XfrmInfo, env: Env): GroupElement | null {
  if (!data) return null;
  const relIds = kid(data, 'relIds');
  let drawingPath: string | null = null;

  const dmRid = attr(relIds, 'r:dm');
  const dmTarget = dmRid ? env.rels[dmRid]?.target : null;
  if (dmTarget) {
    const dmRoot = env.pkg.xml(dmTarget);
    const ext = dmRoot?.getElementsByTagName('*');
    for (let i = 0; ext && i < ext.length; i++) {
      if (ext[i].localName === 'dataModelExt') {
        const relId = attr(ext[i], 'relId');
        if (relId && env.rels[relId]) drawingPath = env.rels[relId].target;
        break;
      }
    }
  }
  if (!drawingPath) drawingPath = relByType(env.rels, '/diagramDrawing');
  // 没有缓存的 drawing part（python-pptx / Google Slides 导出常见）时，
  // 退到自己按数据模型排布，总好过一个灰框
  if (!drawingPath) return layoutDiagram(relIds, xf, env);

  const root = env.pkg.xml(drawingPath);
  const tree = kid(root, 'spTree');
  if (!tree) return layoutDiagram(relIds, xf, env);

  const childEnv: Env = { ...env, rels: env.pkg.rels(drawingPath), partPath: drawingPath, layoutPh: [], masterPh: [] };
  const children = parseShapeTree(tree, childEnv, false);
  if (!children.length) return layoutDiagram(relIds, xf, env);

  // drawing 里的坐标是相对 frame 的绝对 EMU，用 group 的子坐标系归一
  return {
    kind: 'group', ...base(xf),
    childX: 0, childY: 0, scaleX: 1, scaleY: 1,
    children,
    name: 'SmartArt',
  };
}

/**
 * 按数据模型自行排布 SmartArt。见 diagram.ts 顶部对「做到哪一步」的说明。
 */
function layoutDiagram(relIds: Element | null, xf: XfrmInfo, env: Env): GroupElement | null {
  const partOf = (a: string): Element | null => {
    const rid = attr(relIds, a);
    const target = rid ? env.rels[rid]?.target : null;
    return target ? env.pkg.xml(target) : null;
  };
  const dataRoot = partOf('r:dm');
  const pts = parseDataModel(dataRoot);
  if (!pts.length) return null;

  const layoutRoot = partOf('r:lo');
  const colorsRoot = partOf('r:cs');

  // 配色：先用 colors part 里的，取不到退到主题强调色
  const raw = parseDiagramColors(colorsRoot);
  const colors = (raw.length ? raw : ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'])
    .map((v: string) => (/^[0-9a-fA-F]{6}$/.test(v) ? `#${v}` : `#${env.ctx.theme[env.ctx.clrMap[v] ?? v] ?? '4472C4'}`));

  const textEnv: TextEnv = {
    ctx: env.ctx,
    fonts: env.theme.fonts,
    chain: [env.docDefaults, env.masterStyles.other],
    defaultColor: 'rgb(255,255,255)',
    slideNum: env.slideNum,
  };

  const children = buildDiagram(pts, xf.w, xf.h, {
    family: layoutFamily(layoutRoot),
    vertical: isVertical(layoutRoot),
    colors,
    textOf: (id: string) => {
      const t = parseTextBody(pointTxBody(dataRoot, id), textEnv);
      // 数据模型里的文本没有 bodyPr，居中显示才像 SmartArt
      return t ? { ...t, anchor: 'middle', paragraphs: t.paragraphs.map((p) => ({ ...p, align: 'center' })) } : null;
    },
  });
  if (!children.length) return null;
  return wrapDiagram(children, { ...base(xf), name: 'SmartArt' });
}

// ---------------- 表格 ----------------

interface TableStyleParts {
  wholeTbl: Element | null;
  band1H: Element | null;
  band2H: Element | null;
  firstRow: Element | null;
  lastRow: Element | null;
  firstCol: Element | null;
  lastCol: Element | null;
}

const builtInTableStyles = new Map<string, Element>();

function builtInTableStyle(styleId: string | null): Element | null {
  if (!styleId) return null;
  const cached = builtInTableStyles.get(styleId);
  if (cached) return cached;
  const markup = builtInTableStyleMarkup(styleId);
  if (!markup) return null;
  const style = kid(parseXml(`<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${markup}</root>`), 'tblStyle')!;
  builtInTableStyles.set(styleId, style);
  return style;
}

function findTableStyle(tableStyles: Element | null, styleId: string | null): TableStyleParts | null {
  if (!tableStyles) return null;
  const list = kids(tableStyles, 'tblStyle');
  const def = attr(tableStyles, 'def');
  const style = list.find((s) => attr(s, 'styleId') === styleId) ?? builtInTableStyle(styleId)
    ?? list.find((s) => attr(s, 'styleId') === def) ?? builtInTableStyle(def);
  if (!style) return null;
  return {
    wholeTbl: kid(style, 'wholeTbl'),
    band1H: kid(style, 'band1H'),
    band2H: kid(style, 'band2H'),
    firstRow: kid(style, 'firstRow'),
    lastRow: kid(style, 'lastRow'),
    firstCol: kid(style, 'firstCol'),
    lastCol: kid(style, 'lastCol'),
  };
}

/**
 * 单元格四边。
 * 第二项是 tableStyles 里 tcBdr 的子元素名（left/right/top/bottom），
 * 第三项是 tcPr 上的单元格级覆盖标签名（DrawingML 用缩写 lnL/lnR/lnT/lnB，不是 lnLeft）。
 */
const BORDER_SIDES: [keyof CellBorders, string, string][] = [
  ['l', 'left', 'lnL'],
  ['r', 'right', 'lnR'],
  ['t', 'top', 'lnT'],
  ['b', 'bottom', 'lnB'],
];

function stylePartToCell(part: Element | null, env: Env): { fill: Fill | null; borders: CellBorders; bold: boolean; color: string | null } {
  const out = { fill: null as Fill | null, borders: {} as CellBorders, bold: false, color: null as string | null };
  if (!part) return out;
  const tcStyle = kid(part, 'tcStyle');
  out.fill = parseFillProps(kid(tcStyle, 'fill') ?? tcStyle, env);
  const bdr = kid(tcStyle, 'tcBdr');
  for (const [key, tag] of BORDER_SIDES) {
    const side = kid(bdr, tag);
    if (side) out.borders[key] = parseLnElement(kid(side, 'ln'), env, null);
  }
  const tx = kid(part, 'tcTxStyle');
  if (tx) {
    out.bold = attr(tx, 'b') === 'on';
    out.color = childColor(tx, env.ctx);
  }
  return out;
}

function parseTable(tbl: Element, xf: XfrmInfo, env: Env, name?: string): TableElement {
  const tblPr = kid(tbl, 'tblPr');
  const styleId = kid(tblPr, 'tableStyleId')?.textContent?.trim() ?? null;
  const parts = findTableStyle(env.tableStyles, styleId);
  const firstRowOn = boolAttr(tblPr, 'firstRow');
  const lastRowOn = boolAttr(tblPr, 'lastRow');
  const firstColOn = boolAttr(tblPr, 'firstCol');
  const lastColOn = boolAttr(tblPr, 'lastCol');
  const bandRow = boolAttr(tblPr, 'bandRow');

  const colWidths = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => emu(numAttr(c, 'w')));
  const trs = kids(tbl, 'tr');

  const parseRow = (tr: Element, ri: number, rowCount: number): TableRow => {
    const isFirst = firstRowOn && ri === 0;
    const isLast = lastRowOn && ri === rowCount - 1;
    const bandIdx = bandRow ? (firstRowOn ? ri - 1 : ri) : -1;
    return {
      height: emu(numAttr(tr, 'h')),
      cells: kids(tr, 'tc').map((tc, ci): TableCell => {
        const isFirstCol = firstColOn && ci === 0;
        const isLastCol = lastColOn && ci === kids(tr, 'tc').length - 1;

        // 样式叠加：整表 → 条纹 → 首/末列 → 首/末行
        const layers: (Element | null)[] = [parts?.wholeTbl ?? null];
        if (bandIdx >= 0 && !isFirst && !isLast) layers.push(bandIdx % 2 === 0 ? (parts?.band1H ?? null) : (parts?.band2H ?? null));
        if (isFirstCol) layers.push(parts?.firstCol ?? null);
        if (isLastCol) layers.push(parts?.lastCol ?? null);
        if (isFirst) layers.push(parts?.firstRow ?? null);
        if (isLast) layers.push(parts?.lastRow ?? null);

        let fill: Fill | null = null;
        const borders: CellBorders = {};
        let bold = false;
        let color: string | null = null;
        for (const layer of layers) {
          const r = stylePartToCell(layer, env);
          if (r.fill) fill = r.fill;
          for (const [key] of BORDER_SIDES) if (r.borders[key] !== undefined) borders[key] = r.borders[key];
          if (r.bold) bold = true;
          if (r.color) color = r.color;
        }

        const tcPr = kid(tc, 'tcPr');
        const ownFill = parseFillProps(tcPr, env);
        if (ownFill) fill = ownFill;
        for (const [key, , lnTag] of BORDER_SIDES) {
          const side = kid(tcPr, lnTag);
          if (side) borders[key] = parseLnElement(side, env, null);
        }

        const txBody = kid(tc, 'txBody');
        const textEnv: Parameters<typeof parseTextBody>[1] = {
          ctx: env.ctx,
          fonts: env.theme.fonts,
          chain: [env.docDefaults],
          slideNum: env.slideNum,
          defaultColor: color,
          resolveLink: (rid, action) => resolveLink(env, rid, action),
          edit: env.edit,
        };
        const text = parseTextBody(txBody, textEnv);
        const textTemplate = !text && env.edit
          ? parseTextBody(txBody, textEnv, true) ?? undefined
          : undefined;
        if (bold) {
          for (const body of [text, textTemplate]) {
            if (body) for (const p of body.paragraphs) for (const r of p.runs) r.b = true;
          }
        }

        const mar = (n2: string, dflt: number): number => {
          const v = numAttr(tcPr, n2);
          return v === null ? emu(dflt) : emu(v);
        };

        return {
          colSpan: numAttr(tc, 'gridSpan') ?? 1,
          rowSpan: numAttr(tc, 'rowSpan') ?? 1,
          merged: boolAttr(tc, 'hMerge') || boolAttr(tc, 'vMerge'),
          fill,
          text,
          borders,
          margins: [mar('marT', 45720), mar('marR', 91440), mar('marB', 45720), mar('marL', 91440)],
          vAlign: attr(tcPr, 'anchor') === 'ctr' ? 'middle' : attr(tcPr, 'anchor') === 'b' ? 'bottom' : 'top',
          vert: attr(tcPr, 'vert') === 'vert' ? 'vert' : attr(tcPr, 'vert') === 'vert270' ? 'vert270' : undefined,
          ...(textTemplate ? { editInfo: { textTemplate } } : {}),
        };
      }),
    };
  };

  const rows = trs.map((tr, ri) => parseRow(tr, ri, trs.length));
  let editInfo: TableElement['editInfo'];
  const template = trs[trs.length - 1];
  if (env.edit && template) {
    const next = trs.length;
    editInfo = {
      tableRowAppend: {
        ...(next === 1 ? { previousLast: parseRow(template, 0, 2) } : {}),
        regular: [
          parseRow(template, next, next + 2),
          parseRow(template, next + 1, next + 3),
        ],
        last: [
          parseRow(template, next, next + 1),
          parseRow(template, next + 1, next + 2),
        ],
      },
    };
  }

  return { kind: 'table', ...base(xf), colWidths, rows, name, ...(editInfo ? { editInfo } : {}) };
}

const creationTables = new WeakMap<Element, Map<string, Element>>();
let fallbackCreationTable: Element | null = null;
const CREATION_TABLE_TEXT = '<a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></a:txBody>';
const NEUTRAL_TABLE_TEXT = '<a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN" b="0"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:endParaRPr></a:p></a:txBody>';
const NEUTRAL_BORDER_FILL = '<a:solidFill><a:schemeClr val="tx1"><a:alpha val="25000"/></a:schemeClr></a:solidFill>';

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 同时兼容原生 DOM 与 Worker 的 xml-lite，只序列化表样式里已解析出的线节点。 */
function elementMarkup(element: Element, tagName = element.tagName): string {
  const attributes = Array.from(element.attributes)
    .map((item) => ` ${item.name}="${escapeXmlText(item.value)}"`).join('');
  const nodes = Array.from((element as unknown as { childNodes: readonly unknown[] }).childNodes);
  if (!nodes.length) return `<${tagName}${attributes}/>`;
  const content = nodes.map((node) => {
    if (typeof node === 'string') return escapeXmlText(node);
    const child = node as { nodeType?: number; nodeValue?: string | null; tagName?: string };
    return child.nodeType === 1 || child.tagName
      ? elementMarkup(node as Element)
      : escapeXmlText(child.nodeValue ?? '');
  }).join('');
  return `<${tagName}${attributes}>${content}</${tagName}>`;
}

function tableCellPropertiesMarkup(parts: TableStyleParts | null, rowPart: Element | null): string {
  const layers = [parts?.wholeTbl ?? null, rowPart];
  const borders = BORDER_SIDES.map(([, styleTag, cellTag]) => {
    let line: Element | null = null;
    for (const layer of layers) {
      const candidate = kid(kid(kid(layer, 'tcStyle'), 'tcBdr'), styleTag);
      if (candidate) line = kid(candidate, 'ln');
    }
    return line
      ? elementMarkup(line, `a:${cellTag}`)
      : `<a:${cellTag} w="9525">${NEUTRAL_BORDER_FILL}</a:${cellTag}>`;
  }).join('');
  const neutralFill = parts ? '' : '<a:solidFill><a:schemeClr val="lt1"/></a:solidFill>';
  return `<a:tcPr>${borders}${neutralFill}</a:tcPr>`;
}

function defaultTableSource(
  cellPropertiesMarkup: readonly [string, string, string],
  textBodyMarkup: string,
  tableStyles: Element | null,
): Element {
  const key = `${textBodyMarkup}\u0000${cellPropertiesMarkup.join('\u0000')}`;
  const cache = tableStyles ? creationTables.get(tableStyles) : null;
  const cached = tableStyles ? cache?.get(key) : fallbackCreationTable;
  if (cached) return cached;
  const cell = (properties: string) => `<a:tc>${textBodyMarkup}${properties}</a:tc>`;
  const root = parseXml(`<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid><a:gridCol w="9525"/></a:tblGrid>
<a:tr h="9525">${cell(cellPropertiesMarkup[0])}</a:tr>
<a:tr h="9525">${cell(cellPropertiesMarkup[1])}</a:tr>
<a:tr h="9525">${cell(cellPropertiesMarkup[2])}</a:tr>
  </a:tbl></root>`);
  const table = kid(root, 'tbl')!;
  if (tableStyles) {
    const next = cache ?? new Map<string, Element>();
    next.set(key, table);
    if (!cache) creationTables.set(tableStyles, next);
  } else fallbackCreationTable = table;
  return table;
}

/** 写回 tableStyleId 与即时单元格视觉由同一默认表样式求值，避免首次保存后整表变色。 */
function defaultTableEditInfo(env: Env): TableCreationDefaults {
  const candidateStyleId = attr(env.tableStyles, 'def')?.trim();
  const parts = candidateStyleId ? findTableStyle(env.tableStyles, candidateStyleId) : null;
  const styleId = candidateStyleId || undefined;
  const cellPropertiesMarkup = [
    tableCellPropertiesMarkup(parts, parts?.firstRow ?? null),
    tableCellPropertiesMarkup(parts, parts?.band1H ?? null),
    tableCellPropertiesMarkup(parts, parts?.band2H ?? null),
  ] as const;
  const textBodyMarkup = parts ? CREATION_TABLE_TEXT : NEUTRAL_TABLE_TEXT;
  const table = parseTable(defaultTableSource(
    cellPropertiesMarkup, textBodyMarkup, parts ? env.tableStyles : null,
  ), {
    x: 0, y: 0, w: 1, h: 3, chX: 0, chY: 0, chW: 1, chH: 3,
    rot: 0, flipH: false, flipV: false,
  }, env);
  const [first, band1, band2] = table.rows.map((row) => row.cells[0]);
  if (!first?.editInfo?.textTemplate || !band1?.editInfo?.textTemplate
    || !band2?.editInfo?.textTemplate) {
    throw new Error('无法构造新增表格单元格模板');
  }
  return {
    ...(styleId ? { styleId } : {}), textBodyMarkup, cellPropertiesMarkup,
    firstRow: first, bandRows: [band1, band2],
  };
}

// ---------------- 幻灯片 ----------------

function extractText(root: Element | null): string {
  if (!root) return '';
  const out: string[] = [];
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === 't') out.push(all[i].textContent ?? '');
    else if (all[i].localName === 'p' && out.length) out.push('\n');
  }
  return out.join('').replace(/\n+/g, '\n').trim();
}

// ---------------- 批注 ----------------

interface AuthorInfo {
  name: string;
  initials?: string;
}

/**
 * 作者表：经典 commentAuthors.xml（authorId 为数字）与新版 authors.xml（id 为 GUID）都收进同一张表。
 */
function parseCommentAuthors(pkg: Pkg, presRels: Rels): Map<string, AuthorInfo> {
  const out = new Map<string, AuthorInfo>();
  for (const rel of Object.values(presRels)) {
    if (!/\/(commentAuthors|authors)$/.test(rel.type)) continue;
    const root = pkg.xml(rel.target);
    if (!root) continue;
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.localName !== 'cmAuthor' && el.localName !== 'author') continue;
      const id = attr(el, 'id');
      const name = attr(el, 'name');
      if (id === null || !name) continue;
      out.set(id, { name, initials: attr(el, 'initials') ?? undefined });
    }
  }
  return out;
}

/** 幻灯片批注：经典 p:cm（p:text）与新版 p188:cm（p188:txBody）走同一条 localName 路径 */
function parseSlideComments(pkg: Pkg, slideRels: Rels, authors: Map<string, AuthorInfo>): SlideComment[] {
  const out: SlideComment[] = [];
  for (const rel of Object.values(slideRels)) {
    if (!rel.type.endsWith('/comments')) continue;
    const root = pkg.xml(rel.target);
    if (!root) continue;
    for (const cm of kids(root, 'cm')) {
      const authorId = attr(cm, 'authorId') ?? '';
      const author = authors.get(authorId);
      const pos = kid(cm, 'pos');
      const textEl = kid(cm, 'text');
      const text = (textEl?.textContent ?? extractText(kid(cm, 'txBody'))).trim();
      const idx = numAttr(cm, 'idx');
      out.push({
        author: author?.name ?? (authorId ? `作者 ${authorId}` : '未知作者'),
        initials: author?.initials,
        date: attr(cm, 'dt') ?? attr(cm, 'created') ?? undefined,
        text,
        x: emu(numAttr(pos, 'x')),
        y: emu(numAttr(pos, 'y')),
        idx: idx !== null ? idx : undefined,
      });
    }
  }
  out.sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
  return out;
}

// ---------------- 节 ----------------

/** p:extLst → p14:sectionLst；slideIds 为 p:sldId@id，同时给出对应页序号 */
function parseSections(presRoot: Element, idToIndex: Map<number, number>): Section[] {
  const out: Section[] = [];
  const all = presRoot.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName !== 'sectionLst') continue;
    for (const sec of kids(all[i], 'section')) {
      const slideIds: number[] = [];
      const slideIndexes: number[] = [];
      for (const s of kids(kid(sec, 'sldIdLst'), 'sldId')) {
        const id = numAttr(s, 'id');
        if (id === null) continue;
        slideIds.push(id);
        const at = idToIndex.get(id);
        if (at !== undefined) slideIndexes.push(at);
      }
      out.push({ name: attr(sec, 'name') ?? `节 ${out.length + 1}`, slideIds, slideIndexes });
    }
    break;
  }
  return out;
}

function parseEmbeddedFonts(pkg: Pkg, presRoot: Element, presRels: Rels): EmbeddedFont[] {
  const out: EmbeddedFont[] = [];
  for (const ef of kids(kid(presRoot, 'embeddedFontLst'), 'embeddedFont')) {
    const family = attr(kid(ef, 'font'), 'typeface');
    if (!family) continue;
    for (const [tag, bold, italic] of [['regular', false, false], ['bold', true, false], ['italic', false, true], ['boldItalic', true, true]] as const) {
      const rid = attr(kid(ef, tag), 'r:id');
      const target = rid ? presRels[rid]?.target : null;
      const url = target ? pkg.fontUrl(target) : null;
      if (url) out.push({ family, src: url, bold, italic });
    }
  }
  return out;
}

export interface PptxParseOptions {
  /**
   * 惰性解析幻灯片（默认开启）。
   * `slides` 仍是普通数组，`length` 与遍历行为不变，只是每一项在首次读取时才真正解析。
   * 设为 false 可拿到「全部解析完毕」的纯数据对象——需要 `structuredClone`
   * 或 `JSON.stringify` 整份演示文稿时更省心。
   */
  lazy?: boolean;
  /** 为页与元素保留 OOXML 回写锚点和占位符身份；默认关闭 */
  edit?: boolean;
  /** 保留原始 ZIP 与解压 part，通过 `Presentation.package` 暴露；默认关闭 */
  keepPackage?: boolean;
  /**
   * 资源产出方式。`defer` 下图片不建 blob URL，而是发 `asset:N` 令牌并把字节
   * 收进 `assets`，供 Worker 把结果传回主线程后再兑现成真实 URL。
   */
  assets?: AssetMode;
}

/** Worker 模式下的解析结果：Schema 里是 asset:N 令牌，字节单独带出 */
export interface PptxParseResult {
  presentation: Presentation;
  assets: DeferredAsset[];
}

export function parsePptxDeferred(bytes: Uint8Array): PptxParseResult {
  const pkg = new Pkg(bytes);
  pkg.assetMode = 'defer';
  const presentation = buildPresentation(pkg, { lazy: false, assets: 'defer' });
  return { presentation, assets: pkg.deferred };
}

export function parsePptx(bytes: Uint8Array, opts: PptxParseOptions = {}): Presentation {
  const pkg = new Pkg(bytes, opts.keepPackage === true);
  if (opts.assets === 'defer') pkg.assetMode = 'defer';
  return buildPresentation(pkg, opts);
}

function buildPresentation(pkg: Pkg, opts: PptxParseOptions): Presentation {
  const presPath = 'ppt/presentation.xml';
  const presRoot = pkg.xml(presPath);
  if (!presRoot) throw new Error('无效的 .pptx：找不到 ppt/presentation.xml');
  const presRels = pkg.rels(presPath);

  const sldSz = kid(presRoot, 'sldSz');
  const width = emu(numAttr(sldSz, 'cx') ?? 12192000);
  const height = emu(numAttr(sldSz, 'cy') ?? 6858000);

  const tableStylesPath = relByType(presRels, '/tableStyles');
  const tableStyles = tableStylesPath ? pkg.xml(tableStylesPath) : null;

  const docDefaults: LevelStyles = { lvls: [] };
  const slideIds = kids(kid(presRoot, 'sldIdLst'), 'sldId');

  // 幻灯片路径 → 页码，用于内部超链接
  const slideIdMap: Record<string, number> = {};
  const idToIndex = new Map<number, number>();
  slideIds.forEach((sldId, i) => {
    const rid = attr(sldId, 'r:id');
    const target = rid ? presRels[rid]?.target : null;
    if (target) slideIdMap[target] = i + 1;
    const id = numAttr(sldId, 'id');
    if (id !== null) idToIndex.set(id, i);
  });

  const authors = parseCommentAuthors(pkg, presRels);

  // 有效的幻灯片路径（缺 rels 的条目直接跳过，保证下标连续）
  const slidePaths: string[] = [];
  for (const sldId of slideIds) {
    const rid = attr(sldId, 'r:id');
    const target = rid ? presRels[rid]?.target : null;
    if (target) slidePaths.push(target);
  }

  const failed = (i: number, err: unknown): Slide => ({
    background: { type: 'solid', color: 'rgb(255,255,255)' },
    elements: [{
      kind: 'unsupported', x: width * 0.1, y: height * 0.4, w: width * 0.8, h: height * 0.2,
      rot: 0, flipH: false, flipV: false,
      label: `第 ${i + 1} 页解析失败：${err instanceof Error ? err.message : String(err)}`,
    }],
    ...(opts.edit ? { editInfo: { origin: { part: slidePaths[i] } } } : {}),
  });

  const buildSlide = (i: number): Slide => {
    try {
      return parseSlide(
        pkg, slidePaths[i], i + 1, presRoot, docDefaults, tableStyles, slideIdMap, authors, opts.edit === true,
      );
    } catch (err) {
      return failed(i, err);
    }
  };

  let slides: Slide[];
  if (opts.lazy === false) {
    slides = slidePaths.map((_, i) => buildSlide(i));
  } else {
    // 惰性：只在首次访问某页时才解析它。
    // 200 页的文件首屏因此从「解析全部」降到「解析 1 页」，实测快约 11 倍。
    slides = new Array<Slide>(slidePaths.length);
    slidePaths.forEach((_, i) => {
      let cached: Slide | undefined;
      Object.defineProperty(slides, i, {
        enumerable: true,
        configurable: true,
        get(): Slide {
          if (cached === undefined) cached = buildSlide(i);
          return cached;
        },
        set(v: Slide) {
          cached = v;
        },
      });
    });
  }

  const sections = parseSections(presRoot, idToIndex);
  const layouts = opts.edit
    ? parseLayoutCatalog(pkg, presRoot, presRels, docDefaults, tableStyles, slideIdMap)
    : undefined;

  const opcPackage = pkg.opcPackage;
  return {
    width, height, slides, source: 'pptx',
    dispose: () => pkg.dispose(),
    ...(opcPackage ? { package: opcPackage } : {}),
    embeddedFonts: parseEmbeddedFonts(pkg, presRoot, presRels),
    sections: sections.length ? sections : undefined,
    ...(layouts ? { editInfo: { layouts } } : {}),
  };
}

function resolvedSlideBackground(
  slideRoot: Element | null,
  slidePath: string | null,
  inheritance: SlideInheritance,
): Fill | null {
  const { layoutRoot, layoutPath, masterRoot, masterPath, envFor } = inheritance;
  for (const [root, path] of [[slideRoot, slidePath], [layoutRoot, layoutPath], [masterRoot, masterPath]] as const) {
    const bg = walk(root, 'cSld', 'bg');
    if (!bg || !path) continue;
    const env = envFor(path, false);
    const bgPr = kid(bg, 'bgPr');
    if (bgPr) {
      const fill = parseFillProps(bgPr, env);
      if (fill) return fill;
      continue;
    }
    const bgRef = kid(bg, 'bgRef');
    if (!bgRef) continue;
    const idx = Number(attr(bgRef, 'idx') ?? '0');
    const phClr = childColor(bgRef, env.ctx);
    const styleEl = env.theme.bgFillStyles[Math.min(idx, env.theme.bgFillStyles.length) - 1] ?? null;
    const fill = styleEl
      ? parseFillElement(styleEl, withPhClr(env, phClr))
      : (phClr ? { type: 'solid' as const, color: phClr } : null);
    if (fill) return fill;
  }
  return null;
}

function parseLayoutCatalog(
  pkg: Pkg,
  presRoot: Element,
  presRels: Rels,
  docDefaults: LevelStyles,
  tableStyles: Element | null,
  slideIdMap: Record<string, number>,
): NonNullable<Presentation['editInfo']>['layouts'] {
  const layoutPaths = layoutCatalogPaths(
    presRoot, presRels, (path) => pkg.xml(path), (path) => pkg.rels(path),
  );
  return layoutPaths.flatMap((layoutPath) => {
    const inheritance = slideInheritance(
      pkg, null, layoutPath, presRoot, docDefaults, tableStyles, slideIdMap, 1, true,
    );
    if (!inheritance.layoutRoot || !inheritance.masterPath) return [];
    const staticElements: SlideElement[] = [];
    if (boolAttr(inheritance.layoutRoot, 'showMasterSp', true)) {
      staticElements.push(...parseShapeTree(
        inheritance.masterTree, inheritance.envFor(inheritance.masterPath, false), true,
      ));
    }
    // showMasterSp 只屏蔽母版图形；版式自身的背景图形始终属于该版式。
    staticElements.push(...parseShapeTree(
      inheritance.layoutTree, inheritance.envFor(layoutPath, false), true,
    ));
    const placeholders = parseShapeTree(
      inheritance.layoutTree, inheritance.envFor(layoutPath, true), false,
    ).flatMap((element) => {
      const template = layoutPlaceholderTemplate(element);
      return template ? [template] : [];
    });
    return [{
      id: layoutPath,
      name: attr(walk(inheritance.layoutRoot, 'cSld'), 'name') ?? layoutPath,
      origin: { part: layoutPath, masterPart: inheritance.masterPath },
      background: resolvedSlideBackground(null, null, inheritance),
      elements: [...staticElements, ...placeholders],
      transition: parseTransition(inheritance.layoutRoot) ?? undefined,
      defaultShape: defaultShapeEditInfo(inheritance.envFor(layoutPath, true))!,
      defaultTable: defaultTableEditInfo(inheritance.envFor(layoutPath, true)),
    }];
  });
}

function parseSlide(
  pkg: Pkg,
  slidePath: string,
  slideNum: number,
  presRoot: Element,
  docDefaults: LevelStyles,
  tableStyles: Element | null,
  slideIdMap: Record<string, number>,
  authors: Map<string, AuthorInfo>,
  edit: boolean,
): Slide {
  const slideRoot = pkg.xml(slidePath);
  const slideRels = pkg.rels(slidePath);
  const layoutPath = relByType(slideRels, '/slideLayout');
  const inheritance = slideInheritance(
    pkg, slideRoot, layoutPath, presRoot, docDefaults, tableStyles, slideIdMap, slideNum, edit,
  );
  const { layoutRoot, masterPath, masterTree, layoutTree, envFor } = inheritance;
  const slideTree = walk(slideRoot, 'cSld', 'spTree');

  const elements: SlideElement[] = [];
  const showMaster = boolAttr(slideRoot, 'showMasterSp', true) && boolAttr(layoutRoot, 'showMasterSp', true);
  if (showMaster && masterPath) {
    elements.push(...parseShapeTree(masterTree, envFor(masterPath, false), true));
  }
  elements.push(...parseShapeTree(layoutTree, envFor(layoutPath, false), true));
  elements.push(...parseShapeTree(slideTree, envFor(slidePath, true), false));

  const background = resolvedSlideBackground(slideRoot, slidePath, inheritance);

  // 运动路径的坐标是幻灯片尺寸的比例，解析时就得换算成 px
  const sz = kid(presRoot, 'sldSz');
  const slideW = emu(numAttr(sz, 'cx') ?? 12192000);
  const slideH = emu(numAttr(sz, 'cy') ?? 6858000);

  const notesPath = relByType(slideRels, '/notesSlide');
  const notes = notesPath ? extractText(walk(pkg.xml(notesPath), 'cSld', 'spTree')) : '';
  const comments = parseSlideComments(pkg, slideRels, authors);

  return {
    background,
    elements,
    notes: notes || undefined,
    comments: comments.length ? comments : undefined,
    hidden: attr(slideRoot, 'show') === '0' || undefined,
    layoutName: attr(walk(layoutRoot, 'cSld'), 'name') ?? undefined,
    transition: parseTransition(slideRoot) ?? parseTransition(layoutRoot),
    animations: parseTiming(kid(slideRoot, 'timing'), slideW, slideH),
    ...(edit ? {
      editInfo: {
        origin: { part: slidePath }, ...(layoutPath ? { layoutId: layoutPath } : {}),
        defaultShape: defaultShapeEditInfo(envFor(slidePath, true)),
        defaultTable: defaultTableEditInfo(envFor(slidePath, true)),
      },
    } : {}),
  };
}
