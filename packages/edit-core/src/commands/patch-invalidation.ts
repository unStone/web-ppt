import {
  invalidateElement, invalidateElementStructure, invalidateLayoutElementCaches,
  invalidateSlide, invalidateSlideData, invalidateSlideSequence, invalidateSlideStructure,
} from '../projection';
import type { EditDoc, ElementId, SlideId } from '../types';
import { isElementHierarchyPatch } from './element-hierarchy';
import { isElementInteractionPatch } from './element-interaction';
import { isImageResourcePatch } from './element-image-content';
import { isElementTreePatch } from './element-tree';
import { isSlideLayoutPatch } from './slide-layout';
import { isSlideNotesPatch } from './slide-notes';
import { isSlideOrderPatch, slideOrderPatchStart } from './slide-order';
import { isSlidePropertyPatch } from './slide-property';
import { isSlideTreePatch } from './slide-tree';
import type { Patch } from './types';
import { isSectionStatePatch } from './sections';
import { isDocumentSizePatch } from './slide-size';
import { isThemePatch } from './theme';
import { slidesForLayout, slidesForMaster, slidesForTheme } from '../design-dependencies';
import { releaseLayoutProjectionCache } from '../layout-projection';
import { releaseThemeProjectionPackage } from '../theme-projection';
import { isLayoutPropertyPatch } from './layout-property';
import { isMasterBackgroundPatch } from './master-property';
import { isMasterTextStylePatch } from './master-text-style';
import { releaseDesignProjectionPackage } from '../design-projection-package';
import { canvasTargetOfElement } from '../design-target';
import { isDocumentExtensionPatch } from '../document-extensions';
import { registeredEditExtensions } from '../extension-runtime';
import { isExtensionAddressPatch, readExtensionAddress } from '../extension-addresses';

function masterElementPatch(doc: EditDoc, patch: Patch): boolean {
  return (isElementTreePatch(patch) || isElementHierarchyPatch(patch))
    && !!doc.masters[patch.value.parent]
    || patch.path[0] === 'elements' && !!doc.elements[patch.path[1]]
    && canvasTargetOfElement(doc, patch.path[1]).kind === 'master';
}

function slideElementIds(doc: EditDoc, slideId: SlideId): ElementId[] {
  const ids: ElementId[] = [];
  const visit = (id: ElementId): void => {
    ids.push(id);
    for (const child of doc.elements[id]?.children ?? []) visit(child);
  };
  for (const id of doc.slides[slideId].children) visit(id);
  return ids;
}

