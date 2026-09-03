import type { EditDoc } from './types';

export function masterHasEdits(doc: EditDoc, id: string): boolean {
  const master = doc.masters[id];
  if (!master) return false;
  if (Reflect.ownKeys(master.ovr).length) return true;
  return masterHasElementEdits(doc, id);
}

export function masterHasElementEdits(doc: EditDoc, id: string): boolean {
  const master = doc.masters[id];
  if (!master) return false;
  const visit = (elementId: string): boolean => {
    const record = doc.elements[elementId];
    return !!record && (record.meta.created || record.meta.sourceParent !== undefined
      || Reflect.ownKeys(record.ovr).length > 0 || (record.children ?? []).some(visit));
  };
  if (master.children.some(visit)) return true;
  return Object.values(doc.removedElements).some((record) => record.meta.origin?.part === id);
}
