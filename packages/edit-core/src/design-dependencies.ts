import type { EditDoc, SlideId } from './types';

interface DesignDependencyIndex {
  readonly slidesByTheme: Map<string, Set<SlideId>>;
  readonly slidesByLayout: Map<string, Set<SlideId>>;
  readonly slidesByMaster: Map<string, Set<SlideId>>;
  readonly themeBySlide: Map<SlideId, string>;
  readonly layoutBySlide: Map<SlideId, string>;
  readonly masterBySlide: Map<SlideId, string>;
}

const indexes = new WeakMap<EditDoc, DesignDependencyIndex>();

function themeOfSlide(doc: EditDoc, slideId: SlideId): string | null {
  const layoutId = doc.slides[slideId]?.layoutId;
  return layoutId ? doc.layouts[layoutId]?.themeId ?? null : null;
}

function build(doc: EditDoc): DesignDependencyIndex {
  const index: DesignDependencyIndex = {
    slidesByTheme: new Map(), slidesByLayout: new Map(),
    slidesByMaster: new Map(), themeBySlide: new Map(), layoutBySlide: new Map(),
    masterBySlide: new Map(),
  };
  for (const slideId of doc.slideOrder) add(index, doc, slideId);
  indexes.set(doc, index);
  return index;
}

function add(index: DesignDependencyIndex, doc: EditDoc, slideId: SlideId): void {
  const layoutId = doc.slides[slideId]?.layoutId;
  if (layoutId) {
    index.layoutBySlide.set(slideId, layoutId);
    let layoutSlides = index.slidesByLayout.get(layoutId);
    if (!layoutSlides) index.slidesByLayout.set(layoutId, layoutSlides = new Set());
    layoutSlides.add(slideId);
    const masterId = doc.layouts[layoutId]?.origin.masterPart;
    if (masterId) {
      index.masterBySlide.set(slideId, masterId);
      let masterSlides = index.slidesByMaster.get(masterId);
      if (!masterSlides) index.slidesByMaster.set(masterId, masterSlides = new Set());
      masterSlides.add(slideId);
    }
  }
  const themeId = themeOfSlide(doc, slideId);
  if (!themeId) return;
  index.themeBySlide.set(slideId, themeId);
  let slides = index.slidesByTheme.get(themeId);
  if (!slides) index.slidesByTheme.set(themeId, slides = new Set());
  slides.add(slideId);
}

function remove(index: DesignDependencyIndex, slideId: SlideId): void {
  const layoutId = index.layoutBySlide.get(slideId);
  if (layoutId) {
    index.layoutBySlide.delete(slideId);
    const slides = index.slidesByLayout.get(layoutId);
    slides?.delete(slideId);
    if (!slides?.size) index.slidesByLayout.delete(layoutId);
  }
  const masterId = index.masterBySlide.get(slideId);
  if (masterId) {
    index.masterBySlide.delete(slideId);
    const slides = index.slidesByMaster.get(masterId);
    slides?.delete(slideId);
    if (!slides?.size) index.slidesByMaster.delete(masterId);
  }
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

export function slidesForLayout(doc: EditDoc, layoutId: string): ReadonlySet<SlideId> {
  return (indexes.get(doc) ?? build(doc)).slidesByLayout.get(layoutId) ?? new Set();
}

export function slidesForMaster(doc: EditDoc, masterId: string): ReadonlySet<SlideId> {
  return (indexes.get(doc) ?? build(doc)).slidesByMaster.get(masterId) ?? new Set();
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
