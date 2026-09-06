import { captureSaveAndReopen, openFixture, selectPaneObject } from './site-editor-browser-helpers.mjs';
import { doubleClickElement } from './browser-double-click.mjs';
import { runSiteI18nPlaceholderContract } from './site-i18n-placeholder-contract.mjs';

async function key(request, key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await request('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode, modifiers });
  }
}

export async function runSiteI18nViewLabelsContract(context) {
  const { evaluate, click, waitFor, request } = context;
  await click('[data-site-locale="en"]');
  await openFixture(context, '/fixtures/sample-editor-find-replace.pptx', '<查找名称 & 原文>.pptx');
  await click('#findText');
  await waitFor("document.activeElement === document.querySelector('#searchQuery')", '查找输入获得焦点');
  await request('Input.insertText', { text: '<没有 & 原文>' });
  await waitFor(`document.querySelector('#canvasMount > div').getAttribute('aria-label') === 'No matches for “<没有 & 原文>”'`, '英文无匹配可访问名称');
  await click('[data-site-locale="zh-CN"]');
  await waitFor(`document.querySelector('#canvasMount > div').getAttribute('aria-label') === '未找到“<没有 & 原文>”'
    && document.activeElement === document.querySelector('#searchQuery')
    && document.activeElement.value === '<没有 & 原文>' && document.querySelector('#undo').disabled`, '无匹配名称切语言保留查询与历史');
  await evaluate("document.querySelector('#searchQuery').select()");
  await request('Input.insertText', { text: 'Needle' });
  await waitFor(`document.querySelector('#canvasMount > div').getAttribute('aria-label') === '查找结果 1/7：Needle'`, '命中片段中文名称');
  await click('[data-site-locale="en"]');
  await waitFor(`document.querySelector('#canvasMount > div').getAttribute('aria-label') === 'Find result 1/7: Needle'`, '命中片段英文名称');
  await evaluate("document.querySelector('#canvasMount > div').focus()");
  const tree = await request('Accessibility.getFullAXTree');
  if (!tree.result.nodes.some(node => !node.ignored && node.name?.value === 'Find result 1/7: Needle')) {
    throw new Error('搜索结果名称没有进入真实无障碍树');
  }
  await key(request, 'Enter', 'Enter', 13);
  await waitFor(`document.querySelector('#canvasMount > div').getAttribute('aria-label') === 'Find result 2/7: Needle group'`, '键盘导航更新命中名称');
  await click('#searchPrevious');
  await click('#searchPrevious');
  await waitFor(`document.querySelector('#canvasMount > div').getAttribute('aria-label') === 'Find result 7/7: Needle middle Needle NeedleCase'`, '跨页搜索名称包含原文上下文');
  await click('#viewMode');
  await click('[data-site-locale="zh-CN"]');
  await waitFor(`document.querySelector('#canvasMount > div').getAttribute('aria-label') === '查找结果 7/7：Needle middle Needle NeedleCase'
    && document.querySelector('#pageIndicator').textContent === '2 / 3'`, '查看模式与切语言保留跨页命中');
  await click('[data-site-locale="en"]');
  await click('#closeSearch');
  await waitFor(`document.querySelector('#canvasMount > div').getAttribute('aria-label') === 'Slide editing canvas'`, '关闭搜索恢复画布名称');
  await click('#zoomIn');
  await click('[data-site-locale="zh-CN"]');
  await waitFor(`document.querySelector('#canvasMount > div').getAttribute('aria-label') === '幻灯片编辑画布'
    && document.querySelector('#undo').disabled`, '关闭后缩放与切语言不恢复旧查询名称');
  await click('#editMode');
  await textInputs(context);
  await imageChooser(context);
  await runSiteI18nPlaceholderContract(context);
}

async function imageChooser(context) {
  const { request, evaluate, click, waitFor } = context;
  await request('Page.setInterceptFileChooserDialog', { enabled: true });
  await evaluate(`(() => {
    globalThis.__readImageChooserLabel = event => {
      if (event.target.matches?.('[data-web-ppt-image-input]')) {
        globalThis.__imageChooserLabelAtClick = event.target.getAttribute('aria-label');
      }
    };
    document.addEventListener('click', globalThis.__readImageChooserLabel);
  })()`);
  try {
    await click('#addImage');
    await waitFor(`globalThis.__imageChooserLabelAtClick === 'Choose an image to insert'`, '打开原生选择器前已有英文名称');
    await evaluate("globalThis.__imageChooserInput = document.querySelector('[data-web-ppt-image-input]')");
    await click('[data-site-locale="zh-CN"]');
    await waitFor(`document.querySelector('[data-web-ppt-image-input]') === globalThis.__imageChooserInput
      && globalThis.__imageChooserInput.getAttribute('aria-label') === '选择要插入的图片'
      && document.querySelector('#undo').disabled`, '切语言保留待选文件入口');
    await evaluate("globalThis.__imageChooserInput.dispatchEvent(new Event('cancel'))");
    await waitFor(`!document.querySelector('[data-web-ppt-image-input]') && document.querySelector('#undo').disabled`, '取消选择不产生历史');
    await click('#addImage');
    await waitFor(`globalThis.__imageChooserLabelAtClick === '选择要插入的图片'`, '重新打开使用当前中文名称');
    await click('[data-site-locale="en"]');
    await waitFor(`document.querySelector('[data-web-ppt-image-input]').getAttribute('aria-label') === 'Choose an image to insert'`, '待选文件入口切回英文');
    await evaluate("document.querySelector('[data-web-ppt-image-input]').dispatchEvent(new Event('cancel'))");
  } finally {
    await evaluate(`document.removeEventListener('click', globalThis.__readImageChooserLabel);
      delete globalThis.__readImageChooserLabel; delete globalThis.__imageChooserLabelAtClick; delete globalThis.__imageChooserInput;`);
    await request('Page.setInterceptFileChooserDialog', { enabled: false });
  }
}

