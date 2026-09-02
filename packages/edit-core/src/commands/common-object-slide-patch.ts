import type { EditDoc } from '../types';
import type { Patch } from './types';
import {
  applyElementAltTextPatch, isElementAltTextPatch, validateElementAltTextPatch,
} from './element-alt-text';
import {
  applySectionStatePatch, isSectionStatePatch, validateSectionStatePatch,
} from './sections';
import {
  applyDocumentSizePatch, isDocumentSizePatch, validateDocumentSizePatch,
} from './slide-size';

export function validateCommonObjectSlidePatch(
  doc: EditDoc, patch: Patch, index: number,
): boolean {
  if (isSectionStatePatch(patch)) validateSectionStatePatch(doc, patch, index);
  else if (isDocumentSizePatch(patch)) validateDocumentSizePatch(patch, index);
  else if (isElementAltTextPatch(patch)) validateElementAltTextPatch(doc, patch, index);
  else return false;
  return true;
}

export function applyCommonObjectSlidePatch(doc: EditDoc, patch: Patch): boolean {
  if (isSectionStatePatch(patch)) applySectionStatePatch(doc, patch);
  else if (isDocumentSizePatch(patch)) applyDocumentSizePatch(doc, patch);
  else if (isElementAltTextPatch(patch)) applyElementAltTextPatch(doc, patch);
  else return false;
  return true;
}
