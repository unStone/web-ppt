import type { EditorSession } from '@web-ppt/editor';
import type { OleCellValue } from '@web-ppt/edit-core/ole';
import { message, type SiteNotice } from './i18n/message';
import { setText, setAttributeMessage, t } from './i18n/runtime';

export function oleControls(module: typeof import('@web-ppt/edit-core/ole'), session: EditorSession, id: string,
  writable: boolean, current: () => boolean, notice: SiteNotice): HTMLElement {
  const root = document.createElement('div'); root.dataset.oleEditor = '';
  const api = module.createOleEditor(session.editor), content = api.query(id);
  const act = (action: () => void) => {
    if (!writable || !current()) return;
    try { action(); notice(message('嵌入内容已更新'), 'success'); }
    catch (error) { notice(message('无法更新嵌入内容：{detail}', { detail: error instanceof Error ? error.message : String(error) }), 'error'); }
  };
  const button = (label: string, action: () => void) => {
    const n = document.createElement('button'); n.type = 'button'; n.textContent = label; n.disabled = !writable;
    n.addEventListener('click', () => act(action)); return n;
  };
  if (content.kind === 'docx') {
    for (const p of content.paragraphs) {
      const label = document.createElement('label'); label.textContent = String(p.index + 1);
      const input = document.createElement('textarea'); input.value = p.text; input.rows = 2;
      setAttributeMessage(input, 'aria-label', message('文档段落 {number}', { number: String(p.index + 1) }));
      input.disabled = !writable || !p.editable;
      input.addEventListener('change', () => act(() => api.setParagraph(id, p.index, input.value)));
      label.append(input); root.append(label);
    }
  } else {
    const select = document.createElement('select'); select.name = 'sheet';
    setAttributeMessage(select, 'aria-label', message('嵌入工作表'));
    for (const sheet of content.sheets) { const option = document.createElement('option'); option.value = sheet.id; option.textContent = sheet.name; select.append(option); }
    const cells = document.createElement('div'); cells.style.overflow = 'auto'; cells.style.maxHeight = '340px';
    const render = () => {
      const sheet = content.sheets.find((s) => s.id === select.value); if (!sheet) return;
      const table = document.createElement('table'); table.className = 'chart-data-table';
      const maxRow = Math.min(20, Math.max(4, ...sheet.cells.map((c) => module.cellPosition(c.ref)[0])));
      const maxCol = Math.min(8, Math.max(3, ...sheet.cells.map((c) => module.cellPosition(c.ref)[1])));
      for (let row = 1; row <= maxRow; row++) {
        const tr = document.createElement('tr');
        for (let col = 1; col <= maxCol; col++) {
          const ref = String.fromCharCode(64 + col) + row, cell = sheet.cells.find((c) => c.ref === ref), td = document.createElement('td');
          const input = document.createElement('input'); input.value = cell?.formula !== undefined ? '=' + cell.formula : cell?.value == null ? '' : String(cell.value);
          input.setAttribute('aria-label', `${sheet.name} ${ref}`); input.disabled = !writable || cell?.formula !== undefined;
          input.addEventListener('change', () => act(() => api.setCell(id, sheet.id, ref,
            typeof cell?.value === 'number' && input.value.trim() ? Number(input.value) : input.value || null)));
          td.append(input); tr.append(td);
        }
        table.append(tr);
      }
      cells.replaceChildren(table);
    };
    select.addEventListener('change', render); root.append(select, cells); render();
    const form = document.createElement('form'), address = document.createElement('input'), value = document.createElement('input'), type = document.createElement('select');
    address.name = 'address'; address.placeholder = 'A1'; address.value = 'A1'; setAttributeMessage(address, 'aria-label', message('单元格地址'));
    value.name = 'value'; setAttributeMessage(value, 'aria-label', message('单元格内容'));
    for (const [kind, label] of [['string', '文本'], ['number', '数字'], ['boolean', '布尔值'], ['null', '清空']] as const) {
      const option = document.createElement('option'); option.value = kind; setText(option, label); type.append(option);
    }
    setAttributeMessage(type, 'aria-label', message('单元格类型'));
    for (const n of [address, value, type]) n.disabled = !writable;
    const apply = button(t('写入单元格'), () => {
      let next: OleCellValue = value.value;
      if (type.value === 'number') { if (!value.value.trim()) throw new Error(t('请输入数字')); next = Number(value.value); }
      if (type.value === 'boolean') { if (!['true', 'false'].includes(value.value)) throw new Error(t('布尔值填写 true 或 false')); next = value.value === 'true'; }
      if (type.value === 'null') next = null;
      api.setCell(id, select.value, address.value.toUpperCase(), next);
    });
    form.addEventListener('submit', (event) => { event.preventDefault(); apply.click(); });
    form.append(address, type, value, apply); root.append(form);
  }
  root.append(button(t('还原嵌入内容'), () => api.reset(id)));
  return root;
}
