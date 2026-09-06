import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleBrowser } from './bundle-browser.mjs';

export async function runEditContextContract({ check, lib, root, window }) {
  const { enableEditContext } = await bundleBrowser({ root,
    entry: join(root, 'packages/editor/src/edit-context/index.ts'), output: join(root, 'out/editor/edit-context.mjs'),
    aliases: [['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
      ['@web-ppt/core', join(root, 'packages/core/src/index.ts')], ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')]],
  });
  const session = await lib.openEditor(new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-basic.pptx'))));
  const container = document.createElement('div'); document.body.append(container);
  const view = session.mount(container, { textMode: 'html' });
  const text = () => session.editor.effectiveElement(id).text.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
  const id = Object.values(session.editor.doc.elements).find((record) => record.src.kind === 'shape'
    && record.src.text?.paragraphs[0]?.runs[0]?.text === '可编辑').id;
  const fallback = enableEditContext(session, view);
  check('缺少 EditContext 时保持原输入路径', !fallback.supported); fallback.dispose();
  const previous = window.EditContext;
  class EditContext extends window.EventTarget {
    constructor(options) { super(); Object.assign(this, options); }
    updateText(start, end, value) { this.text = this.text.slice(0, start) + value + this.text.slice(end); }
    updateSelection(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    updateControlBounds(value) { this.control = value; }
    updateSelectionBounds(value) { this.selection = value; }
    updateCharacterBounds(start, value) { this.bounds = { start, value }; }
    emit(type, fields = {}) { this.dispatchEvent(Object.assign(new window.Event(type), fields)); }
    input(from, to, value) {
      this.updateText(from, to, value); this.updateSelection(from + value.length, from + value.length);
      this.emit('textupdate', { updateRangeStart: from, updateRangeEnd: to, text: value,
        selectionStart: this.selectionStart, selectionEnd: this.selectionEnd });
    }
  }
  window.EditContext = EditContext;
  const enhancement = enableEditContext(session, view);
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  try {
    view.element.querySelector(`[data-edit-id="${id}"]`).dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));
    await flush();
    const host = () => view.element.querySelector('[data-ppt-text-editor]');
    check('增强绑定真实编辑宿主并使用相同文本', enhancement.supported && host().editContext.text === text());
    let context = host().editContext;
    context.input(0, 1, '新'); await flush();
    check('EditContext 普通输入提交模型并重绑替换后的 DOM', text() === '新编辑' && host().editContext !== context && host().editContext.text === text());
    context = host().editContext;
    host().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    await flush();
    check('全选快捷键在下一次原生输入前同步 EditContext 选区', context.selectionStart === 0 && context.selectionEnd === text().length);
    context.updateSelection(1, 1);
    // 原生选择是输入法的初始选区；用 DOM 移动光标模拟真实浏览器。
    const selection = window.getSelection(), range = document.createRange();
    const marker = host().querySelector('[data-r]'); range.setStart(marker.firstChild, 1); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new window.Event('selectionchange'));
    view.setRunProps({ b: true });
    const count = session.editor.history.undoCount;
    context.emit('compositionstart');
    context.input(1, 1, '中'); context.input(1, 2, '中文');
    check('IME 预编辑保留同一宿主且不污染历史', text() === '新编辑' && host().editContext === context
      && host().textContent.includes('中文') && session.editor.history.undoCount === count);
    context.emit('characterboundsupdate', { rangeStart: 1, rangeEnd: 3 });
    check('IME 候选位置使用字符边界', context.bounds.start === 1 && context.bounds.value.length === 2);
    context.emit('compositionend'); await flush();
    check('IME 结束只提交一次并保留待输入格式', text() === '新中文编辑' && session.editor.history.undoCount === count + 1
      && session.editor.effectiveElement(id).text.paragraphs[0].runs.some((run) => run.text.includes('中文') && run.b));
    session.editor.undo(); await flush();
    check('撤销同步 EditContext 文本', text() === '新编辑' && host().editContext.text === text());
    host().editContext.input(1, 1, '甲\n乙'); await flush();
    check('多段文本沿既有片段输入路径提交', text() === '新甲\n乙编辑');
    const final = host(); enhancement.dispose();
    check('关闭增强恢复 contenteditable 并清理关联', final.editContext === null && final.contentEditable !== 'false');
  } finally { enhancement.dispose(); window.EditContext = previous; session.dispose(); container.remove(); }
}
