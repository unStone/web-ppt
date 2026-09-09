import { chartProjection as sourceProjection, queryChartData } from '@web-ppt/edit-core/chart';
import { renderChartXml } from '@web-ppt/core/chart-edit';
import { registerEditExtension } from '../extension-runtime';
import { assertDataObject, assertDataArray } from '../data-validation';
import type { Editor } from '../editor';
import type { EditDoc, ElementId } from '../types';
import type { ExtensionCommand, ExtensionPatch } from '../commands/types';
import { applyChartDesign } from './xml';
import { CHART_TYPES } from './types';
import type { ChartDesign } from './types';

export { CHART_TYPES } from './types';
export type { ChartDesign, ChartType } from './types';
const namespace = 'chart-design';
const state = (doc: EditDoc, id: ElementId) => (doc.elements[id]?.ovr.extensions?.[namespace] as { value?: string } | undefined)?.value;

function chartProjection(doc: EditDoc, id: ElementId) {
  const binding = queryChartData(doc, id).binding;
  if (binding.mode === 'readonly') throw new Error(binding.reason ?? '图表只读');
  return sourceProjection(doc, id);
}

function normalize(value: unknown): ChartDesign {
  assertDataObject(value, ['type', 'horizontal', 'grouping', 'palette', 'legend', 'labels', 'title'], '图表样式');
  const design = value as ChartDesign;
  if (design.type !== undefined && !CHART_TYPES.includes(design.type)) throw new Error('图表类型无效');
  for (const field of ['horizontal', 'labels'] as const) if (design[field] !== undefined && typeof design[field] !== 'boolean') throw new Error(`图表 ${field} 必须为布尔值`);
  if (design.grouping !== undefined && !['standard', 'stacked', 'percentStacked'].includes(design.grouping)) throw new Error('图表分组无效');
  if (design.legend !== undefined && !['none', 'left', 'right', 'top', 'bottom'].includes(design.legend)) throw new Error('图例位置无效');
  if (design.title !== undefined && (typeof design.title !== 'string' || design.title.length > 10000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(design.title))) throw new Error('图表标题无效');
  if (design.palette !== undefined) {
    assertDataArray(design.palette, '图表配色');
    if (!design.palette.length || design.palette.length > 32 || design.palette.some((c) => !/^#[\da-f]{6}$/i.test(c))) throw new Error('图表配色需要 1–32 个十六进制颜色');
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
  const before = state(doc, command.id), path = ['elements', command.id, 'ovr', 'extensions', namespace, 'value'] as const;
  if (before === value) return { forward: [], inverse: [] };
  return { forward: [value === undefined ? { op: 'del' as const, path, origin } : { op: 'set' as const, path, value, origin }],
    inverse: [before === undefined ? { op: 'del' as const, path, origin } : { op: 'set' as const, path, value: before, origin }] };
}

function generateParts(doc: EditDoc, parts: Record<string, Uint8Array>): void {
  const written = new Map<string, string>(), inputs = new Map<string, Uint8Array>();
  for (const record of Object.values(doc.elements)) {
    const value = state(doc, record.id); if (!value) continue;
    const { part } = chartProjection(doc, record.id);
    if (!parts[part]) throw new Error('生成图表缺少部件');
    const input = inputs.get(part) ?? parts[part]; inputs.set(part, input);
    const xml = applyChartDesign(input, normalize(JSON.parse(value)));
    if (written.has(part) && written.get(part) !== xml) throw new Error('共享图表不能设置不同样式');
    written.set(part, xml); parts[part] = new TextEncoder().encode(xml);
  }
}

registerEditExtension(namespace, { command, validatePatch,
  project(doc, id, element) {
    const value = state(doc, id); if (!value || element.kind !== 'group') return element;
    const projection = chartProjection(doc, id);
    return { ...element, children: renderChartXml(applyChartDesign(projection.xml, normalize(JSON.parse(value))), element.w, element.h, projection.context) };
  },
  generateParts,
  copyParts: generateParts,
  materializePackage(doc, baselines, _created, changes) {
    const written = new Map<string, string>(), inputs = new Map<string, Uint8Array>();
    for (const record of Object.values(doc.elements)) {
      const value = state(doc, record.id); if (!value) continue;
      const { part } = chartProjection(doc, record.id);
      const source = baselines[part] ?? doc.package?.parts[part];
      if (!source) throw new Error('图表缺少保存来源');
      baselines[part] ??= source.slice();
      const input = inputs.get(part) ?? changes[part] ?? source; inputs.set(part, input);
      const xml = applyChartDesign(input, normalize(JSON.parse(value)));
      if (written.has(part) && written.get(part) !== xml) throw new Error('共享图表不能设置不同样式');
      written.set(part, xml); changes[part] = new TextEncoder().encode(xml);
    }
  },
});

export function queryChartDesign(doc: EditDoc, id: ElementId): ChartDesign {
  const value = state(doc, id); return value ? normalize(JSON.parse(value)) : {};
}
export function createChartDesignEditor(editor: Pick<Editor, 'doc' | 'exec'>) {
  return { query: (id: ElementId) => queryChartDesign(editor.doc, id),
    set(id: ElementId, design: ChartDesign | null) { return editor.exec({ type: 'Extension', namespace, id, payload: design }); },
  };
}
