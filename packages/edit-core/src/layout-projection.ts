import {
  findPlaceholderByIdentity, PLACEHOLDER_DIRECT_BITS,
  releasePptxLayoutReparseSession, reparsePptxLayoutTemplate, reparsePptxMasterTemplate,
  reparsePptxSlideWithLayout,
} from '@web-ppt/core';
import type {
  Fill, GeomSpec, ShapeCreationDefaults, Slide, SlideElement, SlideLayoutTemplate, SlideMasterTemplate,
  TableCreationDefaults, TextBody,
} from '@web-ppt/core';
import {
  hydrateLayoutSlideAssets, hydrateLayoutTemplateAssets, hydrateMasterTemplateAssets,
  releaseLayoutAssetCache,
} from './layout-assets';
import { fieldTextWithoutDirect } from './field-text';
import { rebaseLayoutText } from './layout-text-rebase';
import { renderLinkTarget } from './hyperlink';
import { textBodyFromOverride } from './text-model';
import type { EditDoc, ElementId, SlideId } from './types';
import { designProjectionPackage, masterSourceProjectionPackage } from './design-projection-package';
import { layoutHasEdits } from './layout-state';
import { masterHasEdits } from './master-state';
import { own } from './data-validation';

type LayoutElementResolver = (id: ElementId) => SlideElement;

interface LayoutResolvedVariant {
  readonly sourcePart: string;
  readonly slide: Slide;
  readonly origins: Map<string, SlideElement | null>;
}

interface LayoutSourceCache {
  readonly package: EditDoc['package'];
  readonly variants: Map<string, LayoutResolvedVariant>;
  readonly templates: Map<string, { layout: SlideLayoutTemplate; origins: Map<string, SlideElement | null> }>;
  readonly masters: Map<string, { master: SlideMasterTemplate; origins: Map<string, SlideElement | null> }>;
}

const layoutSourceCaches = new WeakMap<EditDoc, LayoutSourceCache>();
const MAX_LAYOUT_SOURCE_VARIANTS = 16;

function sourceCache(doc: EditDoc, pkg: NonNullable<EditDoc['package']>): LayoutSourceCache {
  let cache = layoutSourceCaches.get(doc);
  if (!cache || cache.package !== pkg) {
    cache = { package: pkg, variants: new Map(), templates: new Map(), masters: new Map() };
    layoutSourceCaches.set(doc, cache);
  }
  return cache;
}

function originKey(element: SlideElement): string | null {
  const origin = element.editInfo?.origin;
  return origin ? `${origin.part}\0${origin.spid}` : null;
}

function indexOrigins(
  element: SlideElement,
  output: Map<string, SlideElement | null>,
): void {
  const key = originKey(element);
  if (key) output.set(key, output.has(key) ? null : element);
  if (element.kind === 'group') {
    for (const child of element.children) indexOrigins(child, output);
  }
}

function sourcePartForLayout(doc: EditDoc, slideId: SlideId): string | null {
  const slide = doc.slides[slideId];
  if (!slide?.origin || !doc.package) return null;
  if (doc.package.parts[slide.origin.part]) return slide.origin.part;
  const duplicate = slide.creation?.duplicateSourcePart;
  return duplicate && doc.package.parts[duplicate] ? duplicate : null;
}

function resolvedLayoutVariant(doc: EditDoc, slideId: SlideId): LayoutResolvedVariant | null {
  const slide = doc.slides[slideId];
  const pkg = designProjectionPackage(doc);
  const sourcePart = sourcePartForLayout(doc, slideId);
  if (!pkg || !slide?.origin || !sourcePart || !slide.layoutId
    || (slide.layoutId === slide.sourceLayoutId && pkg === doc.package)) return null;
  const cache = sourceCache(doc, pkg);
  const slideNum = doc.slideOrder.indexOf(slideId) + 1;
  const variantKey = `${sourcePart}\0${slide.layoutId}\0${slideNum}`;
  let variant = cache.variants.get(variantKey);
  if (!variant) {
    const result = reparsePptxSlideWithLayout(
      pkg, sourcePart, slide.layoutId, slideNum,
    );
    const parsed = hydrateLayoutSlideAssets(doc, result.slide, result.assets);
    const origins = new Map<string, SlideElement | null>();
    for (const element of parsed.elements) indexOrigins(element, origins);
    variant = { sourcePart, slide: parsed, origins };
    cache.variants.set(variantKey, variant);
    if (cache.variants.size > MAX_LAYOUT_SOURCE_VARIANTS) {
      const oldest = cache.variants.keys().next().value;
      if (oldest !== undefined) cache.variants.delete(oldest);
    }
  } else {
    // Map 顺序承担轻量 LRU，批量跨页操作也只常驻有限份重解析 Schema。
    cache.variants.delete(variantKey);
    cache.variants.set(variantKey, variant);
  }
  return variant;
}

