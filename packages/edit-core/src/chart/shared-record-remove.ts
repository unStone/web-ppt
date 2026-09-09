import type { EditDoc } from '../types';
import type { CommandPatches, DocumentExtensionPatch } from '../commands/types';
import type { SharedGroup } from './shared-graph';
import type { SharedCategoryFamily } from './shared-family';
import type { WorkbookCellValue } from './workbook-read';
import { sharedRecordRemovalPlan } from './shared-rows';
import { currentChartDatasetState } from './source';
import { reconcileCategoryMatrix } from './category-matrix';

interface Resource {
  readonly rows?: Readonly<Record<string, unknown>>;
  readonly cells?: Readonly<Record<string, unknown>>;
  readonly heads?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** 删除一条来源记录，同时保留各层级视图的组首延续引用。 */
export function removeSharedRecord(doc: EditDoc, shared: SharedGroup, family: SharedCategoryFamily,
  position: number, origin: string, resource: Resource, baseline: ReadonlyMap<string, WorkbookCellValue>): CommandPatches {
  const forward = new Map<string, DocumentExtensionPatch>(), inverse: DocumentExtensionPatch[] = [];
  const add = (tail: readonly string[], value: unknown, old: unknown) => {
    const path = ['document', 'extensions', 'chart-shared', shared.workbook, ...tail] as DocumentExtensionPatch['path'];
    const key = JSON.stringify(path), previous = forward.get(key);
    if (previous) {
      if (previous.op !== 'set' || previous.value !== value) throw new Error('共享删除的组首提升产生矛盾值');
      return;
    }
    forward.set(key, { op: 'set', path, value, origin });
    inverse.unshift(old === undefined ? { op: 'del', path, origin } : { op: 'set', path, value: old, origin });
  };
  for (const [key, value] of sharedRecordRemovalPlan(family, position, baseline)) add(['rows', key], JSON.stringify(value), resource.rows?.[key]);
  for (const chart of family.charts) {
    const categoryId = [...family.positions.get(chart.id)!].find(([, axis]) => axis === position)?.[0];
    if (!categoryId) continue;
    const before = currentChartDatasetState(doc, chart.id), after = structuredClone(before);
    (after.categories[categoryId as keyof typeof after.categories] as { removed?: true }).removed = true;
    reconcileCategoryMatrix(after);
    for (const field of chart.fields) if (field.parent) {
      const next = after.categories[field.path[1] as keyof typeof after.categories], old = before.categories[next.id];
      const level = field.parent.level, value = next.levels?.[level];
      if (next.removed || old.levels?.[level] !== null || value === null || value === undefined) continue;
      const parent = chart.fields.find(item => item.parent?.level === level && item.path[1] === categoryId);
      add(['cells', field.key], JSON.stringify(parent ? { parent: parent.key } : { value }), resource.cells?.[field.key]);
      add(['heads', field.parent.family, field.key], true, resource.heads?.[field.parent.family]?.[field.key]);
    }
  }
  return { forward: [...forward.values()], inverse };
}
