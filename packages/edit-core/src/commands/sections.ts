import { assertDataArray, assertDataObject, own } from '../data-validation';
import {
  allocateSectionRecord, assertSectionName, canonicalSectionState, cloneSectionState,
} from '../sections';
import type { EditDoc, SectionId, SectionState, SlideId } from '../types';
import type {
  AddSectionCommand, CommandPatches, MoveSectionCommand, Patch, RemoveSectionCommand,
  RenameSectionCommand, SectionStatePatch,
} from './types';

function assertSectionId(value: unknown, label: string): asserts value is SectionId {
  if (typeof value !== 'string' || !value) throw new Error(`${label} 必须是非空字符串`);
}

export function assertSectionState(doc: EditDoc, value: unknown, label: string): asserts value is SectionState {
  assertDataObject(value, ['records', 'order', 'edited'], label);
  const state = value as SectionState;
  if (typeof state.edited !== 'boolean') throw new Error(`${label}.edited 必须是布尔值`);
  assertDataArray(state.order, `${label}.order`);
  if (!state.records || typeof state.records !== 'object' || Array.isArray(state.records)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(state.records))) {
    throw new Error(`${label}.records 必须是纯数据对象`);
  }
  if (new Set(state.order).size !== state.order.length) throw new Error(`${label}.order 不能重复`);
  if (Object.keys(state.records).length !== state.order.length) throw new Error(`${label} 含孤立节记录`);
  const assigned = new Set<SlideId>();
  for (const id of state.order) {
    assertSectionId(id, `${label}.order`);
    const section = state.records[id];
    assertDataObject(section, ['id', 'presentationId', 'name', 'slideIds'], `${label}.${id}`);
    if (section.id !== id) throw new Error(`${label}.${id} 身份不一致`);
    if (typeof section.presentationId !== 'string'
      || !/^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/i.test(
        section.presentationId,
      )) throw new Error(`${label}.${id} 的 presentationId 不是 GUID`);
    assertSectionName(section.name, `${label}.${id}.name`);
    assertDataArray(section.slideIds, `${label}.${id}.slideIds`);
    if (new Set(section.slideIds).size !== section.slideIds.length) {
      throw new Error(`${label}.${id}.slideIds 不能重复`);
    }
    for (const slideId of section.slideIds) {
      if (typeof slideId !== 'string' || !doc.slides[slideId]) {
        throw new Error(`${label}.${id} 指向不存在的页面：${String(slideId)}`);
      }
      if (assigned.has(slideId)) throw new Error(`${label} 的页面不能属于多个节：${slideId}`);
      assigned.add(slideId);
    }
  }
}

export function isSectionStatePatch(patch: Patch): patch is SectionStatePatch {
  return patch.op === 'set' && patch.path.length === 4
    && patch.path[0] === 'document' && patch.path[1] === 'sections'
    && typeof patch.path[2] === 'string' && !!patch.path[2]
    && ['state', 'name', 'order'].includes(patch.path[3]);
}

export function validateSectionStatePatch(
  doc: EditDoc,
  patch: SectionStatePatch,
  index: number,
): void {
  assertSectionState(doc, patch.value, `Patch ${index} 的节状态`);
}

export function applySectionStatePatch(doc: EditDoc, patch: SectionStatePatch): void {
  doc.sections = cloneSectionState(patch.value);
}

function statePatches(
  doc: EditDoc,
  next: SectionState,
  origin: string,
  target: SectionId,
  field: SectionStatePatch['path'][3],
): CommandPatches {
  const canonical = canonicalSectionState(doc, next);
  if (JSON.stringify(canonical) === JSON.stringify(canonicalSectionState(doc))) {
    return { forward: [], inverse: [] };
  }
  canonical.edited = true;
  const path = ['document', 'sections', target, field] as const;
  return {
    forward: [{ op: 'set', path, value: canonical, origin }],
    inverse: [{ op: 'set', path, value: canonicalSectionState(doc), origin }],
  };
}

