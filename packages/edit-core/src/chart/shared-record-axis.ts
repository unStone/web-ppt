export interface SharedRecordAxis {
  readonly key: string;
  readonly sheet: string;
  readonly horizontal: boolean;
  readonly start: number;
  readonly end: number;
  readonly lanes: ReadonlySet<number>;
  readonly keys: ReadonlySet<string>;
  readonly references?: ReadonlySet<string>;
}

interface AxisInsertion { readonly id: string; readonly anchor: number; readonly removed?: true }

/** 来源坐标是身份；压紧和插入只改变派生坐标，不改写后续记录的寻址。 */
export function recordAxisLayout<T extends AxisInsertion>(family: SharedRecordAxis, records: readonly T[], removed: ReadonlySet<number>) {
  const active = records.filter(row => !row.removed);
  const originalAxes = new Map<number, number>(), insertedAxes = new Map<string, number>();
  let inserted = 0, deletedBefore = 0;
  for (let axis = family.start; axis <= family.end; axis++) {
    while (inserted < active.length && active[inserted].anchor < axis) inserted++;
    originalAxes.set(axis, axis - deletedBefore + inserted);
    if (removed.has(axis)) deletedBefore++;
  }
  const originalAxis = (axis: number) => originalAxes.get(axis) ?? axis;
  const counts = new Map<number, number>();
  for (const row of active) {
    const count = counts.get(row.anchor) ?? 0;
    insertedAxes.set(row.id, originalAxis(row.anchor) + (removed.has(row.anchor) ? 0 : 1) + count);
    counts.set(row.anchor, count + 1);
  }
  return { records, active, deleted: [...removed], originalAxis, insertedAxis: (row: T) => insertedAxes.get(row.id)!,
    end: family.end - removed.size + active.length };
}
