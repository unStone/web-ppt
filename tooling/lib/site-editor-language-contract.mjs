export async function runSiteEditorLanguageContract({ evaluate, click, waitFor }) {
  await click('#addShape');
  await waitFor("!document.querySelector('#undo').disabled", '语言切换前的编辑历史');
  const before = await evaluate(`(() => {
    globalThis.__languageCanvas = document.querySelector('#canvasMount').firstElementChild;
    return { file: document.querySelector('#fileName').textContent,
      selected: document.querySelector('[data-pane-element][aria-selected="true"]')?.dataset.paneElement,
      count: document.querySelectorAll('[data-pane-element]').length,
      zoom: document.querySelector('#zoomLabel').textContent };
  })()`);
  await click('[data-site-locale="en"]');
  await waitFor("document.documentElement.lang === 'en' && document.querySelector('#saveFile').textContent === 'Save a copy'", '英文工具栏');
  const preserved = await evaluate(`(() => ({
    sameCanvas: globalThis.__languageCanvas === document.querySelector('#canvasMount').firstElementChild,
    file: document.querySelector('#fileName').textContent,
    selected: document.querySelector('[data-pane-element][aria-selected="true"]')?.dataset.paneElement,
    zoom: document.querySelector('#zoomLabel').textContent,
  }))()`);
  if (!preserved.sameCanvas || preserved.file !== before.file || preserved.selected !== before.selected || preserved.zoom !== before.zoom) {
    throw new Error(`切换语言不能重建会话或丢失编辑上下文：${JSON.stringify({ before, preserved })}`);
  }
  await click('#undo');
  await waitFor(`document.querySelectorAll('[data-pane-element]').length === ${before.count - 1}`, '英文界面保留撤销历史');
  await waitFor("document.querySelector('#statusText').textContent === 'Last action undone'", '英文撤销状态');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.documentElement.lang === 'zh-CN' && document.querySelector('#saveFile').textContent === '保存副本'", '切回中文工具栏');
  await waitFor("document.querySelector('#statusText').textContent === '已撤销上一步'", '已显示状态随语言切换');
  await click('#redo');
  await waitFor(`document.querySelectorAll('[data-pane-element]').length === ${before.count}`, '切回中文保留重做历史');
}

export async function runSiteLanguagePreferencesContract({ evaluate, click, request, waitFor }, pages = ['editor', 'index', 'samples']) {
  const origin = await evaluate('location.origin');
  const directory = await evaluate("new URL('.', location.href).href");
  const userAgent = await evaluate('navigator.userAgent');
  const acceptLanguage = await evaluate("navigator.languages.join(',')");
  const navigate = async (path, language) => {
    const url = new URL(path, directory).href;
    await request('Page.navigate', { url });
    await waitFor(`location.href === ${JSON.stringify(url)} && document.documentElement.lang === ${JSON.stringify(language)}
      && document.querySelector('[data-site-locale="${language}"]')?.getAttribute('aria-current') === 'true'`, `${path} 语言解析`);
    if (!path.startsWith('editor')) return;
    const ready = `document.querySelector('#fileName')?.textContent === 'showcase.pptx'
      && document.querySelector('#canvasMount')?.firstElementChild && !document.querySelector('#editorApp')?.dataset.loading`;
    await waitFor(`document.querySelector('#recoveryPrompt')?.hidden === false || (${ready})`, '语言优先级测试文稿或恢复决策');
    if (await evaluate("document.querySelector('#recoveryPrompt')?.hidden === false")) await click('#discardRecovery');
    await waitFor(ready, '语言优先级测试文稿就绪');
  };
  await request('Network.enable');
  try {
    for (const page of pages) {
      await request('Network.setUserAgentOverride', { userAgent, acceptLanguage: 'zh-TW' });
      await request('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage' });
      await navigate(`${page}.html`, 'zh-CN');
      await click('[data-site-locale="en"]');
      await waitFor("document.documentElement.lang === 'en'", '用户选择英文');
      await navigate(`${page}.html`, 'en');
      await navigate(`${page}.html?lang=zh-CN&sample=kept&p=2#kept`, 'zh-CN');
      if (!await evaluate("location.search.includes('sample=kept') && location.search.includes('p=2') && location.hash === '#kept'")) {
        throw new Error('语言初始化不能清除文件、页码和位置深链接');
      }
      await click('[data-site-locale="zh-CN"]');
      await navigate(`${page}.en.html`, 'en');
      await navigate(`${page}.html?lang=unknown`, 'en');
      await request('Page.reload');
      await waitFor("document.documentElement.lang === 'en' && document.querySelector('[data-site-locale=\"en\"]')?.getAttribute('aria-current') === 'true'", '未知语言刷新仍回退英文');
      await request('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage' });
      await request('Network.setUserAgentOverride', { userAgent, acceptLanguage: 'fr-FR' });
      await navigate(`${page}.html`, 'en');
    }
  } finally {
    await request('Network.setUserAgentOverride', { userAgent, acceptLanguage });
  }
}
