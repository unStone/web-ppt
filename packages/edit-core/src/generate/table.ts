import { TEXT_RUN_DIRECT_BITS } from '@web-ppt/core';
import type { TableCell, TableStyleDefinition, TableStyleSettings, TextBody } from '@web-ppt/core';
import { effectiveElement } from '../projection';
import { directTableCellMarkup } from '../table-direct-markup';
import { tableStyleDefinitionForElement } from '../table-style';
import type { EditDoc, ElementInsertionSource, ElementRecord } from '../types';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';

const esc = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const EMPTY_TABLE_TEXT: TextBody = {
  anchor: 'top', insets: [4.8, 9.6, 4.8, 9.6], wrap: true, fontScale: 1,
  paragraphs: [{
    align: 'left', lvl: 0, marL: 0, indent: 0, bullet: null,
    lineHeight: null, spaceBefore: 0, spaceAfter: 0,
    runs: [{
      text: '', b: false, i: false, u: false, strike: false,
      size: 18, color: '#000000', fonts: [],
    }],
  }],
};

function coveringCell(
  rows: readonly { readonly cells: readonly TableCell[] }[],
  row: number,
  column: number,
): { row: number; column: number } | null {
  for (let r = 0; r <= row; r++) {
    for (let c = 0; c <= column; c++) {
      const cell = rows[r]?.cells[c];
      if (!cell?.merged && r + cell.rowSpan > row && c + cell.colSpan > column) return { row: r, column: c };
    }
  }
  return null;
}

function tableCellMarkup(
  rows: readonly { readonly cells: readonly TableCell[] }[],
  row: number,
  column: number,
  styled: boolean,
): string {
  const cell = rows[row].cells[column];
  const attrs: string[] = [];
  if (!cell.merged) {
    if (cell.colSpan > 1) attrs.push(`gridSpan="${cell.colSpan}"`);
    if (cell.rowSpan > 1) attrs.push(`rowSpan="${cell.rowSpan}"`);
  } else {
    const anchor = coveringCell(rows, row, column);
    if (!anchor) throw new Error(`表格合并占位格缺少起始格：${row},${column}`);
    if (column > anchor.column) attrs.push('hMerge="1"');
    if (row > anchor.row) attrs.push('vMerge="1"');
  }
  const base = styled ? cell.editInfo?.styleBase : undefined;
  const body = base?.textTemplate ?? base?.text;
  const paragraph = body?.paragraphs[0];
  const run = paragraph?.runs[0];
  const direct = (paragraph?.editInfo?.directRun ?? 0) | (run?.editInfo?.direct ?? 0);
  const markupCell: TableCell = base ? {
    ...cell,
    fill: structuredClone(base.fill),
    borders: structuredClone(base.borders),
    text: structuredClone(base.text),
    editInfo: {
      ...cell.editInfo,
      ...(base.textTemplate ? { textTemplate: structuredClone(base.textTemplate) } : {}),
    },
  } : cell;
  const fallbackBorder = { color: 'rgba(0,0,0,0.25)', width: 1, dash: null } as const;
  // renderer 的未声明边框有网格兜底；仅无样式表格需要把这层视觉固定成直设。
  const markup = directTableCellMarkup({
    ...markupCell,
    ...(!markupCell.editInfo?.textTemplate && !markupCell.text?.paragraphs[0]?.runs[0]
      ? { editInfo: { textTemplate: EMPTY_TABLE_TEXT } } : {}),
    ...(!base ? { borders: {
      l: cell.borders?.l === undefined ? fallbackBorder : cell.borders.l,
      r: cell.borders?.r === undefined ? fallbackBorder : cell.borders.r,
      t: cell.borders?.t === undefined ? fallbackBorder : cell.borders.t,
      b: cell.borders?.b === undefined ? fallbackBorder : cell.borders.b,
    } } : {}),
  }, base ? {
    sparseAppearance: true,
    omitTextBold: !(direct & TEXT_RUN_DIRECT_BITS.b),
    omitTextColor: !(direct & TEXT_RUN_DIRECT_BITS.color),
  } : {});
  return attrs.length ? markup.replace('<a:tc>', `<a:tc ${attrs.join(' ')}>` ) : markup;
}

export function tableInsertion(record: ElementRecord, spid: number): ElementInsertionSource {
  const source = record.src;
  if (source.kind !== 'table') throw new Error(`元素 ${record.id} 不是表格`);
  const columns = source.colWidths.map((width) => `<a:gridCol w="${Math.round(width * 9525)}"/>`).join('');
  const styled = !!source.editInfo?.tableStyle;
  const rows = source.rows.map((row, r) => `<a:tr h="${Math.round(row.height * 9525)}">${row.cells
    .map((_, c) => tableCellMarkup(source.rows, r, c, styled)).join('')}</a:tr>`).join('');
  const name = esc(source.name ?? `表格 ${spid}`);
  const settings = source.editInfo?.tableStyle;
  const switches = settings ? ([
    'firstRow', 'lastRow', 'bandRow', 'firstCol', 'lastCol', 'bandCol',
  ] as const).filter((field) => settings[field]).map((field) => `${field}="1"`).join(' ') : '';
  const properties = settings
    ? `<a:tblPr${switches ? ` ${switches}` : ''}><a:tableStyleId>${esc(settings.styleId)}</a:tableStyleId></a:tblPr>`
    : '<a:tblPr/>';
  return {
    markup: `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${spid}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
${properties}<a:tblGrid>${columns}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
    namespaces: { 'xmlns:a': DRAWINGML_NS, 'xmlns:p': PRESENTATIONML_NS },
    spids: { [String(spid)]: spid },
  };
}

export function generatedTableStyleDefinitions(doc: EditDoc): readonly TableStyleDefinition[] {
  const definitions = new Map<string, TableStyleDefinition>();
  for (const record of Object.values(doc.elements)) {
    const settings: TableStyleSettings | undefined = record.src.kind === 'table'
      ? effectiveElement(doc, record.id).editInfo?.tableStyle : undefined;
    if (!settings) continue;
    const definition = tableStyleDefinitionForElement(doc, record.id, settings.styleId);
    if (!definition) throw new Error(`表格 ${record.id} 的样式定义不存在：${settings.styleId}`);
    definitions.set(definition.styleId.toUpperCase(), definition);
  }
  return [...definitions.values()];
}