function assertWritable(doc: EditDoc): void {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改节');
}

function assertAnchor(
  doc: EditDoc,
  id: SectionId | null,
  current?: SectionId,
): asserts id is SectionId | null {
  if (id !== null && !doc.sections.records[id]) throw new Error(`找不到节锚点：${String(id)}`);
  if (id === current) throw new Error('节不能移动到自身之后');
}

export function addSectionPatches(
  doc: EditDoc,
  command: AddSectionCommand,
  origin: string,
): CommandPatches {
  assertWritable(doc);
  assertSectionName(command.name);
  assertDataArray(command.slideIds, 'AddSection.slideIds');
  if (!command.slideIds.length) throw new Error('AddSection.slideIds 不能为空');
  if (new Set(command.slideIds).size !== command.slideIds.length) {
    throw new Error('AddSection.slideIds 不能重复');
  }
  const assigned = new Set(doc.sections.order.flatMap((id) => doc.sections.records[id].slideIds));
  const positions = command.slideIds.map((id) => {
    if (typeof id !== 'string' || !doc.slides[id]) throw new Error(`找不到页面：${String(id)}`);
    if (assigned.has(id)) throw new Error(`页面已经属于节：${id}`);
    return doc.slideOrder.indexOf(id);
  });
  const sorted = [...positions].sort((a, b) => a - b);
  if (positions.some((value, index) => value !== sorted[index])
    || sorted.some((value, index) => index > 0 && value !== sorted[index - 1] + 1)) {
    throw new Error('AddSection.slideIds 必须按页序给出连续页面');
  }
  assertDataObject(command.at, ['after'], 'AddSection.at');
  if (!own(command.at, 'after')) throw new Error('AddSection.at.after 必须存在');
  assertAnchor(doc, command.at.after);
  const next = cloneSectionState(doc.sections);
  const section = allocateSectionRecord(doc, command.name, [...command.slideIds]);
  next.records[section.id] = section;
  const index = command.at.after === null ? 0 : next.order.indexOf(command.at.after) + 1;
  next.order.splice(index, 0, section.id);
  return statePatches(doc, next, origin, section.id, 'state');
}

export function renameSectionPatches(
  doc: EditDoc,
  command: RenameSectionCommand,
  origin: string,
): CommandPatches {
  assertWritable(doc);
  const section = doc.sections.records[command.id];
  if (!section) throw new Error(`找不到节：${command.id}`);
  assertSectionName(command.name);
  const next = cloneSectionState(doc.sections);
  next.records[command.id].name = command.name;
  return statePatches(doc, next, origin, command.id, 'name');
}

export function moveSectionPatches(
  doc: EditDoc,
  command: MoveSectionCommand,
  origin: string,
): CommandPatches {
  assertWritable(doc);
  if (!doc.sections.records[command.id]) throw new Error(`找不到节：${command.id}`);
  assertDataObject(command.at, ['after'], 'MoveSection.at');
  if (!own(command.at, 'after')) throw new Error('MoveSection.at.after 必须存在');
  assertAnchor(doc, command.at.after, command.id);
  const next = cloneSectionState(doc.sections);
  next.order.splice(next.order.indexOf(command.id), 1);
  const index = command.at.after === null ? 0 : next.order.indexOf(command.at.after) + 1;
  next.order.splice(index, 0, command.id);
  return statePatches(doc, next, origin, command.id, 'order');
}

export function removeSectionPatches(
  doc: EditDoc,
  command: RemoveSectionCommand,
  origin: string,
): CommandPatches {
  assertWritable(doc);
  if (!doc.sections.records[command.id]) throw new Error(`找不到节：${command.id}`);
  const next = cloneSectionState(doc.sections);
  delete next.records[command.id];
  next.order.splice(next.order.indexOf(command.id), 1);
  return statePatches(doc, next, origin, command.id, 'state');
}
