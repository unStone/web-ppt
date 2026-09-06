import { openFixture, selectPaneObject } from './site-editor-browser-helpers.mjs';

export async function runSiteEditContextBrowserContract(context) {
  const { evaluate, request, waitFor, click } = context;
  if (!await evaluate("'EditContext' in window")) return;
  await openFixture(context, '/fixtures/sample-editor-text.pptx', 'edit-context.pptx');
  await selectPaneObject(context, '重复格式');
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-pane-element]')].find(n=>n.getAttribute('aria-selected')==='true');
    document.querySelector('[data-edit-id="'+CSS.escape(row.dataset.paneElement)+'"]')
      .dispatchEvent(new MouseEvent('dblclick',{bubbles:true,composed:true}));
  })()`);
  await waitFor("!!document.querySelector('[data-ppt-text-editor]')?.editContext", '真实 EditContext 绑定');
  await evaluate(`(() => {
    const host=document.querySelector('[data-ppt-text-editor]');host.focus();
    const text=document.createTreeWalker(host,NodeFilter.SHOW_TEXT).nextNode();
    const range=document.createRange();range.setStart(text,0);range.collapse(true);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    globalThis.__beforeNativeIme=document.querySelector('[data-ppt-layer=static]').textContent;
  })()`);
  await request('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1, replacementStart: 0, replacementEnd: 0 });
  await waitFor("document.querySelector('[data-ppt-text-editor]')?.textContent.includes('中')", '原生输入法预编辑');
  if (!await evaluate("document.querySelector('[data-ppt-layer=static]').textContent === globalThis.__beforeNativeIme")) {
    throw new Error('原生输入法预编辑提前修改文档');
  }
  await request('Input.insertText', { text: '中文' });
  await waitFor("document.querySelector('[data-ppt-text-editor]')?.editContext?.text.includes('中文')", '原生输入法提交与重绑');
  await request('Input.insertText', { text: '！' });
  await waitFor("document.querySelector('[data-ppt-text-editor]')?.editContext?.text.includes('中文！')", '连续原生输入');
  await click('#undo');
  await waitFor("document.querySelector('[data-ppt-text-editor]')?.textContent.includes('中文') && !document.querySelector('[data-ppt-text-editor]')?.textContent.includes('！')", '原生输入撤销');
  await click('#undo');
  await waitFor("!document.querySelector('[data-ppt-text-editor]')?.textContent.includes('中文')", '单事务撤销输入法提交');
  console.log('  Chromium EditContext · 原生预编辑、提交、连续输入与单事务撤销通过');
}

export async function runSiteEditContextFailureContract(context, rejectChunk) {
  const { evaluate, request, waitFor } = context;
  if (!await evaluate("'EditContext' in window")) return;
  rejectChunk();
  await request('Network.setCacheDisabled', { cacheDisabled: true });
  const url = await evaluate("location.origin + '/editor.html?lang=zh-CN&input-failure=1'");
  await request('Page.navigate', { url });
  await waitFor("document.querySelector('#fileName')?.textContent === 'showcase.pptx' && !document.querySelector('#editorApp')?.dataset.loading", '可选输入模块加载失败仍打开文稿');
  await openFixture(context, '/fixtures/sample-editor-text.pptx', 'input-fallback.pptx', { discardRecovery: true });
  await selectPaneObject(context, '重复格式');
  await evaluate(`(() => {
    const row=[...document.querySelectorAll('[data-pane-element]')].find(n=>n.getAttribute('aria-selected')==='true');
    document.querySelector('[data-edit-id="'+CSS.escape(row.dataset.paneElement)+'"]')
      .dispatchEvent(new MouseEvent('dblclick',{bubbles:true,composed:true}));
  })()`);
  await waitFor("!!document.querySelector('[data-ppt-text-editor]') && !document.querySelector('[data-ppt-text-editor]').editContext", '可选输入模块失败保留原编辑路径');
  console.log('  EditContext 按需块实际 503 时仍可打开并编辑');
  return true;
}
