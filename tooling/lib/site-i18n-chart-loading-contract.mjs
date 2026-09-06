import { openFixture, selectPaneObject } from './site-editor-browser-helpers.mjs';

/** 只在原生模块网络边界延迟或失败，图表选择、状态和后续文稿仍走真实页面。 */
export async function runSiteI18nChartLoadingContract(context) {
  const { evaluate, request, click, waitFor, onEvent, chartChunks } = context;
  for (const kind of ['tools', 'data']) for (const abandoned of [false, true]) {
    await request('Page.navigate', { url: await evaluate("new URL('editor.en.html', location.href).href") });
    const ready = "document.querySelector('#canvasMount')?.firstElementChild && !document.querySelector('#editorApp').dataset.loading";
    await waitFor(`document.querySelector('#recoveryPrompt') && (!document.querySelector('#recoveryPrompt').hidden || (${ready}))`, '图表加载负例冷启动');
    if (await evaluate("!document.querySelector('#recoveryPrompt').hidden")) await click('#discardRecovery');
    await waitFor(ready, '冷启动文稿就绪');
    const paused = [];
    let resolvePaused, timeout;
    const requested = new Promise((resolve) => { resolvePaused = resolve; });
    const unsubscribe = onEvent((event) => {
      if (event.method === 'Fetch.requestPaused') { paused.push(event.params.requestId); resolvePaused(); }
    });
    await request('Network.setCacheDisabled', { cacheDisabled: true });
    await request('Fetch.enable', { patterns: chartChunks[kind].map((path) => ({ urlPattern: `*${path}`, requestStage: 'Request' })) });
    try {
      await openFixture(context, '/fixtures/sample-chart-data.pptx', `chart-${kind}.pptx`);
      await selectPaneObject(context, '图表');
      await Promise.race([requested, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`没有捕获图表 ${kind} 模块请求`)), 5000);
      })]);
      await click('[data-site-locale="zh-CN"]');
      if (abandoned) await selectPaneObject(context, 'Title');
      const before = await evaluate("document.querySelector('#statusText').textContent");
      for (const requestId of paused.splice(0)) await request('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
      if (abandoned) {
        // 等待浏览器同一模块图的失败结算，不用固定延时猜测旧 import 是否已经拒绝。
        if (!await evaluate(`import(${JSON.stringify(chartChunks[kind][0])}).then(() => false, () => true)`, true)) {
          throw new Error('模块失败负例没有经过真实的浏览器加载拒绝');
        }
        if (!await evaluate(`document.querySelector('#chartInspector').hidden
          && document.querySelector('#statusText').textContent === ${JSON.stringify(before)}`)) throw new Error(`过期图表 ${kind} 加载失败污染新选择`);
      } else {
        const source = kind === 'tools' ? '无法加载图表工具：' : '无法读取图表数据：';
        await waitFor(`document.querySelector('#statusText').textContent.startsWith(${JSON.stringify(source)})`, `图表 ${kind} 加载失败中文摘要`);
        const diagnostic = await evaluate(`document.querySelector('#statusText').textContent.slice(${source.length})`);
        await click('[data-site-locale="en"]');
        const prefix = kind === 'tools' ? 'Could not load chart tools: ' : 'Could not read chart data: ';
        await waitFor(`document.querySelector('#statusText').textContent === ${JSON.stringify(prefix + diagnostic)}`, '模块原始诊断保留并原地切英文');
        if (!await evaluate("!document.querySelector('#saveFile').disabled")) throw new Error('图表模块失败不应阻止保存文稿');
      }
    } finally {
      clearTimeout(timeout);
      for (const requestId of paused) await request('Fetch.continueRequest', { requestId });
      await request('Fetch.disable'); await request('Network.setCacheDisabled', { cacheDisabled: false }); unsubscribe();
    }
  }
  await openFixture(context, '/fixtures/sample-editor-shape-format.pptx', 'after-chart-failure.pptx');
  await waitFor("document.querySelector('#chartInspector').hidden", '失败后普通文稿可继续使用');
}
