import type { EditorSession } from '@web-ppt/editor';
import type {
  ChartDataEditor, ChartDataset, ChartPoint, ChartSeries,
} from '@web-ppt/editor/chart';

interface ChartInspectorContext {
  readonly session: EditorSession | null;
  readonly writable: boolean;
}

type Notice = (message: string, tone?: 'normal' | 'success' | 'error') => void;
type ChartModule = typeof import('@web-ppt/editor/chart');

export interface ChartInspector {
  sync(): void;
  destroy(): void;
}

const button = (label: string, action: () => void, disabled: boolean): HTMLButtonElement => {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.disabled = disabled;
  element.addEventListener('click', action);
  return element;
};

function input(
  value: string, action: (value: string) => void, disabled: boolean, type = 'text',
): HTMLInputElement {
  const element = document.createElement('input');
  element.type = type;
  element.value = value;
  element.disabled = disabled;
  element.addEventListener('change', () => action(element.value));
  return element;
}

const numeric = (value: number | null | undefined): string => value === null || value === undefined
  ? '' : String(value);
const plotLabel = (kind: ChartSeries['plotKind']): string => ({
  bar: '柱形', line: '折线', pie: '饼图', doughnut: '环形', area: '面积', scatter: '散点',
  radar: '雷达', bubble: '气泡', stock: '股价', ofPie: '复合饼图', surface: '曲面', other: '同类',
})[kind];

function numberValue(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('图表数值必须是有限数字或留空');
  return number;
}

