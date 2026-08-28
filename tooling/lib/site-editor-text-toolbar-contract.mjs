import {
  changeValue, openFixture, saveAndReopen, selectPaneObject,
} from './site-editor-browser-helpers.mjs';

async function selectFirstCharacter(context, name) {
  const { evaluate, waitFor } = context;
  await selectPaneObject(context, name);
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-pane-element]')]
      .find((candidate) => candidate.querySelector('[data-pane-name]')?.textContent === ${JSON.stringify(name)});
    const id = row?.dataset.paneElement;
    const partition = id && document.querySelector('[data-edit-id="' + CSS.escape(id) + '"]');
    partition?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
    const marker = id && document.querySelector('[data-ppt-text-editor="' + CSS.escape(id) + '"] [data-r="0.0"]');
    const text = marker?.firstChild;
    if (!marker || !text) return;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    marker.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, button: 0 }));
  })()`);
  await waitFor("document.querySelector('#textInspector') && !document.querySelector('#textInspector').hidden", '文字上下文面板');
}

export async function runSiteEditorTextToolbarContract(context) {
  const { evaluate, waitFor, click } = context;
  await openFixture(context, '/fixtures/sample-editor-text.pptx', 'text-format.pptx');
  await selectFirstCharacter(context, '重复格式');

  const boldBefore = await evaluate("document.querySelector('#textBold').getAttribute('aria-pressed')");
  await click('#textBold');
  await waitFor("document.querySelector('#textBold').getAttribute('aria-pressed') === 'true'", '加粗写入');
  await click('#undo');
  await waitFor(`document.querySelector('#textBold').getAttribute('aria-pressed') === ${JSON.stringify(boldBefore)}`, '加粗撤销');
  await click('#redo');
  await waitFor("document.querySelector('#textBold').getAttribute('aria-pressed') === 'true'", '加粗重做');

  await click('#textItalic');
  await waitFor("document.querySelector('#textItalic').getAttribute('aria-pressed') === 'true'", '斜体写入');
  await click('#undo');
  await waitFor("document.querySelector('#textItalic').getAttribute('aria-pressed') === 'false'", '斜体撤销');
  await click('#redo');
  await waitFor("document.querySelector('#textItalic').getAttribute('aria-pressed') === 'true'", '斜体重做');

  await click('#textUnderline');
  await waitFor("document.querySelector('#textUnderline').getAttribute('aria-pressed') === 'true'", '下划线写入');
  await click('#undo');
  await waitFor("document.querySelector('#textUnderline').getAttribute('aria-pressed') === 'false'", '下划线撤销');
  await click('#redo');

  const sizeBefore = await evaluate("document.querySelector('#textFontSize').value");
  await changeValue(context, '#textFontSize', '37');
  await waitFor("document.querySelector('#textFontSize').value === '37'", '字号写入');
  await click('#undo'); await waitFor(`document.querySelector('#textFontSize').value === ${JSON.stringify(sizeBefore)}`, '字号撤销');
  await click('#redo'); await waitFor("document.querySelector('#textFontSize').value === '37'", '字号重做');

  const colorBefore = await evaluate("document.querySelector('#textColor').value");
  await changeValue(context, '#textColor', '#aabbcc');
  await waitFor("document.querySelector('#textColor').value === '#aabbcc'", '文字颜色写入');
  await click('#undo'); await waitFor(`document.querySelector('#textColor').value === ${JSON.stringify(colorBefore)}`, '文字颜色撤销');
  await click('#redo'); await waitFor("document.querySelector('#textColor').value === '#aabbcc'", '文字颜色重做');

  const alignBefore = await evaluate("document.querySelector('#textAlign').value");
  await changeValue(context, '#textAlign', 'center');
  await waitFor("document.querySelector('#textAlign').value === 'center'", '段落对齐写入');
  await click('#undo'); await waitFor(`document.querySelector('#textAlign').value === ${JSON.stringify(alignBefore)}`, '段落对齐撤销');
  await click('#redo'); await waitFor("document.querySelector('#textAlign').value === 'center'", '段落对齐重做');

  await click('#findText');
  await changeValue(context, '#searchQuery', '同', 'input');
  await waitFor("document.querySelector('#searchCount').value !== '0 个结果'", '可见查找结果');
  await click('#replaceText');
  await changeValue(context, '#searchReplacement', '异', 'input');
  await click('#replaceCurrent');
  await waitFor("document.querySelector('#fileName').textContent.startsWith('●')", '替换当前');
  await click('#undo');
  await click('#redo');
  await click('#closeSearch');

  await saveAndReopen(context, 'text-format-reopen.pptx');
  await selectFirstCharacter(context, '重复格式');
  await waitFor(`document.querySelector('#textBold').getAttribute('aria-pressed') === 'true'
    && document.querySelector('#textItalic').getAttribute('aria-pressed') === 'true'
    && document.querySelector('#textUnderline').getAttribute('aria-pressed') === 'true'
    && document.querySelector('#textFontSize').value === '37'
    && document.querySelector('#textColor').value === '#aabbcc'
    && document.querySelector('#textAlign').value === 'center'`, '文字格式重开验证');
  const replaced = await evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-pane-element]')]
      .find((candidate) => candidate.querySelector('[data-pane-name]')?.textContent === '重复格式');
    const id = row?.dataset.paneElement;
    return id ? document.querySelector('[data-edit-id="' + CSS.escape(id) + '"]')?.textContent : '';
  })()`);
  if (!replaced?.includes('异')) throw new Error(`查找替换没有保存重开：${replaced}`);
}
