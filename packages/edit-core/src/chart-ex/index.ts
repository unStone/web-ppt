import { readChartExData, renderChartExXml } from '@web-ppt/core/chart-ex';
import type { ChartExDataset } from '@web-ppt/core/chart-ex';
import { sourcePartBytes } from '@web-ppt/edit-core';
import type { Editor, EditDoc, ElementId, ExtensionCommand, ExtensionPatch } from '@web-ppt/edit-core';
import { registerEditExtension } from '../extension-runtime';
import { assertDataObject, assertDataArray } from '../data-validation';
import { objectSource } from '../object-source';
import { CX, R, writeChartExData } from './xml';
import type { ChartExState } from './xml';
import { chartExWorkbook } from './workbook';
import { parseXmlTree, xmlElementChildren } from '@web-ppt/edit-core/xml';

export type { ChartExDataset } from '@web-ppt/core/chart-ex';
const namespace = 'chart-ex-data';
const stored = (doc: EditDoc, id: ElementId) => (doc.elements[id]?.ovr.extensions?.[namespace] as { value?: string } | undefined)?.value;
const source = (doc: EditDoc, id: ElementId) => {
  const value = objectSource(doc, id, CX); if (!value) throw new Error('对象没有现代图表数据'); return value;
};
const sourceData = (doc: EditDoc, id: ElementId) => {
  const original = source(doc, id); return readChartExData(original.xml, original.context);
};
function current(doc: EditDoc, id: ElementId): ChartExState {
  const value = stored(doc, id); if (value) return JSON.parse(value);
  const data = sourceData(doc, id);
  return { data, rows: Object.fromEntries(data.map((d) => [d.id,
    Array.from({ length: d.dimensions[0]?.levels[0]?.length ?? 0 }, (_, i) => i)])) };
}
function normalize(doc: EditDoc, id: ElementId, value: unknown): ChartExState {
  assertDataObject(value, ['data', 'rows'], 'ChartEx 编辑数据');
  const state = value as ChartExState, original = sourceData(doc, id);
  assertDataArray(state.data, 'ChartEx 数据集');
  assertDataObject(state.rows, original.map((d) => d.id), 'ChartEx 行映射');
  if (state.data.length !== original.length) throw new Error('ChartEx 数据集结构不同');
  let cells = 0;
  for (const [index, data] of state.data.entries()) {
    const base = original[index];
    assertDataObject(data, ['id', 'dimensions'], 'ChartEx 数据集');
    if (data.id !== base.id) throw new Error('ChartEx 数据身份不同');
    assertDataArray(data.dimensions, 'ChartEx 维度');
    if (data.dimensions.length !== base.dimensions.length) throw new Error('ChartEx 维度结构不同');
    const rows = state.rows[data.id]; assertDataArray(rows, 'ChartEx 行映射');
    const sourceCount = base.dimensions[0]?.levels[0]?.length ?? 0;
    if (rows.length > 10000 || new Set(rows.filter((r) => r !== null)).size !== rows.filter((r) => r !== null).length
      || rows.some((r) => r !== null && (!Number.isInteger(r) || r < 0 || r >= sourceCount))) throw new Error('ChartEx 行映射无效');
    for (const [at, dimension] of data.dimensions.entries()) {
      const originalDimension = base.dimensions[at];
      assertDataObject(dimension, ['type', 'numeric', 'source', 'levels', 'format'], 'ChartEx 维度');
      for (const field of ['type', 'numeric', 'source', 'format'] as const) if (dimension[field] !== originalDimension[field]) throw new Error('ChartEx 维度元数据不能改写');
      assertDataArray(dimension.levels, 'ChartEx 层级');
      if (dimension.levels.length !== originalDimension.levels.length) throw new Error('ChartEx 层级结构不同');
      for (const level of dimension.levels) {
        assertDataArray(level, 'ChartEx 数据点');
        if (level.length !== rows.length || (cells += level.length) > 100000) throw new Error('ChartEx 数据长度无效');
        for (const cell of level) if (cell !== null && (dimension.numeric ? typeof cell !== 'number' || !Number.isFinite(cell)
          : typeof cell !== 'string' || cell.length > 32767 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(cell))) throw new Error('ChartEx 数据值无效');
      }
    }
  }
  const originalChart = source(doc, id), element = doc.elements[id].src;
  if (!renderChartExXml(writeChartExData(originalChart.xml, state), element.w, element.h, originalChart.context).length) {
    throw new Error('数据不满足当前图表布局；分层图需要完整类别路径和有效数值');
  }
  return structuredClone(state);
}
function validatePatch(doc: EditDoc, patch: ExtensionPatch) {
  if (patch.path[0] !== 'elements' || patch.path.length !== 6 || patch.path[5] !== 'value') throw new Error('ChartEx 补丁路径无效');
  if (patch.op === 'set') {
    if (typeof patch.value !== 'string' || patch.value.length > 1000000) throw new Error('ChartEx 补丁值无效');
    normalize(doc, patch.path[1], JSON.parse(patch.value));
  } else source(doc, patch.path[1]);
}
function command(doc: EditDoc, cmd: ExtensionCommand, origin: string) {
  if (doc.meta.readonly) throw new Error('文稿只读');
  const value = cmd.payload === null ? undefined : JSON.stringify(normalize(doc, cmd.id, cmd.payload));
  const before = stored(doc, cmd.id), path = ['elements', cmd.id, 'ovr', 'extensions', namespace, 'value'] as const;
  if (before === value) return { forward: [], inverse: [] };
  const patch = (v: string | undefined) => v === undefined ? { op: 'del' as const, path, origin } : { op: 'set' as const, path, value: v, origin };
  return { forward: [patch(value)], inverse: [patch(before)] };
}
function save(doc: EditDoc) {
  const changes: Record<string, Uint8Array> = {}, baselines: Record<string, Uint8Array> = {}, seen = new Map<string, string | undefined>();
  for (const record of Object.values(doc.elements)) {
    const original = objectSource(doc, record.id, CX); if (!original) continue;
    const value = stored(doc, record.id), tracked = !!doc.saveState.baselines[original.part];
    if (!value && !tracked) continue;
    if (seen.has(original.part)) {
      if (seen.get(original.part) !== value) throw new Error('共享 ChartEx 不能设置不同数据');
      continue;
    }
    seen.set(original.part, value);
    baselines[original.part] = sourcePartBytes(doc, original.part)!;
    const root = parseXmlTree(original.xml).root;
    const chartData = xmlElementChildren(root).find((n) => n.namespaceUri === CX && n.localName === 'chartData');
    const external = chartData && xmlElementChildren(chartData).find((n) => n.namespaceUri === CX && n.localName === 'externalData');
    const rid = external?.attributes.find((a) => a.localName === 'id' && a.namespaceUri === R)?.value;
    const relation = rid && original.context.rels[rid], part = relation && relation.type === `${R}/package` ? relation.target : null;
    const workbook = part ? sourcePartBytes(doc, part) : undefined;
    if (part && workbook) baselines[part] = workbook;
    if (!value) {
      changes[original.part] = baselines[original.part];
      if (part && workbook && !changes[part]) changes[part] = workbook;
      continue;
    }
    const state = normalize(doc, record.id, JSON.parse(value));
    const updated = workbook && chartExWorkbook(changes[part!] ?? workbook, state.data);
    if (updated && part) changes[part] = updated.bytes;
    changes[original.part] = new TextEncoder().encode(writeChartExData(original.xml, state, updated?.formula));
  }
  return { changes, baselines };
}
registerEditExtension(namespace, { command, validatePatch,
  project(doc, id, element) {
    if (element.kind !== 'group') return element;
    const original = source(doc, id), state = normalize(doc, id, current(doc, id));
    const children = renderChartExXml(writeChartExData(original.xml, state), element.w, element.h, original.context);
    if (!children.length) throw new Error('ChartEx 数据无法形成当前布局');
    return { ...element, children };
  },
  beforeSave: save,
  generateParts(doc, parts) { Object.assign(parts, save(doc).changes); },
});

