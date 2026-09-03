import { canvasTargetOfElement } from '../design-target';
import type { EditDoc } from '../types';
import { isElementHierarchyPatch } from './element-hierarchy';
import { isElementOrderPatch } from './element-order';
import { isElementTreePatch } from './element-tree';
import type { Patch } from './types';

/** 结构补丁只复制可能被写入的记录；大文稿验证不应深克隆整份模型。 */
export function structuralPatchStage(doc: EditDoc, patches: readonly Patch[]): EditDoc {
  const stage: EditDoc = {
    ...doc,
    identity: structuredClone(doc.identity),
    slides: { ...doc.slides },
    layouts: { ...doc.layouts },
    slideOrder: [...doc.slideOrder],
    sections: structuredClone(doc.sections),
    themes: structuredClone(doc.themes),
    elements: { ...doc.elements },
    removedElements: { ...doc.removedElements },
    imageResources: { ...doc.imageResources },
  };
  const clonedSlides = new Set<string>();
  const clonedLayouts = new Set<string>();
  const clonedElements = new Set<string>();
  const cloneSlide = (id: string): void => {
    if (clonedSlides.has(id) || !stage.slides[id]) return;
    stage.slides[id] = structuredClone(stage.slides[id]);
    clonedSlides.add(id);
  };
  const cloneElement = (id: string): void => {
    if (clonedElements.has(id) || !stage.elements[id]) return;
    stage.elements[id] = structuredClone(stage.elements[id]);
    clonedElements.add(id);
  };
  const cloneLayout = (id: string): void => {
    if (clonedLayouts.has(id) || !stage.layouts[id]) return;
    stage.layouts[id] = structuredClone(stage.layouts[id]);
    clonedLayouts.add(id);
  };
  const cloneParent = (id: string): void => {
    if (stage.slides[id]) cloneSlide(id);
    else if (stage.layouts[id]) cloneLayout(id);
    else cloneElement(id);
  };
  const cloneOwningCanvas = (parent: string): void => {
    if (doc.slides[parent]) cloneSlide(parent);
    else if (doc.layouts[parent]) cloneLayout(parent);
    else if (doc.elements[parent]) {
      const canvas = canvasTargetOfElement(doc, parent);
      if (canvas.kind === 'slide') cloneSlide(canvas.id); else cloneLayout(canvas.id);
    }
  };
  for (const patch of patches) {
    if (patch.path[0] === 'slides' && patch.path.length > 2) cloneSlide(patch.path[1]);
    if (patch.path[0] === 'layouts' && patch.path.length > 2) cloneLayout(patch.path[1]);
    if (patch.path[0] === 'elements' && patch.path.length > 2) cloneElement(patch.path[1]);
    if (isElementTreePatch(patch)) {
      cloneParent(patch.value.parent);
      // 同一批次前序补丁创建的父级不在基线中，无需再次复制。
      cloneOwningCanvas(patch.value.parent);
    } else if (isElementHierarchyPatch(patch)) {
      for (const parent of Object.keys(patch.value.children)) cloneParent(parent);
      cloneOwningCanvas(patch.value.parent);
    } else if (isElementOrderPatch(patch)) {
      const parent = doc.elements[patch.path[1]]?.parent;
      if (parent) cloneParent(parent);
    }
  }
  return stage;
}