/** 主题覆盖后的版式来源仍由 core 的 OOXML 继承器求值，编辑层只按来源身份对回稳定节点。 */
export function resolvedLayoutTemplate(doc: EditDoc, layoutId: string): SlideLayoutTemplate | null {
  const pkg = designProjectionPackage(doc);
  if (!pkg || pkg === doc.package) return null;
  const cache = sourceCache(doc, pkg);
  let resolved = cache.templates.get(layoutId);
  if (!resolved) {
    const result = reparsePptxLayoutTemplate(pkg, layoutId);
    const layout = hydrateLayoutTemplateAssets(doc, result.layout, result.assets);
    const origins = new Map<string, SlideElement | null>();
    for (const element of layout.elements) indexOrigins(element, origins);
    resolved = { layout, origins };
    cache.templates.set(layoutId, resolved);
  }
  return resolved.layout;
}

export function resolvedLayoutElementSource(
  doc: EditDoc,
  layoutId: string,
  record: EditDoc['elements'][string],
): SlideElement | null {
  const origin = record.meta.origin;
  if (!origin || record.meta.created) return null;
  const template = resolvedLayoutTemplate(doc, layoutId);
  if (!template) return null;
  return layoutSourceCaches.get(doc)?.templates.get(layoutId)
    ?.origins.get(`${origin.part}\0${origin.spid}`) ?? null;
}

export function resolvedMasterTemplate(doc: EditDoc, masterId: string): SlideMasterTemplate | null {
  const pkg = masterSourceProjectionPackage(doc);
  if (!pkg || pkg === doc.package) return null;
  const cache = sourceCache(doc, pkg);
  let resolved = cache.masters.get(masterId);
  if (!resolved) {
    const result = reparsePptxMasterTemplate(pkg, masterId);
    const master = hydrateMasterTemplateAssets(doc, result.master, result.assets);
    const origins = new Map<string, SlideElement | null>();
    for (const element of master.elements) indexOrigins(element, origins);
    resolved = { master, origins };
    cache.masters.set(masterId, resolved);
  }
  return resolved.master;
}

export function resolvedMasterElementSource(
  doc: EditDoc,
  masterId: string,
  record: EditDoc['elements'][string],
): SlideElement | null {
  const origin = record.meta.origin;
  if (!origin || record.meta.created) return null;
  if (!resolvedMasterTemplate(doc, masterId)) return null;
  return layoutSourceCaches.get(doc)?.masters.get(masterId)
    ?.origins.get(`${origin.part}\0${origin.spid}`) ?? null;
}

export function resolvedLayoutSlide(doc: EditDoc, slideId: SlideId): Slide | null {
  return resolvedLayoutVariant(doc, slideId)?.slide ?? null;
}

export function releaseLayoutProjectionCache(doc: EditDoc): void {
  const cache = layoutSourceCaches.get(doc);
  if (cache?.package) releasePptxLayoutReparseSession(cache.package);
  layoutSourceCaches.delete(doc);
  releaseLayoutAssetCache(doc);
}

/** 同包、同页、同目标版式只解析一次；缓存不进入 EditDoc，文档仍可结构化克隆。 */
function resolvedLayoutSource(
  doc: EditDoc,
  slideId: SlideId,
  record: EditDoc['elements'][string],
): SlideElement | null {
  const slide = doc.slides[slideId];
  const origin = record.meta.origin;
  if (!slide?.origin || !origin || record.meta.created) return null;
  const variant = resolvedLayoutVariant(doc, slideId);
  // 复制页沿用来源 slide part 重解析，但元素已获得新 part 身份；版式/母版来源则必须保留自己的 part。
  const part = origin.part === slide.origin.part ? variant?.sourcePart : origin.part;
  return variant?.origins.get(`${part}\0${origin.spid}`) ?? null;
}

export function changedLayout(doc: EditDoc, slideId: SlideId) {
  const slide = doc.slides[slideId];
  return slide?.layoutId ? doc.layouts[slide.layoutId] : undefined;
}

