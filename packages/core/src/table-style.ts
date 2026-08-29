import type {
  CellBorders, TableCell, TableElement, TableStyleDefinition, TableStylePart, TableStyleSettings,
} from './types';

const DEFAULT_PREVIEW_SETTINGS: TableStyleSettings = {
  styleId: '', firstRow: true, lastRow: false, bandRow: true,
  firstCol: false, lastCol: false, bandCol: false,
};

function mergePart(target: { fill: TableCell['fill']; borders: CellBorders }, part?: TableStylePart): void {
  if (!part) return;
  if (part.fill !== undefined) target.fill = structuredClone(part.fill);
  for (const [side, stroke] of Object.entries(part.borders ?? {})) {
    target.borders[side as keyof CellBorders] = structuredClone(stroke);
  }
}

/** 表样式优先级在一个纯函数里收敛，解析投影与任意 UI 预览不会各自猜一遍。 */
export function tableStyleCellAppearance(
  definition: TableStyleDefinition,
  settings: TableStyleSettings,
  row: number,
  column: number,
  rowCount: number,
  columnCount: number,
): { fill: TableCell['fill']; borders: CellBorders; text: TableStylePart['text'] } {
  const target = { fill: null as TableCell['fill'], borders: {} as CellBorders };
  const { parts } = definition;
  const isFirstRow = settings.firstRow && row === 0;
  const isLastRow = settings.lastRow && row === rowCount - 1;
  const isFirstCol = settings.firstCol && column === 0;
  const isLastCol = settings.lastCol && column === columnCount - 1;
  const rowBand = settings.bandRow ? (settings.firstRow ? row - 1 : row) : -1;
  const colBand = settings.bandCol ? (settings.firstCol ? column - 1 : column) : -1;
  const layers: (TableStylePart | undefined)[] = [parts.wholeTbl];
  if (rowBand >= 0 && !isFirstRow && !isLastRow) {
    layers.push(rowBand % 2 === 0 ? parts.band1H : parts.band2H);
  }
  if (colBand >= 0 && !isFirstCol && !isLastCol) {
    layers.push(colBand % 2 === 0 ? parts.band1V : parts.band2V);
  }
  if (isFirstCol) layers.push(parts.firstCol);
  if (isLastCol) layers.push(parts.lastCol);
  if (isFirstRow) layers.push(parts.firstRow);
  if (isLastRow) layers.push(parts.lastRow);
  if (isFirstRow && isFirstCol) layers.push(parts.nwCell);
  if (isFirstRow && isLastCol) layers.push(parts.neCell);
  if (isLastRow && isFirstCol) layers.push(parts.swCell);
  if (isLastRow && isLastCol) layers.push(parts.seCell);

  let text: TableStylePart['text'];
  for (const layer of layers) {
    mergePart(target, layer);
    if (layer?.text) text = { ...text, ...layer.text };
  }
  return { ...target, text };
}

export function tableStylePreview(definition: TableStyleDefinition): TableElement {
  const settings = { ...DEFAULT_PREVIEW_SETTINGS, styleId: definition.styleId };
  const rows = Array.from({ length: 3 }, (_, row) => ({
    height: 32,
    cells: Array.from({ length: 3 }, (_, column): TableCell => {
      const appearance = tableStyleCellAppearance(definition, settings, row, column, 3, 3);
      return {
        colSpan: 1, rowSpan: 1, merged: false,
        fill: appearance.fill, borders: appearance.borders, text: null,
      };
    }),
  }));
  return {
    kind: 'table', x: 0, y: 0, w: 288, h: 96, rot: 0, flipH: false, flipV: false,
    colWidths: [96, 96, 96], rows,
  };
}
