import type { SlideElement } from '@web-ppt/core';
import { relationshipPartFor, resolveRelationshipTarget } from '../clipboard-source';
import { allocateElementId, allocateSlideId } from '../document';
import type { EditDoc, ElementId, ElementRecord, SlideId } from '../types';
import { findXmlAttribute, xmlElementChildren } from '../xml/query';
import { parseXmlTree } from '../xml/tree';
import {
  allocateNotesPart, allocateSlideOpcIdentity, presentationSlideIdForPart,
} from './add-slide-identity';
import type { CommandPatches, DuplicateSlideCommand, SlideTreePatch } from './types';

const LAYOUT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout';
const NOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';

function sourceRelationshipInfo(doc: EditDoc, sourceId: SlideId): {
  layoutId: string;
  notesPart?: string;
} {
  const source = doc.slides[sourceId];
  if (source.creation) {
    return {
      layoutId: source.creation.layoutRelationshipId,
      ...(source.creation.duplicateNotesSourcePart
        ? { notesPart: source.creation.duplicateNotesSourcePart } : {}),
    };
  }
  const part = source.origin?.part;
  const relsPart = part && relationshipPartFor(part);
  const bytes = relsPart
    && (doc.saveState.baselines[relsPart] ?? doc.package?.parts[relsPart]);
  if (!bytes) throw new Error(`页面 ${sourceId} 缺少关系 part`);
  let layoutId: string | undefined;
  let notesPart: string | undefined;
  for (const relation of xmlElementChildren(parseXmlTree(bytes).root, { localName: 'Relationship' })) {
    const type = findXmlAttribute(relation, { localName: 'Type', namespaceUri: null })?.value;
    const target = findXmlAttribute(relation, { localName: 'Target', namespaceUri: null })?.value;
    const mode = findXmlAttribute(relation, { localName: 'TargetMode', namespaceUri: null })?.value;
    if (type === LAYOUT_REL) {
      layoutId = findXmlAttribute(relation, { localName: 'Id', namespaceUri: null })?.value;
    } else if (type === NOTES_REL && target && mode !== 'External') {
      notesPart = resolveRelationshipTarget(part!, target);
    }
  }
  if (!layoutId) throw new Error(`页面 ${sourceId} 缺少版式关系`);
  return { layoutId, ...(notesPart ? { notesPart } : {}) };
}

function duplicateRemovedSpids(doc: EditDoc, sourceId: SlideId): number[] {
  const source = doc.slides[sourceId];
  const inherited = source.creation?.duplicateRemovedSpids ?? [];
  const current = Object.values(doc.removedElements).flatMap((record) => {
    const origin = record.meta.origin;
    return origin && origin.part === source.origin?.part && !record.meta.created ? [origin.spid] : [];
  });
  return [...new Set([...inherited, ...current])].sort((left, right) => left - right);
}

function retargetSource(source: SlideElement, part: string): void {
  const visit = (element: SlideElement): void => {
    if (element.editInfo?.origin) {
      element.editInfo = { ...element.editInfo, origin: { ...element.editInfo.origin, part } };
    }
    if (element.kind === 'group') for (const child of element.children) visit(child);
  };
  visit(source);
}

function duplicateRecords(
  doc: EditDoc,
  sourceId: SlideId,
  targetId: SlideId,
  targetPart: string,
): { children: ElementId[]; records: Record<ElementId, ElementRecord>; remap: Map<ElementId, ElementId> } {
  const records: Record<ElementId, ElementRecord> = Object.create(null);
  const remap = new Map<ElementId, ElementId>();
  const allocate = (id: ElementId): void => {
    remap.set(id, allocateElementId(doc));
    for (const child of doc.elements[id].children ?? []) allocate(child);
  };
  for (const id of doc.slides[sourceId].children) allocate(id);
  for (const [sourceElementId, targetElementId] of remap) {
    const source = doc.elements[sourceElementId];
    const parent = source.parent === sourceId ? targetId : remap.get(source.parent as ElementId);
    if (!parent) throw new Error(`页面 ${sourceId} 的元素父链无效：${sourceElementId}`);
    const record = structuredClone(source);
    record.id = targetElementId;
    record.parent = parent;
    if (record.meta.origin) record.meta.origin = { ...record.meta.origin, part: targetPart };
    retargetSource(record.src, targetPart);
    if (record.children) record.children = record.children.map((id) => remap.get(id)!);
    records[targetElementId] = record;
  }
  return {
    children: doc.slides[sourceId].children.map((id) => remap.get(id)!), records, remap,
  };
}

export function duplicateSlidePatches(
  doc: EditDoc,
  command: DuplicateSlideCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly || doc.meta.source !== 'pptx' || !doc.package) {
    throw new Error('只读或非 OOXML 编辑文档不能复制页面');
  }
  const source = doc.slides[command.id];
  if (!source?.origin || !source.layoutId) throw new Error(`找不到可复制页面：${String(command.id)}`);
  const id = allocateSlideId(doc);
  const opc = allocateSlideOpcIdentity(doc);
  const relationshipInfo = sourceRelationshipInfo(doc, source.id);
  const notesPart = relationshipInfo.notesPart ? allocateNotesPart(doc) : undefined;
  const removedSpids = duplicateRemovedSpids(doc, source.id);
  const cloned = duplicateRecords(doc, source.id, id, opc.part);
  const spids = Object.values(cloned.records).flatMap((record) => record.meta.origin?.spid ?? []);
  doc.identity.nextSpid[opc.part] = Math.max(1, ...spids) + 1;
  const sourceIndex = doc.slideOrder.indexOf(source.id);
  if (sourceIndex < 0) throw new Error(`页面不在 slideOrder 中：${source.id}`);
  const value = {
    after: source.id,
    before: doc.slideOrder[sourceIndex + 1] ?? null,
    slide: {
      ...structuredClone(source), id, children: cloned.children,
      dynamicSlideNumbers: source.dynamicSlideNumbers.map((elementId) => cloned.remap.get(elementId)!),
      dynamicSlideLinks: source.dynamicSlideLinks.map((elementId) => cloned.remap.get(elementId)!),
      origin: { part: opc.part },
      creation: {
        layoutPart: source.layoutId,
        layoutRelationshipId: relationshipInfo.layoutId,
        ...(source.creation?.duplicateSourcePart
          ? { duplicateSourcePart: source.creation.duplicateSourcePart }
          : source.creation ? {} : { duplicateSourcePart: source.origin.part }),
        ...(relationshipInfo.notesPart ? {
          duplicateNotesSourcePart: relationshipInfo.notesPart,
          duplicateNotesPart: notesPart,
        } : {}),
        ...(removedSpids.length ? { duplicateRemovedSpids: removedSpids } : {}),
        presentationSlideId: opc.presentationSlideId,
        presentationRelationshipId: opc.presentationRelationshipId,
        sectionAfterSlideId: presentationSlideIdForPart(doc, source.origin.part),
      },
    },
    records: cloned.records,
  };
  const path = ['slides', id] as const;
  const forward: SlideTreePatch = { op: 'insert', path, value, origin };
  const inverse: SlideTreePatch = { op: 'remove', path, value, origin };
  return { forward: [forward], inverse: [inverse] };
}
