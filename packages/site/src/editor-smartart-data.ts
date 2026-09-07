import type { EditorSession } from '@web-ppt/editor';
import { message, type SiteNotice } from './i18n/message';
import { setText, setAttributeMessage, t } from './i18n/runtime';

type Module = typeof import('@web-ppt/edit-core/smartart');
export function smartArtControls(module: Module, session: EditorSession, id: string, writable: boolean,
  current: () => boolean, notice: SiteNotice, selectedId?: string): HTMLElement {
  const api = module.createSmartArtEditor(session.editor), nodes = api.query(id);
  const root = document.createElement('div'); root.dataset.smartartEditor = '';
  const select = document.createElement('select'); select.name = 'node';
  setAttributeMessage(select, 'aria-label', message('SmartArt 节点'));
  for (const [index, node] of nodes.entries()) {
    const option = document.createElement('option'); option.value = node.id;
    option.textContent = `${index + 1}. ${node.text || t('空节点')}`; select.append(option);
  }
  select.value = nodes.some((n) => n.id === selectedId) ? selectedId! : nodes[0].id;
  const form = document.createElement('form');
  const act = (action: () => void) => {
    if (!writable || !current()) return;
    try { action(); notice(message('SmartArt 已更新'), 'success'); }
    catch (error) { notice(message('SmartArt 修改失败：{detail}', { detail: error instanceof Error ? error.message : String(error) }), 'error'); }
  };
  const render = () => {
    const selected = nodes.find((n) => n.id === select.value)!;
    const text = document.createElement('textarea'); text.name = 'text'; text.value = selected.text; text.disabled = !writable;
    setAttributeMessage(text, 'aria-label', message('节点文字'));
    const parent = document.createElement('select'); parent.name = 'parent'; parent.disabled = !writable;
    setAttributeMessage(parent, 'aria-label', message('父节点'));
    const top = document.createElement('option'); top.value = ''; setText(top, '顶层节点'); parent.append(top);
    const descendant = (node: typeof selected) => {
      let candidate: typeof selected | undefined = node;
      while (candidate) { if (candidate.id === selected.id) return true; candidate = nodes.find((n) => n.id === candidate?.parentId); }
      return false;
    };
    for (const node of nodes.filter((n) => !descendant(n))) {
      const option = document.createElement('option'); option.value = node.id; option.textContent = node.text || t('空节点'); parent.append(option);
    }
    parent.value = selected.parentId ?? '';
    parent.addEventListener('change', () => act(() => api.moveNode(id, selected.id, parent.value || null)));
    const button = (label: '应用节点文字' | '增加同级节点' | '增加子节点' | '删除节点及后代' | '节点上移' | '节点下移', action: () => void) => {
      const button = document.createElement('button'); button.type = 'button'; button.disabled = !writable; setText(button, label);
      button.addEventListener('click', () => act(action)); return button;
    };
    const move = (direction: number) => {
      const siblings = nodes.filter((n) => n.parentId === selected.parentId), index = siblings.findIndex((n) => n.id === selected.id);
      if (index + direction < 0 || index + direction >= siblings.length) return;
      const before = direction < 0 ? siblings[index - 1].id : siblings[index + 2]?.id;
      api.moveNode(id, selected.id, selected.parentId, before);
    };
    form.replaceChildren(text, parent, button('应用节点文字', () => api.setText(id, selected.id, text.value)),
      button('增加同级节点', () => { api.addNode(id, selected.parentId, t('新节点')); }),
      button('增加子节点', () => { api.addNode(id, selected.id, t('新节点')); }),
      button('节点上移', () => move(-1)), button('节点下移', () => move(1)),
      button('删除节点及后代', () => api.removeNode(id, selected.id)));
  };
  select.addEventListener('change', render); form.addEventListener('submit', (e) => e.preventDefault());
  render(); root.append(select, form); return root;
}
