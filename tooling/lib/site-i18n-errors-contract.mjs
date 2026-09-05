export async function runSiteI18nErrorsContract({ evaluate, click, waitFor }) {
  await click('[data-site-locale="en"]');
  await waitFor("document.documentElement.lang === 'en'", '错误流程使用英文');
  await evaluate(`(() => {
    globalThis.__languageErrorCanvas = document.querySelector('#canvasMount').firstElementChild;
    const files = new DataTransfer();
    files.items.add(new File(['not a presentation'], '<坏文件>.pptx'));
    const input = document.querySelector('#fileInput');
    input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('#statusText').textContent.startsWith('Could not open: ')", '英文打开失败提示');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent.startsWith('打开失败：')", '已发生的错误随语言切换');
  if (!await evaluate("globalThis.__languageErrorCanvas === document.querySelector('#canvasMount').firstElementChild && !document.querySelector('#editorApp').dataset.loading")) throw new Error('打开失败不能销毁现有文稿');
  await click('[data-site-locale="en"]');
  await click('#addShape');
  await evaluate(`(() => {
    globalThis.__languageConfirm = window.confirm;
    window.confirm = (text) => { globalThis.__languageConfirmation = text; return false; };
  })()`);
  try {
    await click('#newFile');
    const text = await evaluate('globalThis.__languageConfirmation');
    if (text !== 'Your changes have not been saved. Open another presentation anyway?') throw new Error(`替换文稿确认未翻译：${text}`);
    if (!await evaluate("globalThis.__languageErrorCanvas === document.querySelector('#canvasMount').firstElementChild && !document.querySelector('#undo').disabled && !document.querySelector('#templateDialog')?.open")) throw new Error('取消确认必须保留文稿和编辑历史');
  } finally { await evaluate('window.confirm = globalThis.__languageConfirm'); }
  await click('#undo');
  await click('[data-site-locale="zh-CN"]');
}

export async function runSiteI18nConversionContract({ evaluate, click, waitFor }) {
  await click('[data-site-locale="en"]');
  await evaluate(`(async () => {
    const bytes = await fetch('/fixtures/sample.ppt').then((response) => response.arrayBuffer());
    const files = new DataTransfer(); files.items.add(new File([bytes], '<旧文稿>.ppt'));
    const input = document.querySelector('#fileInput');
    input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor("document.querySelector('#documentKind').textContent === 'PPT · Convert to edit' && !document.querySelector('#editorApp').dataset.loading", '英文旧格式预览');
  await evaluate(`(() => {
    globalThis.__languageConfirm = window.confirm;
    globalThis.__languageAcceptConversion = false;
    window.confirm = (text) => { globalThis.__languageConfirmation = text; return globalThis.__languageAcceptConversion; };
  })()`);
  try {
    await click('#editMode');
    const text = await evaluate('globalThis.__languageConfirmation');
    const expected = '<旧文稿>.ppt uses the legacy .ppt format. Editing will save a copy as <旧文稿>.pptx without overwriting the original. Unsupported legacy content will appear as placeholders with reasons and only support frame-level changes such as moving and resizing. Continue?';
    if (text !== expected) throw new Error(`旧格式转换确认未翻译或改变文件名：${text}`);
    await waitFor("document.querySelector('#statusText').textContent === 'Conversion cancelled. The presentation remains in preview mode.'", '英文转换取消提示');
    if (!await evaluate("document.querySelector('#addShape').disabled && document.querySelector('#saveFile').disabled")) throw new Error('拒绝转换不能开放编辑');
    await evaluate('globalThis.__languageAcceptConversion = true');
    await click('#editMode');
    await waitFor("document.querySelector('#documentKind').textContent === 'PPT → PPTX · Editable' && !document.querySelector('#saveFile').disabled", '英文转换允许编辑');
    await waitFor("document.querySelector('#statusText').textContent === 'Edit mode: double-click text, drag or resize elements'", '英文编辑模式提示');
  } finally { await evaluate('window.confirm = globalThis.__languageConfirm'); }
  await click('[data-site-locale="zh-CN"]');
}
