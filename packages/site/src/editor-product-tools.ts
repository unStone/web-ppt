import type { EditorSession, SlideEditor } from '@web-ppt/editor';

interface ProductToolsContext {
  readonly session: EditorSession | null;
  readonly view: SlideEditor | null;
  readonly writable: boolean;
  openInspector(): void;
}

export interface ProductTools {
  bindSession(): void;
  sync(): void;
  destroy(): void;
}

type Notice = (message: string, tone?: 'normal' | 'success' | 'error') => void;
const $ = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;

export function createProductTools(
  context: () => ProductToolsContext,
  notice: Notice,
): ProductTools {
  const find = $<HTMLButtonElement>('#findText');
  const replace = $<HTMLButtonElement>('#replaceText');
  const painter = $<HTMLButtonElement>('#formatPainter');
  const painterContinuous = $<HTMLButtonElement>('#formatPainterContinuous');
  const panel = $<HTMLElement>('#searchInspector');
  const query = $<HTMLInputElement>('#searchQuery');
  const replacement = $<HTMLInputElement>('#searchReplacement');
  const replacementField = $<HTMLElement>('#replacementField');
  const count = $<HTMLOutputElement>('#searchCount');
  const replaceCurrent = $<HTMLButtonElement>('#replaceCurrent');
  const replaceAll = $<HTMLButtonElement>('#replaceAll');
  let unsubscribePainter: (() => void) | null = null;
  let unsubscribeSearch: (() => void) | null = null;

  const sync = (): void => {
    const { session, writable } = context();
    const ready = !!session;
    find.disabled = !ready;
    replace.disabled = !ready;
    painter.disabled = !writable;
    painterContinuous.disabled = !writable;
    const painterState = session?.formatPainter.snapshot;
    painter.setAttribute('aria-pressed', String(painterState?.mode === 'single'));
    painterContinuous.setAttribute('aria-pressed', String(painterState?.mode === 'continuous'));
    const search = session?.textSearch.snapshot;
    panel.hidden = !search?.open;
    if (!search) return;
    if (document.activeElement !== query) query.value = search.query;
    if (document.activeElement !== replacement) replacement.value = search.replacement;
    replacementField.hidden = search.mode !== 'replace';
    replaceCurrent.hidden = search.mode !== 'replace';
    replaceAll.hidden = search.mode !== 'replace';
    replaceCurrent.disabled = !writable || !search.current;
    replaceAll.disabled = !writable || !search.matches.length;
    count.value = search.matches.length
      ? `${Math.max(0, search.currentIndex) + 1} / ${search.matches.length}` : '0 个结果';
  };

  const bindSession = (): void => {
    unsubscribePainter?.(); unsubscribeSearch?.();
    const session = context().session;
    unsubscribePainter = session?.formatPainter.subscribe(sync) ?? null;
    unsubscribeSearch = session?.textSearch.subscribe(sync) ?? null;
    sync();
  };

  const openSearch = (mode: 'find' | 'replace'): void => {
    const { view } = context(); if (!view) return;
    view.openTextSearch({ mode });
    context().openInspector();
    requestAnimationFrame(() => query.focus());
  };
  find.addEventListener('click', () => openSearch('find'));
  replace.addEventListener('click', () => openSearch('replace'));
  $<HTMLButtonElement>('#closeSearch').addEventListener('click', () => context().view?.closeTextSearch());
  query.addEventListener('input', () => context().session?.textSearch.setQuery(query.value));
  replacement.addEventListener('input', () => context().session?.textSearch.setReplacement(replacement.value));
  $<HTMLButtonElement>('#searchNext').addEventListener('click', () => context().view?.nextTextSearch());
  $<HTMLButtonElement>('#searchPrevious').addEventListener('click', () => context().view?.previousTextSearch());
  replaceCurrent.addEventListener('click', () => {
    if (context().view?.replaceCurrentText()) notice('已替换当前匹配', 'success');
  });
  replaceAll.addEventListener('click', () => {
    const changed = context().view?.replaceAllText() ?? 0;
    notice(changed ? `已替换 ${changed} 处` : '没有可替换的匹配', changed ? 'success' : 'normal');
  });

  const startPainter = (continuous: boolean): void => {
    const view = context().view;
    if (!view?.startFormatPainter({ continuous })) {
      notice('请先单选一个元素，或在文字编辑中选择一段文字', 'error');
      return;
    }
    notice(continuous ? '连续格式刷已启用；按 Esc 退出' : '格式刷已启用；点击一个目标应用');
  };
  painter.addEventListener('click', () => {
    const active = context().session?.formatPainter.snapshot.active;
    if (active) context().view?.cancelFormatPainter(); else startPainter(false);
  });
  painterContinuous.addEventListener('click', () => {
    const mode = context().session?.formatPainter.snapshot.mode;
    if (mode === 'continuous') context().view?.cancelFormatPainter(); else startPainter(true);
  });

  return {
    bindSession, sync,
    destroy() { unsubscribePainter?.(); unsubscribeSearch?.(); },
  };
}
