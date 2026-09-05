export async function runSiteI18nStartupContract({ evaluate, request, click, waitFor, dictionaryUrls, onEvent }) {
  const paused = [];
  let notifyPaused, timeout;
  const dictionaryRequested = new Promise((resolve) => { notifyPaused = resolve; });
  const unsubscribe = onEvent((event) => {
    if (event.method === 'Fetch.requestPaused') { paused.push(event.params.requestId); notifyPaused(); }
  });
  await request('Network.enable');
  await request('Network.setCacheDisabled', { cacheDisabled: true });
  await request('Fetch.enable', { patterns: dictionaryUrls.map((path) => ({ urlPattern: `*${path}`, requestStage: 'Request' })) });
  try {
    const url = await evaluate("new URL('editor.en.html', location.href).href");
    await request('Page.navigate', { url });
    await Promise.race([dictionaryRequested, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('未拦截到真实英文词库请求')), 5000);
    })]);
    await waitFor("document.querySelector('#newFile') && document.querySelector('[data-site-text]')", '英文冷启动页面与语言模块初始化');
    if (!paused.length) throw new Error('未拦截到真实英文词库请求');
    if (!await evaluate("document.querySelector('#newFile').disabled && document.querySelector('#fileInput').disabled")) throw new Error('词库未就绪时不能开放依赖词条的新建/文件入口');
  } finally {
    clearTimeout(timeout);
    for (const requestId of paused) await request('Fetch.continueRequest', { requestId });
    await request('Fetch.disable');
    await request('Network.setCacheDisabled', { cacheDisabled: false });
    unsubscribe();
  }
  await waitFor("document.querySelector('#canvasMount')?.firstElementChild && !document.querySelector('#editorApp').dataset.loading", '词库释放后继续打开示例');
  await click('#newFile');
  await waitFor("document.querySelector('#templateDialogTitle')?.textContent === 'New presentation'", '慢词库就绪后模板可用');
  await click('[data-template-id="blank"]');
  await waitFor("document.querySelector('#fileName').textContent === 'Untitled presentation.pptx' && !document.querySelector('#editorApp').dataset.loading", '英文冷启动新建成功');
}

export async function runSiteI18nDictionaryFailureContract({ evaluate, request, click, waitFor, dictionaryUrls, onEvent, consumeConsoleFailure }) {
  const rejected = [];
  const unsubscribe = onEvent((event) => {
    if (event.method === 'Fetch.requestPaused') rejected.push(request('Fetch.failRequest', {
      requestId: event.params.requestId, errorReason: 'Aborted',
    }));
  });
  await request('Network.setCacheDisabled', { cacheDisabled: true });
  await request('Fetch.enable', { patterns: dictionaryUrls.map((path) => ({ urlPattern: `*${path}`, requestStage: 'Request' })) });
  try {
    await request('Page.navigate', { url: await evaluate("new URL('editor.en.html', location.href).href") });
    await waitFor("document.querySelector('#siteLanguage [role=alert]')", '英文词库网络失败提示');
    await waitFor("document.documentElement.lang === 'zh-CN' && document.querySelector('#canvasMount')?.firstElementChild && !document.querySelector('#editorApp').dataset.loading", '英文词库失败后明确回退可用中文');
    if (!rejected.length) throw new Error('英文词库失败负例没有触发真实请求');
    for (const path of dictionaryUrls) {
      const url = await evaluate(`new URL(${JSON.stringify(path)}, location.href).href`);
      if (!consumeConsoleFailure(`Failed to fetch dynamically imported module: ${url}`)) throw new Error('缺少词库加载失败的诊断日志');
    }
    await click('#newFile');
    await waitFor("document.querySelector('#templateDialogTitle')?.textContent === '新建演示文稿'", '词库失败后模板仍可用');
    await click('[data-template-id="blank"]');
    await waitFor("document.querySelector('#fileName').textContent === '未命名演示文稿.pptx' && !document.querySelector('#editorApp').dataset.loading", '中文回退可新建');
  } finally {
    await Promise.all(rejected);
    await request('Fetch.disable');
    await request('Network.setCacheDisabled', { cacheDisabled: false });
    unsubscribe();
  }
  if (!await evaluate("document.querySelector('#siteLanguage [role=alert]').textContent.includes('save and reload')")) throw new Error('词库失败必须说明先保存再刷新，不能自动重建编辑会话');
  await request('Page.reload');
  await waitFor("document.documentElement.lang === 'en' && !document.querySelector('#siteLanguage [role=alert]') && document.querySelector('#canvasMount')?.firstElementChild && !document.querySelector('#editorApp').dataset.loading", '网络恢复后刷新可重新加载英文');
}
