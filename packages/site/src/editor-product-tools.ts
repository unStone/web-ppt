import type { EditorSession, SlideEditor } from '@web-ppt/editor';
import { message, type SiteNotice } from './i18n/message';
import { setMessage } from './i18n/runtime';

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

const $ = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;

export function createProductTools(
  context: () => ProductToolsContext,
  notice: SiteNotice,
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
  const next = $<HTMLButtonElement>('#searchNext');
  const previous = $<HTMLButtonElement>('#searchPrevious');
  const invalid = new Set<HTMLInputElement>();
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
    if (!invalid.has(query) && document.activeElement !== query) query.value = search.query;
    if (!invalid.has(replacement) && document.activeElement !== replacement) replacement.value = search.replacement;
    replacementField.hidden = search.mode !== 'replace';
    replaceCurrent.hidden = search.mode !== 'replace';
    replaceAll.hidden = search.mode !== 'replace';
    replaceCurrent.disabled = !writable || invalid.size > 0 || !search.current;
    replaceAll.disabled = !writable || invalid.size > 0 || !search.matches.length;
    next.disabled = previous.disabled = invalid.has(query) || !search.matches.length;
    setMessage(count, invalid.has(query) ? message('查询无效') : search.matches.length
      ? `${Math.max(0, search.currentIndex) + 1} / ${search.matches.length}` : message('0 个结果'));
  };

  const bindSession = (): void => {
    unsubscribePainter?.(); unsubscribeSearch?.();
    invalid.clear();
    query.removeAttribute('aria-invalid'); replacement.removeAttribute('aria-invalid');
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
  const bindInput = (input: HTMLInputElement, update: (value: string) => void): void => {
    input.addEventListener('input', () => {
      const recovered = invalid.delete(input);
      try {
        update(input.value);
        if (recovered && !invalid.size) notice(message('输入已恢复'));
      } catch (error) {
        // SDK 拒绝时仍持有旧值，保留待修正输入并暂停相关操作，不能误用旧查询或替换值。
        invalid.add(input);
        // 画布键盘导航也消费 SDK 命中，不能只禁用站点按钮。
        if (input === query) context().session?.textSearch.setQuery('');
        notice(message('文字输入无效：{detail}', { detail: error instanceof Error ? error.message : String(error) }), 'error');
      }
      input.setAttribute('aria-invalid', String(invalid.has(input)));
      sync();
    });
  };
  bindInput(query, (value) => context().session?.textSearch.setQuery(value));
  bindInput(replacement, (value) => context().session?.textSearch.setReplacement(value));
  next.addEventListener('click', () => context().view?.nextTextSearch());
  previous.addEventListener('click', () => context().view?.previousTextSearch());
  replaceCurrent.addEventListener('click', () => {
    if (context().view?.replaceCurrentText()) notice(message('已替换当前匹配'), 'success');
  });
  replaceAll.addEventListener('click', () => {
    const changed = context().view?.replaceAllText() ?? 0;
    notice(changed ? message('已替换 {count} 处', { count: changed }) : message('没有可替换的匹配'), changed ? 'success' : 'normal');
  });

  const startPainter = (continuous: boolean): void => {
    const view = context().view;
    if (!view?.startFormatPainter({ continuous })) {
      notice(message('请先单选一个元素，或在文字编辑中选择一段文字'), 'error');
      return;
    }
    notice(message(continuous ? '连续格式刷已启用；按 Esc 退出' : '格式刷已启用；点击一个目标应用'));
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