async function textInputs(context) {
  const { evaluate, click, waitFor, request } = context;
  await click('[data-site-locale="en"]');
  await selectPaneObject(context, 'find-page-two');
  const id = await evaluate("document.querySelector('[data-pane-element][aria-selected=true]').dataset.paneElement");
  await doubleClickElement(context, `[data-edit-id="${id}"]`);
  await waitFor(`document.querySelector('[data-ppt-text-editor]')?.getAttribute('aria-label') === 'Edit text: find-page-two'`, '文字编辑英文上下文名称');
  const modifier = await evaluate("navigator.platform.includes('Mac') ? 4 : 2");
  await key(request, 'a', 'KeyA', 65, modifier);
  await request('Input.insertText', { text: '<编辑内容 & 原文>' });
  await waitFor(`document.querySelector('[data-ppt-text-editor]')?.textContent === '<编辑内容 & 原文>'`, '真实输入替换文字');
  await preserveTextSelection(context, 'Edit text: find-page-two', '编辑文字：find-page-two');
  await key(request, 'Escape', 'Escape', 27);
  await click('#undo');
  await waitFor(`document.querySelector('#canvasMount').textContent.includes('Needle middle Needle NeedleCase')
    && document.querySelector('#undo').disabled`, '切语言不增加文字历史');
  await click('#redo');
  await click('#prevSlide');
  await selectPaneObject(context, 'find-table');
  await doubleClickElement(context, '[data-table-cell="0:1"]');
  await waitFor(`document.querySelector('[data-ppt-text-editor]')?.getAttribute('aria-label') === 'Edit cell: find-table, row 1, column 2'`, '表格单元格英文坐标名称');
  await key(request, 'a', 'KeyA', 65, modifier);
  await request('Input.insertText', { text: '<单元格内容 & 原文>' });
  await preserveTextSelection(context, 'Edit cell: find-table, row 1, column 2', '编辑单元格：find-table，第 1 行，第 2 列');
  await key(request, 'Escape', 'Escape', 27);
  await captureSaveAndReopen(context, 'view-labels-saved.pptx');
  await selectPaneObject(context, 'find-table');
  await doubleClickElement(context, '[data-table-cell="0:1"]');
  await waitFor(`document.querySelector('[data-ppt-text-editor]')?.textContent === '<单元格内容 & 原文>'
    && document.querySelector('[data-ppt-text-editor]').getAttribute('aria-label') === 'Edit cell: find-table, row 1, column 2'
    && document.querySelector('#undo').disabled`, '保存重开原始文字与编辑标签');
  await key(request, 'Escape', 'Escape', 27);
  await click('#nextSlide');
  await waitFor(`document.querySelector('#canvasMount').textContent.includes('<编辑内容 & 原文>')`, '形状文字保存重开');
}

async function preserveTextSelection(context, english, chinese) {
  const { evaluate, click, waitFor, request } = context;
  await evaluate(`(() => {
    const root = document.querySelector('[data-ppt-text-editor]');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode();
    getSelection().setBaseAndExtent(text, 1, text, 3);
    globalThis.__editingLanguage = { root, text, content: root.textContent };
  })()`);
  await click('[data-site-locale="zh-CN"]');
  const preserved = `document.querySelector('[data-ppt-text-editor]') === globalThis.__editingLanguage.root
    && document.activeElement === globalThis.__editingLanguage.root
    && document.activeElement.textContent === globalThis.__editingLanguage.content
    && getSelection().anchorNode === globalThis.__editingLanguage.text && getSelection().anchorOffset === 1
    && getSelection().focusNode === globalThis.__editingLanguage.text && getSelection().focusOffset === 3`;
  await waitFor(`${preserved} && document.activeElement.getAttribute('aria-label') === ${JSON.stringify(chinese)}`, '文字标签切中文保留 DOM、光标与内容');
  const tree = await request('Accessibility.getFullAXTree');
  if (!tree.result.nodes.some(node => !node.ignored && node.role?.value === 'textbox' && node.name?.value === chinese)) {
    throw new Error('文字编辑名称未进入真实无障碍树');
  }
  await request('Emulation.setTouchEmulationEnabled', { enabled: true });
  try {
    const point = await evaluate(`(() => {
      const rect = document.querySelector('[data-site-locale="en"]').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await request('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await request('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitFor(`${preserved} && document.activeElement.getAttribute('aria-label') === ${JSON.stringify(english)}`, '触屏切英文保留文字编辑选区');
  } finally { await request('Emulation.setTouchEmulationEnabled', { enabled: false }); }
}