export function slideDesignChanged(doc: EditDoc, slideId: SlideId): boolean {
  const slide = doc.slides[slideId];
  if (!slide?.layoutId) return false;
  return slide.layoutId !== slide.sourceLayoutId
    || layoutHasEdits(doc, slide.layoutId)
    || masterHasEdits(doc, doc.layouts[slide.layoutId]?.origin.masterPart ?? '');
}

export function layoutShowsMaster(doc: EditDoc, layoutId: string): boolean {
  return doc.layouts[layoutId]?.showMasterShapes !== false;
}

export function effectiveLayoutBackground(
  doc: EditDoc,
  layoutId: string,
  resolved?: { readonly background: Fill | null } | null,
): Fill | null {
  const layout = doc.layouts[layoutId];
  if (!layout) return null;
  if (own(layout.ovr, 'background')) return layout.ovr.background!;
  if (layout.directBackground) return resolved?.background ?? layout.background;
  const master = doc.masters[layout.origin.masterPart];
  if (master && own(master.ovr, 'background')) return master.ovr.background!;
  return resolved?.background ?? layout.background;
}

export function currentShapeDefaults(
  doc: EditDoc,
  slideId: SlideId,
): ShapeCreationDefaults | undefined {
  const slide = doc.slides[slideId];
  if (!slide?.layoutId) return slide?.defaultShape;
  if (slide.layoutId === slide.sourceLayoutId) {
    return resolvedLayoutSlide(doc, slideId)?.editInfo?.defaultShape
      ?? slide.defaultShape ?? doc.layouts[slide.layoutId]?.defaultShape;
  }
  return resolvedLayoutSlide(doc, slideId)?.editInfo?.defaultShape
    ?? doc.layouts[slide.layoutId]?.defaultShape
    ?? slide.defaultShape;
}

export function currentTableDefaults(
  doc: EditDoc,
  slideId: SlideId,
): TableCreationDefaults | undefined {
  const slide = doc.slides[slideId];
  if (!slide?.layoutId) return slide?.defaultTable;
  if (slide.layoutId === slide.sourceLayoutId) {
    return resolvedLayoutSlide(doc, slideId)?.editInfo?.defaultTable
      ?? slide.defaultTable ?? doc.layouts[slide.layoutId]?.defaultTable;
  }
  return resolvedLayoutSlide(doc, slideId)?.editInfo?.defaultTable
    ?? doc.layouts[slide.layoutId]?.defaultTable
    ?? slide.defaultTable;
}

/** 页面级 showMasterSp=false 必须继续压过新关系指向的版式/母版。 */
export function projectedLayoutElements(
  doc: EditDoc,
  slideId: SlideId,
  resolveLayoutElement?: LayoutElementResolver,
): SlideElement[] {
  const layout = changedLayout(doc, slideId);
  if (!layout) return [];
  const masterEdited = masterHasEdits(doc, layout.origin.masterPart);
  if (layoutHasEdits(doc, layout.id) || masterEdited) {
    const master = doc.masters[layout.origin.masterPart];
    const masterElements = layoutShowsMaster(doc, layout.id) && master
      ? master.children.map((id) =>
        resolveLayoutElement ? resolveLayoutElement(id) : doc.elements[id].src)
      : [];
    const layoutElements = layout.children.map((id) =>
      resolveLayoutElement ? resolveLayoutElement(id) : doc.elements[id].src);
    const elements = [...masterElements, ...layoutElements];
    return doc.slides[slideId].sourceHideMasterShapes
      ? elements.filter((element) => element.editInfo?.origin?.part !== layout.origin.masterPart)
      : elements;
  }
  const variant = resolvedLayoutVariant(doc, slideId);
  const elements = variant
    ? [
      ...variant.slide.elements.filter((element) => {
        const part = element.editInfo?.origin?.part;
        return !!part && part !== variant.sourcePart;
      }),
      // 重解析结果把已绑定占位符折叠进 slide 内容；目录节点仍承担未绑定交互与语义匹配。
      ...layout.elements.filter((element) => !!element.editInfo?.placeholder),
    ]
    : layout.elements;
  if (!doc.slides[slideId].sourceHideMasterShapes) return elements;
  return elements.filter((element) =>
    element.editInfo?.origin?.part !== layout.origin.masterPart);
}

