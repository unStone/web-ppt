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

  await changeValue(context, '#textBulletKind', 'char');
  await changeValue(context, '#textBulletChar', '→');
  await waitFor("document.querySelector('#textBulletKind').value === 'char' && document.querySelector('#textBulletChar').value === '→'", '字符项目符号写入');
  await changeValue(context, '#textBulletKind', 'autoNum');
  await changeValue(context, '#textBulletScheme', 'romanLcPeriod');
  await changeValue(context, '#textBulletStart', '4');
  await waitFor(`document.querySelector('#textBulletKind').value === 'autoNum'
    && document.querySelector('#textBulletScheme').value === 'romanLcPeriod'
    && document.querySelector('#textBulletStart').value === '4'`, '自动编号制式与起点写入');
  await click('#undo');
  await waitFor("document.querySelector('#textBulletStart').value === '1'", '自动编号起点撤销');
  await click('#redo');
  await waitFor("document.querySelector('#textBulletStart').value === '4'", '自动编号起点重做');
  await evaluate(`(async () => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'bullet.png', { type: 'image/png' }));
    const input = document.querySelector('#textBulletImageInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor("document.querySelector('#textBulletKind').value === 'image'", '图片项目符号上传');
  await changeValue(context, '#textBulletFont', 'Wingdings');
  await evaluate(`(() => {
    const control = document.querySelector('#textBulletColorEnabled');
    control.checked = true;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await changeValue(context, '#textBulletColor', '#336699');
  await changeValue(context, '#textBulletSizeKind', 'percent');
  await changeValue(context, '#textBulletSize', '135');
  await waitFor(`document.querySelector('#textBulletKind').value === 'image'
    && document.querySelector('#textBulletFont').value === 'Wingdings'
    && document.querySelector('#textBulletColorEnabled').checked
    && document.querySelector('#textBulletColor').value === '#336699'
    && document.querySelector('#textBulletSizeKind').value === 'percent'
    && document.querySelector('#textBulletSize').value === '135'`, '图片项目符号样式写入');

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
  const reopenedFormatting = await evaluate(`(() => ({
    bold: document.querySelector('#textBold').getAttribute('aria-pressed'),
    italic: document.querySelector('#textItalic').getAttribute('aria-pressed'),
    underline: document.querySelector('#textUnderline').getAttribute('aria-pressed'),
    size: document.querySelector('#textFontSize').value,
    color: document.querySelector('#textColor').value,
    align: document.querySelector('#textAlign').value,
    bulletKind: document.querySelector('#textBulletKind').value,
    bulletFont: document.querySelector('#textBulletFont').value,
    bulletColor: document.querySelector('#textBulletColor').value,
    bulletSizeKind: document.querySelector('#textBulletSizeKind').value,
    bulletSize: document.querySelector('#textBulletSize').value,
  }))()`);
  const reopenedFormattingOk = reopenedFormatting.bold === 'true'
    && reopenedFormatting.italic === 'true' && reopenedFormatting.underline === 'true'
    && reopenedFormatting.size === '37' && reopenedFormatting.color === '#aabbcc'
    && reopenedFormatting.align === 'center' && reopenedFormatting.bulletKind === 'image'
    && reopenedFormatting.bulletFont === 'Wingdings'
    && reopenedFormatting.bulletColor === '#336699'
    && reopenedFormatting.bulletSizeKind === 'percent' && reopenedFormatting.bulletSize === '135';
  if (!reopenedFormattingOk) {
    throw new Error(`文字格式重开验证失败：${JSON.stringify(reopenedFormatting)}`);
  }
  await waitFor(`document.querySelector('#textBold').getAttribute('aria-pressed') === 'true'
    && document.querySelector('#textItalic').getAttribute('aria-pressed') === 'true'
    && document.querySelector('#textUnderline').getAttribute('aria-pressed') === 'true'
    && document.querySelector('#textFontSize').value === '37'
    && document.querySelector('#textColor').value === '#aabbcc'
    && document.querySelector('#textAlign').value === 'center'
    && document.querySelector('#textBulletKind').value === 'image'
    && document.querySelector('#textBulletFont').value === 'Wingdings'
    && document.querySelector('#textBulletColor').value === '#336699'
    && document.querySelector('#textBulletSizeKind').value === 'percent'
    && document.querySelector('#textBulletSize').value === '135'`, '文字格式重开验证');
  const replaced = await evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-pane-element]')]
      .find((candidate) => candidate.querySelector('[data-pane-name]')?.textContent === '重复格式');
    const id = row?.dataset.paneElement;
    return id ? document.querySelector('[data-edit-id="' + CSS.escape(id) + '"]')?.textContent : '';
  })()`);
  if (!replaced?.includes('异')) throw new Error(`查找替换没有保存重开：${replaced}`);
}
