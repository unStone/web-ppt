import type { EditorSession } from '@web-ppt/editor';
import { message, type SiteNotice } from './i18n/message';
import { setText, setAttributeMessage, t } from './i18n/runtime';

export function inkControls(module: typeof import('@web-ppt/edit-core/ink'), session: EditorSession, id: string,
  writable: boolean, current: () => boolean, notice: SiteNotice, selected?: string): HTMLElement {
  const api = module.createInkEditor(session.editor), data = api.query(id), root = document.createElement('div'); root.dataset.inkEditor = '';
  const select = document.createElement('select'); select.name = 'stroke'; setAttributeMessage(select, 'aria-label', message('墨迹笔画'));
  for (const [index, stroke] of data.strokes.entries()) { const option = document.createElement('option'); option.value = stroke.id; option.textContent = `${index + 1}`; select.append(option); }
  if (selected && data.strokes.some((s) => s.id === selected)) select.value = selected;
  const act = (action: () => void) => {
    if (!writable || !current()) return;
    try { action(); notice(message('墨迹已更新'), 'success'); }
    catch (error) { notice(message('无法更新墨迹：{detail}', { detail: error instanceof Error ? error.message : String(error) }), 'error'); }
  };
  const input = (label: '笔画颜色' | '笔画宽度' | '水平移动' | '垂直移动', value: string, type = 'text') => {
    const n = document.createElement('input'); n.type = type; n.value = value; n.disabled = !writable;
    setAttributeMessage(n, 'aria-label', message(label)); return n;
  };
  const button = (label: '应用笔刷' | '移动笔画' | '删除笔画' | '应用采样点' | '还原墨迹', action: () => void) => {
    const n = document.createElement('button'); n.type = 'button'; setText(n, label); n.disabled = !writable;
    n.addEventListener('click', () => act(action)); return n;
  };
  const color = input('笔画颜色', ''), width = input('笔画宽度', '', 'number'), dx = input('水平移动', '0', 'number'), dy = input('垂直移动', '0', 'number');
  width.min = '0'; width.step = 'any'; dx.step = dy.step = 'any';
  const points = document.createElement('textarea'); points.rows = 5; points.disabled = !writable;
  setAttributeMessage(points, 'aria-label', message('采样点（每行 X,Y）'));
  const load = () => { const stroke = data.strokes.find((s) => s.id === select.value)!; color.value = stroke.color; width.value = String(stroke.width); points.value = stroke.points.map((p) => `${p.x},${p.y}`).join('\n'); };
  select.addEventListener('change', load); load();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), b = data.bounds;
  svg.setAttribute('viewBox', `${b.x} ${b.y} ${Math.max(b.width, 1)} ${Math.max(b.height, 1)}`); svg.style.cssText = 'width:100%;height:180px;touch-action:none;background:#fff;border:1px solid #cbd5e1';
  svg.setAttribute('role', 'img'); setAttributeMessage(svg, 'aria-label', message('墨迹预览，拖动可增加笔画'));
  for (const stroke of data.strokes) {
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', stroke.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' '));
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', stroke.color); path.setAttribute('stroke-width', String(stroke.width || 2)); path.setAttribute('stroke-linecap', 'round'); svg.append(path);
  }
  let drawing: Array<{ x: number; y: number; pressure: number }> | null = null, pointer: number | null = null;
  const point = (event: PointerEvent) => {
    const matrix = svg.getScreenCTM(); if (!matrix) throw new Error(t('无法定位墨迹画布'));
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()); return { x: p.x, y: p.y, pressure: event.pressure || 0.5 };
  };
  const scratch = document.createElementNS(svg.namespaceURI, 'path'); scratch.setAttribute('fill', 'none'); scratch.setAttribute('stroke-linecap', 'round'); svg.append(scratch);
  svg.addEventListener('pointerdown', (event) => {
    if (!writable || !current() || pointer !== null || event.button !== 0) return;
    event.preventDefault(); pointer = event.pointerId; drawing = [point(event)]; svg.setPointerCapture(pointer);
    scratch.setAttribute('stroke', color.value); scratch.setAttribute('stroke-width', width.value || '2');
  });
  svg.addEventListener('pointermove', (event) => {
    if (pointer !== event.pointerId || !drawing || !current()) return;
    for (const sample of event.getCoalescedEvents?.() ?? [event]) if (drawing.length < 10000) drawing.push(point(sample));
    scratch.setAttribute('d', drawing.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' '));
  });
  svg.addEventListener('pointerup', (event) => {
    if (pointer !== event.pointerId || !drawing) return;
    drawing.push(point(event)); const samples = drawing; pointer = null; drawing = null; svg.releasePointerCapture(event.pointerId);
    act(() => api.addStroke(id, samples, { color: color.value, width: Number(width.value) }));
  });
  svg.addEventListener('pointercancel', () => { pointer = null; drawing = null; scratch.removeAttribute('d'); });
  root.append(select, svg, color, width, button('应用笔刷', () => api.setStyle(id, select.value, { color: color.value, width: Number(width.value) })), dx, dy,
    button('移动笔画', () => api.translate(id, select.value, Number(dx.value), Number(dy.value))),
    points, button('应用采样点', () => {
      const original = data.strokes.find((s) => s.id === select.value)!;
      const values = points.value.trim().split('\n').map((line, i) => {
        const pair = line.split(','); if (pair.length !== 2 || pair.some((v) => !v.trim())) throw new Error(t('采样点必须是 X,Y'));
        return { x: Number(pair[0]), y: Number(pair[1]), values: [...(original.points[i]?.values ?? [])] };
      }); api.setPoints(id, select.value, values);
    }), button('删除笔画', () => api.removeStroke(id, select.value)), button('还原墨迹', () => api.reset(id)));
  return root;
}