function targetPlaceholder(
  doc: EditDoc,
  slideId: SlideId,
  record: EditDoc['elements'][string],
  resolveLayoutElement?: LayoutElementResolver,
): SlideElement | null {
  const ph = record.meta.ph;
  if (!ph) return null;
  const slide = doc.slides[slideId];
  if (!slide.layoutId) return null;
  const sourceLayout = slide.layoutId === slide.sourceLayoutId;
  const editedSourceDesign = sourceLayout && (layoutHasEdits(doc, slide.layoutId)
    || masterHasEdits(doc, doc.layouts[slide.layoutId]?.origin.masterPart ?? ''));
  if (sourceLayout && !editedSourceDesign
    && !(record.meta.created && record.meta.fieldPlaceholder)) return null;
  const elements = sourceLayout && !editedSourceDesign
    ? doc.layouts[slide.layoutId]?.elements ?? []
    : projectedLayoutElements(doc, slideId, resolveLayoutElement);
  const placeholders = elements.filter((element) =>
    !!element.editInfo?.placeholder) ?? [];
  return findPlaceholderByIdentity(
    placeholders, (element) => element.editInfo?.placeholder, ph,
  ) ?? null;
}

function inheritedLayoutText(
  doc: EditDoc,
  slideId: SlideId,
  target: SlideElement,
  fallback: TextBody | null,
): TextBody | null {
  if (!fallback) return null;
  const layoutId = doc.slides[slideId]?.layoutId;
  const origin = target.editInfo?.origin;
  const host = layoutId && origin ? doc.layouts[layoutId]?.children
    .map((id) => doc.elements[id])
    .find((record) => record.meta.origin?.part === origin.part
      && record.meta.origin.spid === origin.spid) : undefined;
  // 版式提示文字自身的 rPr 不会传给页面内容；用户建立的文字覆盖则要叠在继承模板上。
  const source = fieldTextWithoutDirect(fallback);
  // textLevelTemplate 的数组位置就是九级样式地址；清理提示文字直设时不能把各级都折回 0 级。
  source.paragraphs.forEach((paragraph, index) => {
    paragraph.lvl = fallback.paragraphs[index]?.lvl ?? paragraph.lvl;
  });
  return host?.ovr.text?.kind === 'flat'
    ? textBodyFromOverride(host.ovr.text, source, (link) => renderLinkTarget(doc, link))
    : source;
}

export function projectionContentIds(doc: EditDoc, slideId: SlideId): ElementId[] {
  const slide = doc.slides[slideId];
  return changedLayout(doc, slideId)
    ? slide.children.filter((elementId) => !doc.elements[elementId].meta.inherited)
    : slide.children;
}

/** 目标没有宿主且来源变换本来只靠旧版式继承时，保存必须把有效 frame 降级为页面直设。 */
export function layoutFallbackElementIds(doc: EditDoc, slideId: SlideId): ElementId[] {
  if (!slideDesignChanged(doc, slideId)) return [];
  const slide = doc.slides[slideId];
  return slide.children.filter((id) => {
    const record = doc.elements[id];
    return !!record?.meta.ph
      && record.meta.origin?.part === slide.origin?.part
      && !targetPlaceholder(doc, slideId, record);
  });
}

/** 预设几何可由语义重建；继承 custGeom 由保存层从来源版式逐节点复制。 */
export function layoutFallbackGeometry(record: EditDoc['elements'][string]): GeomSpec | undefined {
  return record.meta.geom;
}

function flattenVirtualElement(element: SlideElement, output: Array<ElementId | null>): void {
  output.push(null);
  if (element.kind === 'group'
    && (!element.editInfo || element.editInfo.editable !== 'frame')) {
    for (const child of element.children) flattenVirtualElement(child, output);
  }
}

function flattenRecordElement(doc: EditDoc, id: ElementId, output: Array<ElementId | null>): void {
  const record = doc.elements[id];
  output.push(id);
  if (record.meta.editable !== 'frame') {
    for (const child of record.children ?? []) flattenRecordElement(doc, child, output);
  }
}

/** 整页 SVG 可混入没有 EditDoc 身份的目标版式静态节点；DOM 绑定按同一投影序列跳过它们。 */
export function projectedSlideElementIds(doc: EditDoc, slideId: SlideId): Array<ElementId | null> {
  const output: Array<ElementId | null> = [];
  for (const element of projectedLayoutElements(doc, slideId)
    .filter((candidate) => !candidate.editInfo?.placeholder)) {
    flattenVirtualElement(element, output);
  }
  for (const id of projectionContentIds(doc, slideId)) flattenRecordElement(doc, id, output);
  return output;
}

