export async function runStandaloneFileProgressContract({ evaluate, request, waitFor }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);
  const press = async (name, value, code = name) => {
    const key = { key: name, code, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };

  await request('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const original = window.fetch;
      window.fetch = (url, init) => {
        const name = String(url).split('?')[0].split('/').pop();
        if (name !== 'held-remote.pptx') return original(url, init);
        return new Promise((resolve, reject) => {
          const finish = () => {
            try { resolve(original(url, init)); } catch (error) { reject(error); }
          };
          window.__releaseHeldRemote = finish;
          const signal = init && init.signal;
          if (!signal) return;
          if (signal.aborted) {
            reject(new DOMException('下载已取消', 'AbortError'));
            return;
          }
          signal.addEventListener('abort', () => {
            reject(new DOMException('下载已取消', 'AbortError'));
          }, { once: true });
        });
      };
    })()`,
  });

  try {
    await request('Page.navigate', { url: await standalone('/demo/held-remote.pptx') });
    await waitFor(
      "document.querySelector('#stage')?.dataset.openPhase === 'download' && /下载中/.test(document.querySelector('#stage')?.textContent ?? '') && document.querySelector('#fileInfo')?.textContent === '正在下载…'",
      '远程打开进入下载',
    );
    if (await evaluate("document.querySelector('#stage svg')")) {
      throw new Error('下载中仍留着旧幻灯片');
    }
    await press('g', 71, 'KeyG');
    if (await evaluate("document.querySelector('.slide-grid:not([hidden])')")) {
      throw new Error('下载中 G 制造了网格');
    }

    await evaluate(`(() => {
      const stage = document.querySelector('#stage');
      globalThis.__sawRemoteParsing = false;
      const watch = () => {
        if (stage.dataset.openPhase === 'parsing' || /解析中/.test(stage.textContent ?? '')) {
          globalThis.__sawRemoteParsing = true;
        }
      };
      watch();
      globalThis.__remoteParsingWatch = new MutationObserver(watch);
      globalThis.__remoteParsingWatch.observe(stage, { childList: true, subtree: true, attributes: true });
    })()`);
    await evaluate('window.__releaseHeldRemote()');
    await waitFor(
      "document.querySelector('#fileInfo')?.textContent.includes('held-remote.pptx') && document.querySelector('#stage')?.dataset.openPhase === 'ready' && document.querySelector('#stage svg')",
      '远程下载后解析成功',
    );
    if (!await evaluate('globalThis.__sawRemoteParsing === true')) {
      throw new Error('远程打开没有出现解析中');
    }

    await request('Page.navigate', { url: await standalone('/demo/held-remote.pptx') });
    await waitFor("document.querySelector('#stage')?.dataset.openPhase === 'download'", '第二次远程进入下载');
    await evaluate(`(async () => {
      const bytes = await fetch('/demo/showcase.pptx').then((r) => r.arrayBuffer());
      const file = new File([bytes], 'local-wins.pptx');
      const input = document.querySelector('#fileInput');
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await waitFor(
      "document.querySelector('#fileInfo')?.textContent.includes('local-wins.pptx') && document.querySelector('#stage')?.dataset.openPhase === 'ready'",
      '下载中途本地打开赢',
    );
    if (await evaluate("document.querySelector('#fileInfo').textContent.includes('held-remote.pptx')")) {
      throw new Error('被换掉的远程下载仍写进了文件信息');
    }
    if (String(await evaluate('location.search')).includes('file=')) {
      throw new Error('下载中途换本地没有清掉 file');
    }

    await request('Page.navigate', { url: await standalone('/missing.pptx') });
    await waitFor(
      "document.querySelector('#stage')?.dataset.openPhase === 'error' && document.querySelector('#fileInfo')?.textContent === '未打开文件' && /下载失败/.test(document.querySelector('#stage')?.textContent ?? '') && document.querySelector('#pageIndicator')?.textContent === '- / -'",
      '显式 ?file= 失败可见',
    );
  } finally {
    await evaluate(`(() => {
      globalThis.__remoteParsingWatch?.disconnect();
      delete globalThis.__remoteParsingWatch;
      delete globalThis.__sawRemoteParsing;
      delete window.__releaseHeldRemote;
    })()`);
  }
  console.log('  独立查看器远程下载进度通过');
}
