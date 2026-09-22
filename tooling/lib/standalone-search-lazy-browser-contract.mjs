export async function runStandaloneSearchLazyContract({ evaluate, request, waitFor, click }) {
  const standalone = (query = '') => evaluate(`new URL(${JSON.stringify(query ? `/standalone.html?${query}` : '/standalone.html')}, location.href).href`);
  const openLocal = (bytes, name) => evaluate(`(() => {
    const file = new File([Uint8Array.from(${JSON.stringify([...bytes])})], ${JSON.stringify(name)});
    const input = document.querySelector('#fileInput');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const press = async (name, value, code = name) => {
    const key = { key: name, code, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };
  const typeSearch = async (value) => {
    await evaluate(`(() => {
      const input = document.querySelector('#searchInput');
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  };

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') && document.querySelector('#stage')?.dataset.openPhase === 'ready'",
    '独立查看器打开 showcase',
  );
  if (await evaluate("document.querySelector('#searchInput')?.disabled")) {
    throw new Error('打开成功后搜索仍不可用');
  }

  await typeSearch('立体效果');
  await waitFor("document.querySelector('#searchHits')?.textContent.includes('页')", '打字查找出现命中');
  await waitFor("document.querySelector('#pageIndicator')?.textContent.startsWith('7 /')", '第一个命中会跳到后页');
  const hitPage = String(await evaluate("document.querySelector('#pageIndicator')?.textContent ?? ''"));

  await typeSearch('');
  await waitFor("document.querySelector('#searchHits')?.textContent === ''", '空查询清掉命中文案');
  if (String(await evaluate("document.querySelector('#pageIndicator')?.textContent ?? ''")) !== hitPage) {
    throw new Error('空查询不该再跳页');
  }

  await typeSearch('zzz-no-such-slide-token');
  await waitFor("document.querySelector('#searchHits')?.textContent === '无结果'", '无命中写无结果');
  if (String(await evaluate("document.querySelector('#pageIndicator')?.textContent ?? ''")) !== hitPage) {
    throw new Error('无命中不该跳页');
  }

  await press('g', 71, 'KeyG');
  await waitFor("document.querySelector('.slide-grid:not([hidden])')", '网格开着');
  await typeSearch('自定义几何');
  await waitFor(
    "document.querySelector('#searchHits')?.textContent.includes('页') && !document.querySelector('.slide-grid:not([hidden])')",
    '跳到命中时先关网格',
  );

  await evaluate(`(() => {
    globalThis.__nativeRequestFullscreenSearch = document.documentElement.requestFullscreen.bind(document.documentElement);
    document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await click('#btnPresent');
    await waitFor("!document.querySelector('#presenter').hidden && !document.fullscreenElement", '全屏失败仍进入演示');
    await press('/', 191, 'Slash');
    if (await evaluate("document.activeElement === document.querySelector('#searchInput')")) {
      throw new Error('放映中 / 不该聚焦搜索');
    }
    await press('Escape', 27, 'Escape');
    await waitFor("document.querySelector('#presenter').hidden", 'Esc 离开放映');
  } finally {
    await evaluate(`(() => {
      if (globalThis.__nativeRequestFullscreenSearch) {
        document.documentElement.requestFullscreen = globalThis.__nativeRequestFullscreenSearch;
      }
      delete globalThis.__nativeRequestFullscreenSearch;
    })()`);
  }

  const pdf = new TextEncoder().encode('%PDF-1.4\ntrailer\n%%EOF');
  await typeSearch('残留');
  await openLocal(pdf, 'not-a-deck.pdf');
  await waitFor("document.querySelector('#fileInfo')?.textContent === '未打开文件' && document.querySelector('#stage')?.dataset.openPhase === 'error'", '认错后回到未打开');
  if (await evaluate("document.querySelector('#searchInput')?.value !== '' || document.querySelector('#searchHits')?.textContent !== '' || !document.querySelector('#searchInput')?.disabled")) {
    throw new Error('打开失败没有清空并禁用搜索');
  }
  await press('/', 191, 'Slash');
  if (await evaluate("document.activeElement === document.querySelector('#searchInput')")) {
    throw new Error('未打开时 / 不该聚焦搜索');
  }

  await evaluate(`(async () => {
    const bytes = await fetch('/demo/showcase.pptx').then((r) => r.arrayBuffer());
    const file = new File([bytes], 'after-search-fail.pptx');
    const input = document.querySelector('#fileInput');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('after-search-fail.pptx') && document.querySelector('#stage')?.dataset.openPhase === 'ready'",
    '失败后再打开成功',
  );
  if (await evaluate("document.querySelector('#searchInput')?.disabled || document.querySelector('#searchInput')?.value !== ''")) {
    throw new Error('再打开成功后搜索没有恢复为空的可用框');
  }

  console.log('  独立查看器查找不再一次打穿后页通过');
}
