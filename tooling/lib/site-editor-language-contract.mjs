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

export async function runSiteLanguagePreferencesContract({ evaluate, click, request, waitFor }) {
  const origin = await evaluate('location.origin');
  const userAgent = await evaluate('navigator.userAgent');
  const navigate = async (path, language) => {
    await request('Page.navigate', { url: origin + path });
    await waitFor(`location.href === ${JSON.stringify(origin + path)} && document.documentElement.lang === ${JSON.stringify(language)}
      && document.querySelector('#fileName')?.textContent === 'showcase.pptx'
      && document.querySelector('#canvasMount')?.firstElementChild
      && !document.querySelector('#editorApp')?.dataset.loading`, `${path} 语言解析`);
  };
  await request('Network.enable');
  await request('Network.setUserAgentOverride', { userAgent, acceptLanguage: 'zh-TW' });
  await request('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage' });
  await navigate('/editor.html', 'zh-CN');
  await click('[data-site-locale="en"]');
  await waitFor("document.documentElement.lang === 'en'", '用户选择英文');
  await navigate('/editor.html', 'en');
  await navigate('/editor.html?lang=zh-CN&sample=kept&p=2#kept', 'zh-CN');
  if (!await evaluate("location.search.includes('sample=kept') && location.search.includes('p=2') && location.hash === '#kept'")) {
    throw new Error('语言初始化不能清除文件、页码和位置深链接');
  }
  await click('[data-site-locale="zh-CN"]');
  await navigate('/editor.en.html', 'en');
  await navigate('/editor.html?lang=unknown', 'en');
  await request('Page.reload');
  await waitFor("document.documentElement.lang === 'en' && document.querySelector('#canvasMount')?.firstElementChild && document.querySelector('#fileName')?.textContent === 'showcase.pptx'", '未知语言刷新仍回退英文');
}
