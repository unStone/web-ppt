import type { DocumentExtensionPatch } from '../commands/types';
import { assertChartDictionary } from './validation';

export function stageSharedRecords(records: Readonly<Record<string, unknown>> | undefined,
  patches: readonly DocumentExtensionPatch[]): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const next: Record<string, unknown> = structuredClone(records ?? {});
  for (const patch of patches) {
    let target = next, missing = false;
    for (const key of patch.path.slice(5, -1)) {
      if (target[key] === undefined) {
        if (patch.op === 'del') { missing = true; break; }
        target[key] = Object.create(null);
      }
      assertChartDictionary(target[key], '共享记录字段'); target = target[key] as Record<string, unknown>;
    }
    if (missing) continue;
    const key = patch.path[patch.path.length - 1];
    if (patch.op === 'set') target[key] = patch.value; else delete target[key];
  }
  return next as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
