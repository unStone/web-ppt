import { message } from './i18n/message';
import { setMessage, setAttributeMessage } from './i18n/runtime';

export function categoryLevelCell(
  row: HTMLTableRowElement, level: number, depth: number, value: string | null,
  writable: boolean, change: (value: string | null) => void,
): HTMLTableCellElement {
  const cell = row.insertCell(), input = document.createElement('input');
  input.type = 'text'; input.value = value ?? ''; input.dataset.chartLevel = String(level);
  input.disabled = !writable || value === null;
  setAttributeMessage(input, 'aria-label', message('第 {level} 级类别', { level: level + 1 }));
  if (value === null) setAttributeMessage(input, 'placeholder', level < depth - 1 ? message('延续前组') : message('无标签'));
  input.addEventListener('change', () => change(input.value));
  const label = document.createElement('label'), empty = document.createElement('input'), text = document.createElement('span');
  label.className = 'chart-level-empty';
  empty.type = 'checkbox'; empty.checked = value === null; empty.disabled = !writable;
  empty.dataset.chartEmpty = String(level);
  setAttributeMessage(empty, 'aria-label', message('第 {level} 级空槽', { level: level + 1 }));
  setMessage(text, message('空槽'));
  empty.addEventListener('change', () => change(empty.checked ? null : ''));
  label.append(empty, text); cell.append(input, label);
  return cell;
}
