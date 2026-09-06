import { readFileSync } from 'node:fs';
import { runViewerFullscreenContract, runViewerCopyContract, runViewerNavigationKeysContract } from './site-viewer-controls-contract.mjs';
import { runSiteLanguageInputContract } from './site-language-input-contract.mjs';

export async function runSiteI18nGalleryContract({ evaluate, request, click, waitFor, onEvent }) {
  const transfers = [];
  const pending = [];
  const body = readFileSync(new URL('../../fixtures/showcase.pptx', import.meta.url)).toString('base64');
  const index = { base: 'https://unstone.github.io/web-ppt-samples/', samples: [
    { file: 'language-contract.pptx', title: '复制', author: '<中文作者>', highlight: '保留原文', license: 'CC0',
      source: 'https://example.org/original?lang=zh-CN', demo: true },
  ] };
  const unsubscribe = onEvent((event) => {
    if (event.method !== 'Fetch.requestPaused') return;
    const { requestId, request: intercepted } = event.params;
    if (intercepted.url.endsWith('/index.json')) transfers.push(request('Fetch.fulfillRequest', {
      requestId, responseCode: 200, body: Buffer.from(JSON.stringify(index)).toString('base64'),
      responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'application/json' }],
    }));
    else pending.push(requestId);
  });
  await request('Fetch.enable', { patterns: [{ urlPattern: 'https://unstone.github.io/web-ppt-samples/*' }] });
  try {
    await request('Page.navigate', { url: await evaluate("new URL('samples.en.html', location.href).href") });
    const card = '.sample-card[data-file="language-contract.pptx"]';
    await waitFor(`document.querySelector('${card} button')?.textContent === 'Preview'`, '新增样本卡片英文入口');
    if (!await evaluate(`document.querySelector('${card} h3').textContent === '复制'
      && document.querySelector('${card} .sample-credit').textContent.includes('<中文作者>')
      && document.querySelector('${card} .sample-foot a').href.includes('index.en.html?sample=language-contract.pptx')
      && document.querySelector('${card} .sample-credit a').href === 'https://example.org/original?lang=zh-CN'`)) throw new Error('动态导航未保留语言，或样本原文/出处被翻译');
    await click(`${card} button`);
    await waitFor("document.querySelector('.preview [role=dialog]')?.getAttribute('aria-label') === 'Sample preview' && document.querySelector('.preview #siteLanguage')", '英文预览浮层与语言入口');
    await waitFor("document.querySelector('.preview-stage .loading-label')?.textContent === 'Downloading · 0.0MB'", '英文样本下载中');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('.preview-stage .loading-label')?.textContent === '下载中 · 0.0MB'", '预览下载中切中文');
    if (pending.length !== 1) throw new Error('预览必须仅下载用户选择的一份样本');
    await request('Fetch.fulfillRequest', { requestId: pending.shift(), responseCode: 200, body,
      responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }] });
    await waitFor("document.querySelector('.preview-stage svg') && document.querySelector('.preview-meta').textContent.includes('7 页')", '真实样本文稿渲染');
    await click('.preview-next');
    await waitFor("document.querySelector('.preview-pager').textContent === '2 / 7'", '样本查看器第二页');
    await evaluate("globalThis.__previewView = document.querySelector('.preview-stage').firstElementChild; globalThis.__previewBytes = document.querySelector('.preview-dl').href");
    await click('[data-site-locale="en"]');
    await waitFor("document.querySelector('.preview-meta').textContent.includes('Slides: 7') && document.querySelector('.preview-meta').textContent.includes('Parse ')", '已打开样本切英文');
    if (!await evaluate("document.querySelector('.preview-title').textContent === '复制' && document.querySelector('.preview-pager').textContent === '2 / 7' && globalThis.__previewView === document.querySelector('.preview-stage').firstElementChild && globalThis.__previewBytes === document.querySelector('.preview-dl').href && document.querySelector('.preview-dl').download === 'language-contract.pptx'")) throw new Error('语言切换改变样本内容、页码、视图或下载');
    const context = { evaluate, request, click, waitFor };
    await runSiteLanguageInputContract(context, '样本预览');
    await runViewerCopyContract(context, '.preview-share', '复制链接', 'Copy link');
    await runViewerFullscreenContract(context, '.preview-full', '.preview-stage', '.preview-pager');
    await runViewerNavigationKeysContract(context, '.preview-next', '.preview-pager');
    await click('.preview-close');
    if (!await evaluate("document.querySelector('.preview').hidden && !document.querySelector('.preview #siteLanguage') && document.querySelector('#siteLanguage')?.isConnected && !new URL(location.href).searchParams.has('sample')")) throw new Error('关闭预览未归还语言入口或清理深链');
    await click(`${card} button`);
    await waitFor("document.querySelector('.preview-stage .loading-label')", '再次打开样本');
    if (!await evaluate("document.querySelector('.preview-dl').hidden && new URL(document.querySelector('[data-site-locale=zh-CN]').href).searchParams.get('sample') === 'language-contract.pptx'")) throw new Error('下载中仍暴露旧下载，或语言链接丢失当前样本深链');
    await request('Fetch.fulfillRequest', { requestId: pending.shift(), responseCode: 503,
      responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }] });
    await waitFor("document.querySelector('.preview-stage .err')?.textContent === 'Could not load (HTTP 503)'", '预览真实 HTTP 错误');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('.preview-stage .err')?.textContent === '载入失败（HTTP 503）' && document.querySelector('.preview-meta').textContent === ''", '预览错误切语言不复活元数据');
    const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor("document.querySelector('.preview').hidden && !document.querySelector('.preview #siteLanguage')", '错误时 Esc 归还入口');
    for (const code of [503, 200]) await runGalleryLateResponseContract(context, card, pending, body, code);
    await click(`${card} button`);
    await waitFor("!!document.querySelector('.preview-stage .loading-label')", '批注样本加载');
    const commentBody = await evaluate("fetch('/fixtures/sample-editor-comments.pptx').then(r=>r.arrayBuffer()).then(b=>btoa(String.fromCharCode(...new Uint8Array(b))))", true);
    await request('Fetch.fulfillRequest', { requestId: pending.shift(), responseCode: 200, body: commentBody,
      responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }] });
    await waitFor("document.querySelector('.preview-stage svg')", '批注样本渲染');
    await click('.preview-comments');
    await waitFor("document.querySelectorAll('#commentsPanel li').length === 2", '样本批注');
    await click('.preview-next');
    await waitFor("document.querySelectorAll('#commentsPanel li').length === 1", '样本批注翻页');
    await click('.preview-close');
    if (await evaluate("!!document.querySelector('#commentsPanel')")) throw new Error('关闭预览未释放批注');
  } finally {
    for (const requestId of pending) await request('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
    await Promise.all(transfers);
    await request('Fetch.disable');
    unsubscribe();
  }
}