/** 尚无 slide 内容节点的目标占位符只供 edit interaction layer 提示，不进入业务渲染。 */
export function unboundLayoutPlaceholders(doc: EditDoc, slideId: SlideId): SlideElement[] {
  const placeholders = projectedLayoutElements(doc, slideId).filter((element) =>
    !!element.editInfo?.placeholder);
  if (!placeholders.length) return placeholders;
  const bound = new Set<SlideElement>();
  for (const id of projectionContentIds(doc, slideId)) {
    const ph = doc.elements[id].meta.ph;
    if (!ph) continue;
    // 原版式不必重新继承，但内容仍已绑定；不能借 targetPlaceholder 的重继承条件判定缺位。
    const target = findPlaceholderByIdentity(placeholders, (element) => element.editInfo?.placeholder, ph);
    if (target) bound.add(target);
  }
  return placeholders.filter((element) => !bound.has(element));
}

export function rebasedElementBase(
  doc: EditDoc,
  slideId: SlideId,
  record: EditDoc['elements'][string],
  resolveLayoutElement?: LayoutElementResolver,
): { base: SlideElement; geom?: GeomSpec } {
  const slide = doc.slides[slideId];
  const target = targetPlaceholder(doc, slideId, record, resolveLayoutElement);
  const resolved = resolvedLayoutSource(doc, slideId, record);
  const missingTarget = !!record.meta.ph && !!changedLayout(doc, slideId)
    && record.meta.origin?.part === slide?.origin?.part && !target;
  if (missingTarget) {
    // 文本/主题直设仍应在新母版下求值；只有旧占位符提供、而目标已断开的外观字段需要固定。
    const base = structuredClone(resolved ?? record.src);
    const direct = record.meta.placeholderDirect ?? 0;
    if (!(direct & PLACEHOLDER_DIRECT_BITS.transform)) {
      Object.assign(base, {
        x: record.src.x, y: record.src.y, w: record.src.w, h: record.src.h,
        rot: record.src.rot, flipH: record.src.flipH, flipV: record.src.flipV,
      });
    }
    if (base.kind === 'shape' && record.src.kind === 'shape') {
      if (!(direct & (PLACEHOLDER_DIRECT_BITS.fill | PLACEHOLDER_DIRECT_BITS.style))) {
        base.fill = structuredClone(record.src.fill);
      }
      if (!(direct & (PLACEHOLDER_DIRECT_BITS.stroke | PLACEHOLDER_DIRECT_BITS.style))) {
        base.stroke = structuredClone(record.src.stroke);
      }
      if (!(direct & (PLACEHOLDER_DIRECT_BITS.effects | PLACEHOLDER_DIRECT_BITS.style))) {
        base.effects = structuredClone(
          record.meta.placeholderInheritedEffects ?? record.src.effects,
        );
      }
    } else if (base.kind === 'image' && record.src.kind === 'image'
      && !(direct & (PLACEHOLDER_DIRECT_BITS.stroke | PLACEHOLDER_DIRECT_BITS.style))) {
      base.stroke = structuredClone(record.src.stroke);
    }
    // 继承图片填充跨 part 还需要复制关系闭包；当前显式降级为无填充，避免即时与重开分叉。
    if (base.kind === 'shape' && base.fill?.type === 'image'
      && !(direct & (PLACEHOLDER_DIRECT_BITS.fill | PLACEHOLDER_DIRECT_BITS.style))) {
      base.fill = { type: 'none' };
    }
    const geom = layoutFallbackGeometry(record);
    return { base, ...(geom ? { geom } : {}) };
  }
  if (resolved) {
    const base = structuredClone(resolved);
    if (base.editInfo?.origin && record.meta.origin) {
      base.editInfo = { ...base.editInfo, origin: { ...record.meta.origin } };
    }
    return {
      base,
      ...(base.editInfo?.geom ? { geom: structuredClone(base.editInfo.geom) } : {}),
    };
  }
  const creationDefaults = record.meta.created && record.meta.themeDefaultShape
    ? currentShapeDefaults(doc, slideId) : undefined;
  if (creationDefaults && record.src.kind === 'shape') {
    const base = structuredClone(record.src);
    base.fill = base.openGeom ? { type: 'none' } : structuredClone(creationDefaults.fill);
    base.stroke = structuredClone(creationDefaults.stroke);
    base.effects = structuredClone(creationDefaults.effects);
    return { base, ...(record.meta.geom ? { geom: record.meta.geom } : {}) };
  }
  if (!target) {
    return { base: record.src, ...(record.meta.geom ? { geom: record.meta.geom } : {}) };
  }
  const direct = record.meta.placeholderDirect ?? 0;
  const base = structuredClone(record.src);
  if (!(direct & PLACEHOLDER_DIRECT_BITS.transform)) {
    Object.assign(base, {
      x: target.x, y: target.y, w: target.w, h: target.h,
      rot: target.rot, flipH: target.flipH, flipV: target.flipV,
    });
  }
  const targetGeom = target.editInfo?.geom;
  if (base.kind === 'shape' && target.kind === 'shape') {
    if (!(direct & PLACEHOLDER_DIRECT_BITS.geometry)) {
      base.path = target.path;
      base.openGeom = target.openGeom;
    }
    if (!(direct & (PLACEHOLDER_DIRECT_BITS.fill | PLACEHOLDER_DIRECT_BITS.style))) {
      base.fill = structuredClone(target.fill);
    }
    if (!(direct & (PLACEHOLDER_DIRECT_BITS.stroke | PLACEHOLDER_DIRECT_BITS.style))) {
      base.stroke = structuredClone(target.stroke);
    }
    if (!(direct & (PLACEHOLDER_DIRECT_BITS.effects | PLACEHOLDER_DIRECT_BITS.style))) {
      base.effects = structuredClone(target.effects);
    }
    const rawTargetText = target.editInfo?.textLevelTemplate
      ?? target.editInfo?.textTemplate ?? target.text;
    const targetText = inheritedLayoutText(doc, slideId, target, rawTargetText);
    base.text = record.meta.created && !record.meta.fieldPlaceholder
      ? structuredClone(target.text)
      : rebaseLayoutText(
        base.text,
        targetText,
      );
  } else if (base.kind === 'image') {
    if (!(direct & PLACEHOLDER_DIRECT_BITS.geometry)) {
      base.clipPath = targetGeom?.preset === 'rect' ? null
        : target.kind === 'shape' ? target.path : base.clipPath;
    }
    if (!(direct & PLACEHOLDER_DIRECT_BITS.stroke) && 'stroke' in target) {
      base.stroke = structuredClone(target.stroke);
    }
  }
  return {
    base,
    ...((direct & PLACEHOLDER_DIRECT_BITS.geometry) && record.meta.geom
      ? { geom: record.meta.geom } : targetGeom ? { geom: targetGeom } : {}),
  };
}

