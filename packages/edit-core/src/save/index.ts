import { assertSaveExtensions } from './extension-availability';
import { materializeDuplicateComments } from './comments';
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
import { hasTableCellAppearanceOverrides, hasTableRowOverrides, hasTableStyleOverride } from './table';
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
  duplicateRelationshipSource, duplicateSlideRemovals, duplicateSlideSource,
} from './duplicate-slide-parts';
import { hasSlidePropertyOverrides, patchSlideProperties } from './slide-properties';
import { removeSlideAnimationTargets } from './animation';
import { materializeLayoutFallback } from './layout-fallback';
import { createLayoutFallbackGeometryResolver } from './layout-fallback-source';
import {
  materializeNotesParts, patchSlideNotesRelationship, prepareNotesSave,
} from './notes';
import { hasNameOverride } from './name';
import { hasAltTextOverride } from './alt-text';
import { hasGeometryOverride } from './geometry';
import {
  materializeTableStyles, patchTableStyleContentType, patchTableStylePresentationRelationships,
  tableStyleSavePlan,
} from './table-style-part';
import { materializeThemePart } from '../theme-xml';
import { themeHasOverrides } from '../theme';
import { hasLayoutPropertyOverrides, patchLayoutProperties } from './layout-properties';
import { hasMasterPropertyOverrides, patchMasterProperties } from './master-properties';
import { registeredEditExtensions } from '../extension-runtime';
import { hasElementExtensionOverrides } from './extension-elements';
import type { EditExtensionSavePlan } from '../extension-runtime';

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
      && !hasNameOverride(record)
      && !hasAltTextOverride(record)
      && !hasGeometryOverride(record)
      && !hasShapeFormatOverrides(record)
      && !hasEffectsOverride(record)
      && !hasImageContentOverrides(record)
      && !hasTableRowOverrides(record)
      && !hasTableCellAppearanceOverrides(record)
      && !hasTableStyleOverride(record)
      && !hasHyperlinkOverrides(record)
      && !hasElementExtensionOverrides(record)
      && record.meta.sourceParent === undefined
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

function layoutPropertiesByPart(doc: EditDoc) {
  return new Map(doc.layoutOrder.flatMap((id) => {
    const layout = doc.layouts[id];
    return hasLayoutPropertyOverrides(layout) ? [[layout.origin.part, layout] as const] : [];
  }));
}

function masterPropertiesByPart(doc: EditDoc) {
  return new Map(doc.masterOrder.flatMap((id) => {
    const master = doc.masters[id];
    return hasMasterPropertyOverrides(master) ? [[master.id, master] as const] : [];
  }));
}

async function extensionSavePlan(doc: EditDoc): Promise<EditExtensionSavePlan> {
  const extensions = registeredEditExtensions();
  assertSaveExtensions(doc);
  const changes: Record<string, Uint8Array | null> = Object.create(null);
  const baselines: Record<string, Uint8Array> = Object.create(null);
  for (const extension of extensions.values()) {
    const plan = await extension.beforeSave?.(doc);
    if (!plan) continue;
    for (const [part, bytes] of Object.entries(plan.changes)) {
      if (Object.prototype.hasOwnProperty.call(changes, part)) {
        throw new Error(`多个编辑扩展同时修改 OPC part：${part}`);
      }
      changes[part] = bytes;
    }
    for (const [part, bytes] of Object.entries(plan.baselines)) {
      const current = baselines[part];
      if (current && (current.length !== bytes.length
        || !current.every((value, index) => value === bytes[index]))) {
        throw new Error(`多个编辑扩展的保存基线冲突：${part}`);
      }
      baselines[part] = bytes;
    }
  }
  return { changes, baselines };
}

/** 编辑器入口延迟到首次保存才加载扩展保存聚合器。 */
export async function saveEditDocWithExtensions(doc: EditDoc): Promise<OpcPatchResult> {
  return saveEditDoc(doc, await extensionSavePlan(doc));
}

/** 字节生成不代表交付成功；宿主负责确认保存点和释放独立生成的结果包。 */
export async function serializeEditDoc(doc: EditDoc): Promise<OpcPatchResult> {
  return doc.meta.source === 'pptx' && doc.package && !doc.package.disposed
    ? saveEditDocWithExtensions(doc)
    : (await import('../generate/index')).generateEditDoc(doc);
}

