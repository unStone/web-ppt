import { TEXT_RUN_DIRECT_BITS, tableStyleCellAppearance, tableStylePreview } from '@web-ppt/core';
import type {
  CellBorders, TableElement, TableStyleDefinition, TableStylePart, TableStyleSettings, TextBody,
} from '@web-ppt/core';
import { assertDataObject, own } from './data-validation';
import type { EditDoc, ElementId, SlideId } from './types';

export interface TableStyleCatalogItem {
  readonly styleId: string;
  readonly name: string;
  readonly source: 'document' | 'builtin';
  readonly preview: TableElement;
}

export interface TableStyleState {
  readonly value: TableStyleSettings | null;
  readonly source: TableStyleSettings | null;
  readonly direct: boolean;
}

function definitionsForSlide(doc: EditDoc, slideId: SlideId): readonly TableStyleDefinition[] {
  const slide = doc.slides[slideId];
  if (!slide) throw new Error(`找不到幻灯片：${slideId}`);
  const changedLayout = slide.layoutId !== slide.sourceLayoutId;
  return changedLayout
    ? doc.layouts[slide.layoutId ?? '']?.tableStyles ?? slide.tableStyles ?? []
    : slide.tableStyles ?? doc.layouts[slide.layoutId ?? '']?.tableStyles ?? [];
}

function elementSlideId(doc: EditDoc, id: ElementId): SlideId {
  let current = doc.elements[id];
  if (!current) throw new Error(`找不到元素：${id}`);
  while (!doc.slides[current.parent]) {
    current = doc.elements[current.parent];
    if (!current) throw new Error(`元素 ${id} 的父链无效`);
  }
  return current.parent;
}

function definitionFor(
  doc: EditDoc,
  slideId: SlideId,
  styleId: string,
): TableStyleDefinition | undefined {
  const key = styleId.toUpperCase();
  return definitionsForSlide(doc, slideId)
    .find((definition) => definition.styleId.toUpperCase() === key);
}

export function tableStyleDefinitionForElement(
  doc: EditDoc,
  id: ElementId,
  styleId: string,
): TableStyleDefinition | undefined {
  return definitionFor(doc, elementSlideId(doc, id), styleId);
}

/** 目录以页面主题为上下文；返回值不泄露 OOXML，也不要求 UI 复刻样式优先级。 */
export function listTableStyles(doc: EditDoc, slideId: SlideId): readonly TableStyleCatalogItem[] {
  return definitionsForSlide(doc, slideId).map((definition) => ({
    styleId: definition.styleId,
    name: definition.name,
    source: definition.source,
    preview: tableStylePreview(definition),
  }));
}

export function assertTableStyleSettings(
  doc: EditDoc,
  id: ElementId,
  input: unknown,
  label: string,
): TableStyleSettings {
  assertDataObject(input, [
    'styleId', 'firstRow', 'lastRow', 'bandRow', 'firstCol', 'lastCol', 'bandCol',
  ], label);
  const value = input as unknown as TableStyleSettings;
  if (typeof value.styleId !== 'string' || !value.styleId.trim()) {
    throw new Error(`${label}.styleId 必须是非空字符串`);
  }
  for (const field of ['firstRow', 'lastRow', 'bandRow', 'firstCol', 'lastCol', 'bandCol'] as const) {
    if (typeof value[field] !== 'boolean') throw new Error(`${label}.${field} 必须是布尔值`);
  }
  const definition = definitionFor(doc, elementSlideId(doc, id), value.styleId);
  if (!definition) throw new Error(`${label}.styleId 不在当前页面的表样式目录中：${value.styleId}`);
  return { ...value, styleId: definition.styleId };
}

export function queryTableStyle(doc: EditDoc, id: ElementId): TableStyleState {
  const record = doc.elements[id];
  if (!record || record.src.kind !== 'table') throw new Error(`找不到表格：${id}`);
  const source = record.src.editInfo?.tableStyle ?? null;
  return {
    value: structuredClone(record.ovr.tableStyle ?? source),
    source: structuredClone(source),
    direct: own(record.ovr, 'tableStyle'),
  };
}

function styledTextBody(
  current: TextBody | null,
  base: TextBody | null | undefined,
  style: TableStylePart['text'],
): TextBody | null {
  if (!current) return null;
  return {
    ...current,
    paragraphs: current.paragraphs.map((paragraph, paragraphIndex) => ({
      ...paragraph,
      runs: paragraph.runs.map((run, runIndex) => {
        const baseRun = base?.paragraphs[paragraphIndex]?.runs[runIndex];
        const direct = (paragraph.editInfo?.directRun ?? 0) | (run.editInfo?.direct ?? 0);
        return {
          ...run,
          ...(!(direct & TEXT_RUN_DIRECT_BITS.b)
            ? { b: style?.b ?? baseRun?.b ?? run.b } : {}),
          ...(!(direct & TEXT_RUN_DIRECT_BITS.color)
            ? { color: style?.color ?? baseRun?.color ?? run.color } : {}),
        };
      }),
    })),
  };
}

/** 来源直设基线最后叠加，因此样式切换不会清洗单元格直接格式。 */
export function projectTableStyle(
  doc: EditDoc,
  slideId: SlideId,
  table: TableElement,
  settings: TableStyleSettings,
): TableElement {
  const definition = definitionFor(doc, slideId, settings.styleId);
  if (!definition) throw new Error(`表样式不在当前页面目录中：${settings.styleId}`);
  const rowCount = table.rows.length;
  return {
    ...table,
    editInfo: { ...table.editInfo, tableStyle: structuredClone(settings) },
    rows: table.rows.map((row, rowIndex) => ({
      ...row,
      cells: row.cells.map((cell, columnIndex) => {
        const base = cell.editInfo?.styleBase;
        // 自包含新增/粘贴表格没有可分离的样式基线；全部视觉都按直接格式保留。
        if (!base) return cell;
        const appearance = tableStyleCellAppearance(
          definition, settings, rowIndex, columnIndex, rowCount, row.cells.length,
        );
        const borders: CellBorders = { ...appearance.borders };
        for (const side of ['l', 'r', 't', 'b'] as const) {
          if (own(base.borders, side)) borders[side] = structuredClone(base.borders[side]);
        }
        const textTemplate = cell.editInfo?.textTemplate
          ? styledTextBody(cell.editInfo.textTemplate, base.textTemplate, appearance.text)!
          : undefined;
        return {
          ...cell,
          fill: base.fill === null ? appearance.fill : structuredClone(base.fill),
          borders,
          text: styledTextBody(cell.text, base.text, appearance.text),
          editInfo: {
            ...cell.editInfo,
            ...(textTemplate ? { textTemplate } : {}),
          },
        };
      }),
    })),
  };
}
