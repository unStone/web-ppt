import { openFixture } from './site-editor-browser-helpers.mjs';
import { coldSavePage, installLocalSaveBoundary, restoreLocalSaveBoundary } from './site-local-save-boundary.mjs';
import { reopenLocalFile } from './site-local-save-lifecycle-contract.mjs';

export async function runLocalSaveRaceContract(context) {
  const { evaluate, click, waitFor, request, onEvent, saveChunks } = context;
  await coldSavePage(context, 'generation');
  await openFixture(context, '/fixtures/sample-editor-shape-format.pptx', 'generation-race.pptx');
  await installLocalSaveBoundary(context);
  const paused = [];
  let resolveRequested, timer;
  const requested = new Promise(resolve => { resolveRequested = resolve; });
  const unsubscribe = onEvent(event => {
    if (event.method === 'Fetch.requestPaused') { paused.push(event.params.requestId); resolveRequested(); }
  });
  await request('Network.setCacheDisabled', { cacheDisabled: true });
  await request('Fetch.enable', { patterns: saveChunks.map(path => ({ urlPattern: `*${path}`, requestStage: 'Request' })) });
  try {
    await evaluate(`(async () => {
      const stream = await globalThis.__savedHandle.createWritable();
      await stream.write('original file sentinel'); await stream.close();
    })()`, true);
    await click('#addShape');
    const count = await evaluate("document.querySelectorAll('[data-pane-element]').length");
    await click('#saveToFile');
    await Promise.race([requested, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('未捕获真实序列化模块请求')), 5000);
    })]);
    await evaluate("document.querySelector('#canvasMount > div').focus()");
    for (const type of ['rawKeyDown', 'keyUp']) await request('Input.dispatchKeyEvent', {
      type, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39,
    });
    await click('[data-site-locale="zh-CN"]');
    for (const requestId of paused.splice(0)) await request('Fetch.continueRequest', { requestId });
    await waitFor("document.querySelector('#statusText').textContent === '文稿在生成期间已变化，请重新保存' && !document.querySelector('#saveToFile').disabled", '序列化期间变化不交付混合版本');
    if (!await evaluate(`(async () => document.querySelector('#fileName').textContent.startsWith('● ')
      && document.querySelector('#saveAsFile').hidden && !globalThis.__localDownloads.length
      && await (await globalThis.__savedHandle.getFile()).text() === 'original file sentinel')()`, true)) {
      throw new Error('拒绝生成竞态必须保留原文件、脏状态和未选定目标');
    }
    await click('[data-site-locale="en"]');
    await waitFor("document.querySelector('#statusText').textContent === 'The presentation changed while preparing the file. Save again.'", '生成竞态提示切英文');
    await click('#saveToFile');
    await waitFor("document.querySelector('#statusText').textContent === 'Saved to local-save.pptx' && !document.querySelector('#fileName').textContent.startsWith('● ')", '生成竞态后重新保存成功');
    await reopenLocalFile(context, count);
  } finally {
    clearTimeout(timer);
    for (const requestId of paused) await request('Fetch.continueRequest', { requestId });
    await request('Fetch.disable'); await request('Network.setCacheDisabled', { cacheDisabled: false });
    unsubscribe(); await restoreLocalSaveBoundary(context);
  }
}
