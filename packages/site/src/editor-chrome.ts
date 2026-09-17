import { activateEditorIcons } from './editor-icon-loader';

/** 产品外壳只管理任务切换和菜单显隐。 */
export function bindEditorChrome(signal: AbortSignal): void {
  activateEditorIcons(signal);
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-task-tab]')];
  const panels = [...document.querySelectorAll<HTMLElement>('[data-task-panel]')];
  const selectTask = (name: string, focus = false) => {
    for (const tab of tabs) {
      const active = tab.dataset.taskTab === name;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    }
    for (const panel of panels) panel.hidden = panel.dataset.taskPanel !== name;
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTask(tab.dataset.taskTab!), { signal });
    tab.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      selectTask(next.dataset.taskTab!, true);
    }, { signal });
  });

  const toggle = document.querySelector<HTMLButtonElement>('#fileMenuToggle')!;
  const menu = document.querySelector<HTMLElement>('#fileMenu')!;
  const closeMenu = (restoreFocus = false) => {
    if (menu.hidden) return;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  };
  toggle.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector<HTMLButtonElement>('button:not([hidden]):not(:disabled)')?.focus();
  }, { signal });
  menu.addEventListener('click', event => {
    if ((event.target as Element).closest('[role="menuitem"]')) closeMenu();
  }, { signal });
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && !menu.contains(event.target as Node) && !toggle.contains(event.target as Node)) closeMenu();
  }, { signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); closeMenu(true); }
  }, { signal });
}
