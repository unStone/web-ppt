import type { EditDoc } from './types';

export function layoutHasEdits(doc: EditDoc, id: string): boolean {
  const layout = doc.layouts[id];
  if (!layout) return false;
  if (Reflect.ownKeys(layout.ovr).length) return true;
  const visit = (elementId: string): boolean => {
    const record = doc.elements[elementId];
    return !!record && (record.meta.created || record.meta.sourceParent !== undefined
      || Reflect.ownKeys(record.ovr).length > 0 || (record.children ?? []).some(visit));
  };
  if (layout.children.some(visit)) return true;
  return Object.values(doc.removedElements).some((record) => record.meta.origin?.part === id);
}
