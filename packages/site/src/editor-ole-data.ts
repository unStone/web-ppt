import type { EditorSession } from '@web-ppt/editor';
import type { OleCellValue, OleRichRun } from '@web-ppt/edit-core/ole';
import { message, type SiteMessage, type SiteNotice } from './i18n/message';
import { setText, setAttributeMessage, t } from './i18n/runtime';

const HEX6 = /^[0-9a-fA-F]{6}$/;

/** 六位十六进制颜色输入；空串表示不修改该字段。 */
function colorInput(label: SiteMessage, writable: boolean): HTMLInputElement {
  const input = document.createElement('input');
  input.placeholder = 'RRGGBB'; input.size = 8;
  setAttributeMessage(input, 'aria-label', label);
  input.disabled = !writable;
  return input;
}

/** 读颜色输入；非空且非六位十六进制时抛错（fast-fail，不静默忽略输入）。 */
function readColor(input: HTMLInputElement): string | undefined {
  const value = input.value.trim();
  if (!value) return undefined;
  if (!HEX6.test(value)) throw new Error(t('颜色须为六位十六进制'));
  return value.toLowerCase();
}

export function oleControls(module: typeof import('@web-ppt/edit-core/ole'), session: EditorSession, id: string,
  writable: boolean, current: () => boolean, notice: SiteNotice): HTMLElement {
  const root = document.createElement('div'); root.dataset.oleEditor = '';
  const api = module.createOleEditor(session.editor), content = api.query(id);
  const act = (action: () => void) => {
    if (!writable || !current()) return;
    try { action(); notice(message('嵌入内容已更新'), 'success'); }
    catch (error) { notice(message('无法更新嵌入内容：{detail}', { detail: error instanceof Error ? error.message : String(error) }), 'error'); }
  };
  type OleButtonLabel = '应用样式' | '清除样式' | '添加片段' | '设为富文本' | '清除富文本保留文字' | '写入单元格' | '还原嵌入内容';
  const button = (label: OleButtonLabel, action: () => void) => {
    const n = document.createElement('button'); n.type = 'button'; setText(n, label); n.disabled = !writable;
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
      // run 级编辑：只改目标片段的文字，相邻片段的粗斜体等格式原样保留（票据 014）
      if (p.editable && p.runs.length > 1) {
        const runs = document.createElement('div'); runs.className = 'ole-runs';
        for (const run of p.runs) {
          const chip = document.createElement('label'); chip.className = 'ole-run';
          const badges = [run.format.bold ? 'B' : '', run.format.italic ? 'I' : '', run.format.underline ? 'U' : '']
            .filter(Boolean).join('');
          const name = document.createElement('span');
          setText(name, '文字片段 {number}{badges}', { number: String(run.index + 1), badges: badges ? ` · ${badges}` : '' });
          const piece = document.createElement('input'); piece.value = run.text;
          setAttributeMessage(piece, 'aria-label', message('段落 {paragraph} 文字片段 {number}',
            { paragraph: String(p.index + 1), number: String(run.index + 1) }));
          piece.disabled = !writable;
          piece.addEventListener('change', () => act(() => api.setRun(id, p.index, run.index, piece.value)));
          chip.append(name, piece); runs.append(chip);
        }
        root.append(runs);
      }
    }
  } else {
    const select = document.createElement('select'); select.name = 'sheet';
    setAttributeMessage(select, 'aria-label', message('嵌入工作表'));
    for (const sheet of content.sheets) { const option = document.createElement('option'); option.value = sheet.id; option.textContent = sheet.name; select.append(option); }
    let selectedRef = '';
    const selected = document.createElement('p');
    const renderSelected = () => {
      selected.textContent = selectedRef ? t('选定单元格 {ref}', { ref: selectedRef }) : t('请先在表格中选择单元格');
    };
    const requireSelected = () => {
      if (!selectedRef) throw new Error(t('请先在表格中选择单元格'));
      return selectedRef;
    };
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
          input.addEventListener('focus', () => { selectedRef = ref; renderSelected(); });
          input.addEventListener('change', () => act(() => api.setCell(id, sheet.id, ref,
            typeof cell?.value === 'number' && input.value.trim() ? Number(input.value) : input.value || null)));
          td.append(input); tr.append(td);
        }
        table.append(tr);
      }
      cells.replaceChildren(table);
    };
    select.addEventListener('change', () => { selectedRef = ''; renderSelected(); render(); });
    root.append(select, cells); render();

    // 单元格样式：空字段保持原值；清除则移除样式索引（票据 015）
    const styleForm = document.createElement('form'); styleForm.className = 'ole-style';
    const styleHeading = document.createElement('p'); setText(styleHeading, '选定单元格样式'); styleForm.append(styleHeading);
    const fontName = document.createElement('input'); fontName.placeholder = t('字体名称');
    setAttributeMessage(fontName, 'aria-label', message('字体名称')); fontName.disabled = !writable;
    const fontSize = document.createElement('input'); fontSize.placeholder = t('字号'); fontSize.size = 4; fontSize.inputMode = 'numeric';
    setAttributeMessage(fontSize, 'aria-label', message('字号')); fontSize.disabled = !writable;
    const checkbox = (label: string, ariaLabel: SiteMessage) => {
      const box = document.createElement('input'); box.type = 'checkbox'; box.disabled = !writable;
      const wrap = document.createElement('label'); wrap.append(box, document.createTextNode(label));
      setAttributeMessage(box, 'aria-label', ariaLabel);
      return { box, wrap };
    };
    const bold = checkbox(t('粗体'), message('粗体')), italic = checkbox(t('斜体'), message('斜体'));    const fontColor = colorInput(message('字色'), writable);
    const fillColor = colorInput(message('填充颜色'), writable);
    const borderColor = colorInput(message('边框颜色'), writable);
    const borderStyle = document.createElement('select');
    setAttributeMessage(borderStyle, 'aria-label', message('边框样式')); borderStyle.disabled = !writable;
    const BORDER_KINDS = { thin: '细边框', medium: '中边框', thick: '粗边框', dashed: '虚线边框', dotted: '点线边框', double: '双线边框' } as const;
    const keepBorder = document.createElement('option'); keepBorder.value = ''; setText(keepBorder, '不修改边框'); borderStyle.append(keepBorder);
    for (const [kind, label] of Object.entries(BORDER_KINDS)) {
      const option = document.createElement('option'); option.value = kind; setText(option, label); borderStyle.append(option);
    }
    styleForm.append(fontName, fontSize, bold.wrap, italic.wrap, fontColor, fillColor, borderColor, borderStyle);
    styleForm.append(button('应用样式', () => {
      const ref = requireSelected();
      const size = fontSize.value.trim() ? Number(fontSize.value) : undefined;
      if (size !== undefined && (!Number.isFinite(size) || size <= 0)) throw new Error(t('字号必须是正数'));
      const color = readColor(fontColor);
      api.setCellStyle(id, select.value, ref, {
        font: {
          ...(fontName.value.trim() ? { name: fontName.value.trim() } : {}),
          ...(size !== undefined ? { size } : {}),
          ...(bold.box.checked || italic.box.checked ? { bold: bold.box.checked || undefined, italic: italic.box.checked || undefined } : {}),
          ...(color ? { color } : {}),
        },
        ...(readColor(fillColor) ? { fill: { color: readColor(fillColor)! } } : {}),
        ...((readColor(borderColor) || borderStyle.value) ? { border: {
          ...(readColor(borderColor) ? { color: readColor(borderColor)! } : {}),
          ...(borderStyle.value ? { style: borderStyle.value } : {}),
        } } : {}),
      });
    }));
    styleForm.append(button('清除样式', () => api.setCellStyle(id, select.value, requireSelected(), null)));
    styleForm.addEventListener('submit', (event) => event.preventDefault());
    root.append(styleForm);

    // 富文本：按片段设置粗斜体 / 颜色；清除改回普通字符串并保留拼接文字（票据 015）
    const richForm = document.createElement('form'); richForm.className = 'ole-rich';
    const richHeading = document.createElement('p'); setText(richHeading, '选定单元格富文本'); richForm.append(richHeading);
    const richRuns = document.createElement('div');
    const richRow = () => {
      const row = document.createElement('div');
      const text = document.createElement('input'); text.placeholder = t('文字片段');
      setAttributeMessage(text, 'aria-label', message('富文本片段文字')); text.disabled = !writable;
      const mark = (label: string, ariaLabel: SiteMessage) => {
        const box = document.createElement('input'); box.type = 'checkbox'; box.disabled = !writable;
        setAttributeMessage(box, 'aria-label', ariaLabel);
        const wrap = document.createElement('label'); wrap.append(box, document.createTextNode(label));
        return { box, wrap };
      };
      const b = mark('B', message('粗体')), i = mark('I', message('斜体')), u = mark('U', message('下划线'));
      const color = colorInput(message('字色'), writable);
      row.append(text, b.wrap, i.wrap, u.wrap, color); richRuns.append(row);
      return { read: (): OleRichRun => ({
        text: text.value,
        ...(b.box.checked ? { bold: true } : {}), ...(i.box.checked ? { italic: true } : {}),
        ...(u.box.checked ? { underline: true } : {}), ...(readColor(color) ? { color: readColor(color) } : {}),
      }) };
    };
    const readers: (() => OleRichRun)[] = [richRow().read];
    richForm.append(richRuns, button('添加片段', () => { readers.push(richRow().read); }));
    richForm.append(button('设为富文本', () => {
      const pieces = readers.map((read) => read()).filter((piece) => piece.text !== '');
      if (!pieces.length) throw new Error(t('至少一个文字片段'));
      api.setCellRichText(id, select.value, requireSelected(), pieces);
    }));
    richForm.append(button('清除富文本保留文字', () => api.setCellRichText(id, select.value, requireSelected(), null)));
    richForm.addEventListener('submit', (event) => event.preventDefault());
    root.append(richForm, selected); renderSelected();

    const form = document.createElement('form'), address = document.createElement('input'), value = document.createElement('input'), type = document.createElement('select');
    address.name = 'address'; address.placeholder = 'A1'; address.value = 'A1'; setAttributeMessage(address, 'aria-label', message('单元格地址'));
    value.name = 'value'; setAttributeMessage(value, 'aria-label', message('单元格内容'));
    for (const [kind, label] of [['string', '文本'], ['number', '数字'], ['boolean', '布尔值'], ['null', '清空']] as const) {
      const option = document.createElement('option'); option.value = kind; setText(option, label); type.append(option);
    }
    setAttributeMessage(type, 'aria-label', message('单元格类型'));
    for (const n of [address, value, type]) n.disabled = !writable;
    const apply = button('写入单元格', () => {
      let next: OleCellValue = value.value;
      if (type.value === 'number') { if (!value.value.trim()) throw new Error(t('请输入数字')); next = Number(value.value); }
      if (type.value === 'boolean') { if (!['true', 'false'].includes(value.value)) throw new Error(t('布尔值填写 true 或 false')); next = value.value === 'true'; }
      if (type.value === 'null') next = null;
      api.setCell(id, select.value, address.value.toUpperCase(), next);
    });
    form.addEventListener('submit', (event) => { event.preventDefault(); apply.click(); });
    form.append(address, type, value, apply); root.append(form);
  }
  root.append(button('还原嵌入内容', () => api.reset(id)));
  return root;
}