export function collectPatchInvalidation(
  doc: EditDoc,
  patch: Patch,
  dirtyElements: Set<string>,
  dirtySlides: Set<string>,
  addressTargets: Set<string>,
): void {
  if (isExtensionAddressPatch(patch)) {
    const { target } = readExtensionAddress(patch.op === 'set' ? patch.value : undefined);
    const key = JSON.stringify(target);
    if (addressTargets.has(key)) return;
    addressTargets.add(key);
    // 多个框架搬到同一资源时只失效一次；使用目标扩展定位消费者，未加载时仍保守失效全稿。
    patch = { op: 'set', origin: patch.origin, path: target, value: null };
  }
  if (isDocumentExtensionPatch(patch)) {
    const runtime = registeredEditExtensions().get(patch.path[2]);
    for (const id of runtime?.documentElements?.(doc, patch) ?? Object.keys(doc.elements)) {
      const dirty = invalidateElement(doc, id);
      for (const element of dirty.dirtyElements) dirtyElements.add(element);
      for (const slide of dirty.dirtySlides) dirtySlides.add(slide);
    }
    return;
  }
  if (masterElementPatch(doc, patch)) {
    releaseLayoutProjectionCache(doc);
    releaseDesignProjectionPackage(doc);
    const target = patch.path[0] === 'elements' && doc.elements[patch.path[1]]
      ? canvasTargetOfElement(doc, patch.path[1]) : null;
    if (target?.kind === 'master') {
      const layoutElements = invalidateLayoutElementCaches(doc, doc.masters[target.id].layoutIds);
      for (const id of layoutElements) dirtyElements.add(id);
    }
  }
  if (isLayoutPropertyPatch(patch)) {
    const layout = doc.layouts[patch.path[1]];
    for (const id of layout.children) dirtyElements.add(id);
    for (const slideId of slidesForLayout(doc, layout.id)) {
      dirtySlides.add(slideId);
      invalidateSlide(doc, slideId);
    }
    return;
  }
  if (isMasterBackgroundPatch(patch) || isMasterTextStylePatch(patch)) {
    releaseLayoutProjectionCache(doc);
    releaseDesignProjectionPackage(doc);
    const master = doc.masters[patch.path[1]];
    for (const id of master.children) dirtyElements.add(id);
    for (const slideId of slidesForMaster(doc, master.id)) {
      if (isMasterTextStylePatch(patch)) {
        const dirty = invalidateSlideStructure(doc, slideId, slideElementIds(doc, slideId));
        for (const elementId of dirty.dirtyElements) dirtyElements.add(elementId);
        for (const id of dirty.dirtySlides) dirtySlides.add(id);
      } else {
        dirtySlides.add(slideId);
        invalidateSlide(doc, slideId);
      }
    }
    if (isMasterTextStylePatch(patch)) {
      const layoutElements = invalidateLayoutElementCaches(doc, master.layoutIds);
      for (const id of layoutElements) dirtyElements.add(id);
    }
    return;
  }
  if (isThemePatch(patch)) {
    const slides = [...slidesForTheme(doc, patch.path[1])];
    releaseLayoutProjectionCache(doc);
    releaseDesignProjectionPackage(doc);
    releaseThemeProjectionPackage(doc);
    const designElements = invalidateLayoutElementCaches(
      doc, doc.layoutOrder.filter((id) => doc.layouts[id].themeId === patch.path[1]),
      patch.path[1],
    );
    for (const id of designElements) dirtyElements.add(id);
    for (const slideId of slides) {
      const dirty = invalidateSlideStructure(doc, slideId, slideElementIds(doc, slideId));
      for (const elementId of dirty.dirtyElements) dirtyElements.add(elementId);
      for (const id of dirty.dirtySlides) dirtySlides.add(id);
    }
    return;
  }
  if (isImageResourcePatch(patch) || isElementInteractionPatch(patch)
    || isSectionStatePatch(patch) || isDocumentSizePatch(patch)) return;
  if (isSlideOrderPatch(patch)) {
    const sequence = invalidateSlideSequence(doc, slideOrderPatchStart(doc, patch));
    for (const elementId of sequence.dirtyElements) dirtyElements.add(elementId);
    for (const slideId of sequence.dirtySlides) dirtySlides.add(slideId);
    return;
  }
  if (isSlideTreePatch(patch)) {
    const start = patch.op === 'insert'
      ? (patch.value.after === null ? 0 : doc.slideOrder.indexOf(patch.value.after) + 1)
      : doc.slideOrder.indexOf(patch.path[1]) + 1;
    const sequence = invalidateSlideSequence(doc, start);
    for (const elementId of sequence.dirtyElements) dirtyElements.add(elementId);
    for (const slideId of sequence.dirtySlides) dirtySlides.add(slideId);
  }
  const dirty = patch.path[0] === 'slides' && patch.path[3] === 'extensions'
    ? invalidateSlide(doc, patch.path[1])
    : isSlideNotesPatch(patch)
    ? invalidateSlideData(doc, patch.path[1])
    : isSlideLayoutPatch(patch)
    ? invalidateSlideStructure(doc, patch.path[1], slideElementIds(doc, patch.path[1]))
    : isSlidePropertyPatch(patch)
    ? invalidateSlide(doc, patch.path[1])
    : isSlideTreePatch(patch)
    ? invalidateSlideStructure(doc, patch.path[1], Object.keys(patch.value.records))
    : isElementTreePatch(patch)
    ? invalidateElementStructure(doc, Object.keys(patch.value.records), patch.value.parent)
    : isElementHierarchyPatch(patch)
    ? invalidateElementStructure(doc, patch.value.affected, patch.value.parent)
    : invalidateElement(doc, patch.path[1]);
  for (const elementId of dirty.dirtyElements) dirtyElements.add(elementId);
  for (const slideId of dirty.dirtySlides) dirtySlides.add(slideId);
}

export function canInvalidateAgainst(doc: EditDoc, patch: Patch): boolean {
  if (isDocumentExtensionPatch(patch)) return true;
  if (isThemePatch(patch)) return !!doc.themes[patch.path[1]];
  if (isLayoutPropertyPatch(patch)) return !!doc.layouts[patch.path[1]];
  if (isMasterBackgroundPatch(patch) || isMasterTextStylePatch(patch)) return !!doc.masters[patch.path[1]];
  if (isImageResourcePatch(patch) || isElementInteractionPatch(patch)
    || isSlideTreePatch(patch) || isSectionStatePatch(patch) || isDocumentSizePatch(patch)) return true;
  if (isSlideOrderPatch(patch)) {
    return !!doc.slides[patch.path[1]]
      && (patch.value.after === null || !!doc.slides[patch.value.after]);
  }
  if (patch.path[0] === 'slides') {
    return !!doc.slides[patch.path[1]];
  }
  if (isElementTreePatch(patch)) {
    return !!doc.slides[patch.value.parent] || !!doc.layouts[patch.value.parent]
      || !!doc.masters[patch.value.parent]
      || !!doc.elements[patch.value.parent];
  }
  if (isElementHierarchyPatch(patch)) {
    return !!doc.slides[patch.value.parent] || !!doc.layouts[patch.value.parent]
      || !!doc.masters[patch.value.parent]
      || !!doc.elements[patch.value.parent];
  }
  return !!doc.elements[patch.path[1]];
}