export function listEditableChartEx(doc: EditDoc) {
  return Object.values(doc.elements).filter((record) => objectSource(doc, record.id, CX))
    .map((record) => ({ id: record.id, name: record.src.name ?? 'ChartEx' }));
}
export function queryChartExData(doc: EditDoc, id: ElementId): ChartExDataset[] { return current(doc, id).data; }
export function createChartExEditor(editor: Pick<Editor, 'doc' | 'exec'>) {
  const change = (id: ElementId, operation: (state: ChartExState) => void) => {
    const state = current(editor.doc, id); operation(state);
    editor.exec({ type: 'Extension', namespace, id, payload: state });
  };
  const dataset = (state: ChartExState, id: string) => {
    const data = state.data.find((d) => d.id === id); if (!data) throw new Error('ChartEx 数据集不存在'); return data;
  };
  return {
    query: (id: ElementId) => queryChartExData(editor.doc, id),
    setCell(id: ElementId, dataId: string, dimension: number, level: number, point: number, value: string | number | null) {
      change(id, (state) => {
        const values = dataset(state, dataId).dimensions[dimension]?.levels[level];
        if (!values || !Number.isInteger(point) || point < 0 || point >= values.length) throw new Error('ChartEx 数据坐标越界');
        values[point] = value;
      });
    },
    insertRow(id: ElementId, dataId: string, index: number) {
      change(id, (state) => {
        const data = dataset(state, dataId), rows = state.rows[dataId];
        if (!Number.isInteger(index) || index < 0 || index > rows.length) throw new Error('ChartEx 行号越界');
        const labels = new Set(data.dimensions.flatMap((d) => d.levels.flat()));
        let number = rows.length + 1; while (labels.has(`新数据 ${number}`)) number++;
        rows.splice(index, 0, null);
        for (const d of data.dimensions) for (const level of d.levels) level.splice(index, 0, d.numeric ? null : `新数据 ${number}`);
      });
    },
    removeRow(id: ElementId, dataId: string, index: number) {
      change(id, (state) => {
        const data = dataset(state, dataId), rows = state.rows[dataId];
        if (!Number.isInteger(index) || index < 0 || index >= rows.length) throw new Error('ChartEx 行号越界');
        rows.splice(index, 1); for (const d of data.dimensions) for (const level of d.levels) level.splice(index, 1);
      });
    },
    reset(id: ElementId) { editor.exec({ type: 'Extension', namespace, id, payload: null }); },
  };
}
