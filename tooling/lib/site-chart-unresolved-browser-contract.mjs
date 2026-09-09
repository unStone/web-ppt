import assert from 'node:assert/strict';
import { selectPaneObject } from './site-editor-browser-helpers.mjs';

export async function runSiteChartUnresolvedBrowserContract({ evaluate, request, waitFor, click }) {
  const url = '/fixtures/sample-chart-shared-cache.pptx';
  const address = await evaluate("new URL('editor.html?lang=zh-CN&unresolved=1', location.href).href");
  await request('Page.navigate', { url: address });
  await waitFor(`location.href === ${JSON.stringify(address)} && document.querySelector('#fileName')?.textContent === 'showcase.pptx'
    && !document.querySelector('#editorApp')?.dataset.loading`, '新应用就绪');
  const seed = await evaluate(`(async () => {
    const frame = document.createElement('iframe'); document.body.append(frame);
    try { return await frame.contentWindow.eval('import("/legacy-chart-seed.mjs").then(api => api.seedUnresolvedChartRecovery("${url}"))'); }
    finally { frame.remove(); }
  })()`, true);
  assert.ok(seed.frames > 0);
  const open = () => evaluate(`(async () => {
    window.confirm = () => true;
    const bytes = await fetch('${url}').then(response => response.arrayBuffer());
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'unresolved.pptx'));
    const input = document.querySelector('#fileInput'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await open();
  await waitFor("document.querySelector('#recoveryPrompt')?.hidden === false", '异常旧数据触发恢复选择');
  await click('#restoreRecovery');
  await waitFor("document.querySelector('#canvasMount')?.textContent.includes('图表编辑未恢复')", '恢复失败在首屏明确显示');
  await click('#editMode'); await selectPaneObject({ evaluate, request, waitFor, click }, '图表');
  await waitFor("!document.querySelector('#chartInspector').hidden && document.querySelector('[data-chart-status]')?.textContent.includes('旧数据已保留')",
    '检查器说明数据保留状态');
  assert.equal(await evaluate("document.querySelectorAll('[data-chart-table] input').length"), 0);
  await click('[data-site-locale="en"]');
  await waitFor("document.querySelector('#canvasMount')?.textContent.includes('Chart edits not restored')", '英文画布显示恢复失败');
  await waitFor("document.querySelector('[data-chart-status]')?.textContent.includes('Previous data has been retained')", '英文检查器说明数据保留');
  await click('#saveFile');
  await waitFor("document.querySelector('#statusText')?.textContent.includes('共享缓存')", '保存明确拒绝异常数据');
  assert.equal(await evaluate("document.querySelectorAll('[data-chart-table] input').length"), 0);
  await click('[data-site-locale="zh-CN"]');
  await open();
  await waitFor("document.querySelector('#recoveryPrompt')?.hidden === false", '失败保存后旧恢复记录仍然存在');
  // 显式丢弃是用户决定；同时归还本契约使用的恢复记录，避免影响后续同源固件用例。
  await click('#discardRecovery');
  await waitFor(`document.querySelector('#fileName')?.textContent === 'unresolved.pptx' && !document.querySelector('#editorApp')?.dataset.loading
    && !document.querySelector('#canvasMount')?.textContent.includes('图表编辑未恢复')`, '显式丢弃后才回到来源图表');
  console.log('未恢复图表产品流程：真实 IndexedDB、首屏失败占位、中英文提示、无伪数据表和保存拒绝通过');
}
