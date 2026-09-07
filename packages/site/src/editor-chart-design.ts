import type { EditorSession } from '@web-ppt/editor';
import type { ChartDataset } from '@web-ppt/editor/chart';
import type { ChartDesign } from '@web-ppt/edit-core/chart-design';
import { message, type SiteNotice } from './i18n/message';
import { setText } from './i18n/runtime';
import type { Message } from './i18n/messages';
type Label = Exclude<Message, `${string}{${string}`>;

type Module = typeof import('@web-ppt/edit-core/chart-design');

export function chartDesignControls(module: Module, session: EditorSession, data: ChartDataset,
  writable: boolean, current: () => boolean, notice: SiteNotice): HTMLElement {
  const editor = module.createChartDesignEditor(session.editor), state = editor.query(data.chartId);
  const form = document.createElement('form'); form.dataset.chartDesign = '';
  const fields: Partial<Record<keyof ChartDesign, HTMLInputElement | HTMLSelectElement>> = {};
  const field = (name: keyof ChartDesign, title: Label, control: HTMLInputElement | HTMLSelectElement) => {
    const label = document.createElement('label'), text = document.createElement('span');
    setText(text, title); control.name = name; control.disabled = !writable;
    label.append(text, control); form.append(label); fields[name] = control; return control;
  };
  const select = (name: keyof ChartDesign, title: Label, options: readonly (readonly [string, Label])[], value?: string) => {
    const control = document.createElement('select');
    for (const [key, label] of options) {
      const option = document.createElement('option'); option.value = key; setText(option, label); control.append(option);
    }
    control.value = value ?? ''; return field(name, title, control);
  };
  const input = (name: keyof ChartDesign, title: Label, value: string) => {
    const control = document.createElement('input'); control.value = value; return field(name, title, control);
  };
  const kinds = [['bar', '柱形'], ['line', '折线'], ['area', '面积'], ['pie', '饼图'],
    ['doughnut', '环形'], ['radar', '雷达'], ['scatter', '散点'], ['bubble', '气泡']] as const;
  select('type', '图表类型', [['', '保留原设置'], ...kinds.filter(([kind]) =>
    (kind === 'scatter' || kind === 'bubble') === (data.kind === 'xy') && (kind !== 'pie' || data.series.length === 1))], state.type);
  select('horizontal', '柱形方向', [['', '保留原设置'], ['false', '纵向'], ['true', '横向']], state.horizontal?.toString());
  select('grouping', '系列排列', [['', '保留原设置'], ['standard', '并列'], ['stacked', '堆积'], ['percentStacked', '百分比堆积']], state.grouping);
  select('legend', '图例位置', [['', '保留原设置'], ['none', '隐藏'], ['left', '左侧'], ['right', '右侧'], ['top', '上方'], ['bottom', '下方']], state.legend);
  select('labels', '数据标签', [['', '保留原设置'], ['true', '显示'], ['false', '隐藏']], state.labels?.toString());
  input('title', '图表标题', state.title ?? '');
  input('palette', '配色（十六进制，逗号分隔）', state.palette?.join(', ') ?? '');
  const apply = document.createElement('button'); apply.type = 'submit'; setText(apply, '应用图表样式'); apply.disabled = !writable;
  const reset = document.createElement('button'); reset.type = 'button'; setText(reset, '恢复原图表样式'); reset.disabled = !writable;
  form.append(apply, reset);
  const act = (value: ChartDesign | null) => {
    if (!current() || !writable) return;
    try { editor.set(data.chartId, value); notice(message('图表样式已更新'), 'success'); }
    catch (error) { notice(message('图表样式修改失败：{detail}', { detail: error instanceof Error ? error.message : String(error) }), 'error'); }
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const next: ChartDesign = {};
    for (const key of ['type', 'horizontal', 'grouping', 'legend', 'labels'] as const) {
      const value = fields[key]!.value;
      if (value) Object.assign(next, { [key]: key === 'horizontal' || key === 'labels' ? value === 'true' : value });
    }
    const title = fields.title!.value;
    if (title || state.title !== undefined || fields.title!.dataset.changed) next.title = title;
    const palette = fields.palette!.value.trim(); if (palette) next.palette = palette.split(/[,，\s]+/).filter(Boolean);
    act(next);
  });
  fields.title!.addEventListener('input', () => { fields.title!.dataset.changed = 'true'; });
  reset.addEventListener('click', () => act(null));
  return form;
}
