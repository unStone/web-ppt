import { querySelectionPane, type ElementRecord, type SelectionPaneItem } from '@web-ppt/edit-core';
import type { EditorSession, SelectionPane } from '@web-ppt/editor';
import { message, type SiteMessage } from './i18n/message';
import { setAttributeText, setMessage, setText } from './i18n/runtime';

const kindNames = {
  shape: '形状', image: '图片对象', group: '组合对象', table: '表格对象',
  unsupported: '不支持的对象',
} as const satisfies Record<SelectionPaneItem['kind'], string>;

function displayName(item: SelectionPaneItem, record: ElementRecord, position: number): string | SiteMessage {
  if (item.direct) return item.name;
  if (item.kind === 'shape' && item.name.trim().toLowerCase() === 'sp') {
    const text = record.ovr.text?.kind === 'empty' ? ''
      : record.ovr.text?.kind === 'flat'
        ? record.ovr.text.paragraphs.map((paragraph) => paragraph.text).join(' ')
        : record.src.kind === 'shape'
          ? record.src.text?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join(' ')
          : '';
    const preview = text?.replace(/\s+/g, ' ').trim().slice(0, 28);
    return preview ? message('文字 {position} · {preview}', { position, preview })
      : message('形状 {position}', { position });
  }
  return item.name;
}

export function bindPaneLabels(session: EditorSession, pane: SelectionPane): () => void {
  const tree = pane.element.querySelector('[role="tree"]')!;
  const search = document.querySelector<HTMLInputElement>('#objectSearch');
  const previous = document.querySelector<HTMLButtonElement>('#objectSearchPrevious');
  const next = document.querySelector<HTMLButtonElement>('#objectSearchNext');
  const count = document.querySelector<HTMLOutputElement>('#objectSearchCount');
  const controls = [search, previous, next, count];
  if (controls.some(Boolean) && controls.some((control) => !control)) {
    throw new Error('对象查找控件不完整：需要输入框、前后导航和结果计数');
  }
  const events = new AbortController();
  let matches: string[] = [];
  let currentMatch: string | null = null;
  setAttributeText(tree, 'aria-label', '当前页对象');
  function sync(): void {
    const list = querySelectionPane(session.editor.doc, pane.slideId);
    const items = new Map(list.map((item) => [item.id, item]));
    const positions = new Map(list.map((item, index) => [item.id, index + 1]));
    const query = search?.value.trim().toLocaleLowerCase() ?? '';
    matches = [];
    for (const row of tree.querySelectorAll<HTMLElement>('[data-pane-element]')) {
      const item = items.get(row.dataset.paneElement!);
      if (!item) continue;
      const record = session.editor.doc.elements[item.id];
      const label = displayName(item, record, positions.get(item.id)!);
      const name = row.querySelector<HTMLElement>('[data-pane-name]');
      if (name && typeof label === 'string'
        && (name.textContent !== label || name.hasAttribute('data-site-dynamic'))) setMessage(name, label);
      if (name && typeof label !== 'string' && name.textContent === item.name) setMessage(name, label);
      const visibleName = name?.textContent ?? item.name;
      const match = !!query && `${visibleName} ${item.name}`.toLocaleLowerCase().includes(query);
      row.toggleAttribute('data-search-match', match);
      if (match) matches.push(item.id);
      setAttributeText(row, 'aria-label', '{name}，{kind}，{visibility}，{lock}', {
        name: label, kind: message(kindNames[item.kind]),
        visibility: message(item.hidden ? '已隐藏' : '可见'),
        lock: message(item.locked ? '已锁定' : '未锁定'),
      });
      const rename = row.querySelector('input');
      if (rename) setAttributeText(rename, 'aria-label', '重命名 {name}', { name: label });
      const expand = row.querySelector('[data-pane-action="expand"]');
      if (expand) setAttributeText(expand, 'aria-label', row.getAttribute('aria-expanded') === 'true'
        ? '折叠 {name}' : '展开 {name}', { name: label });
      const actions = {
        visibility: item.hidden && !item.ownHidden ? '由上级隐藏' : item.ownHidden ? '显示对象' : '隐藏对象',
        lock: item.locked && !item.ownLocked ? '由上级锁定' : item.ownLocked ? '解锁对象' : '锁定对象',
      } as const;
      for (const [action, actionLabel] of Object.entries(actions)) {
        const button = row.querySelector(`[data-pane-action="${action}"]`)!;
        setAttributeText(button, 'title', actionLabel);
        setAttributeText(button, 'aria-label', '{action}：{name}', { action: message(actionLabel), name: label });
      }
    }
    if (!matches.includes(currentMatch ?? '')) currentMatch = null;
    for (const row of tree.querySelectorAll<HTMLElement>('[data-pane-element]')) {
      row.toggleAttribute('data-search-current', row.dataset.paneElement === currentMatch && currentMatch !== null);
    }
    if (previous && next && count) {
      previous.disabled = next.disabled = matches.length === 0;
      if (query) {
        if (matches.length) setText(count, '{count} 个匹配对象', { count: matches.length });
        else setText(count, '没有匹配对象');
      } else setText(count, '{count} 个对象', { count: list.length });
    }
  }
  function navigate(direction: 1 | -1): void {
    if (!matches.length) return;
    const index = matches.indexOf(currentMatch ?? '');
    currentMatch = matches[(index < 0 ? direction === 1 ? 0 : matches.length - 1
      : (index + direction + matches.length) % matches.length)]!;
    if (!pane.revealElement(currentMatch)) return;
    tree.querySelector<HTMLElement>(`[data-pane-element="${CSS.escape(currentMatch)}"]`)?.click();
    sync();
  }
  if (search && previous && next) {
    search.addEventListener('input', () => { currentMatch = null; sync(); }, { signal: events.signal });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { search.value = ''; currentMatch = null; sync(); }
      else if (event.key === 'Enter') { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); }
    }, { signal: events.signal });
    previous.addEventListener('click', () => navigate(-1), { signal: events.signal });
    next.addEventListener('click', () => navigate(1), { signal: events.signal });
  }
  // SDK 刷新或重建行后重新绑定；不观察本绑定写入的属性，避免标签更新触发自身。
  const observer = new MutationObserver(sync);
  observer.observe(tree, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
  sync();
  return () => {
    observer.disconnect(); events.abort();
    if (search && previous && next && count) {
      search.value = ''; count.textContent = '';
      previous.disabled = next.disabled = true;
    }
  };
}
