import { allocateElementId } from './document';
import type { EditDoc, SectionId, SectionRecord, SectionState, SlideId } from './types';

export const MAX_SECTION_NAME_LENGTH = 255;

export function assertSectionName(value: unknown, label = '节名称'): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`);
  if (value.length > MAX_SECTION_NAME_LENGTH) {
    throw new Error(`${label}不能超过 ${MAX_SECTION_NAME_LENGTH} 个 UTF-16 单元`);
  }
  if (/[\0-\x1f\x7f]/.test(value)) throw new Error(`${label}不能包含控制字符`);
}

export function cloneSectionState(state: SectionState): SectionState {
  return structuredClone(state);
}

export function canonicalSectionState(doc: EditDoc, state = doc.sections): SectionState {
  const position = new Map(doc.slideOrder.map((id, index) => [id, index]));
  return {
    edited: state.edited,
    order: [...state.order],
    records: Object.fromEntries(state.order.map((id) => {
      const section = state.records[id];
      return [id, {
        ...section,
        slideIds: [...section.slideIds].sort((left, right) =>
          (position.get(left) ?? Number.MAX_SAFE_INTEGER)
            - (position.get(right) ?? Number.MAX_SAFE_INTEGER)),
      }];
    })),
  };
}

export function listSections(doc: EditDoc): SectionRecord[] {
  const state = canonicalSectionState(doc);
  return state.order.map((id) => structuredClone(state.records[id]));
}

export function sectionOfSlide(doc: EditDoc, slideId: SlideId): SectionId | null {
  return doc.sections.order.find((id) => doc.sections.records[id].slideIds.includes(slideId)) ?? null;
}

function guidPart(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function allocateSectionRecord(doc: EditDoc, name: string, slideIds: SlideId[]): SectionRecord {
  const id = `section:${allocateElementId(doc)}`;
  const hex = `${guidPart(id, 0x811c9dc5)}${guidPart(id, 0x9e3779b9)}${guidPart(id, 0x85ebca6b)}${guidPart(id, 0xc2b2ae35)}`;
  return {
    id,
    presentationId: `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`.toUpperCase(),
    name,
    slideIds,
  };
}
