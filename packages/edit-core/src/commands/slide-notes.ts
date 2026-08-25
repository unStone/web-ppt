import { own } from '../data-validation';
import { relationshipPartFor } from '../clipboard-source';
import type { EditDoc, SlideNotesBinding, SlideRecord } from '../types';
import { findXmlAttribute, xmlElementChildren } from '../xml/query';
import { parseXmlTree } from '../xml/tree';
import { allocateNotesPart } from './add-slide-identity';
import type { CommandPatches, SetNotesCommand, SlideNotesPatch } from './types';

export function isSlideNotesPatch(patch: { readonly path: readonly unknown[] }): patch is SlideNotesPatch {
  return patch.path[0] === 'slides' && (patch.path.length === 3 && patch.path[2] === 'notes'
    || patch.path.length === 4 && patch.path[2] === 'ovr' && patch.path[3] === 'notes');
}

export function validateSlideNotesPatch(doc: EditDoc, patch: SlideNotesPatch, index: number): void {
  if (!own(doc.slides, patch.path[1])) throw new Error(`备注 Patch 指向不存在的幻灯片：${patch.path[1]}`);
  if (patch.op !== 'set' && patch.op !== 'del') throw new Error(`Patch ${index} 的备注操作不受支持`);
  if (patch.path.length === 4 && patch.op === 'set' && typeof patch.value !== 'string') {
    throw new Error(`Patch ${index} 的备注必须是字符串`);
  }
  if (patch.path.length === 3 && patch.op === 'set') {
    assertNotesBinding(
      (patch as Extract<SlideNotesPatch, {
        op: 'set'; path: readonly ['slides', string, 'notes'];
      }>).value,
      `Patch ${index}`,
    );
  }
}

export function applySlideNotesPatch(doc: EditDoc, patch: SlideNotesPatch): void {
  const record = doc.slides[patch.path[1]];
  if (!record) throw new Error(`备注 Patch 指向不存在的幻灯片：${patch.path[1]}`);
  if (patch.path.length === 3) {
    if (patch.op === 'set') record.notes = structuredClone(
      (patch as Extract<SlideNotesPatch, {
        op: 'set'; path: readonly ['slides', string, 'notes'];
      }>).value,
    );
    else delete record.notes;
  } else if (patch.op === 'set') record.ovr.notes = (
    patch as Extract<SlideNotesPatch, {
      op: 'set'; path: readonly ['slides', string, 'ovr', 'notes'];
    }>
  ).value;
  else delete record.ovr.notes;
}

function assertNotesBinding(value: SlideNotesBinding, label: string): void {
  if (!value || typeof value !== 'object'
    || typeof value.targetPart !== 'string' || !value.targetPart
    || typeof value.relationshipId !== 'string' || !value.relationshipId
    || value.sourcePart !== undefined && (typeof value.sourcePart !== 'string' || !value.sourcePart)) {
    throw new Error(`${label} 的备注 OPC 身份无效`);
  }
}

function relationshipSource(doc: EditDoc, slide: SlideRecord): Uint8Array | undefined {
  const sourcePart = slide.creation?.duplicateSourcePart ?? slide.origin?.part;
  if (!sourcePart) return undefined;
  const part = relationshipPartFor(sourcePart);
  return doc.saveState.baselines[part] ?? doc.package?.parts[part];
}

function allocateRelationshipId(doc: EditDoc, slide: SlideRecord): string {
  const ids = new Set<string>([slide.creation?.layoutRelationshipId ?? '']);
  const source = relationshipSource(doc, slide);
  if (source) for (const relation of xmlElementChildren(
    parseXmlTree(source).root, { localName: 'Relationship' },
  )) {
    const id = findXmlAttribute(relation, { localName: 'Id', namespaceUri: null })?.value;
    if (id) ids.add(id);
  }
  for (let candidate = 1; Number.isSafeInteger(candidate); candidate++) {
    const id = `rId${candidate}`;
    if (!ids.has(id)) return id;
  }
  throw new Error('页面的备注关系身份已耗尽');
}

function ownsNotesPart(doc: EditDoc, slide: SlideRecord): boolean {
  const part = slide.notes?.targetPart;
  return !part || Object.values(doc.slides)
    .filter((candidate) => candidate.notes?.targetPart === part).length === 1;
}

function independentBinding(doc: EditDoc, slide: SlideRecord): SlideNotesBinding | undefined {
  if (slide.notes && ownsNotesPart(doc, slide)) return undefined;
  return {
    ...(slide.notes ? { sourcePart: slide.notes.sourcePart ?? slide.notes.targetPart } : {}),
    targetPart: allocateNotesPart(doc),
    relationshipId: slide.notes?.relationshipId ?? allocateRelationshipId(doc, slide),
  };
}

export function setNotesPatches(
  doc: EditDoc,
  command: SetNotesCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly || doc.meta.source !== 'pptx' || !doc.package) {
    throw new Error('只读或非 OOXML 编辑文档不能修改演讲者备注');
  }
  const record = doc.slides[command.id];
  if (!record) throw new Error(`找不到幻灯片：${String(command.id)}`);
  if (typeof command.text !== 'string') throw new Error('SetNotes.text 必须是字符串');
  const binding = independentBinding(doc, record);
  const path = ['slides', command.id, 'ovr', 'notes'] as const;
  const hadOverride = own(record.ovr, 'notes');
  if (!binding && hadOverride && record.ovr.notes === command.text) return { forward: [], inverse: [] };
  const forward: SlideNotesPatch = { op: 'set', path, value: command.text, origin };
  const inverse: SlideNotesPatch = hadOverride
    ? { op: 'set', path, value: record.ovr.notes!, origin }
    : { op: 'del', path, origin };
  if (!binding) return { forward: [forward], inverse: [inverse] };
  const bindingPath = ['slides', command.id, 'notes'] as const;
  const bindingForward: SlideNotesPatch = {
    op: 'set', path: bindingPath, value: binding, origin,
  };
  const bindingInverse: SlideNotesPatch = record.notes
    ? { op: 'set', path: bindingPath, value: structuredClone(record.notes), origin }
    : { op: 'del', path: bindingPath, origin };
  return { forward: [bindingForward, forward], inverse: [inverse, bindingInverse] };
}