/** 文字命令从当前版式的重基值起步，不能把旧版式有效值烘进首次覆盖。 */
export function rebasedTextBase(
  doc: EditDoc,
  slideId: SlideId,
  id: ElementId,
  resolveLayoutElement?: LayoutElementResolver,
): TextBody | null {
  const record = doc.elements[id];
  if (!record) throw new Error(`找不到元素：${id}`);
  const base = rebasedElementBase(doc, slideId, record, resolveLayoutElement).base;
  if (base.kind !== 'shape') return null;
  if (base.text) return base.text;
  const target = targetPlaceholder(doc, slideId, record, resolveLayoutElement);
  const template = target?.editInfo?.textLevelTemplate
    ?? target?.editInfo?.textTemplate
    ?? (target?.kind === 'shape' ? target.text : null)
    ?? (record.meta.themeDefaultShape ? currentShapeDefaults(doc, slideId)?.textTemplate : undefined)
    ?? record.meta.textTemplate
    ?? null;
  if (!template) return null;
  return record.meta.created
    ? structuredClone(template)
    : rebaseLayoutText(record.meta.textTemplate ?? template, template);
}

/** 列表改级必须读取九级样式目录，不能从当前段落反推相邻级别的继承值。 */
export function rebasedTextLevelTemplate(
  doc: EditDoc,
  slideId: SlideId,
  id: ElementId,
): TextBody | undefined {
  const record = doc.elements[id];
  if (!record) throw new Error(`找不到元素：${id}`);
  const target = targetPlaceholder(doc, slideId, record);
  const resolved = resolvedLayoutSource(doc, slideId, record);
  // 重解析结果已把页面自身 lstStyle 叠到新母版/版式链，优先级高于裸目标占位符。
  const candidates = [resolved, target, record.src];
  for (const candidate of candidates) {
    if (candidate?.kind === 'shape' && candidate.editInfo?.textLevelTemplate) {
      return candidate.editInfo.textLevelTemplate;
    }
  }
  return record.meta.textTemplate;
}
