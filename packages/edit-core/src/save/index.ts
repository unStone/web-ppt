import { commitSavedPackage } from '../document';
import { hasDynamicSlideNumber } from '../dynamic-slide-fields';
import { validateEditDoc } from '../model-invariants';
import { patchOpcPackage } from '../opc/patch';
import { effectiveElement } from '../projection';
import { layoutFallbackElementIds, layoutFallbackGeometry } from '../layout-projection';
import type { OpcPatchResult, OpcPartChanges } from '../opc/types';
import type { EditDoc, ElementRecord, RemovedElementRecord, SlideRecord } from '../types';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import { hasXfrmOverrides } from './xfrm';
import { hasTextOverrides } from './text';
import { hasOrderOverride } from './order';
import { hasShapeFormatOverrides } from './shape-format';
import { hasEffectsOverride } from './effects';
import { hasImageContentOverrides } from './image-content';
import { hasTableRowOverrides } from './table';
import {
  createHyperlinkSaveContext, hasDanglingSlideRelationships, hasHyperlinkOverrides,
  patchHyperlinkRelationshipPart,
} from './hyperlink';
import type { HyperlinkSaveContext } from './hyperlink';
import { materializeElementTreeState } from './insertion';
import {
  mediaPackageParts, patchContentTypes, patchRelationshipPart, relationshipPartFor, resourceBytes,
} from './clipboard-parts';
import {
  createdSlideRelationships, createdSlides, emptySlideXml, patchPresentationRelationships,
  patchPresentationSlides, patchSlideContentTypes, patchSlideLayoutRelationship,
  patchSlideNumberFields,
} from './slide-parts';
import { removedSlidePackageParts } from './remove-slide-parts';
import {
  cloneDuplicateNotesParts, duplicateNotesParts, duplicateRelationshipSource,
  duplicateSlideRemovals, duplicateSlideSource, patchDuplicateSlideRelationships,
} from './duplicate-slide-parts';
import { hasSlidePropertyOverrides, patchSlideProperties } from './slide-properties';
import { materializeLayoutFallback } from './layout-fallback';
import { createLayoutFallbackGeometryResolver } from './layout-fallback-source';

function dynamicSlideNumberParts(doc: EditDoc): Map<string, number> {
  const parts = new Map<string, number>();
  doc.slideOrder.forEach((slideId, index) => {
    const slide = doc.slides[slideId];
    const part = slide.origin?.part;
    if (part && slide.dynamicSlideNumbers.some((id) => {
      const record = doc.elements[id];
      return record?.meta.origin?.part === part
        && hasDynamicSlideNumber(effectiveElement(doc, id));
    })) parts.set(part, index + 1);
  });
  return parts;
}

function recordsByPart(doc: EditDoc): Map<string, ElementRecord[]> {
  const grouped = new Map<string, ElementRecord[]>();
  for (const record of Object.values(doc.elements)) {
    if (!hasXfrmOverrides(record) && !hasTextOverrides(record) && !hasOrderOverride(record)
      && !hasShapeFormatOverrides(record)
      && !hasEffectsOverride(record)
      && !hasImageContentOverrides(record)
      && !hasTableRowOverrides(record)
      && !hasHyperlinkOverrides(record)
      && !record.meta.insertion) continue;
    const origin = record.meta.origin;
    if (!origin) throw new Error(`元素 ${record.id} 缺少 OOXML 回写锚点`);
    const records = grouped.get(origin.part) ?? [];
    records.push(record);
    grouped.set(origin.part, records);
  }
  return grouped;
}

function removalsByPart(doc: EditDoc): Map<string, RemovedElementRecord[]> {
  const grouped = new Map<string, RemovedElementRecord[]>();
  for (const record of Object.values(doc.removedElements)) {
    const origin = record.meta.origin;
    // 会话中新建又删除的节点没有源宿主；生成保存只需忽略它，不应伪造删除。
    if (!origin) continue;
    const records = grouped.get(origin.part) ?? [];
    records.push(record);
    grouped.set(origin.part, records);
  }
  return grouped;
}

function slidePropertiesByPart(doc: EditDoc): Map<string, SlideRecord> {
  const grouped = new Map<string, SlideRecord>();
  for (const record of Object.values(doc.slides)) {
    if (!hasSlidePropertyOverrides(record)) continue;
    const part = record.origin?.part;
    if (!part) throw new Error(`幻灯片 ${record.id} 缺少 OOXML 回写锚点`);
    grouped.set(part, record);
  }
  return grouped;
}

