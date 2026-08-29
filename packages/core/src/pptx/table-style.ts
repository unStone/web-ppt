import { TEXT_RUN_DIRECT_BITS } from '../edit-metadata';
import { tableStyleCellAppearance } from '../table-style';
import type {
  CellBorders, ElementBase, Fill, Stroke, TableCell, TableCreationDefaults, TableElement,
  TableRow, TableStyleDefinition, TableStylePart,
} from '../types';
import { attr, boolAttr, emu, kid, kids, numAttr, parseXml } from '../xml';
import { childColor } from './color';
import { builtInTableStyleCatalog, builtInTableStyleMarkup } from './builtin-table-styles';
import { resolveLink } from './hyperlink';
import type { Env } from './slide-inheritance';
import { parseTextBody } from './text';

export interface TableFormatReader {
  readonly fill: (container: Element | null, env: Env) => Fill | null;
  readonly line: (line: Element | null, env: Env, fallback: Stroke | null) => Stroke | null;
}

interface TableStyleParts {
  wholeTbl: Element | null;
  band1H: Element | null;
  band2H: Element | null;
  band1V: Element | null;
  band2V: Element | null;
  firstRow: Element | null;
  lastRow: Element | null;
  firstCol: Element | null;
  lastCol: Element | null;
  nwCell: Element | null;
  neCell: Element | null;
  swCell: Element | null;
  seCell: Element | null;
}

interface ResolvedStyle {
  readonly style: Element;
  readonly namespaceRoot: Element;
  readonly source: TableStyleDefinition['source'];
  readonly fallbackName?: string;
}

const builtInTableStyles = new Map<string, { root: Element; style: Element }>();

function builtInTableStyle(styleId: string | null): { root: Element; style: Element } | null {
  if (!styleId) return null;
  const key = styleId.toUpperCase();
  const cached = builtInTableStyles.get(key);
  if (cached) return cached;
  const markup = builtInTableStyleMarkup(key);
  if (!markup) return null;
  const root = parseXml(`<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${markup}</root>`);
  const style = kid(root, 'tblStyle')!;
  const value = { root, style };
  builtInTableStyles.set(key, value);
  return value;
}

function resolvedStyle(tableStyles: Element | null, styleId: string | null): ResolvedStyle | null {
  const list = kids(tableStyles, 'tblStyle');
  const def = attr(tableStyles, 'def');
  const documentStyle = list.find((style) => attr(style, 'styleId')?.toUpperCase() === styleId?.toUpperCase());
  if (documentStyle && tableStyles) {
    return { style: documentStyle, namespaceRoot: tableStyles, source: 'document' };
  }
  const builtin = builtInTableStyle(styleId);
  if (builtin) return { ...builtin, namespaceRoot: builtin.root, source: 'builtin' };
  const fallback = list.find((style) => attr(style, 'styleId')?.toUpperCase() === def?.toUpperCase());
  if (fallback && tableStyles) return { style: fallback, namespaceRoot: tableStyles, source: 'document' };
  const builtInFallback = builtInTableStyle(def);
  return builtInFallback
    ? { ...builtInFallback, namespaceRoot: builtInFallback.root, source: 'builtin' }
    : null;
}

function styleParts(style: Element | null): TableStyleParts | null {
  if (!style) return null;
  return {
    wholeTbl: kid(style, 'wholeTbl'),
    band1H: kid(style, 'band1H'),
    band2H: kid(style, 'band2H'),
    band1V: kid(style, 'band1V'),
    band2V: kid(style, 'band2V'),
    firstRow: kid(style, 'firstRow'),
    lastRow: kid(style, 'lastRow'),
    firstCol: kid(style, 'firstCol'),
    lastCol: kid(style, 'lastCol'),
    nwCell: kid(style, 'nwCell'),
    neCell: kid(style, 'neCell'),
    swCell: kid(style, 'swCell'),
    seCell: kid(style, 'seCell'),
  };
}

/** tableStyles 的边名与单元格直设缩写不同，统一映射只保留一份。 */
const BORDER_SIDES: readonly [keyof CellBorders, string, string][] = [
  ['l', 'left', 'lnL'],
  ['r', 'right', 'lnR'],
  ['t', 'top', 'lnT'],
  ['b', 'bottom', 'lnB'],
];

