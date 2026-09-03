import type { TableElement, TableRow } from '@web-ppt/core';

/** 最后一格吃掉浮点余量，保证即时网格与选择 frame 在 JS 数值上也严格闭合。 */
export function scaledDimensions(values: readonly number[], total: number): number[] {
  const sourceTotal = values.reduce((sum, value) => sum + value, 0);
  if (!values.length || sourceTotal <= 0) return [...values];
  let remaining = total;
  return values.map((value, index) => {
    if (index === values.length - 1) return remaining;
    const scaled = value / sourceTotal * total;
    remaining -= scaled;
    return scaled;
  });
}

const scaledTableRow = (row: TableRow, scale: number): TableRow =>
  scale === 1 ? row : { ...row, height: row.height * scale };

export function scaledTableEditInfo(
  editInfo: TableElement['editInfo'], scale: number,
): TableElement['editInfo'] {
  const append = editInfo?.tableRowAppend;
  if (!append || scale === 1) return editInfo;
  return {
    ...editInfo,
    tableRowAppend: {
      ...(append.previousLast ? { previousLast: scaledTableRow(append.previousLast, scale) } : {}),
      regular: [scaledTableRow(append.regular[0], scale), scaledTableRow(append.regular[1], scale)],
      last: [scaledTableRow(append.last[0], scale), scaledTableRow(append.last[1], scale)],
    },
  };
}
