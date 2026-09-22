function pressG(request) {
  const key = { key: 'g', code: 'KeyG', windowsVirtualKeyCode: 71, nativeVirtualKeyCode: 71 };
  return Promise.all([
    request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key }),
    request('Input.dispatchKeyEvent', { type: 'keyUp', ...key }),
  ]);
}

export async function runViewerOpenSessionContract({ evaluate, click, waitFor, request }) {
  await evaluate(`document.querySelector('#demoRoot')?.scrollIntoView({ block: 'start', behavior: 'instant' })`);
  await waitFor("document.querySelector('#stage svg') && document.querySelector('#meta').textContent.includes('showcase.pptx')", '打开会话前默认文稿');

  await evaluate(`(() => {
    const original = window.fetch;
    globalThis.__openFetch = original;
    globalThis.__holdNames = new Set();
    globalThis.__releaseOpen = {};
    window.fetch = (url, ...args) => {
      const name = String(url).split('?')[0].split('/').pop();
      if (globalThis.__holdNames.has(name)) {
        return new Promise((resolve, reject) => {
          globalThis.__releaseOpen[name] = () => {
            try { resolve(original(url, ...args)); } catch (error) { reject(error); }
          };
        });
      }
      return original(url, ...args);
    };
  })()`);

  try {
    await evaluate("globalThis.__holdNames.add('sample-chart.pptx')");
    await click('.chip[data-src="demo/sample-chart.pptx"]');
    await waitFor("document.querySelector('#stage')?.dataset.openPhase === 'download'", '换文件立刻进入下载');
    if (!await evaluate("!document.querySelector('#stage svg') && document.querySelector('#present').disabled && document.querySelector('#pager').textContent === '— / —'")) {
      throw new Error('下载中仍留着旧页或演示仍可用');
    }
    await pressG(request);
    if (await evaluate("document.querySelector('.slide-grid:not([hidden])')")) {
      throw new Error('下载中 G 制造了网格');
    }

    await evaluate(`(() => {
      const stage = document.querySelector('#stage');
      globalThis.__sawParsing = false;
      const watch = () => {
        if (stage.dataset.openPhase === 'parsing' || /解析中|Parsing/.test(stage.textContent ?? '')) {
          globalThis.__sawParsing = true;
        }
      };
      watch();
      const mo = new MutationObserver(watch);
      mo.observe(stage, { childList: true, subtree: true, attributes: true });
      globalThis.__parsingWatch = mo;
    })()`);

    await evaluate("globalThis.__holdNames.add('showcase.pptx')");
    await click('.chip[data-src="demo/showcase.pptx"]');
    await waitFor("document.querySelector('#stage')?.dataset.openPhase === 'download'", '后一次打开仍在下载');
    await evaluate("globalThis.__releaseOpen['sample-chart.pptx']()");
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (await evaluate("document.querySelector('#meta').textContent.includes('图表.pptx') || document.querySelector('#meta').textContent.includes('Charts.pptx') || document.querySelector('#stage svg')")) {
      throw new Error('先点的样本在后一次打开之后仍画上了舞台');
    }
    await evaluate("globalThis.__releaseOpen['showcase.pptx']()");
    await waitFor("document.querySelector('#stage svg') && document.querySelector('#meta').textContent.includes('showcase.pptx') && document.querySelector('#stage')?.dataset.openPhase === 'ready'", '后一次打开画上默认文稿');
    if (!await evaluate('globalThis.__sawParsing === true')) {
      throw new Error('解析阶段没有出现解析中');
    }
  } finally {
    await evaluate(`(() => {
      if (globalThis.__openFetch) window.fetch = globalThis.__openFetch;
      globalThis.__parsingWatch?.disconnect();
      delete globalThis.__openFetch;
      delete globalThis.__holdNames;
      delete globalThis.__releaseOpen;
      delete globalThis.__parsingWatch;
    })()`);
  }
  console.log('  官网打开会话通过');
}
