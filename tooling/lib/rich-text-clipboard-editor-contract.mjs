import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const textOf = (element) => element.text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

function clipboardData(values) {
  const data = new Map(Object.entries(values));
  return {
    get types() { return [...data.keys()]; },
    getData(type) { return data.get(type) ?? ''; },
    setData(type, value) { data.set(type, value); },
  };
}

function clipboardEvent(window, type, data) {
  const event = new window.Event(type, { bubbles: true, composed: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: data });
  return event;
}

function selectAcross(window, first, firstOffset, last, lastOffset) {
  const range = window.document.createRange();
  range.setStart(first.firstChild, firstOffset);
  range.setEnd(last.firstChild, lastOffset);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 从发布挂载入口验证外部富文本只经白名单进入模型。 */
export async function runRichTextClipboardEditorContract({ check, lib, root, window }) {
  console.log('\n\x1b[36m▸ DOM 文字剪贴板与富文本粘贴\x1b[0m');
  const session = await lib.openEditor(
    new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-rich-clipboard.pptx'))),
    { idPrefix: 'editor-rich-paste-' },
  );
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === '富文本剪贴板');
  const container = document.createElement('div');
  const mirror = document.createElement('div');
  document.body.append(container, mirror);
  const view = session.mount(container, { mode: 'edit' });
  const mirrorView = session.mount(mirror, { mode: 'edit' });
  container.querySelector(`[data-edit-id="${record.id}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  let editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  let markers = editable.querySelectorAll('[data-r]');

  selectAcross(window, markers[0], 0, markers[0], 1);
  const historyBeforeUntrusted = session.editor.history.undoCount;
  for (const values of [
    { 'text/plain': '', 'text/html': '<b>不得插入</b>' },
    { 'text/html': '<b>也不得插入</b>' },
  ]) {
    const untrusted = clipboardEvent(window, 'paste', clipboardData(values));
    editable.dispatchEvent(untrusted);
    check('text/plain 为空或缺失时不信任 HTML 内容', untrusted.defaultPrevented
      && session.editor.history.undoCount === historyBeforeUntrusted
      && !textOf(session.editor.effectiveElement(record.id)).includes('不得插入'));
  }
  const unknown = clipboardEvent(window, 'paste', clipboardData({
    'text/plain': '未知', 'text/html': '<custom style="font-weight:700;font-size:99px">未知</custom>',
  }));
  editable.dispatchEvent(unknown);
  const unknownRun = session.editor.effectiveElement(record.id).text.paragraphs[0].runs
    .find((run) => run.text === '未知');
  check('未知标签只贡献文本且不能携带自己的内联样式',
    unknown.defaultPrevented && !!unknownRun && !unknownRun.b && unknownRun.size !== 99);
  session.editor.undo();

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  markers = editable.querySelectorAll('[data-r]');
  selectAcross(window, markers[0], 1, markers[1], 1);
  const data = clipboardData({
    'text/plain': '粗斜\n第二\n软',
    'text/html': '<div><strong style="font-family: Arial; font-size: 20px">粗</strong>'
      + '<em>斜</em></div><div>第二<br>软</div><script>恶意</script>',
  });
  const paste = clipboardEvent(window, 'paste', data);
  editable.dispatchEvent(paste);
  const effective = session.editor.effectiveElement(record.id);
  const runs = effective.text.paragraphs.flatMap((paragraph) => paragraph.runs);
  check('默认粘贴把 HTML 白名单格式和块/br 语义一次提交到模型',
    paste.defaultPrevented && textOf(effective) === '同粗斜\n第二\n软同'
      && runs.some((run) => run.text === '粗' && run.b && run.fonts[0] === 'Arial' && run.size === 20)
      && runs.some((run) => run.text === '斜' && run.i)
      && !textOf(effective).includes('恶意') && session.editor.history.undoCount === 1);
  const mirrorPaste = clipboardEvent(window, 'paste', clipboardData({ 'text/plain': '旁路' }));
  mirror.querySelector(`[data-edit-id="${record.id}"]`).dispatchEvent(mirrorPaste);
  check('多视图同步模型投影且非活动视图不接管文字剪贴板',
    mirror.textContent.includes('粗斜') && !mirrorPaste.defaultPrevented
      && !mirror.querySelector('[data-ppt-text-editor]') && session.editor.history.undoCount === 1);

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const plainTarget = editable.querySelector('[data-r]');
  const lastText = plainTarget.firstChild;
  const range = window.document.createRange();
  range.setStart(lastText, 0); range.setEnd(lastText, Math.min(1, lastText.textContent.length));
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  editable.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'v', code: 'KeyV', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
  }));
  const plainPaste = clipboardEvent(window, 'paste', clipboardData({
    'text/plain': '纯文本', 'text/html': '<b>纯文本</b>',
  }));
  editable.dispatchEvent(plainPaste);
  const afterPlain = session.editor.effectiveElement(record.id);
  const plainRun = afterPlain.text.paragraphs.flatMap((paragraph) => paragraph.runs)
    .find((run) => run.text.includes('纯文本'));
  check('Ctrl/Cmd+Shift+V 忽略 HTML 格式并仍形成单独撤销单元',
    plainPaste.defaultPrevented && !!plainRun && plainRun.b === false
      && session.editor.history.undoCount === 2,
  `prevented=${plainPaste.defaultPrevented} run=${JSON.stringify(plainRun)}`
    + ` history=${session.editor.history.undoCount} text=${textOf(afterPlain)}`);

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const richMarker = [...editable.querySelectorAll('[data-r]')]
    .find((marker) => marker.textContent === '粗');
  selectAcross(window, richMarker, 0, richMarker, 1);
  const copied = clipboardData({});
  const copy = clipboardEvent(window, 'copy', copied);
  editable.dispatchEvent(copy);
  check('文字复制输出标准纯文本与清洗后的 HTML 而不泄漏编辑标记',
    copy.defaultPrevented && copied.getData('text/plain') === '粗'
      && copied.getData('text/html').includes('font-weight:700')
      && !copied.getData('text/html').includes('data-r'),
  `prevented=${copy.defaultPrevented} plain=${copied.getData('text/plain')}`
    + ` html=${copied.getData('text/html')}`);
  const cutData = clipboardData({});
  const cut = clipboardEvent(window, 'cut', cutData);
  editable.dispatchEvent(cut);
  check('文字剪切先写剪贴板再用一个模型事务删除选区',
    cut.defaultPrevented && cutData.getData('text/plain') === '粗'
      && !textOf(session.editor.effectiveElement(record.id)).includes('粗')
      && session.editor.history.undoCount === 3);
  session.editor.undo();
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const normalMarker = editable.querySelector('[data-r]');
  selectAcross(window, normalMarker, 0, normalMarker, 1);
  const mismatch = clipboardEvent(window, 'paste', clipboardData({
    'text/plain': '安全',
    'text/html': '<b>不同</b><script>恶意()</script>',
  }));
  editable.dispatchEvent(mismatch);
  const safeRun = session.editor.effectiveElement(record.id).text.paragraphs
    .flatMap((paragraph) => paragraph.runs).find((run) => run.text.includes('安全'));
  check('HTML 与纯文本不一致时只接纳纯文本且不执行或保留恶意内容',
    mismatch.defaultPrevented && !!safeRun && !safeRun.b
      && !textOf(session.editor.effectiveElement(record.id)).includes('恶意'));

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const nestedTarget = editable.querySelector('[data-r]');
  selectAcross(window, nestedTarget, 0, nestedTarget, 1);
  const nestedPaste = clipboardEvent(window, 'paste', clipboardData({
    'text/plain': '嵌套\r\n\r\n末行',
    'text/html': '<div><span style="mso-bidi-font-weight:bold;font-family:Arial;font-size:18pt;'
      + 'font-weight:700"><em><u>嵌套</u></em></span></div><div></div>'
      + '<p><span style="text-decoration:line-through">末行</span></p>',
  }));
  editable.dispatchEvent(nestedPaste);
  const nestedText = session.editor.effectiveElement(record.id).text;
  const nestedRuns = nestedText.paragraphs.flatMap((paragraph) => paragraph.runs);
  check('嵌套语义标签、Word 内联 CSS、CRLF 与空段映射为纯片段语义',
    nestedPaste.defaultPrevented && nestedText.paragraphs[1].runs.every((run) => run.text === '')
      && nestedRuns.some((run) => run.text === '嵌套' && run.b && run.i && run.u
        && run.fonts[0] === 'Arial' && run.size === 24)
      && nestedRuns.some((run) => run.text === '末行' && run.strike));

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const nestedFirst = [...editable.querySelectorAll('[data-r]')]
    .find((marker) => marker.textContent === '嵌套');
  const nestedLast = [...editable.querySelectorAll('[data-r]')]
    .find((marker) => marker.textContent === '末行');
  selectAcross(window, nestedFirst, 0, nestedLast, nestedLast.textContent.length);
  const emptyRoundTrip = clipboardData({});
  editable.dispatchEvent(clipboardEvent(window, 'copy', emptyRoundTrip));
  const historyBeforeRoundTrip = session.editor.history.undoCount;
  const roundTripPaste = clipboardEvent(window, 'paste', emptyRoundTrip);
  editable.dispatchEvent(roundTripPaste);
  const roundTripped = session.editor.effectiveElement(record.id).text;
  check('包含空段的清洗 HTML 可复制回贴且不会把空段变成硬换行',
    roundTripPaste.defaultPrevented && emptyRoundTrip.getData('text/plain') === '嵌套\n\n末行'
      && emptyRoundTrip.getData('text/html').includes('<div></div>')
      && !emptyRoundTrip.getData('text/html').includes('<div><br></div>')
      && roundTripped.paragraphs[1].runs.every((run) => run.text === '')
      && !roundTripped.paragraphs.slice(0, 3)
        .some((paragraph) => paragraph.runs.some((run) => run.text === '\n'))
      && session.editor.history.undoCount === historyBeforeRoundTrip + 1);

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const historyBeforeImage = session.editor.history.undoCount;
  const domBeforeImage = editable.innerHTML;
  const imageOnly = clipboardEvent(window, 'paste', clipboardData({ 'image/png': 'opaque' }));
  editable.dispatchEvent(imageOnly);
  check('尚未支持的图片载荷被拦截且不会制造浏览器私有 DOM 或历史',
    imageOnly.defaultPrevented && session.editor.history.undoCount === historyBeforeImage
      && container.querySelector(`[data-ppt-text-editor="${record.id}"]`).innerHTML === domBeforeImage);

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const beforeInputData = clipboardData({ 'text/plain': '输入事件' });
  const beforeInputPaste = new window.InputEvent('beforeinput', {
    bubbles: true, composed: true, cancelable: true, inputType: 'insertFromPaste',
  });
  Object.defineProperty(beforeInputPaste, 'dataTransfer', { value: beforeInputData });
  editable.dispatchEvent(beforeInputPaste);
  check('只提供 beforeinput.dataTransfer 的浏览器分支也走同一纯片段命令',
    beforeInputPaste.defaultPrevented
      && textOf(session.editor.effectiveElement(record.id)).includes('输入事件'));
  mirrorView.destroy();
  view.destroy();
  session.dispose();
  container.remove();
  mirror.remove();
}
