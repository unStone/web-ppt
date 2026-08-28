import {
  findPlaceholderByIdentity, PLACEHOLDER_DIRECT_BITS,
  releasePptxLayoutReparseSession, reparsePptxSlideWithLayout,
} from '@web-ppt/core';
import type {
  GeomSpec, ShapeCreationDefaults, Slide, SlideElement, TableCreationDefaults, TextBody,
} from '@web-ppt/core';
import { hydrateLayoutSlideAssets, releaseLayoutAssetCache } from './layout-assets';
import { fieldTextWithoutDirect } from './field-text';
import { rebaseLayoutText } from './layout-text-rebase';
import type { EditDoc, ElementId, SlideId } from './types';

interface LayoutResolvedVariant {
  readonly sourcePart: string;
  readonly slide: Slide;
  readonly origins: Map<string, SlideElement | null>;
}

interface LayoutSourceCache {
  readonly package: EditDoc['package'];
  readonly variants: Map<string, LayoutResolvedVariant>;
}

const layoutSourceCaches = new WeakMap<EditDoc, LayoutSourceCache>();
const MAX_LAYOUT_SOURCE_VARIANTS = 16;

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
  const pkg = doc.package;
  const sourcePart = sourcePartForLayout(doc, slideId);
  if (!pkg || !slide?.origin || !sourcePart || !slide.layoutId
    || slide.layoutId === slide.sourceLayoutId) return null;
  let cache = layoutSourceCaches.get(doc);
  if (!cache || cache.package !== pkg) {
    cache = { package: pkg, variants: new Map() };
    layoutSourceCaches.set(doc, cache);
  }
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
  if (!slide?.origin || !origin || record.meta.created || origin.part !== slide.origin.part) return null;
  const variant = resolvedLayoutVariant(doc, slideId);
  return variant?.origins.get(`${variant.sourcePart}\0${origin.spid}`) ?? null;
}

export function changedLayout(doc: EditDoc, slideId: SlideId) {
  const slide = doc.slides[slideId];
  return slide?.layoutId && slide.layoutId !== slide.sourceLayoutId
    ? doc.layouts[slide.layoutId] : undefined;
}

export function currentShapeDefaults(
  doc: EditDoc,
  slideId: SlideId,
): ShapeCreationDefaults | undefined {
  const slide = doc.slides[slideId];
  if (!slide?.layoutId) return slide?.defaultShape;
  if (slide.layoutId === slide.sourceLayoutId) {
    return slide.defaultShape ?? doc.layouts[slide.layoutId]?.defaultShape;
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
    return slide.defaultTable ?? doc.layouts[slide.layoutId]?.defaultTable;
  }
  return resolvedLayoutSlide(doc, slideId)?.editInfo?.defaultTable
    ?? doc.layouts[slide.layoutId]?.defaultTable
    ?? slide.defaultTable;
}

/** 页面级 showMasterSp=false 必须继续压过新关系指向的版式/母版。 */
export function projectedLayoutElements(doc: EditDoc, slideId: SlideId): SlideElement[] {
  const layout = changedLayout(doc, slideId);
  if (!layout) return [];
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
): SlideElement | null {
  const ph = record.meta.ph;
  if (!ph) return null;
  const slide = doc.slides[slideId];
  if (!slide.layoutId) return null;
  const sourceLayout = slide.layoutId === slide.sourceLayoutId;
  if (sourceLayout && !(record.meta.created && record.meta.fieldPlaceholder)) return null;
  const elements = sourceLayout
    ? doc.layouts[slide.layoutId]?.elements ?? []
    : projectedLayoutElements(doc, slideId);
  const placeholders = elements.filter((element) =>
    !!element.editInfo?.placeholder) ?? [];
  return findPlaceholderByIdentity(
    placeholders, (element) => element.editInfo?.placeholder, ph,
  ) ?? null;
}

export function projectionContentIds(doc: EditDoc, slideId: SlideId): ElementId[] {
  const slide = doc.slides[slideId];
  return changedLayout(doc, slideId)
    ? slide.children.filter((elementId) => !doc.elements[elementId].meta.inherited)
    : slide.children;
}

/** 目标没有宿主且来源变换本来只靠旧版式继承时，保存必须把有效 frame 降级为页面直设。 */
export function layoutFallbackElementIds(doc: EditDoc, slideId: SlideId): ElementId[] {
  if (!changedLayout(doc, slideId)) return [];
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
  if (element.kind === 'group') {
    for (const child of element.children) flattenVirtualElement(child, output);
  }
}

function flattenRecordElement(doc: EditDoc, id: ElementId, output: Array<ElementId | null>): void {
  output.push(id);
  for (const child of doc.elements[id].children ?? []) flattenRecordElement(doc, child, output);
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
  const layout = changedLayout(doc, slideId);
  if (!layout) return [];
  const bound = new Set<SlideElement>();
  for (const id of projectionContentIds(doc, slideId)) {
    const record = doc.elements[id];
    if (!record.meta.ph) continue;
    const target = targetPlaceholder(doc, slideId, record);
    if (target) bound.add(target);
  }
  return projectedLayoutElements(doc, slideId).filter((element) =>
    !!element.editInfo?.placeholder && !bound.has(element));
}

export function rebasedElementBase(
  doc: EditDoc,
  slideId: SlideId,
  record: EditDoc['elements'][string],
): { base: SlideElement; geom?: GeomSpec } {
  const slide = doc.slides[slideId];
  const target = targetPlaceholder(doc, slideId, record);
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
  const creationDefaults = record.meta.themeDefaultShape
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
    const targetText = target.editInfo?.textLevelTemplate
      ?? target.editInfo?.textTemplate ?? target.text;
    base.text = record.meta.created && !record.meta.fieldPlaceholder
      ? structuredClone(target.text)
      : rebaseLayoutText(
        base.text,
        record.meta.fieldPlaceholder && targetText ? fieldTextWithoutDirect(targetText) : targetText,
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
export function rebasedTextBase(doc: EditDoc, slideId: SlideId, id: ElementId): TextBody | null {
  const record = doc.elements[id];
  if (!record) throw new Error(`找不到元素：${id}`);
  const base = rebasedElementBase(doc, slideId, record).base;
  if (base.kind !== 'shape') return null;
  if (base.text) return base.text;
  const target = targetPlaceholder(doc, slideId, record);
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