/** 始终从首次触碰的基线重建 part，避免连续保存把旧覆盖烘进源树而破坏撤销。 */
export function saveEditDoc(doc: EditDoc): OpcPatchResult {
  validateEditDoc(doc);
  if (doc.meta.readonly) throw new Error('只读编辑文档不能保存');
  if (doc.meta.source !== 'pptx' || !doc.package) {
    throw new Error('当前版本尚未实现生成式 PPTX 保存');
  }

  const grouped = recordsByPart(doc);
  const slideProperties = slidePropertiesByPart(doc);
  const explicitHyperlinkParts = new Set([...grouped].flatMap(([part, records]) =>
    records.some(hasHyperlinkOverrides) ? [part] : []));
  const removals = removalsByPart(doc);
  const media = mediaPackageParts(doc);
  const activeCreatedSlides = createdSlides(doc);
  const layoutSlides = new Map(Object.values(doc.slides).flatMap((slide) =>
    slide.layoutId !== slide.sourceLayoutId && slide.origin ? [[slide.origin.part, slide] as const] : []));
  const layoutFallbacks = new Map(Object.values(doc.slides).flatMap((slide) => {
    const ids = layoutFallbackElementIds(doc, slide.id);
    return slide.origin && ids.length ? [[slide.origin.part, ids] as const] : [];
  }));
  const slidesByPart = new Map(Object.values(doc.slides).flatMap((slide) =>
    slide.origin ? [[slide.origin.part, slide] as const] : []));
  const fallbackGeometrySource = createLayoutFallbackGeometryResolver(doc);
  const duplicateNotes = duplicateNotesParts(activeCreatedSlides);
  const duplicateNotesBySlide = new Map(duplicateNotes.map((notes) => [notes.slidePart, notes]));
  const nextBaselines: Record<string, Uint8Array> = Object.assign(
    Object.create(null), doc.saveState.baselines,
  );
  const nextCreatedParts = new Set(doc.saveState.createdParts);
  const contentTypesPart = '[Content_Types].xml';
  const presentationPart = 'ppt/presentation.xml';
  const presentationRelsPart = 'ppt/_rels/presentation.xml.rels';
  const hasCreatedSlideHistory = activeCreatedSlides.length > 0
    || [...nextCreatedParts].some((part) => /^ppt\/slides\/slide\d+\.xml$/.test(part));
  const currentSlideParts = doc.slideOrder.flatMap((id) => doc.slides[id].origin?.part ?? []);
  const removedSlideParts = removedSlidePackageParts(doc, nextCreatedParts);
  const hasRemovedSlideHistory = removedSlideParts.slideParts.size > 0;
  const danglingHyperlinkParts = new Set<string>();
  if (hasRemovedSlideHistory) {
    for (const id of doc.slideOrder) {
      const slide = doc.slides[id];
      const part = slide.origin?.part;
      if (!part) continue;
      const relsPart = relationshipPartFor(part);
      const relationSource = nextBaselines[relsPart]
        ?? (slide.creation ? duplicateRelationshipSource(doc, slide, nextBaselines) : undefined)
        ?? doc.package.parts[relsPart];
      if (hasDanglingSlideRelationships(doc, part, relationSource)) {
        danglingHyperlinkParts.add(part);
      }
    }
  }
  const hyperlinkParts = new Set([...explicitHyperlinkParts, ...danglingHyperlinkParts]);
  const presentationOrderChanged = currentSlideParts.length !== doc.saveState.sourceSlideParts.length
    || currentSlideParts.some((part, index) => part !== doc.saveState.sourceSlideParts[index]);
  const hasSlideHistory = hasCreatedSlideHistory || hasRemovedSlideHistory || presentationOrderChanged
    || !!nextBaselines[presentationPart];
  if (presentationOrderChanged && !nextBaselines[presentationPart]) {
    const source = doc.package.parts[presentationPart];
    if (!source) throw new Error('PPTX 缺少 ppt/presentation.xml');
    nextBaselines[presentationPart] = source.slice();
  }
  const slideNumbers = hasSlideHistory ? dynamicSlideNumberParts(doc) : new Map<string, number>();
  for (const part of new Set([
    ...grouped.keys(), ...slideProperties.keys(), ...removals.keys(), ...slideNumbers.keys(),
    ...hyperlinkParts, ...layoutFallbacks.keys(),
  ])) {
    if (nextBaselines[part]) continue;
    if (activeCreatedSlides.some((slide) => slide.origin?.part === part)) continue;
    const source = doc.package.parts[part];
    if (!source) throw new Error(`找不到待写回的 OPC part：${part}`);
    nextBaselines[part] = source.slice();
  }
  for (const sourcePart of media.relationships.keys()) {
    const relsPart = relationshipPartFor(sourcePart);
    if (nextBaselines[relsPart] || nextCreatedParts.has(relsPart)) continue;
    const source = doc.package.parts[relsPart];
    if (source) nextBaselines[relsPart] = source.slice();
    else nextCreatedParts.add(relsPart);
  }
  for (const sourcePart of hyperlinkParts) {
    const relsPart = relationshipPartFor(sourcePart);
    if (nextBaselines[relsPart] || nextCreatedParts.has(relsPart)) continue;
    const source = doc.package.parts[relsPart];
    if (source) nextBaselines[relsPart] = source.slice();
    else nextCreatedParts.add(relsPart);
  }
  for (const [sourcePart, slide] of layoutSlides) {
    if (slide.creation) continue;
    const relsPart = relationshipPartFor(sourcePart);
    if (nextBaselines[relsPart] || nextCreatedParts.has(relsPart)) continue;
    const source = doc.package.parts[relsPart];
    if (source) nextBaselines[relsPart] = source.slice();
    else nextCreatedParts.add(relsPart);
  }
  for (const part of removedSlideParts.packageParts) {
    if (nextCreatedParts.has(part) || nextBaselines[part]) continue;
    const source = doc.package.parts[part];
    if (source) nextBaselines[part] = source.slice();
  }
  if ((media.resources.size || hasCreatedSlideHistory || hasRemovedSlideHistory)
    && !nextBaselines[contentTypesPart]) {
    const source = doc.package.parts[contentTypesPart];
    if (!source) throw new Error('PPTX 缺少 [Content_Types].xml');
    nextBaselines[contentTypesPart] = source.slice();
  }
  if (hasCreatedSlideHistory || hasRemovedSlideHistory) {
    for (const part of [presentationPart, presentationRelsPart]) {
      if (nextBaselines[part]) continue;
      const source = doc.package.parts[part];
      if (!source) throw new Error(`PPTX 缺少 ${part}`);
      nextBaselines[part] = source.slice();
    }
  }
  for (const slide of activeCreatedSlides) {
    const part = slide.origin!.part;
    nextCreatedParts.add(part);
    nextCreatedParts.add(relationshipPartFor(part));
  }
  for (const notes of duplicateNotes) {
    nextCreatedParts.add(notes.targetPart);
    nextCreatedParts.add(relationshipPartFor(notes.targetPart));
  }
  for (const resource of media.resources.values()) {
    if (resource.created) nextCreatedParts.add(resource.targetPart);
  }

  const changes: Record<string, Uint8Array | null> = Object.create(null);
  for (const part of nextCreatedParts) changes[part] = null;
  for (const [part, source] of Object.entries(nextBaselines)) {
    if (!doc.package.parts[part] && !removedSlideParts.packageParts.has(part)
      && !nextCreatedParts.has(part)) changes[part] = source;
  }
  const slideParts = new Set(doc.slideOrder.flatMap((id) => {
    const slide = doc.slides[id];
    const part = slide.origin?.part;
    return part && (nextBaselines[part] || slide.creation || slideNumbers.has(part)) ? [part] : [];
  }));
  const hyperlinkContexts = new Map<string, HyperlinkSaveContext>();
  for (const part of slideParts) {
    const slide = activeCreatedSlides.find((candidate) => candidate.origin?.part === part);
    const source = nextBaselines[part]
      ?? (slide ? duplicateSlideSource(doc, slide, nextBaselines) ?? emptySlideXml() : undefined);
    if (!source) throw new Error(`找不到页面保存基线：${part}`);
    const tree = parseXmlTree(source);
    const records = grouped.get(part) ?? [];
    const relsPart = relationshipPartFor(part);
    const relationSource = nextBaselines[relsPart] ?? (slide
      ? duplicateRelationshipSource(doc, slide, nextBaselines) : undefined);
    const links = hyperlinkParts.has(part)
      ? createHyperlinkSaveContext(
        doc, part, relationSource, media.relationships.get(part) ?? [],
      ) : undefined;
    if (links) hyperlinkContexts.set(part, links);
    links?.removeDanglingHyperlinks(tree);
    materializeElementTreeState(tree, doc, part, records, [
      ...(slide ? duplicateSlideRemovals(slide) : []), ...(removals.get(part) ?? []),
    ], { links });
    for (const id of layoutFallbacks.get(part) ?? []) {
      const record = doc.elements[id];
      const owningSlide = slidesByPart.get(part);
      materializeLayoutFallback(
        tree, record, effectiveElement(doc, id), layoutFallbackGeometry(record),
        owningSlide ? fallbackGeometrySource(owningSlide, record) : undefined,
      );
    }
    const slideRecord = slideProperties.get(part);
    if (slideRecord) patchSlideProperties(tree, doc, slideRecord);
    const bytes = serializeXmlTreeBytes(tree);
    changes[part] = slideNumbers.has(part)
      ? patchSlideNumberFields(bytes, slideNumbers.get(part)!)
      : bytes;
  }

  const activeRelationshipParts = new Set<string>();
  for (const sourcePart of new Set([
    ...media.relationships.keys(), ...hyperlinkContexts.keys(), ...layoutSlides.keys(),
  ])) {
    const relationships = media.relationships.get(sourcePart) ?? [];
    const relsPart = relationshipPartFor(sourcePart);
    activeRelationshipParts.add(relsPart);
    const slide = activeCreatedSlides.find((candidate) => candidate.origin?.part === sourcePart);
    const relationSource = nextBaselines[relsPart] ?? (slide
      ? duplicateRelationshipSource(doc, slide, nextBaselines) : undefined);
    const links = hyperlinkContexts.get(sourcePart);
    const slideBytes = changes[sourcePart];
    let relationshipBytes = links && slideBytes instanceof Uint8Array
      ? patchHyperlinkRelationshipPart(relationSource, relationships, links, slideBytes)
      : patchRelationshipPart(relationSource, relationships);
    const layoutSlide = layoutSlides.get(sourcePart);
    if (layoutSlide) relationshipBytes = patchSlideLayoutRelationship(layoutSlide, relationshipBytes);
    changes[relsPart] = relationshipBytes;
  }
  for (const [part, source] of Object.entries(nextBaselines)) {
    if (part.endsWith('.rels') && !activeRelationshipParts.has(part)) {
      changes[part] = patchRelationshipPart(source, []);
    }
  }
  for (const [part, resource] of media.resources) changes[part] = resourceBytes(resource);
  if (nextBaselines[contentTypesPart]) {
    const resourceTypes = patchContentTypes(
      nextBaselines[contentTypesPart], [...media.resources.values()],
    );
    changes[contentTypesPart] = patchSlideContentTypes(
      resourceTypes, doc, removedSlideParts.contentTypeParts,
    );
  }
  for (const slide of activeCreatedSlides) {
    const relsPart = relationshipPartFor(slide.origin!.part);
    const relationships = changes[relsPart];
    const source = relationships instanceof Uint8Array
      ? relationships : duplicateRelationshipSource(doc, slide, nextBaselines);
    changes[relsPart] = slide.creation?.duplicateSourcePart
      ? patchDuplicateSlideRelationships(source!, duplicateNotesBySlide.get(slide.origin!.part))
      : createdSlideRelationships(slide, source);
  }
  for (const notes of duplicateNotes) {
    const cloned = cloneDuplicateNotesParts(doc, nextBaselines, notes);
    changes[notes.targetPart] = cloned.notes;
    changes[relationshipPartFor(notes.targetPart)] = cloned.relationships;
  }
  if (nextBaselines[presentationPart]) {
    const relationships = nextBaselines[presentationRelsPart]
      ?? doc.package.parts[presentationRelsPart];
    if (!relationships) throw new Error('PPTX 缺少 ppt/_rels/presentation.xml.rels');
    changes[presentationPart] = patchPresentationSlides(
      nextBaselines[presentationPart], relationships, doc,
    );
  }
  if (nextBaselines[presentationRelsPart]) {
    changes[presentationRelsPart] = patchPresentationRelationships(
      nextBaselines[presentationRelsPart], doc,
    );
  }
  for (const part of removedSlideParts.packageParts) changes[part] = null;

  const result = patchOpcPackage(doc.package, changes satisfies OpcPartChanges);
  commitSavedPackage(doc, result.package, nextBaselines, [...nextCreatedParts].sort());
  return result;
}

export type { OpcFallbackReason, OpcPatchResult, OpcSaveMode } from '../opc/types';