/** 始终从首次触碰的基线重建 part，避免连续保存把旧覆盖烘进源树而破坏撤销。 */
export function saveEditDoc(
  doc: EditDoc,
  extensionPlan: EditExtensionSavePlan = { changes: {}, baselines: {} },
): OpcPatchResult {
  validateEditDoc(doc);
  if (doc.meta.readonly) throw new Error('只读编辑文档不能保存');
  if (doc.meta.source !== 'pptx' || !doc.package) {
    throw new Error('当前版本尚未实现生成式 PPTX 保存');
  }

  const grouped = recordsByPart(doc);
  const slideProperties = slidePropertiesByPart(doc);
  const layoutProperties = layoutPropertiesByPart(doc);
  const masterProperties = masterPropertiesByPart(doc);
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
  const nextBaselines: Record<string, Uint8Array> = Object.assign(
    Object.create(null), doc.saveState.baselines, extensionPlan.baselines,
  );
  const nextCreatedParts = new Set(doc.saveState.createdParts);
  const contentTypesPart = '[Content_Types].xml';
  const presentationPart = 'ppt/presentation.xml';
  const presentationRelsPart = 'ppt/_rels/presentation.xml.rels';
  const tableStyles = tableStyleSavePlan(doc);
  const themeParts = doc.themeOrder.filter((id) =>
    themeHasOverrides(doc.themes[id]) || !!nextBaselines[id]);
  for (const part of themeParts) {
    if (nextBaselines[part]) continue;
    const source = doc.package.parts[part];
    if (!source) throw new Error(`找不到主题 OPC part：${part}`);
    nextBaselines[part] = source.slice();
  }
  if (tableStyles?.definitions.length && !nextBaselines[tableStyles.part]) {
    const source = doc.package.parts[tableStyles.part];
    if (source) nextBaselines[tableStyles.part] = source.slice();
    else {
      nextCreatedParts.add(tableStyles.part);
      for (const part of [contentTypesPart, presentationRelsPart]) {
        if (nextBaselines[part]) continue;
        const baseline = doc.package.parts[part];
        if (!baseline) throw new Error(`PPTX 缺少 ${part}`);
        nextBaselines[part] = baseline.slice();
      }
    }
  }
  const notesPlan = prepareNotesSave(doc, nextBaselines, nextCreatedParts);
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
  const presentationMetadataChanged = doc.meta.width !== doc.meta.sourceWidth
    || doc.meta.height !== doc.meta.sourceHeight
    || doc.sections.edited;
  const hasSlideHistory = hasCreatedSlideHistory || hasRemovedSlideHistory || presentationOrderChanged
    || presentationMetadataChanged
    || !!nextBaselines[presentationPart];
  if ((presentationOrderChanged || presentationMetadataChanged) && !nextBaselines[presentationPart]) {
    const source = doc.package.parts[presentationPart];
    if (!source) throw new Error('PPTX 缺少 ppt/presentation.xml');
    nextBaselines[presentationPart] = source.slice();
  }
  const slideNumbers = hasSlideHistory ? dynamicSlideNumberParts(doc) : new Map<string, number>();
  for (const part of new Set([
    ...grouped.keys(), ...slideProperties.keys(), ...layoutProperties.keys(),
    ...masterProperties.keys(),
    ...removals.keys(), ...slideNumbers.keys(),
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
  if ((media.resources.size || hasCreatedSlideHistory || hasRemovedSlideHistory
    || notesPlan.trackedParts.size)
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
  for (const resource of media.resources.values()) {
    if (resource.created) nextCreatedParts.add(resource.targetPart);
  }

  const changes: Record<string, Uint8Array | null> = Object.assign(
    Object.create(null), extensionPlan.changes,
  );
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
    const removedRecords = [
      ...(slide ? duplicateSlideRemovals(slide) : []), ...(removals.get(part) ?? []),
    ];
    materializeElementTreeState(tree, doc, part, records, removedRecords, { links });
    const duplicateAnimationSpids = slide?.creation?.duplicateRemovedAnimationSpids
      ?? slide?.creation?.duplicateRemovedSpids ?? [];
    const liveAnimationSpids = (removals.get(part) ?? []).flatMap((record) =>
      record.sourceSpids ?? (record.meta.origin ? [record.meta.origin.spid] : []));
    removeSlideAnimationTargets(tree, [...duplicateAnimationSpids, ...liveAnimationSpids]);
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

  const layoutParts = new Set(doc.layoutOrder.filter((id) => nextBaselines[id]
    || grouped.has(id) || removals.has(id) || layoutProperties.has(id)));
  for (const part of layoutParts) {
    const source = nextBaselines[part];
    if (!source) throw new Error(`找不到版式保存基线：${part}`);
    const tree = parseXmlTree(source);
    const records = grouped.get(part) ?? [];
    const relationSource = nextBaselines[relationshipPartFor(part)];
    const links = hyperlinkParts.has(part)
      ? createHyperlinkSaveContext(
        doc, part, relationSource, media.relationships.get(part) ?? [],
      ) : undefined;
    if (links) hyperlinkContexts.set(part, links);
    links?.removeDanglingHyperlinks(tree);
    materializeElementTreeState(tree, doc, part, records, removals.get(part) ?? [], { links });
    const properties = layoutProperties.get(part);
    if (properties) patchLayoutProperties(tree, properties);
    changes[part] = serializeXmlTreeBytes(tree);
  }

  const masterParts = new Set(doc.masterOrder.filter((id) => nextBaselines[id]
    || grouped.has(id) || removals.has(id) || masterProperties.has(id)));
  for (const part of masterParts) {
    const source = nextBaselines[part];
    if (!source) throw new Error(`找不到母版保存基线：${part}`);
    const tree = parseXmlTree(source);
    const records = grouped.get(part) ?? [];
    const relationSource = nextBaselines[relationshipPartFor(part)];
    const links = hyperlinkParts.has(part)
      ? createHyperlinkSaveContext(
        doc, part, relationSource, media.relationships.get(part) ?? [],
      ) : undefined;
    if (links) hyperlinkContexts.set(part, links);
    links?.removeDanglingHyperlinks(tree);
    materializeElementTreeState(tree, doc, part, records, removals.get(part) ?? [], { links });
    const properties = masterProperties.get(part);
    if (properties) patchMasterProperties(tree, properties);
    changes[part] = serializeXmlTreeBytes(tree);
  }

  const activeRelationshipParts = new Set<string>();
  for (const sourcePart of new Set([
    ...media.relationships.keys(), ...hyperlinkContexts.keys(), ...layoutSlides.keys(),
    ...notesPlan.relationshipSlides.keys(),
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
    const notesSlide = notesPlan.relationshipSlides.get(sourcePart);
    if (notesSlide) relationshipBytes = patchSlideNotesRelationship(notesSlide, relationshipBytes);
    changes[relsPart] = relationshipBytes;
  }
  for (const [part, source] of Object.entries(nextBaselines)) {
    if (part.endsWith('.rels') && !activeRelationshipParts.has(part)) {
      changes[part] = patchRelationshipPart(source, []);
    }
  }
  for (const [part, resource] of media.resources) changes[part] = resourceBytes(resource);
  materializeNotesParts(doc, nextBaselines, notesPlan, changes);
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
    const materialized = slide.creation?.duplicateSourcePart
      ? source! : createdSlideRelationships(slide, source);
    changes[relsPart] = patchSlideNotesRelationship(slide, materialized);
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
  if (tableStyles?.definitions.length && nextCreatedParts.has(tableStyles.part)) {
    const contentTypes = changes[contentTypesPart] ?? nextBaselines[contentTypesPart];
    const relationships = changes[presentationRelsPart] ?? nextBaselines[presentationRelsPart];
    if (!(contentTypes instanceof Uint8Array) || !(relationships instanceof Uint8Array)) {
      throw new Error('创建 tableStyles.xml 缺少 OPC 闭包基线');
    }
    changes[contentTypesPart] = patchTableStyleContentType(contentTypes, tableStyles.part);
    changes[presentationRelsPart] = patchTableStylePresentationRelationships(
      relationships, tableStyles.part,
    );
  }
  for (const part of removedSlideParts.packageParts) changes[part] = null;
  if (tableStyles) {
    const source = nextBaselines[tableStyles.part];
    if (tableStyles.definitions.length) {
      changes[tableStyles.part] = materializeTableStyles(source, tableStyles.definitions);
    } else if (source) changes[tableStyles.part] = source;
  }
  for (const part of themeParts) {
    changes[part] = materializeThemePart(nextBaselines[part], doc.themes[part]);
  }

  materializeDuplicateComments(doc, activeCreatedSlides, nextBaselines, nextCreatedParts, changes);
  for (const runtime of registeredEditExtensions().values()) runtime.materializePackage?.(doc, nextBaselines, nextCreatedParts, changes);
  const result = patchOpcPackage(doc.package, changes satisfies OpcPartChanges);
  commitSavedPackage(doc, result.package, nextBaselines, [...nextCreatedParts].sort());
  return result;
}

export type { OpcFallbackReason, OpcPatchResult, OpcSaveMode } from '../opc/types';