async function runGalleryLateResponseContract({ evaluate, request, click, waitFor }, card, pending, body, code) {
  await click('[data-site-locale="zh-CN"]');
  await click(`${card} button`);
  await waitFor("document.querySelector('.preview-stage .loading-label')", '旧预览开始下载');
  await click('.preview-close');
  await click(`${card} button`);
  await waitFor("document.querySelector('.preview-stage .loading-label')", '下载未完成时重开预览');
  if (pending.length !== 2) throw new Error('乱序完成负例未控制两个实际请求');
  const old = pending.shift(), current = pending.shift();
  await request('Fetch.fulfillRequest', { requestId: current, responseCode: 200, body,
    responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }] });
  await waitFor("document.querySelector('.preview-stage svg') && document.querySelector('.preview-meta').textContent.includes('7 页')", '新预览先完成');
  await evaluate(`(() => {
    globalThis.__latestPreview = document.querySelector('.preview-stage').firstElementChild;
    globalThis.__lateResponseObserved = new Promise((resolve) => {
      const observer = new PerformanceObserver((list) => {
        if (list.getEntries().some((entry) => entry.name.endsWith('/language-contract.pptx'))) {
          observer.disconnect(); requestAnimationFrame(() => requestAnimationFrame(resolve));
        }
      }); observer.observe({ type: 'resource' });
    });
  })()`);
  await request('Fetch.fulfillRequest', { requestId: old, responseCode: code, ...(code === 200 ? { body } : {}),
    responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }] });
  await evaluate('globalThis.__lateResponseObserved', true);
  await click('[data-site-locale="en"]');
  if (!await evaluate("globalThis.__latestPreview === document.querySelector('.preview-stage').firstElementChild && document.querySelector('.preview-meta').textContent.includes('Slides: 7') && !document.querySelector('.preview-stage .err')")) throw new Error(`已关闭请求的迟到响应 ${code} 覆盖了新预览`);
  await click('.preview-close');
}