export function createChartInspector(
  section: HTMLElement,
  context: () => ChartInspectorContext,
  notice: Notice,
): ChartInspector {
  const mount = section.querySelector<HTMLElement>('[data-chart-table]')!;
  const status = section.querySelector<HTMLElement>('[data-chart-status]')!;
  let generation = 0;
  let disposed = false;

  const selectedFrame = (): string | null => {
    const { session } = context();
    const selection = session?.editor.selection;
    if (!session || selection?.kind !== 'elements' || selection.ids.length !== 1) return null;
    return selection.ids[0];
  };

  const selectedChart = (module: ChartModule): string | null => {
    const { session } = context();
    const id = selectedFrame();
    return session && id && module.listEditableCharts(session.editor.doc).some((item) => item.id === id)
      ? id : null;
  };

  const act = (action: () => void): void => {
    try { action(); notice('图表数据已更新', 'success'); } catch (error) {
      notice(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const renderCategory = (
    data: ChartDataset, editor: ChartDataEditor, writable: boolean,
  ): HTMLElement => {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-table-wrap';
    const table = document.createElement('table');
    table.dataset.chartGrid = 'category';
    const head = table.createTHead().insertRow();
    head.append(document.createElement('th'));
    for (const series of data.series.filter((item) => item.plotKind !== 'scatter' && item.plotKind !== 'bubble')) {
      const cell = document.createElement('th');
      cell.append(input(series.name, (value) => act(() => editor.setSeriesName(
        data.chartId, series.id, value,
      )), !writable));
      cell.append(button('×', () => act(() => editor.removeSeries(data.chartId, series.id)), !writable));
      head.append(cell);
    }
    const series = data.series.filter((item) => item.plotKind !== 'scatter' && item.plotKind !== 'bubble');
    const body = table.createTBody();
    data.categories.forEach((category, rowIndex) => {
      const row = body.insertRow();
      const label = row.insertCell();
      label.append(input(category.label, (value) => act(() => editor.setCategoryLabel(
        data.chartId, category.id, value,
      )), !writable));
      label.append(button('×', () => act(() => editor.removeCategory(data.chartId, category.id)), !writable));
      for (const item of series) {
        const point = item.points.find((candidate) => candidate.id === category.id)
          ?? item.points[rowIndex];
        const cell = row.insertCell();
        if (point) cell.append(input(numeric(point.value), (value) => act(() => editor.setValue(
          data.chartId, item.id, point.id, numberValue(value),
        )), !writable, 'number'));
      }
    });
    wrapper.append(table);
    const actions = document.createElement('div');
    actions.className = 'inspector-actions';
    actions.append(button(
      '增加类别', () => act(() => { editor.addCategory(data.chartId, '新类别'); }), !writable,
    ));
    const kinds = data.plotKinds.filter((kind) => kind !== 'scatter' && kind !== 'bubble');
    for (const kind of kinds) actions.append(button(
      kinds.length === 1 ? '增加系列' : `增加${plotLabel(kind)}系列`,
      () => act(() => { editor.addSeries(data.chartId, '新系列', kind); }), !writable,
    ));
    wrapper.append(actions);
    return wrapper;
  };

  const renderXYSeries = (
    data: ChartDataset, series: ChartSeries, editor: ChartDataEditor, writable: boolean,
  ): HTMLElement => {
    const group = document.createElement('div');
    group.className = 'chart-xy-series';
    const heading = document.createElement('div');
    heading.className = 'chart-series-heading';
    heading.append(input(series.name, (value) => act(() => editor.setSeriesName(
      data.chartId, series.id, value,
    )), !writable));
    heading.append(button('删除系列', () => act(() => editor.removeSeries(data.chartId, series.id)), !writable));
    group.append(heading);
    const table = document.createElement('table');
    table.dataset.chartGrid = series.plotKind;
    const head = table.createTHead().insertRow();
    for (const title of ['X', 'Y', ...(series.plotKind === 'bubble' ? ['大小'] : []), '']) {
      const cell = document.createElement('th'); cell.textContent = title; head.append(cell);
    }
    const body = table.createTBody();
    const field = (point: ChartPoint, name: 'x' | 'value' | 'size', cell: HTMLTableCellElement): void => {
      cell.append(input(numeric(point[name]), (value) => act(() => editor.setPoint(
        data.chartId, series.id, point.id, { [name]: numberValue(value) },
      )), !writable, 'number'));
    };
    for (const point of series.points) {
      const row = body.insertRow();
      field(point, 'x', row.insertCell());
      field(point, 'value', row.insertCell());
      if (series.plotKind === 'bubble') field(point, 'size', row.insertCell());
      row.insertCell().append(button('×', () => act(() => editor.removePoint(
        data.chartId, series.id, point.id,
      )), !writable));
    }
    group.append(table, button('增加数据点', () => act(() => editor.addPoint(
      data.chartId, series.id, { x: 0, value: 0, ...(series.plotKind === 'bubble' ? { size: 1 } : {}) },
    )), !writable));
    return group;
  };

  const render = (module: ChartModule, chartId: string): void => {
    const { session, writable } = context();
    if (!session) return;
    const data = module.queryChartData(session.editor.doc, chartId);
    const editor = module.createChartDataEditor(session.editor);
    status.textContent = data.binding.mode === 'workbook'
      ? '保存时同步图表与内嵌工作簿'
      : data.binding.mode === 'cache' ? '此图表没有内嵌工作簿；仅更新图表缓存'
        : data.binding.reason ?? '此图表数据只读';
    const canEdit = writable && data.binding.mode !== 'readonly';
    const content: HTMLElement[] = [];
    if (data.kind !== 'xy') content.push(renderCategory(data, editor, canEdit));
    for (const series of data.series.filter((item) => item.plotKind === 'scatter'
      || item.plotKind === 'bubble')) content.push(renderXYSeries(data, series, editor, canEdit));
    const xyKinds = data.plotKinds.filter((kind) => kind === 'scatter' || kind === 'bubble');
    if (xyKinds.length) {
      const actions = document.createElement('div');
      actions.className = 'inspector-actions';
      for (const kind of xyKinds) actions.append(button(
        `增加${plotLabel(kind)}系列`,
        () => act(() => { editor.addSeries(data.chartId, '新系列', kind); }), !canEdit,
      ));
      content.push(actions);
    }
    mount.replaceChildren(...content);
  };

  const sync = (): void => {
    const candidateId = selectedFrame();
    section.hidden = true;
    if (!candidateId) { mount.replaceChildren(); return; }
    const current = ++generation;
    status.textContent = '正在读取图表数据…';
    void import('@web-ppt/editor/chart').then((module) => {
      if (disposed || current !== generation) return;
      const chartId = selectedChart(module);
      section.hidden = !chartId;
      if (chartId) render(module, chartId); else mount.replaceChildren();
    }).catch((error) => notice(error instanceof Error ? error.message : String(error), 'error'));
  };

  return { sync, destroy: () => { disposed = true; generation++; } };
}
