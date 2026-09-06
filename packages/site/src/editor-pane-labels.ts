import { querySelectionPane, type SelectionPaneItem } from '@web-ppt/edit-core';
import type { EditorSession, SelectionPane } from '@web-ppt/editor';
import { message } from './i18n/message';
import { setAttributeText } from './i18n/runtime';

const kindNames = {
  shape: '形状', image: '图片对象', group: '组合对象', table: '表格对象',
  unsupported: '不支持的对象',
} as const satisfies Record<SelectionPaneItem['kind'], string>;

export function bindPaneLabels(session: EditorSession, pane: SelectionPane): () => void {
  const tree = pane.element.querySelector('[role="tree"]')!;
  setAttributeText(tree, 'aria-label', '当前页对象');
  function sync(): void {
    const items = new Map(querySelectionPane(session.editor.doc, pane.slideId).map((item) => [item.id, item]));
    for (const row of tree.querySelectorAll<HTMLElement>('[data-pane-element]')) {
      const item = items.get(row.dataset.paneElement!);
      if (!item) continue;
      setAttributeText(row, 'aria-label', '{name}，{kind}，{visibility}，{lock}', {
        name: item.name, kind: message(kindNames[item.kind]),
        visibility: message(item.hidden ? '已隐藏' : '可见'),
        lock: message(item.locked ? '已锁定' : '未锁定'),
      });
      const rename = row.querySelector('input');
      if (rename) setAttributeText(rename, 'aria-label', '重命名 {name}', { name: item.name });
      const expand = row.querySelector('[data-pane-action="expand"]');
      if (expand) setAttributeText(expand, 'aria-label', row.getAttribute('aria-expanded') === 'true'
        ? '折叠 {name}' : '展开 {name}', { name: item.name });
      const actions = {
        visibility: item.hidden && !item.ownHidden ? '由上级隐藏' : item.ownHidden ? '显示对象' : '隐藏对象',
        lock: item.locked && !item.ownLocked ? '由上级锁定' : item.ownLocked ? '解锁对象' : '锁定对象',
      } as const;
      for (const [action, label] of Object.entries(actions)) {
        const button = row.querySelector(`[data-pane-action="${action}"]`)!;
        setAttributeText(button, 'title', label);
        setAttributeText(button, 'aria-label', '{action}：{name}', { action: message(label), name: item.name });
      }
    }
  }
  // SDK 刷新或重建行后重新绑定；不观察本绑定写入的属性，避免标签更新触发自身。
  const observer = new MutationObserver(sync);
  observer.observe(tree, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
  sync();
  return () => observer.disconnect();
}
