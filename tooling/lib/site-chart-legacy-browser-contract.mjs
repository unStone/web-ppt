import assert from 'node:assert/strict';
import { selectPaneObject, changeValue, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';
import { runSiteChartUnresolvedBrowserContract } from './site-chart-unresolved-browser-contract.mjs';

export async function runSiteChartLegacyBrowserContract(context) {
  await runSiteChartUnresolvedBrowserContract(context);
  const { evaluate, waitFor, click, request } = context;
  for (const name of ['cache', 'scatter-horizontal']) {
    const url = `/fixtures/sample-chart-shared-transition-${name}.pptx`;
    const address = await evaluate(`new URL('editor.html?lang=zh-CN&legacy=${name}', location.href).href`);
    await request('Page.navigate', { url: address });
    await waitFor(`location.href === ${JSON.stringify(address)} && document.querySelector('#fileName')?.textContent === 'showcase.pptx'
      && !document.querySelector('#editorApp')?.dataset.loading`, '未加载图表扩展的新应用就绪');
    const seed = await evaluate(`(async () => {
      const frame = document.createElement('iframe'); document.body.append(frame);
      try { return await frame.contentWindow.eval('import("/legacy-chart-seed.mjs").then(api => api.seedLegacyChartRecovery("${url}"))'); }
      finally { frame.remove(); }
    })()`, true);
    assert.ok(seed.frames > 5);
    const filename = `legacy-${name}.pptx`;
    await evaluate(`(async () => {
      const bytes = await fetch('${url}').then(response => response.arrayBuffer());
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], '${filename}'));
      const input = document.querySelector('#fileInput'); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await waitFor("document.querySelector('#recoveryPrompt')?.hidden === false", '旧局部图表日志触发产品恢复选择');
    await click('#restoreRecovery');
    await waitFor(`document.querySelector('#fileName')?.textContent.replace(/^● /, '') === '${filename}'
      && !document.querySelector('#editorApp')?.dataset.loading`, '旧日志恢复完成');
    assert.equal(await evaluate("document.querySelectorAll('#slideList [data-slide-id]').length"), seed.pages);
    await click('#slideList [data-slide-id]:first-child');
    await waitFor("document.querySelector('#canvasMount')?.textContent.includes('Legacy recovered series')",
      '尚未打开检查器，恢复首屏已显示旧系列名称');
    await click('#editMode'); await selectPaneObject(context, '图表');
    const xy = seed.kind === 'xy';
    const cell = xy ? '.chart-xy-series:first-of-type tbody tr:last-child td:nth-child(2) input'
      : '[data-chart-grid] tbody tr:last-child input[type="number"]';
    const count = xy ? "document.querySelectorAll('.chart-xy-series:first-of-type tbody tr').length"
      : "document.querySelectorAll('[data-chart-category]').length";
    await waitFor(`!document.querySelector('#chartInspector').hidden && document.querySelector('${cell}')?.value === '729'
      && !document.querySelector('${cell}').disabled`, '迁移后的旧结构可继续编辑');
    assert.equal(await evaluate(count), seed.rows);
    const seriesCount = xy ? "document.querySelectorAll('.chart-xy-series').length"
      : "document.querySelectorAll('[data-chart-grid] thead input').length";
    assert.equal(await evaluate(seriesCount), seed.series);
    await changeValue(context, cell, '937');
    await click('#slideList [data-slide-id]:nth-child(2)'); await selectPaneObject(context, '图表');
    await waitFor(`document.querySelector('${cell}')?.value === '937'`, '迁移后修改联动另一个幸存副本');
    await click('#undo'); await waitFor(`document.querySelector('${cell}')?.value === '729'`, '迁移后的新编辑可整次撤销');
    await click('#redo'); await waitFor(`document.querySelector('${cell}')?.value === '937'`, '迁移后的新编辑可重做');
    await click('[data-site-locale="en"]');
    await waitFor("document.querySelector('#chartInspector h2')?.textContent === 'Chart data'", '迁移恢复支持英文检查器');
    await changeValue(context, cell, '953');
    await click('#slideList [data-slide-id]:first-child'); await selectPaneObject(context, '图表');
    await waitFor(`document.querySelector('${cell}')?.value === '953'`, '英文重建后修改仍联动另一副本');
    await click('#undo'); await waitFor(`document.querySelector('${cell}')?.value === '937'`, '英文新编辑可撤销');
    await click('#redo'); await waitFor(`document.querySelector('${cell}')?.value === '953'`, '英文新编辑可重做');
    await captureSaveAndReopen(context, `legacy-${name}-saved.pptx`);
    await click('#editMode'); await click('#slideList [data-slide-id]:first-child'); await selectPaneObject(context, '图表');
    await waitFor(`document.querySelector('${cell}')?.value === '953'`, '英文修改经产品保存重开保持');
    assert.equal(await evaluate(count), seed.rows); assert.equal(await evaluate(seriesCount), seed.series);
    await click('[data-site-locale="zh-CN"]');
  }
  console.log('旧图表产品恢复：真实 IndexedDB、首屏投影、来源删除后二次复制、层级缓存/横向散点、中英文、共享撤销与保存重开通过');
}
