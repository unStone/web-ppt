const PASSWORD = 'web-ppt-2024';

export async function runStandaloneClearFileContract({ evaluate, request, waitFor, click }) {
  const standalone = (query = '') => evaluate(`new URL(${JSON.stringify(query ? `/standalone.html?${query}` : '/standalone.html')}, location.href).href`);
  const press = async (name, value, code = name) => {
    const key = { key: name, code, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };
  const search = () => evaluate('location.search');
  const openLocal = async (src, name) => evaluate(`(async () => {
    const bytes = await fetch(${JSON.stringify(src)}).then((r) => r.arrayBuffer());
    const file = new File([bytes], ${JSON.stringify(name)});
    const input = document.querySelector('#fileInput');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);

  await request('Page.navigate', { url: await standalone() });
  await waitFor("document.querySelector('#dropHint') || document.querySelector('#fileInfo')?.textContent === '未打开文件'", '对照页：没有 ?file=');
  const emptyUrl = await evaluate('location.href');

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx&p=3') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent === '3 / 7'",
    '清 file 前先落到远程第 3 页',
  );

  await evaluate(`(async () => {
    const bytes = await fetch('/demo/sample-chart.pptx').then((r) => r.arrayBuffer());
    const delayed = new File([bytes], 'held-local.pptx');
    delayed.arrayBuffer = () => new Promise((resolve) => {
      globalThis.__releaseHeldLocal = () => resolve(bytes);
    });
    const input = document.querySelector('#fileInput');
    const transfer = new DataTransfer();
    transfer.items.add(delayed);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor("document.querySelector('#stage')?.dataset.openPhase === 'opening' && document.querySelector('#fileInfo')?.textContent === '正在打开…'", '换本地立刻进入打开');
  if (String(await search()).includes('file=')) throw new Error('解析中地址还留着远程 file');
  if (String(await search()).includes('p=')) throw new Error('解析中地址还留着远程 p');

  await evaluate('globalThis.__releaseHeldLocal()');
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('held-local.pptx') && document.querySelector('#stage')?.dataset.openPhase === 'ready'",
    '本地打开成功',
  );
  if (!await evaluate("document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') === true")) {
    throw new Error('换本地文件仍停在上一份的页码');
  }
  if (String(await search()).includes('file=')) throw new Error('本地打开成功后地址还留着 file');
  if (String(await search()).includes('p=')) throw new Error('本地打开成功后地址还留着 p');

  await click('#btnNext');
  await waitFor("document.querySelector('#pageIndicator')?.textContent.startsWith('2 /') === true", '本地翻到下一页');
  if (String(await search()).includes('p=')) throw new Error('本地翻页把页码写进了没有 file 的地址');

  await request('Page.reload', { ignoreCache: true });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent === '未打开文件' && !document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx')",
    '刷新不再打开上一份远程稿',
  );
  if (await evaluate("document.querySelector('#fileInfo')?.textContent.includes('held-local.pptx')")) {
    throw new Error('刷新假装恢复了本地稿');
  }
  if (String(await search()).includes('file=')) throw new Error('刷新后又写出了 file');

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx&p=3') });
  await waitFor("document.querySelector('#pageIndicator')?.textContent === '3 / 7'", '后退对照前再次打开远程');
  await openLocal('/demo/sample-chart.pptx', 'after-back.pptx');
  await waitFor("document.querySelector('#fileInfo')?.textContent.includes('after-back.pptx')", '再次换成本地');
  await evaluate('history.back()');
  await waitFor(
    `location.href === ${JSON.stringify(emptyUrl)} || document.querySelector('#fileInfo')?.textContent === '未打开文件'`,
    '后退回到上一份完整导航',
  );
  if (await evaluate("document.querySelector('#fileInfo')?.textContent.includes('after-back.pptx') && location.search.includes('file=')")) {
    throw new Error('后退后出现地址远程、屏幕本地');
  }

  await request('Page.navigate', { url: await standalone('file=/missing.pptx&p=3') });
  await waitFor(
    "document.querySelector('#stage')?.dataset.openPhase === 'error' && document.querySelector('#pageIndicator')?.textContent === '- / -'",
    '远程失败不落页',
  );
  if (!String(await search()).includes('file=')) throw new Error('远程失败清掉了人家写进来的 file');
  if (!String(await search()).includes('p=3')) throw new Error('远程失败清掉了人家写进来的 p');

  await request('Page.navigate', { url: await standalone('file=/demo/sample-encrypted-agile.pptx') });
  await waitFor("document.querySelector('#viewerPasswordDialog')?.open === true", '远程加密稿先问密码');
  await evaluate("document.querySelector('#viewerPasswordCancel').click()");
  await waitFor("/已取消打开/.test(document.querySelector('#stage')?.textContent ?? '')", '远程取消密码');
  if (!String(await search()).includes('file=')) throw new Error('远程取消密码清掉了 file');

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx&p=3') });
  await waitFor("document.querySelector('#pageIndicator')?.textContent === '3 / 7'", '本地加密前先打开远程');
  await openLocal('/demo/sample-encrypted-agile.pptx', 'local-secret.pptx');
  await waitFor("document.querySelector('#viewerPasswordDialog')?.open === true", '本地加密稿问密码');
  if (String(await search()).includes('file=')) throw new Error('本地密码框出现时还留着远程 file');
  await evaluate("document.querySelector('#viewerPasswordCancel').click()");
  await waitFor(
    "document.querySelector('#stage')?.dataset.openPhase === 'error' && /已取消打开/.test(document.querySelector('#stage')?.textContent ?? '') && document.querySelector('#fileInfo')?.textContent === '未打开文件'",
    '本地取消密码',
  );
  if (String(await search()).includes('file=')) throw new Error('本地取消密码后又写出了 file');
  await press('g', 71, 'KeyG');
  if (await evaluate("document.querySelector('.slide-grid:not([hidden])')")) {
    throw new Error('本地取消后 G 制造了网格');
  }

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx&p=3') });
  await waitFor("document.querySelector('#pageIndicator')?.textContent === '3 / 7'", '放映前再次落到第 3 页');
  await evaluate(`(() => {
    globalThis.__nativeRequestFullscreenClear = document.documentElement.requestFullscreen.bind(document.documentElement);
    document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await click('#btnPresent');
    await waitFor("!document.querySelector('#presenter').hidden", '进放映');
    await openLocal('/demo/sample-chart.pptx', 'during-present.pptx');
    await waitFor(
      "document.querySelector('#presenter').hidden && document.querySelector('#fileInfo')?.textContent.includes('during-present.pptx')",
      '放映中换本地先退出再打开',
    );
    if (String(await search()).includes('file=')) throw new Error('放映中换本地没有清掉 file');
  } finally {
    await evaluate(`(() => {
      if (globalThis.__nativeRequestFullscreenClear) {
        document.documentElement.requestFullscreen = globalThis.__nativeRequestFullscreenClear;
      }
      delete globalThis.__nativeRequestFullscreenClear;
    })()`);
  }

  await press('g', 71, 'KeyG');
  await waitFor("document.querySelector('.slide-grid:not([hidden])')", '本地稿打开网格');
  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx&p=2') });
  await waitFor("document.querySelector('#pageIndicator')?.textContent === '2 / 7'", '网格中途换文件前');
  await press('g', 71, 'KeyG');
  await waitFor("document.querySelector('.slide-grid:not([hidden])')", '远程稿打开网格');
  await openLocal('/demo/sample-chart.pptx', 'during-grid.pptx');
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('during-grid.pptx') && !document.querySelector('.slide-grid:not([hidden])')",
    '网格开着换本地先关掉网格',
  );
  if (String(await search()).includes('file=')) throw new Error('网格开着换本地没有清掉 file');

  console.log('  独立查看器换本地后清 file 通过');
}