function semanticPart(
  part: Element | null,
  env: Env,
  format: TableFormatReader,
): TableStylePart | undefined {
  if (!part) return undefined;
  const tcStyle = kid(part, 'tcStyle');
  const fill = format.fill(kid(tcStyle, 'fill') ?? tcStyle, env);
  const borders: CellBorders = {};
  const tableBorders = kid(tcStyle, 'tcBdr');
  for (const [key, tag] of BORDER_SIDES) {
    const side = kid(tableBorders, tag);
    if (side) borders[key] = format.line(kid(side, 'ln'), env, null);
  }
  const textStyle = kid(part, 'tcTxStyle');
  const bold = attr(textStyle, 'b');
  const color = textStyle ? childColor(textStyle, env.ctx) : null;
  const text = {
    ...(bold !== null ? { b: bold === 'on' || bold === '1' || bold === 'true' } : {}),
    ...(color ? { color } : {}),
  };
  return {
    ...(fill ? { fill } : {}),
    ...(Object.keys(borders).length ? { borders } : {}),
    ...(Object.keys(text).length ? { text } : {}),
  };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function namespaceAttributes(root: Element): readonly { name: string; value: string }[] {
  return Array.from(root.attributes)
    .filter((item) => item.name === 'xmlns' || item.name.startsWith('xmlns:'))
    .map((item) => ({ name: item.name, value: item.value }));
}

/** 子树离开 tblStyleLst 后仍必须自带全部祖先 namespace，未知扩展才能合法搬运。 */
function elementMarkup(
  element: Element,
  tagName = element.tagName,
  inheritedNamespaces: readonly { name: string; value: string }[] = [],
): string {
  const own = new Set(Array.from(element.attributes).map((item) => item.name));
  const attributes = [
    ...inheritedNamespaces.filter((item) => !own.has(item.name)),
    ...Array.from(element.attributes).map((item) => ({ name: item.name, value: item.value })),
  ].map((item) => ` ${item.name}="${escapeXml(item.value)}"`).join('');
  const nodes = Array.from((element as unknown as { childNodes: readonly unknown[] }).childNodes);
  if (!nodes.length) return `<${tagName}${attributes}/>`;
  const content = nodes.map((node) => {
    if (typeof node === 'string') return escapeXml(node);
    const child = node as { nodeType?: number; nodeValue?: string | null; tagName?: string };
    return child.nodeType === 1 || child.tagName
      ? elementMarkup(node as Element)
      : escapeXml(child.nodeValue ?? '');
  }).join('');
  return `<${tagName}${attributes}>${content}</${tagName}>`;
}

const PART_NAMES = [
  'wholeTbl', 'band1H', 'band2H', 'band1V', 'band2V',
  'firstRow', 'lastRow', 'firstCol', 'lastCol',
  'nwCell', 'neCell', 'swCell', 'seCell',
] as const;

function styleDefinition(
  resolved: ResolvedStyle,
  env: Env,
  format: TableFormatReader,
): TableStyleDefinition | null {
  const styleId = attr(resolved.style, 'styleId')?.trim();
  if (!styleId) return null;
  const parts: TableStyleDefinition['parts'] = {};
  for (const name of PART_NAMES) {
    const part = semanticPart(kid(resolved.style, name), env, format);
    if (part) (parts as Record<string, TableStylePart>)[name] = part;
  }
  return {
    styleId,
    name: attr(resolved.style, 'styleName')?.trim() || resolved.fallbackName || styleId,
    source: resolved.source,
    markup: elementMarkup(
      resolved.style, resolved.style.tagName, namespaceAttributes(resolved.namespaceRoot),
    ),
    parts,
  };
}

/** 目录按文档原顺序优先，内置项只补同 GUID 的缺口。 */
export function tableStyleCatalog(
  tableStyles: Element | null,
  env: Env,
  format: TableFormatReader,
): TableStyleDefinition[] {
  const catalog: TableStyleDefinition[] = [];
  const seen = new Set<string>();
  const append = (definition: TableStyleDefinition | null): void => {
    const key = definition?.styleId.toUpperCase();
    if (!definition || seen.has(key!)) return;
    seen.add(key!);
    catalog.push(definition);
  };
  for (const style of kids(tableStyles, 'tblStyle')) {
    append(styleDefinition({ style, namespaceRoot: tableStyles!, source: 'document' }, env, format));
  }
  for (const builtin of builtInTableStyleCatalog()) {
    const parsed = builtInTableStyle(builtin.styleId)!;
    append(styleDefinition({
      style: parsed.style, namespaceRoot: parsed.root, source: 'builtin', fallbackName: builtin.name,
    }, env, format));
  }
  return catalog;
}

function directCellAppearance(
  cell: Element,
  env: Env,
  format: TableFormatReader,
): { fill: Fill | null; borders: CellBorders } {
  const properties = kid(cell, 'tcPr');
  const fill = format.fill(properties, env);
  const borders: CellBorders = {};
  for (const [key, , lineTag] of BORDER_SIDES) {
    const line = kid(properties, lineTag);
    if (line) borders[key] = format.line(line, env, null);
  }
  return { fill, borders };
}

export function parseTable(
  table: Element,
  frame: ElementBase,
  env: Env,
  format: TableFormatReader,
  name?: string,
): TableElement {
  const properties = kid(table, 'tblPr');
  const sourceStyleId = kid(properties, 'tableStyleId')?.textContent?.trim() ?? null;
  const resolved = resolvedStyle(env.tableStyles, sourceStyleId);
  const definition = resolved ? styleDefinition(resolved, env, format) : null;
  const settings = {
    styleId: sourceStyleId ?? definition?.styleId ?? '',
    firstRow: boolAttr(properties, 'firstRow'),
    lastRow: boolAttr(properties, 'lastRow'),
    bandRow: boolAttr(properties, 'bandRow'),
    firstCol: boolAttr(properties, 'firstCol'),
    lastCol: boolAttr(properties, 'lastCol'),
    bandCol: boolAttr(properties, 'bandCol'),
  };
  const columns = kids(kid(table, 'tblGrid'), 'gridCol').map((column) => emu(numAttr(column, 'w')));
  const rowElements = kids(table, 'tr');

  const parseRow = (row: Element, rowIndex: number, rowCount: number): TableRow => {
    const cellElements = kids(row, 'tc');
    return {
      height: emu(numAttr(row, 'h')),
      cells: cellElements.map((cell, columnIndex): TableCell => {
        const styled = definition ? tableStyleCellAppearance(
          definition, settings, rowIndex, columnIndex, rowCount, cellElements.length,
        ) : { fill: null, borders: {}, text: undefined };
        const direct = directCellAppearance(cell, env, format);
        const borders: CellBorders = structuredClone(styled.borders);
        for (const [side, stroke] of Object.entries(direct.borders)) {
          borders[side as keyof CellBorders] = stroke;
        }
        const textBody = kid(cell, 'txBody');
        const textEnv: Parameters<typeof parseTextBody>[1] = {
          ctx: env.ctx,
          fonts: env.theme.fonts,
          chain: [env.docDefaults],
          slideNum: env.slideNum,
          defaultColor: styled.text?.color ?? null,
          resolveLink: (rid, action) => resolveLink(env, rid, action),
          edit: env.edit,
        };
        const text = parseTextBody(textBody, textEnv);
        const textTemplate = !text && env.edit
          ? parseTextBody(textBody, textEnv, true) ?? undefined
          : undefined;
        if (styled.text?.b !== undefined) {
          for (const body of [text, textTemplate]) {
            if (!body) continue;
            for (const paragraph of body.paragraphs) for (const run of paragraph.runs) {
              const directRun = (paragraph.editInfo?.directRun ?? 0) | (run.editInfo?.direct ?? 0);
              if (!(directRun & TEXT_RUN_DIRECT_BITS.b)) run.b = styled.text.b;
            }
          }
        }
        let styleBase: NonNullable<TableCell['editInfo']>['styleBase'];
        if (env.edit) {
          const baseTextEnv = { ...textEnv, defaultColor: null };
          const baseText = parseTextBody(textBody, baseTextEnv);
          const baseTemplate = !baseText
            ? parseTextBody(textBody, baseTextEnv, true) ?? undefined
            : undefined;
          styleBase = {
            fill: direct.fill,
            borders: direct.borders,
            text: baseText,
            ...(baseTemplate ? { textTemplate: baseTemplate } : {}),
          };
        }
        const cellProperties = kid(cell, 'tcPr');
        const margin = (attribute: string, fallback: number): number => {
          const value = numAttr(cellProperties, attribute);
          return value === null ? emu(fallback) : emu(value);
        };
        return {
          colSpan: numAttr(cell, 'gridSpan') ?? 1,
          rowSpan: numAttr(cell, 'rowSpan') ?? 1,
          merged: boolAttr(cell, 'hMerge') || boolAttr(cell, 'vMerge'),
          fill: direct.fill ?? styled.fill,
          text,
          borders,
          margins: [
            margin('marT', 45720), margin('marR', 91440),
            margin('marB', 45720), margin('marL', 91440),
          ],
          vAlign: attr(cellProperties, 'anchor') === 'ctr' ? 'middle'
            : attr(cellProperties, 'anchor') === 'b' ? 'bottom' : 'top',
          vert: attr(cellProperties, 'vert') === 'vert' ? 'vert'
            : attr(cellProperties, 'vert') === 'vert270' ? 'vert270' : undefined,
          ...(textTemplate || styleBase ? { editInfo: {
            ...(textTemplate ? { textTemplate } : {}),
            ...(styleBase ? { styleBase } : {}),
          } } : {}),
        };
      }),
    };
  };

  const rows = rowElements.map((row, index) => parseRow(row, index, rowElements.length));
  let editInfo: TableElement['editInfo'] = env.edit && sourceStyleId
    ? { tableStyle: settings } : undefined;
  const template = rowElements[rowElements.length - 1];
  if (env.edit && template) {
    const next = rowElements.length;
    editInfo = {
      ...editInfo,
      tableRowAppend: {
        ...(next === 1 ? { previousLast: parseRow(template, 0, 2) } : {}),
        regular: [parseRow(template, next, next + 2), parseRow(template, next + 1, next + 3)],
        last: [parseRow(template, next, next + 1), parseRow(template, next + 1, next + 2)],
      },
    };
  }
  return { kind: 'table', ...frame, colWidths: columns, rows, name, ...(editInfo ? { editInfo } : {}) };
}

const creationTables = new WeakMap<Element, Map<string, Element>>();
let fallbackCreationTable: Element | null = null;
const CREATION_TABLE_TEXT = '<a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></a:txBody>';
const NEUTRAL_TABLE_TEXT = '<a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN" b="0"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:endParaRPr></a:p></a:txBody>';
const NEUTRAL_BORDER_FILL = '<a:solidFill><a:schemeClr val="tx1"><a:alpha val="25000"/></a:schemeClr></a:solidFill>';

function tableCellPropertiesMarkup(parts: TableStyleParts | null, rowPart: Element | null): string {
  const layers = [parts?.wholeTbl ?? null, rowPart];
  const borders = BORDER_SIDES.map(([, styleTag, cellTag]) => {
    let line: Element | null = null;
    for (const layer of layers) {
      const candidate = kid(kid(kid(layer, 'tcStyle'), 'tcBdr'), styleTag);
      if (candidate) line = kid(candidate, 'ln');
    }
    return line
      ? elementMarkup(line, `a:${cellTag}`)
      : `<a:${cellTag} w="9525">${NEUTRAL_BORDER_FILL}</a:${cellTag}>`;
  }).join('');
  const neutralFill = parts ? '' : '<a:solidFill><a:schemeClr val="lt1"/></a:solidFill>';
  return `<a:tcPr>${borders}${neutralFill}</a:tcPr>`;
}

function defaultTableSource(
  cellPropertiesMarkup: readonly [string, string, string],
  textBodyMarkup: string,
  tableStyles: Element | null,
): Element {
  const key = `${textBodyMarkup}\u0000${cellPropertiesMarkup.join('\u0000')}`;
  const cache = tableStyles ? creationTables.get(tableStyles) : null;
  const cached = tableStyles ? cache?.get(key) : fallbackCreationTable;
  if (cached) return cached;
  const cell = (properties: string) => `<a:tc>${textBodyMarkup}${properties}</a:tc>`;
  const root = parseXml(`<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid><a:gridCol w="9525"/></a:tblGrid>
<a:tr h="9525">${cell(cellPropertiesMarkup[0])}</a:tr>
<a:tr h="9525">${cell(cellPropertiesMarkup[1])}</a:tr>
<a:tr h="9525">${cell(cellPropertiesMarkup[2])}</a:tr>
</a:tbl></root>`);
  const table = kid(root, 'tbl')!;
  if (tableStyles) {
    const next = cache ?? new Map<string, Element>();
    next.set(key, table);
    if (!cache) creationTables.set(tableStyles, next);
  } else fallbackCreationTable = table;
  return table;
}

/** 写回 styleId 与新增单元格视觉共用同一来源，首次保存不会整表变色。 */
export function defaultTableEditInfo(env: Env, format: TableFormatReader): TableCreationDefaults {
  const styleId = attr(env.tableStyles, 'def')?.trim();
  const resolved = styleId ? resolvedStyle(env.tableStyles, styleId) : null;
  const parts = styleParts(resolved?.style ?? null);
  const cellPropertiesMarkup = [
    tableCellPropertiesMarkup(parts, parts?.firstRow ?? null),
    tableCellPropertiesMarkup(parts, parts?.band1H ?? null),
    tableCellPropertiesMarkup(parts, parts?.band2H ?? null),
  ] as const;
  const textBodyMarkup = parts ? CREATION_TABLE_TEXT : NEUTRAL_TABLE_TEXT;
  const table = parseTable(defaultTableSource(
    cellPropertiesMarkup, textBodyMarkup, parts ? env.tableStyles : null,
  ), {
    x: 0, y: 0, w: 1, h: 3, rot: 0, flipH: false, flipV: false,
  }, env, format);
  const [first, band1, band2] = table.rows.map((row) => row.cells[0]);
  if (!first?.editInfo?.textTemplate || !band1?.editInfo?.textTemplate
    || !band2?.editInfo?.textTemplate) {
    throw new Error('无法构造新增表格单元格模板');
  }
  return {
    ...(styleId ? { styleId } : {}), textBodyMarkup, cellPropertiesMarkup,
    firstRow: first, bandRows: [band1, band2],
  };
}
