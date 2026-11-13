import { chartProjection as sourceProjection, queryChartData } from '@web-ppt/edit-core/chart';
import { renderChartXml } from '@web-ppt/core/chart-edit';
import { registerEditExtension } from '../extension-runtime';
import { assertDataObject, assertDataArray } from '../data-validation';
import type { Editor } from '../editor';
import type { EditDoc, ElementId } from '../types';
import type { ExtensionCommand, ExtensionPatch } from '../commands/types';
import { applyChartDesign } from './xml';
import { MAX_CHART_POINTS } from '../chart/validation';
import { CHART_TYPES, ERROR_VALUE_TYPES, TRENDLINE_TYPES } from './types';
import type { ChartDesign, ChartErrorBars, ChartTrendline } from './types';

export { CHART_TYPES, ERROR_VALUE_TYPES, TRENDLINE_TYPES } from './types';
export type { ChartDesign, ChartDataTable, ChartErrorBars, ChartTrendline, ChartType, ErrorValueType, TrendlineType } from './types';
const namespace = 'chart-design';
const state = (doc: EditDoc, id: ElementId) => (doc.elements[id]?.ovr.extensions?.[namespace] as { value?: string } | undefined)?.value;

function chartProjection(doc: EditDoc, id: ElementId) {
  const binding = queryChartData(doc, id).binding;
  if (binding.mode === 'readonly') throw new Error(binding.reason ?? '图表只读');
  return sourceProjection(doc, id);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optionalInt = (v: unknown, lo: number, hi: number, label: string): void => {
  if (v !== undefined && (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi)) throw new Error(`${label}无效`);
};
const COLOR = /^#[\da-f]{6}$/i;

function normalizeTrendline(v: unknown, index: number): ChartTrendline {
  assertDataObject(
    v,
    ['series', 'type', 'order', 'period', 'forward', 'backward', 'intercept', 'equation', 'rSquare', 'name', 'color'],
    `趋势线 ${index}`,
  );
  const t = v as ChartTrendline;
  if (!TRENDLINE_TYPES.includes(t.type)) throw new Error('趋势线类型无效');
  optionalInt(t.series, 0, 1024, '趋势线系列下标');
  optionalInt(t.order, 2, 6, '多项式阶数');
  optionalInt(t.period, 2, MAX_CHART_POINTS, '移动平均周期');
  for (const field of ['forward', 'backward'] as const)
    if (t[field] !== undefined && (!finite(t[field]) || (t[field] as number) < 0 || (t[field] as number) > 10000))
      throw new Error(`趋势线 ${field} 无效`);
  if (t.intercept !== undefined && !finite(t.intercept)) throw new Error('趋势线截距无效');
  for (const field of ['equation', 'rSquare'] as const)
    if (t[field] !== undefined && typeof t[field] !== 'boolean') throw new Error(`趋势线 ${field} 必须为布尔值`);
  if (t.name !== undefined && (typeof t.name !== 'string' || t.name.length > 2000)) throw new Error('趋势线名称无效');
  if (t.color !== undefined && !COLOR.test(t.color)) throw new Error('趋势线颜色需要十六进制颜色');
  return t;
}

function normalizeErrorBars(v: unknown, index: number): ChartErrorBars {
  assertDataObject(v, ['series', 'direction', 'amount', 'valueType', 'value', 'plus', 'minus', 'noEndCap', 'color'], `误差线 ${index}`);
  const e = v as ChartErrorBars;
  if (!ERROR_VALUE_TYPES.includes(e.valueType)) throw new Error('误差线取值类型无效');
  optionalInt(e.series, 0, 1024, '误差线系列下标');
  if (e.direction !== undefined && !['x', 'y', 'both'].includes(e.direction)) throw new Error('误差线方向无效');
  if (e.amount !== undefined && !['both', 'plus', 'minus'].includes(e.amount)) throw new Error('误差线量向无效');
  if (e.value !== undefined && (!finite(e.value) || (e.value as number) < 0)) throw new Error('误差线量值无效');
  for (const field of ['plus', 'minus'] as const)
    if (e[field] !== undefined) {
      assertDataArray(e[field], `误差线 ${field}`);
      const arr = e[field] as readonly unknown[];
      if (arr.length > MAX_CHART_POINTS || arr.some((x) => x !== null && !finite(x))) throw new Error(`误差线 ${field} 数组无效`);
    }
  if (e.noEndCap !== undefined && typeof e.noEndCap !== 'boolean') throw new Error('误差线 noEndCap 必须为布尔值');
  if (e.color !== undefined && !COLOR.test(e.color)) throw new Error('误差线颜色需要十六进制颜色');
  return e;
}

function normalize(value: unknown): ChartDesign {
  assertDataObject(
    value,
    ['type', 'horizontal', 'grouping', 'palette', 'legend', 'labels', 'title', 'trendlines', 'errorBars', 'dataTable'],
    '图表样式',
  );
  const design = value as ChartDesign;
  if (design.type !== undefined && !CHART_TYPES.includes(design.type)) throw new Error('图表类型无效');
  for (const field of ['horizontal', 'labels'] as const)
    if (design[field] !== undefined && typeof design[field] !== 'boolean') throw new Error(`图表 ${field} 必须为布尔值`);
  if (design.grouping !== undefined && !['standard', 'stacked', 'percentStacked'].includes(design.grouping))
    throw new Error('图表分组无效');
  if (design.legend !== undefined && !['none', 'left', 'right', 'top', 'bottom'].includes(design.legend)) throw new Error('图例位置无效');
  if (
    design.title !== undefined
    && (typeof design.title !== 'string'
      || design.title.length > 10000
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(design.title))
  )
    throw new Error('图表标题无效');
  if (design.palette !== undefined) {
    assertDataArray(design.palette, '图表配色');
    if (!design.palette.length || design.palette.length > 32 || design.palette.some((c) => !/^#[\da-f]{6}$/i.test(c)))
      throw new Error('图表配色需要 1–32 个十六进制颜色');
  }
  if (design.trendlines !== undefined) {
    assertDataArray(design.trendlines, '趋势线');
    if (design.trendlines.length > 64) throw new Error('趋势线数量超出上限');
    design.trendlines.forEach((t, i) => normalizeTrendline(t, i));
  }
  if (design.errorBars !== undefined) {
    assertDataArray(design.errorBars, '误差线');
    if (design.errorBars.length > 64) throw new Error('误差线数量超出上限');
    design.errorBars.forEach((e, i) => normalizeErrorBars(e, i));
  }
  if (design.dataTable !== undefined && design.dataTable !== null) {
    assertDataObject(design.dataTable, ['horizontalBorders', 'verticalBorders', 'outline', 'keys'], '数据表');
    const d = design.dataTable;
    for (const field of ['horizontalBorders', 'verticalBorders', 'outline', 'keys'] as const)
      if (d[field] !== undefined && typeof d[field] !== 'boolean') throw new Error(`数据表 ${field} 必须为布尔值`);
  }
  return { ...design, ...(design.palette ? { palette: design.palette.map((color) => color.toUpperCase()) } : {}) };
}

function validatePatch(doc: EditDoc, patch: ExtensionPatch): void {
  if (patch.path[0] !== 'elements' || patch.path.length !== 6 || patch.path[5] !== 'value') throw new Error('图表样式补丁路径无效');
  const projection = chartProjection(doc, patch.path[1]);
  if (patch.op === 'set') {
    if (typeof patch.value !== 'string' || patch.value.length > 20000) throw new Error('图表样式补丁值无效');
    applyChartDesign(projection.xml, normalize(JSON.parse(patch.value)));
  }
}

function command(doc: EditDoc, command: ExtensionCommand, origin: string) {
  if (doc.meta.readonly || doc.elements[command.id]?.meta.editable !== 'frame') throw new Error('对象不允许修改图表样式');
  const value = command.payload === null ? undefined : JSON.stringify(normalize(command.payload));
  const projection = chartProjection(doc, command.id);
  if (value !== undefined) applyChartDesign(projection.xml, JSON.parse(value));
  const before = state(doc, command.id),
    path = ['elements', command.id, 'ovr', 'extensions', namespace, 'value'] as const;
  if (before === value) return { forward: [], inverse: [] };
  return {
    forward: [value === undefined ? { op: 'del' as const, path, origin } : { op: 'set' as const, path, value, origin }],
    inverse: [before === undefined ? { op: 'del' as const, path, origin } : { op: 'set' as const, path, value: before, origin }],
  };
}

function generateParts(doc: EditDoc, parts: Record<string, Uint8Array>): void {
  const written = new Map<string, string>(),
    inputs = new Map<string, Uint8Array>();
  for (const record of Object.values(doc.elements)) {
    const value = state(doc, record.id);
    if (!value) continue;
    const { part } = chartProjection(doc, record.id);
    if (!parts[part]) throw new Error('生成图表缺少部件');
    const input = inputs.get(part) ?? parts[part];
    inputs.set(part, input);
    const xml = applyChartDesign(input, normalize(JSON.parse(value)));
    if (written.has(part) && written.get(part) !== xml) throw new Error('共享图表不能设置不同样式');
    written.set(part, xml);
    parts[part] = new TextEncoder().encode(xml);
  }
}

registerEditExtension(namespace, {
  command,
  validatePatch,
  project(doc, id, element) {
    const value = state(doc, id);
    if (!value || element.kind !== 'group') return element;
    const projection = chartProjection(doc, id);
    return {
      ...element,
      children: renderChartXml(applyChartDesign(projection.xml, normalize(JSON.parse(value))), element.w, element.h, projection.context),
    };
  },
  generateParts,
  copyParts: generateParts,
  materializePackage(doc, baselines, _created, changes) {
    const written = new Map<string, string>(),
      inputs = new Map<string, Uint8Array>();
    for (const record of Object.values(doc.elements)) {
      const value = state(doc, record.id);
      if (!value) continue;
      const { part } = chartProjection(doc, record.id);
      const source = baselines[part] ?? doc.package?.parts[part];
      if (!source) throw new Error('图表缺少保存来源');
      baselines[part] ??= source.slice();
      const input = inputs.get(part) ?? changes[part] ?? source;
      inputs.set(part, input);
      const xml = applyChartDesign(input, normalize(JSON.parse(value)));
      if (written.has(part) && written.get(part) !== xml) throw new Error('共享图表不能设置不同样式');
      written.set(part, xml);
      changes[part] = new TextEncoder().encode(xml);
    }
  },
});

export function queryChartDesign(doc: EditDoc, id: ElementId): ChartDesign {
  const value = state(doc, id);
  return value ? normalize(JSON.parse(value)) : {};
}
export function createChartDesignEditor(editor: Pick<Editor, 'doc' | 'exec'>) {
  return {
    query: (id: ElementId) => queryChartDesign(editor.doc, id),
    set(id: ElementId, design: ChartDesign | null) {
      return editor.exec({ type: 'Extension', namespace, id, payload: design });
    },
  };
}
