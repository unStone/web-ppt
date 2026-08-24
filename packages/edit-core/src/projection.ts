import { resolveGeomPath } from '@web-ppt/core/geometry';
import type { GroupElement, ImageElement, ShapeElement, Slide, SlideElement } from '@web-ppt/core';
import type { EditDoc, ElementId, ProjectionInvalidation, SlideId } from './types';
import { textBodyFromOverride } from './text-model';

interface ProjectionCache {
  elements: Map<ElementId, SlideElement>;
  slides: Map<SlideId, Slide>;
}

const caches = new WeakMap<EditDoc, ProjectionCache>();

function cacheOf(doc: EditDoc): ProjectionCache {
  let cache = caches.get(doc);
  if (!cache) {
    cache = { elements: new Map(), slides: new Map() };
    caches.set(doc, cache);
  }
  return cache;
}

function elementRecord(doc: EditDoc, id: ElementId) {
  const record = doc.elements[id];
  if (!record) throw new Error(`找不到元素：${id}`);
  return record;
}

export function effectiveElement(doc: EditDoc, id: ElementId): SlideElement {
  const cache = cacheOf(doc);
  const cached = cache.elements.get(id);
  if (cached) return cached;

  const record = elementRecord(doc, id);
  let out = { ...record.src, ...record.ovr } as unknown as SlideElement;
  if (out.kind === 'shape' && record.ovr.text?.kind === 'empty') {
    out = { ...out, text: null } as ShapeElement;
  } else if (out.kind === 'shape' && record.ovr.text?.kind === 'flat') {
    out = { ...out, text: textBodyFromOverride(record.ovr.text) } as ShapeElement;
  }
  if (out.kind === 'group') {
    const source = record.src as GroupElement;
    // chExt 不进入覆盖层；组 ext 改变时必须由源比例反推出新 scale，才能与保存重开后的解析结果一致。
    const scaleX = source.w > 0 ? source.scaleX * out.w / source.w : source.scaleX;
    const scaleY = source.h > 0 ? source.scaleY * out.h / source.h : source.scaleY;
    out = {
      ...out, scaleX, scaleY,
      children: (record.children ?? []).map((childId) => effectiveElement(doc, childId)),
    } as GroupElement;
  } else if (out.kind === 'shape' && record.meta.geom) {
    const geom = resolveGeomPath(record.meta.geom, out.w, out.h);
    out = { ...out, path: geom.d, openGeom: geom.open || undefined } as ShapeElement;
  } else if (out.kind === 'image' && record.meta.geom) {
    const geom = resolveGeomPath(record.meta.geom, out.w, out.h);
    out = {
      ...out,
      clipPath: record.meta.geom.preset === 'rect' ? null : geom.d,
    } as ImageElement;
  }
  cache.elements.set(id, out);
  return out;
}

export function toSlide(doc: EditDoc, id: SlideId): Slide {
  const cache = cacheOf(doc);
  const cached = cache.slides.get(id);
  if (cached) return cached;
  const record = doc.slides[id];
  if (!record) throw new Error(`找不到幻灯片：${id}`);
  const slide: Slide = {
    ...record.src,
    ...record.ovr,
    elements: record.children.map((elementId) => effectiveElement(doc, elementId)),
  };
  cache.slides.set(id, slide);
  return slide;
}

export function slideOfElement(doc: EditDoc, id: ElementId): SlideId {
  let current = elementRecord(doc, id);
  const seen = new Set<ElementId>();
  for (;;) {
    if (seen.has(current.id)) throw new Error(`元素父链成环：${current.id}`);
    seen.add(current.id);
    if (doc.slides[current.parent]) return current.parent as SlideId;
    current = elementRecord(doc, current.parent as ElementId);
  }
}

/** 元素变化会沿组祖先传播到所属页；无需扫描或比较整份文档。 */
export function invalidateElement(doc: EditDoc, id: ElementId): ProjectionInvalidation {
  const cache = cacheOf(doc);
  const dirtyElements = new Set<ElementId>();
  const dirtySlides = new Set<SlideId>();
  let current = elementRecord(doc, id);
  for (;;) {
    if (dirtyElements.has(current.id)) throw new Error(`元素父链成环：${current.id}`);
    dirtyElements.add(current.id);
    cache.elements.delete(current.id);
    if (doc.slides[current.parent]) {
      const slideId = current.parent as SlideId;
      dirtySlides.add(slideId);
      cache.slides.delete(slideId);
      break;
    }
    current = elementRecord(doc, current.parent as ElementId);
  }
  return { dirtyElements, dirtySlides };
}

export function invalidateSlide(doc: EditDoc, id: SlideId): ProjectionInvalidation {
  if (!doc.slides[id]) throw new Error(`找不到幻灯片：${id}`);
  cacheOf(doc).slides.delete(id);
  return { dirtyElements: new Set(), dirtySlides: new Set([id]) };
}

/** 结构 patch 的根可能尚不存在；以外部父节点失效并清掉整棵树的旧投影缓存。 */
export function invalidateElementStructure(
  doc: EditDoc,
  ids: readonly ElementId[],
  parent: SlideId | ElementId,
): ProjectionInvalidation {
  const cache = cacheOf(doc);
  for (const id of ids) cache.elements.delete(id);
  const dirty = doc.slides[parent]
    ? invalidateSlide(doc, parent as SlideId)
    : invalidateElement(doc, parent as ElementId);
  for (const id of ids) dirty.dirtyElements.add(id);
  return dirty;
}

export function invalidateAll(doc: EditDoc): ProjectionInvalidation {
  caches.delete(doc);
  return {
    dirtyElements: new Set(Object.keys(doc.elements)),
    dirtySlides: new Set(doc.slideOrder),
  };
}
