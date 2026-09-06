export async function runSiteI18nHomeContract({ evaluate, request, click, waitFor, onEvent }) {
  const transfers = [];
  const index = { base: 'https://unstone.github.io/web-ppt-samples/', samples: [
    { file: 'taste-grammar-gallery.pptx', title: '复制', highlight: '<作者原文>', demo: true },
    { file: 'remaining-one.pptx', title: '其余一' }, { file: 'remaining-two.pptx', title: '其余二' },
  ] };
  const unsubscribe = onEvent((event) => {
    if (event.method !== 'Fetch.requestPaused') return;
    const { requestId, request: intercepted } = event.params;
    transfers.push(request('Fetch.fulfillRequest', { requestId,
      responseCode: intercepted.url.endsWith('/index.json') ? 200 : 503,
      body: intercepted.url.endsWith('/index.json') ? Buffer.from(JSON.stringify(index)).toString('base64') : '',
      responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'application/json' }],
    }));
  });
  await request('Fetch.enable', { patterns: [{ urlPattern: 'https://unstone.github.io/web-ppt-samples/index.json' }, { urlPattern: '*/demo/hardcases.pptx' }] });
  try {
    await request('Page.navigate', { url: await evaluate("new URL('index.en.html', location.href).href") });
    await waitFor("document.querySelector('#demoRoot') && document.documentElement.lang === 'en'", '首页动态展示');
    await evaluate("document.querySelector('#demoRoot').scrollIntoView({ behavior: 'instant' })");
    await waitFor("document.querySelector('#archDiagram svg')?.getAttribute('aria-label') === 'Web-PPT architecture diagram'", '架构图英文可访问名称');
    if (!await evaluate(`!/[\u4e00-\u9fff]/.test(document.querySelector('#archDiagram').textContent)
      && document.querySelector('#archDiagram').textContent.includes('Unified schema')`)) throw new Error('英文架构图仍有未翻译文案');
    await waitFor("document.querySelector('.samples .more')?.textContent === 'More samples: 2'", '更多样本数量英文');
    if (!await evaluate(`document.querySelector('.samples .more').href.includes('samples.en.html')
      && document.querySelector('.samples .remote').textContent === '复制'
      && document.querySelector('.samples .remote').title === '<作者原文>'`)) throw new Error('更多导航丢失语言或样本原文被翻译');
    await evaluate("document.querySelector('#hardGrid').scrollIntoView({ behavior: 'instant' })");
    await waitFor("[...document.querySelectorAll('#hardGrid .good .pane')].every((node) => node.textContent === 'Could not load the sample')", '疑难案例失败英文');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('#archDiagram svg')?.getAttribute('aria-label') === 'Web-PPT 架构图' && document.querySelector('.samples .more')?.textContent === '更多 2 个'", '首页动态展示原地切中文');
    if (!await evaluate("[...document.querySelectorAll('#hardGrid .good .pane')].every((node) => node.textContent === '样本载入失败')")) throw new Error('疑难案例错误未随语言更新');
    await waitFor("document.querySelector('#stage svg')", '真实查看器就绪');
    for (let page = 1; page < 4; page++) await click('#next');
    await waitFor("document.querySelector('#stage a[href=\"https://example.com\"]')", '真实幻灯片外链');
    await click('#stage a[href="https://example.com"]');
    await waitFor("!document.querySelector('#linkToast').hidden", '超链接提示');
    await click('[data-site-locale="en"]');
    await waitFor("document.querySelector('#linkToast').textContent.startsWith('This is a hyperlink: ')", '超链接提示切英文');
    if (!await evaluate("document.querySelector('#linkToast a').textContent === 'https://example.com' && document.querySelector('#linkToast a').getAttribute('href') === 'https://example.com'")) throw new Error('用户超链接被产品语言改写');
  } finally {
    await Promise.all(transfers); await request('Fetch.disable'); unsubscribe();
  }
}
