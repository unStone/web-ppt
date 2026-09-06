import { captureSaveAndReopen, openFixture } from './site-editor-browser-helpers.mjs';
import { runSiteLanguageInputContract } from './site-language-input-contract.mjs';
import { readFileSync } from 'node:fs';

/** 默认示例是网络任务；失败不能挡住纯本机编辑，也不能把站点中文当成外部诊断保留。 */
export async function runSiteI18nBootstrapContract(context) {
  const { request, evaluate, waitFor, click, onEvent } = context;
  const transfers = [];
  let failure = 'http';
  const unsubscribe = onEvent(event => {
    if (event.method !== 'Fetch.requestPaused') return;
    const requestId = event.params.requestId;
    transfers.push(failure === 'network' ? request('Fetch.failRequest', {
      requestId, errorReason: 'InternetDisconnected',
    }) : request('Fetch.fulfillRequest', {
      requestId, responseCode: 503,
      responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: '',
    }));
  });
  await request('Network.enable');
  await request('Network.setCacheDisabled', { cacheDisabled: true });
  await request('Fetch.enable', { patterns: [{ urlPattern: '*/demo/showcase.pptx' }] });
  try {
    for (failure of ['http', 'network']) {
      await request('Page.navigate', { url: await evaluate("new URL('editor.en.html', location.href).href") });
      const english = failure === 'http'
        ? 'Could not download the example: HTTP 503. You can still open a local file or create a presentation.'
        : 'Could not download the example: Network unavailable. You can still open a local file or create a presentation.';
      const chinese = failure === 'http'
        ? '示例下载失败：HTTP 503。仍可打开本地文件或新建文稿。'
        : '示例下载失败：网络不通。仍可打开本地文件或新建文稿。';
      const shown = (text) => `document.querySelector('#statusText')?.textContent === ${JSON.stringify(text)}
        && document.querySelector('#canvasState small')?.textContent === ${JSON.stringify(text)}`;
      await waitFor(shown(english), `冷启动 ${failure} 失败的英文产品提示`);
      await waitFor("document.querySelector('#documentKind').textContent === 'No presentation open'", '没有文稿时不误报 PPTX 可编辑');
      if (!transfers.length || !await evaluate(`!document.querySelector('#canvasMount').firstElementChild
        && !document.querySelector('#editorApp').dataset.loading && !document.querySelector('#fileInput').disabled
        && !document.querySelector('#newFile').disabled && document.querySelector('#saveFile').disabled
        && document.querySelector('#undo').disabled`)) throw new Error('示例失败必须仍可打开/新建本地文稿，不能伪造可保存状态');
      await click('[data-site-locale="zh-CN"]');
      await waitFor(shown(chinese), '已有下载错误切回中文');
      await waitFor("document.querySelector('#documentKind').textContent === '未打开文稿'", '空文稿状态切回中文');
      await click('[data-site-locale="en"]');
      await waitFor(shown(english), '已有下载错误再切英文');
      await runSiteLanguageInputContract(context, '冷启动失败');
      if (failure === 'http') {
        await openFixture(context, '/fixtures/sample-editor-shape-format.pptx', '<本机恢复 & 原文>.pptx');
        await waitFor(`document.querySelector('#statusText').textContent === '<本机恢复 & 原文>.pptx is ready. Select, drag or double-click text to edit.'
          && document.querySelector('#canvasMount').firstElementChild && !document.querySelector('#saveFile').disabled
          && document.querySelector('#undo').disabled`, '默认下载失败后仍可完整打开本地文稿');
      } else {
        await click('#newFile');
        await waitFor("document.querySelector('#templateDialog')?.open && document.querySelector('[data-template-id=blank]')", '网络失败后按需模板就绪');
        await click('[data-template-id="blank"]');
        await waitFor(`document.querySelector('#fileName').textContent === 'Untitled presentation.pptx'
          && !document.querySelector('#editorApp').dataset.loading`, '网络失败后仍能本机新建文稿');
      }
      await click('#addShape');
      await click('#undo');
      await waitFor("document.querySelector('#undo').disabled && !document.querySelector('#redo').disabled", '失败恢复后编辑与历史可用');
      await click('#redo');
      await captureSaveAndReopen(context, 'bootstrap-recovered.pptx');
    }
  } finally {
    await Promise.all(transfers);
    await request('Fetch.disable');
    await request('Network.setCacheDisabled', { cacheDisabled: false });
    unsubscribe();
  }
  await lateSample(context);
}

async function lateSample(context) {
  const { request, evaluate, waitFor, click, onEvent } = context;
  const body = readFileSync(new URL('../../fixtures/showcase.pptx', import.meta.url)).toString('base64');
  for (const scenario of ['language', 'local-error', 'local-success']) {
    let resolvePaused, timeout;
    const paused = new Promise(resolve => { resolvePaused = resolve; });
    const unsubscribe = onEvent(event => {
      if (event.method === 'Fetch.requestPaused') resolvePaused(event.params.requestId);
    });
    await request('Fetch.enable', { patterns: [{ urlPattern: '*/demo/showcase.pptx' }] });
    await request('Network.setCacheDisabled', { cacheDisabled: true });
    try {
      await request('Page.navigate', { url: await evaluate("new URL('editor.en.html', location.href).href") });
      const requestId = await Promise.race([paused, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('默认示例没有发起真实下载请求')), 5000);
      })]);
      await click('[data-site-locale="zh-CN"]');
      if (scenario !== 'language') {
        await openFixture(context, '/fixtures/sample-editor-shape-format.pptx', '<优先本机 & 原文>.pptx');
        await click('#addShape');
        await evaluate(`globalThis.__bootstrapCurrent = {
          canvas: document.querySelector('#canvasMount').firstElementChild,
          status: document.querySelector('#statusText').textContent,
          file: document.querySelector('#fileName').textContent,
        }`);
      }
      await request('Fetch.fulfillRequest', { requestId, responseCode: scenario === 'local-success' ? 200 : 503,
        ...(scenario === 'local-success' ? { body } : {}),
      });
      if (scenario === 'language') {
        await waitFor("document.querySelector('#statusText').textContent === '示例下载失败：HTTP 503。仍可打开本地文件或新建文稿。'", '下载期间切语言，迟到错误使用当前中文');
      } else {
        await waitFor("performance.getEntriesByType('resource').some(entry => new URL(entry.name).pathname.endsWith('/demo/showcase.pptx'))", '默认示例网络响应已经结算');
        // 等待原生响应后的渲染帧；断言不能在迟到响应尚未到达时提前通过。
        await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', true);
        if (!await evaluate(`document.querySelector('#canvasMount').firstElementChild === globalThis.__bootstrapCurrent.canvas
          && document.querySelector('#statusText').textContent === globalThis.__bootstrapCurrent.status
          && document.querySelector('#fileName').textContent === globalThis.__bootstrapCurrent.file
          && !document.querySelector('#undo').disabled && !document.querySelector('#saveFile').disabled`)) {
          throw new Error(`迟到示例 ${scenario} 覆盖了本地文稿、状态或历史`);
        }
        await click('#undo');
        await waitFor("document.querySelector('#undo').disabled", '迟到示例不污染本地编辑历史');
      }
    } finally {
      clearTimeout(timeout);
      await request('Fetch.disable');
      await request('Network.setCacheDisabled', { cacheDisabled: false });
      unsubscribe();
      await evaluate('delete globalThis.__bootstrapCurrent');
    }
  }
}
