import { applyTextEditOps, textBodyEditText, textBodyFromOverride, textPositionAtIndex, textPositionToIndex } from '@web-ppt/edit-core';
import type { EditorSession } from '../session';
import type { SlideEditor } from '../slide-editor-types';
import { resolveActiveText } from '../text-editor-target';
import { createTextEditorRoot, setTextDomSelection } from '../text-editor-view';
import { compositionChangedRange, rangePositions, rebaseRange } from '../text-dom';
import { plainTextFragment } from '../text-clipboard';
import { compositionDecoration, textBounds } from './geometry';
import type { EditingHost, EditContextWindow, NativeTextFormat, NativeTextUpdate } from './native';

export interface EditContextEnhancement { readonly supported: boolean; dispose(): void }

/** 仅替换浏览器输入适配；格式、历史、IME 合并与协同重基仍经过既有文字控制器。 */
export function enableEditContext(session: EditorSession, view: SlideEditor): EditContextEnhancement {
  const document = view.element.ownerDocument, window = document.defaultView! as EditContextWindow;
  const Constructor = window.EditContext;
  if (!Constructor) return { supported: false, dispose() {} };
  const layer = view.element.querySelector<HTMLElement>('[data-ppt-layer=text]')!;
  let current: EditingHost | null = null, release: (() => void) | undefined, disposed = false;

  const bind = (root: EditingHost) => {
    const cell = root.dataset.pptTextCell?.split(':').map(Number);
    const active = () => resolveActiveText(session.editor, root.dataset.pptTextEditor!, cell ? { r: cell[0], c: cell[1] } : null);
    const initial = active(); if (!initial) return () => {};
    let text = initial.text, composing = false, closed = false;
    let composition: { text: string; markup: string; from: number; to: number } | null = null;
    const positions = rangePositions(root, text);
    const context = new Constructor({ text: textBodyEditText(text),
      selectionStart: positions ? textPositionToIndex(text, positions.from) : 0,
      selectionEnd: positions ? textPositionToIndex(text, positions.to) : 0 });
    const decoration = compositionDecoration(root);
    const abort = new window.AbortController();
    const on = (target: EventTarget, type: string, handler: (event: Event) => void, capture = false) =>
      target.addEventListener(type, handler, { signal: abort.signal, capture });
    const bounds = () => {
      if (closed || !root.isConnected) return;
      context.updateControlBounds(root.getBoundingClientRect());
      context.updateSelectionBounds(textBounds(root, text, context.selectionStart, context.selectionEnd));
    };
    const syncSelection = () => {
      if (closed || composing) return;
      const value = active(); if (!value) return;
      text = value.text;
      const plain = textBodyEditText(text), range = rangePositions(root, text);
      if (context.text !== plain) context.updateText(0, context.text.length, plain);
      if (range) context.updateSelection(textPositionToIndex(text, range.from), textPositionToIndex(text, range.to));
      bounds();
    };
    const insert = (from: number, to: number, value: string) => {
      const host = layer.querySelector<EditingHost>('[data-ppt-text-editor]');
      const model = active(); if (!host || host.dataset.pptTextEditor !== root.dataset.pptTextEditor || !model) return;
      setTextDomSelection(host, textPositionAtIndex(model.text, from), textPositionAtIndex(model.text, to));
      if (value.includes('\n')) {
        const event = new window.Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => type === 'text/plain' ? value : '' } });
        host.dispatchEvent(event);
      } else host.dispatchEvent(new window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
    };
    on(context, 'compositionstart', () => {
      syncSelection(); composing = true;
      composition = { text: context.text, markup: root.innerHTML, from: context.selectionStart, to: context.selectionEnd };
      root.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
    });
    on(context, 'textupdate', (event) => {
      if (closed || !root.isConnected) return;
      const e = event as NativeTextUpdate;
      if (!composing) {
        insert(e.updateRangeStart, e.updateRangeEnd, e.text);
        const host = layer.querySelector<EditingHost>('[data-ppt-text-editor]'), value = active();
        if (host && value) setTextDomSelection(host,
          textPositionAtIndex(value.text, e.selectionStart), textPositionAtIndex(value.text, e.selectionEnd));
        return;
      }
      const override = applyTextEditOps(text, [{ type: 'replaceFragment',
        from: textPositionAtIndex(text, e.updateRangeStart), to: textPositionAtIndex(text, e.updateRangeEnd), fragment: plainTextFragment(e.text) }]);
      if (override.kind !== 'flat') return;
      text = textBodyFromOverride(override);
      const value = active(); if (!value) return;
      const layout = root.querySelector('[data-layout=engine]') ? 'engine' : 'browser';
      const scale = Number(root.querySelector<HTMLElement>('[data-font-scale]')?.dataset.fontScale ?? 1);
      root.innerHTML = createTextEditorRoot(document, { ...value, text }, layout, scale).innerHTML;
      setTextDomSelection(root, textPositionAtIndex(text, e.selectionStart), textPositionAtIndex(text, e.selectionEnd));
      bounds();
    });
    on(context, 'compositionend', () => {
      if (closed || !composition) return;
      const snapshot = composition, value = active(); composition = null; composing = false;
      const local = compositionChangedRange(snapshot.text, textBodyEditText(text), snapshot.from, snapshot.to);
      const rebased = local && value ? rebaseRange(snapshot.text, textBodyEditText(value.text), local.from, local.to) : null;
      if (!local?.text.includes('\n')) {
        root.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true }));
        return;
      }
      // 先结束主控制器的暂存态，再通过同一输入入口提交一个事务，包含多段落与待输入格式。
      root.innerHTML = snapshot.markup;
      root.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true }));
      if (local && rebased && (local.from !== local.to || local.text)) insert(rebased.from, rebased.to, local.text);
      syncSelection();
    });
    on(context, 'characterboundsupdate', (event) => {
      const e = event as Event & { rangeStart: number; rangeEnd: number };
      context.updateCharacterBounds(e.rangeStart, Array.from({ length: Math.max(0, Math.min(context.text.length, e.rangeEnd) - e.rangeStart) },
        (_, index) => textBounds(root, text, e.rangeStart + index, e.rangeStart + index + 1)));
    });
    on(context, 'textformatupdate', (event) => {
      decoration.update(text, (event as Event & { getTextFormats(): NativeTextFormat[] }).getTextFormats());
    });
    // 支持 EditContext 的浏览器负责这些原生输入；合成事件才交给既有模型适配器。
    on(root, 'beforeinput', (event) => {
      if (event.isTrusted && /^(insertText|insertCompositionText|deleteContentBackward|deleteContentForward)$/.test((event as InputEvent).inputType)) event.stopImmediatePropagation();
    }, true);
    on(document, 'selectionchange', syncSelection);
    // 模型快捷键会同步改 DOM 选区，selectionchange 却可能晚于下一次原生输入。
    on(root, 'keydown', () => window.queueMicrotask(syncSelection));
    on(root, 'keyup', syncSelection); on(root, 'pointerup', syncSelection);
    const unsubscribe = session.editor.subscribe(() => window.queueMicrotask(syncSelection));
    on(window, 'scroll', bounds, true); on(window, 'resize', bounds);
    root.editContext = context; syncSelection();
    return () => {
      closed = true; unsubscribe(); abort.abort(); decoration.dispose(); root.editContext = null;
      if (composition && root.isConnected) {
        root.innerHTML = composition.markup;
        root.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true }));
      }
    };
  };
  const sync = () => {
    if (disposed) return;
    const next = layer.querySelector<EditingHost>('[data-ppt-text-editor]');
    if (next === current) return;
    release?.(); current = next; release = next ? bind(next) : undefined;
  };
  const observer = new window.MutationObserver(sync);
  observer.observe(layer, { childList: true }); sync();
  return { supported: true, dispose() { disposed = true; observer.disconnect(); release?.(); current = null; } };
}
