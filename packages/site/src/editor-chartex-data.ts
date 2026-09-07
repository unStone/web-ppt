import type { EditorSession } from '@web-ppt/editor';
import { message, type SiteNotice } from './i18n/message';
import { setText, setAttributeMessage } from './i18n/runtime';

type Module = typeof import('@web-ppt/edit-core/chart-ex');
export function chartExDataControls(module: Module, session: EditorSession, id: string,
  writable: boolean, current: () => boolean, notice: SiteNotice): HTMLElement {
  const api = module.createChartExEditor(session.editor), root = document.createElement('div');
  root.dataset.chartexEditor = '';
  const act = (action: () => void) => {
    if (!writable || !current()) return;
    try { action(); notice(message('图表数据已更新'), 'success'); }
    catch (error) { notice(message('无法更新图表数据：{detail}', { detail: error instanceof Error ? error.message : String(error) }), 'error'); }
  };
  for (const [at, dataset] of api.query(id).entries()) {
    const section = document.createElement('section'), heading = document.createElement('h4');
    setText(heading, '数据集 {index}', { index: at + 1 }); section.append(heading);
    const wrap = document.createElement('div'); wrap.className = 'chart-table-wrap';
    const table = document.createElement('table'); table.dataset.chartexData = dataset.id;
    const columns = dataset.dimensions.flatMap((dimension, index) => dimension.levels.map((values, level) => ({ dimension, index, level, values })));
    const head = table.createTHead().insertRow();
    for (const column of columns) {
      const cell = document.createElement('th');
      if (column.dimension.numeric) setText(cell, column.dimension.type === 'size' ? '面积' : '数值');
      else setText(cell, '类别层级 {index}', { index: column.level + 1 });
      head.append(cell);
    }
    head.append(document.createElement('th'));
    const body = table.createTBody(), count = columns[0]?.values.length ?? 0;
    for (let rowIndex = 0; rowIndex < count; rowIndex++) {
      const row = body.insertRow();
      for (const column of columns) {
        const input = document.createElement('input'), value = column.values[rowIndex];
        input.value = value === null ? '' : String(value); input.disabled = !writable;
        input.type = column.dimension.numeric ? 'number' : 'text';
        input.dataset.dimension = String(column.index); input.dataset.level = String(column.level); input.dataset.point = String(rowIndex);
        setAttributeMessage(input, 'aria-label', message('数据集 {data}，第 {row} 行，第 {column} 列', { data: at + 1, row: rowIndex + 1, column: row.cells.length + 1 }));
        input.addEventListener('change', () => act(() => {
          api.setCell(id, dataset.id, column.index, column.level, rowIndex,
            column.dimension.numeric ? input.value.trim() ? Number(input.value) : null : input.value);
        }));
        row.insertCell().append(input);
      }
      const remove = document.createElement('button'); remove.type = 'button'; remove.disabled = !writable;
      setText(remove, '删除数据行'); remove.addEventListener('click', () => act(() => api.removeRow(id, dataset.id, rowIndex)));
      row.insertCell().append(remove);
    }
    const add = document.createElement('button'); add.type = 'button'; add.disabled = !writable;
    setText(add, '增加数据行'); add.addEventListener('click', () => act(() => api.insertRow(id, dataset.id, count)));
    wrap.append(table); section.append(wrap, add); root.append(section);
  }
  return root;
}
