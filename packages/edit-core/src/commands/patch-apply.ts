import { sortElementChildrenByOrder } from '../element-order';
import type { EditDoc } from '../types';
import { applyCommonObjectSlidePatch } from './common-object-slide-patch';
import { applyElementCropPatch, applyElementImageReplacementPatch, applyImageResourcePatch,
  isElementCropPatch, isElementImageReplacementPatch, isImageResourcePatch,
} from './element-image-content';
import { applyElementEffectsPatch, isElementEffectsPatch } from './element-effects';
import { applyElementFillPatch, isElementFillPatch } from './element-fill';
import { applyElementGeometryPatch, applyElementPresetGeometryPatch,
  isElementGeometryPatch, isElementPresetGeometryPatch,
} from './element-geometry';
import { applyElementHierarchyPatch, isElementHierarchyPatch } from './element-hierarchy';
import { applyElementInteractionPatch, isElementInteractionPatch } from './element-interaction';
import { applyElementLinkPatch, isElementLinkPatch } from './element-link';
import { applyElementNamePatch, isElementNamePatch } from './element-name';
import { applyElementOrderValue, isElementOrderPatch } from './element-order';
import { applyElementStrokePatch, isElementStrokePatch } from './element-stroke';
import { applyElementTableStylePatch, isElementTableStylePatch } from './element-table-style';
import { applyElementTextPatch, isElementTextPatch } from './element-text';
import { applyElementTransformPatch } from './element-transform';
import { applyElementTreePatch, isElementTreePatch } from './element-tree';
import { applyLayoutPropertyPatch, isLayoutPropertyPatch } from './layout-property';
import { applyMasterBackgroundPatch, isMasterBackgroundPatch } from './master-property';
import { applyMasterTextStylePatch, isMasterTextStylePatch } from './master-text-style';
import { applySlideLayoutPatch, isSlideLayoutPatch } from './slide-layout';
import { applySlideNotesPatch, isSlideNotesPatch } from './slide-notes';
import { applySlideOrderPatch, isSlideOrderPatch } from './slide-order';
import { applySlidePropertyPatch, isSlidePropertyPatch } from './slide-property';
import { applySlideTreePatch, isSlideTreePatch } from './slide-tree';
import { applyTableGridPatch, isTableCellPropsPatch, isTableColumnPatch,
  isTableGridEntryPatch, isTableMergePatch,
} from './table-grid-patch';
import { applyTableRowPatch, isTableRowPatch } from './table-row';
import { applyThemePatch, isThemePatch } from './theme';
import type { ElementTransformPatch, Patch } from './types';
import {
  applyExtensionPatch, finalizeExtensionPatch, isExtensionPatch,
} from '../extension-runtime';

export function applyPatchValues(doc: EditDoc, patches: readonly Patch[]): void {
  const orderParents = new Set<string>();
  const extensionTargets = new Map<string, readonly [string, string, 'elements' | 'slides']>();
  for (const patch of patches) {
    if (applyCommonObjectSlidePatch(doc, patch)) continue;
    if (isThemePatch(patch)) applyThemePatch(doc, patch);
    else if (isLayoutPropertyPatch(patch)) applyLayoutPropertyPatch(doc, patch);
    else if (isMasterBackgroundPatch(patch)) applyMasterBackgroundPatch(doc, patch);
    else if (isMasterTextStylePatch(patch)) applyMasterTextStylePatch(doc, patch);
    else if (isSlideOrderPatch(patch)) applySlideOrderPatch(doc, patch);
    else if (isSlideTreePatch(patch)) applySlideTreePatch(doc, patch);
    else if (isSlidePropertyPatch(patch)) applySlidePropertyPatch(doc, patch);
    else if (isSlideLayoutPatch(patch)) applySlideLayoutPatch(doc, patch);
    else if (isSlideNotesPatch(patch)) applySlideNotesPatch(doc, patch);
    else if (isElementTreePatch(patch)) applyElementTreePatch(doc, patch);
    else if (isElementHierarchyPatch(patch)) applyElementHierarchyPatch(doc, patch);
    else if (isElementFillPatch(patch)) applyElementFillPatch(doc, patch);
    else if (isElementStrokePatch(patch)) applyElementStrokePatch(doc, patch);
    else if (isElementEffectsPatch(patch)) applyElementEffectsPatch(doc, patch);
    else if (isElementLinkPatch(patch)) applyElementLinkPatch(doc, patch);
    else if (isElementCropPatch(patch)) applyElementCropPatch(doc, patch);
    else if (isElementGeometryPatch(patch)) applyElementGeometryPatch(doc, patch);
    else if (isElementPresetGeometryPatch(patch)) applyElementPresetGeometryPatch(doc, patch);
    else if (isElementTableStylePatch(patch)) applyElementTableStylePatch(doc, patch);
    else if (isElementImageReplacementPatch(patch)) applyElementImageReplacementPatch(doc, patch);
    else if (isImageResourcePatch(patch)) applyImageResourcePatch(doc, patch);
    else if (isElementTextPatch(patch)) applyElementTextPatch(doc, patch);
    else if (isTableRowPatch(patch)) applyTableRowPatch(doc, patch);
    else if (isTableColumnPatch(patch) || isTableGridEntryPatch(patch)
      || isTableMergePatch(patch) || isTableCellPropsPatch(patch)) applyTableGridPatch(doc, patch);
    else if (isElementOrderPatch(patch)) orderParents.add(applyElementOrderValue(doc, patch));
    else if (isElementNamePatch(patch)) applyElementNamePatch(doc, patch);
    else if (isElementInteractionPatch(patch)) applyElementInteractionPatch(doc, patch);
    else if (isExtensionPatch(patch)) {
      applyExtensionPatch(doc, patch);
      extensionTargets.set(`${patch.path[0]}\0${patch.path[1]}\0${patch.path[4]}`, [patch.path[1], patch.path[4], patch.path[0]]);
    }
    else applyElementTransformPatch(doc, patch as ElementTransformPatch);
  }
  for (const parent of orderParents) {
    if (doc.slides[parent] || doc.layouts[parent] || doc.masters[parent]
      || doc.elements[parent]?.src.kind === 'group') sortElementChildrenByOrder(doc, parent);
  }
  for (const [id, namespace, scope] of extensionTargets.values()) {
    finalizeExtensionPatch(doc, id, namespace, scope);
  }
}
