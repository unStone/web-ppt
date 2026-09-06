import { changeValue, openFixture, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';
import { installLocalSaveBoundary, restoreLocalSaveBoundary } from './site-local-save-boundary.mjs';

export async function runSiteMixedBrowserContract(context) {
  const { evaluate, waitFor, click } = context;
  await installLocalSaveBoundary(context);
  try {
    await openFixture(context, '/fixtures/mixed-patched.pptx', 'all-features.pptx');
    await click('[data-site-locale="en"]');
    // 选择窗格按前景倒序排列；两种图表同名，最后一项才是底层经典图表。
    await evaluate(`[...document.querySelectorAll('[data-pane-element]')].filter(e=>e.querySelector('[data-pane-name]')?.textContent==='图表').at(-1)?.click()`);
    const grid = '[data-chart-grid=category]';
    await waitFor(`!!document.querySelector('${grid} tbody input')`, '混合文稿数据表');
    await changeValue(context, `${grid} thead th:nth-child(2) input`, 'Mixed revenue');
    await changeValue(context, `${grid} tbody tr:first-child td:first-child input`, '混合季度');
    await changeValue(context, `${grid} tbody tr:first-child td:nth-child(2) input`, '8888');
    const dimensions = await evaluate(`({rows:document.querySelectorAll('${grid} tbody tr').length,columns:document.querySelectorAll('${grid} thead th').length})`);
    await evaluate("[...document.querySelectorAll('#chartInspector button')].find(b=>b.textContent==='Add series')?.click()");
    await waitFor(`document.querySelectorAll('${grid} thead th').length === ${dimensions.columns + 1}`, '混合图表增加系列');
    await evaluate("[...document.querySelectorAll('#chartInspector button')].find(b=>b.textContent==='Add category')?.click()");
    await waitFor(`document.querySelectorAll('${grid} tbody tr').length === ${dimensions.rows + 1}`, '混合图表增加类别');
    await evaluate(`document.querySelector('${grid} thead th:last-child button').click()`);
    await waitFor(`document.querySelectorAll('${grid} thead th').length === ${dimensions.columns}`, '删除系列刷新表格');
    await evaluate(`document.querySelector('${grid} tbody tr:last-child td:first-child button').click()`);
    await waitFor(`document.querySelectorAll('${grid} tbody tr').length === ${dimensions.rows} && document.querySelectorAll('${grid} thead th').length === ${dimensions.columns}`, '混合图表删除系列与类别');
    await click('#undo'); await click('#redo');
    await waitFor("document.querySelector('[data-ppt-layer=static]')?.textContent.includes('8,888')", '混合数据历史');
    await click('#mediaTools');
    await waitFor("document.querySelector('#mediaDialog')?.open", '同文稿插入媒体');
    await evaluate(`(async () => {
      const bytes = await fetch('/fixtures/sample-editor-media.wav').then(r=>r.arrayBuffer());
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], '追加音频.wav', {type:'audio/wav'}));
      const input = document.querySelector('#mediaFile');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`, true);
    await click('#insertMedia');
    await waitFor("!document.querySelector('#mediaDialog')", '混合新增音频完成');
    await click('#commentsTools');
    await waitFor("document.querySelectorAll('#commentsPanel li').length === 2", '混合批注');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('#commentsTitle')?.textContent === '批注'", '同文稿切中文');
    await click('#saveToFile');
    await waitFor("globalThis.__pickerCalls.length === 1 && !document.querySelector('#fileName').textContent.startsWith('●')", '混合文稿本机保存');
    const retained = await evaluate(`(async () => {
      const core=await import('/chartex-core.mjs');
      const bytes=await globalThis.__savedHandle.getFile().then(f=>f.arrayBuffer());
      const p=await core.parse(bytes,{lazy:false});
      const result={ pages:p.slides.length,comments:p.slides[0].comments.length,
        audio:p.slides[0].elements.filter(e=>e.media?.kind==='audio').length,
        video:p.slides[0].elements.some(e=>e.media?.kind==='video'),
        text:core.slideText(p.slides[0]) };
      p.dispose();
      const transfer=new DataTransfer();transfer.items.add(new File([bytes],'mixed-local-reopened.pptx'));
      const input=document.querySelector('#fileInput');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
      return result;
    })()`, true);
    if (retained.pages !== 10 || retained.comments !== 2 || retained.audio !== 2 || !retained.video
      || !retained.text.includes('Mixed revenue') || !retained.text.includes('混合季度') || !retained.text.includes('8,888')) throw new Error(`混合本机保存丢失内容：${JSON.stringify(retained)}`);
    await waitFor("document.querySelector('#fileName').textContent === 'mixed-local-reopened.pptx' && !document.querySelector('#editorApp').dataset.loading", '混合本机字节重开');
    await captureSaveAndReopen(context, 'mixed-download-reopened.pptx');
    await waitFor("document.querySelector('[data-ppt-layer=static]')?.textContent.includes('8,888')", '混合下载重开');
    await click('#commentsTools');
    await waitFor("document.querySelectorAll('#commentsPanel li').length === 2", '双路径保存后批注保留');
    await click('#commentsPanel [data-close]');
  } finally { await restoreLocalSaveBoundary(context); }
  console.log('  全类型混合文稿：系列/类别/数值、音频插入、中英文、本机写入与下载重开通过');
}
