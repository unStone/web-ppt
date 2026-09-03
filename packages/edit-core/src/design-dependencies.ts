import type { EditDoc, SlideId } from './types';

interface DesignDependencyIndex {
  readonly slidesByTheme: Map<string, Set<SlideId>>;
  readonly themeBySlide: Map<SlideId, string>;
}

const indexes = new WeakMap<EditDoc, DesignDependencyIndex>();

function themeOfSlide(doc: EditDoc, slideId: SlideId): string | null {
  const layoutId = doc.slides[slideId]?.layoutId;
  return layoutId ? doc.layouts[layoutId]?.themeId ?? null : null;
}

function build(doc: EditDoc): DesignDependencyIndex {
  const index: DesignDependencyIndex = { slidesByTheme: new Map(), themeBySlide: new Map() };
  for (const slideId of doc.slideOrder) add(index, doc, slideId);
  indexes.set(doc, index);
  return index;
}

function add(index: DesignDependencyIndex, doc: EditDoc, slideId: SlideId): void {
  const themeId = themeOfSlide(doc, slideId);
  if (!themeId) return;
  index.themeBySlide.set(slideId, themeId);
  let slides = index.slidesByTheme.get(themeId);
  if (!slides) index.slidesByTheme.set(themeId, slides = new Set());
  slides.add(slideId);
}

function remove(index: DesignDependencyIndex, slideId: SlideId): void {
  const themeId = index.themeBySlide.get(slideId);
  if (!themeId) return;
  index.themeBySlide.delete(slideId);
  const slides = index.slidesByTheme.get(themeId);
  slides?.delete(slideId);
  if (!slides?.size) index.slidesByTheme.delete(themeId);
}

export function slidesForTheme(doc: EditDoc, themeId: string): ReadonlySet<SlideId> {
  return (indexes.get(doc) ?? build(doc)).slidesByTheme.get(themeId) ?? new Set();
}

/** 页面树与换版式命令在模型落地前后各调用一次，热路径无需重扫全部页面。 */
export function beforeSlideDesignChange(doc: EditDoc, slideId: SlideId): void {
  const index = indexes.get(doc);
  if (index) remove(index, slideId);
}

export function afterSlideDesignChange(doc: EditDoc, slideId: SlideId): void {
  const index = indexes.get(doc);
  if (index && doc.slides[slideId]) add(index, doc, slideId);
}

export function releaseDesignDependencies(doc: EditDoc): void {
  indexes.delete(doc);
}
