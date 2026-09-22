export async function runStandaloneSearchHighlightContract({ evaluate, request, waitFor, click }) {
  const standalone = (query = '') => evaluate(`new URL(${JSON.stringify(query ? `/standalone.html?${query}` : '/standalone.html')}, location.href).href`);
  const highlightCount = () => evaluate(`document.querySelectorAll('.ppt-find-box').length`);
  const typeSearch = async (value) => {
    await evaluate(`(() => {
      const input = document.querySelector('#searchInput');
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  };
  const press = async (name, value, code = name) => {
    const key = { key: name, code, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') && document.querySelector('#stage')?.dataset.openPhase === 'ready'",
    '独立查看器打开 showcase',
  );

  await typeSearch('立体效果');
  await waitFor("document.querySelector('#searchHits')?.textContent.includes('页')", '打字查找出现命中');
  await waitFor("document.querySelector('#pageIndicator')?.textContent.startsWith('7 /')", '第一个命中会跳到后页');
  await waitFor("document.querySelectorAll('.ppt-find-box').length > 0", '命中页标出查询词');
  const hitPage = String(await evaluate("document.querySelector('#pageIndicator')?.textContent ?? ''"));
  await click('#btnNotes');
  await waitFor("document.querySelectorAll('.ppt-find-box').length >= 2 && document.querySelector('#notesBody .ppt-find-box')", '备注开着时备注里的词也标');
  await click('#btnNotes');
  await waitFor("document.querySelectorAll('.ppt-find-box').length > 0 && !document.querySelector('#notesBody .ppt-find-box')", '关上备注后只留舞台黄框');

  await typeSearch('挤出');
  await waitFor(
    "document.querySelector('#pageIndicator')?.textContent.startsWith('7 /') && document.querySelector('#searchHits')?.textContent === '1 页 · 第 1/4 处' && document.querySelectorAll('.ppt-find-current').length === 1 && document.querySelectorAll('.ppt-find-box').length >= 4",
    '同页多处标出第 1 处',
  );
  const firstAt = String(await evaluate(`(() => {
    const box = document.querySelector('.ppt-find-current');
    const rect = box.getBoundingClientRect();
    return rect.left + ',' + rect.top;
  })()`));
  await evaluate(`document.querySelector('#searchInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await waitFor(
    "document.querySelector('#pageIndicator')?.textContent.startsWith('7 /') && document.querySelector('#searchHits')?.textContent === '1 页 · 第 2/4 处'",
    'Enter 留在本页走到下一处',
  );
  const secondAt = String(await evaluate(`(() => {
    const box = document.querySelector('.ppt-find-current');
    const rect = box.getBoundingClientRect();
    return rect.left + ',' + rect.top;
  })()`));
  if (secondAt === firstAt) throw new Error('下一处的深色框没有移动');
  await evaluate(`document.activeElement?.blur?.()`);
  await press('g', 71, 'KeyG');
  await waitFor("document.querySelector('.slide-grid:not([hidden])')", '同页移动前网格开着');
  await evaluate(`document.querySelector('#searchInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await waitFor(
    "!document.querySelector('.slide-grid:not([hidden])') && document.querySelector('#searchHits')?.textContent === '1 页 · 第 3/4 处' && document.querySelector('#pageIndicator')?.textContent.startsWith('7 /')",
    '网格开着时 Enter 先关网格再移到下一处',
  );
  await evaluate(`document.querySelector('#searchInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))`);
  await waitFor("document.querySelector('#searchHits')?.textContent === '1 页 · 第 2/4 处'", 'Shift+Enter 回到上一处');
  await evaluate(`document.activeElement?.blur?.()`);
  const chord = async (extra) => {
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true, ${extra} }))`);
  };
  await chord('ctrlKey: true');
  await waitFor(
    "document.querySelector('#searchHits')?.textContent === '1 页 · 第 3/4 处' && document.activeElement !== document.querySelector('#searchInput')",
    '搜索框没聚焦时 Ctrl+G 走到下一处',
  );
  await chord('metaKey: true, shiftKey: true');
  await waitFor("document.querySelector('#searchHits')?.textContent === '1 页 · 第 2/4 处'", '⌘+Shift+G 回到上一处');
  await press('g', 71, 'KeyG');
  await waitFor("document.querySelector('.slide-grid:not([hidden])')", '单独的 G 仍打开网格');
  await chord('ctrlKey: true');
  await waitFor(
    "!document.querySelector('.slide-grid:not([hidden])') && document.querySelector('#searchHits')?.textContent === '1 页 · 第 3/4 处' && document.querySelector('#pageIndicator')?.textContent.startsWith('7 /')",
    '网格开着时 Ctrl+G 先关网格再走到下一处',
  );

  await typeSearch('');
  await waitFor("document.querySelector('#searchHits')?.textContent === ''", '空查询清掉命中文案');
  const clearedPage = String(await evaluate("document.querySelector('#pageIndicator')?.textContent ?? ''"));
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true, cancelable: true }))`);
  if (String(await evaluate("document.querySelector('#pageIndicator')?.textContent ?? ''")) !== clearedPage) {
    throw new Error('空查询的 Ctrl+G 不该跳页');
  }
  if (Number(await highlightCount()) !== 0) throw new Error('空查询必须清掉高亮');
  if (String(await evaluate("document.querySelector('#pageIndicator')?.textContent ?? ''")) !== hitPage) {
    throw new Error('空查询不该再跳页');
  }

  await typeSearch('zzz-no-such-slide-token');
  await waitFor("document.querySelector('#searchHits')?.textContent === '无结果'", '无命中写无结果');
  if (Number(await highlightCount()) !== 0) throw new Error('无命中必须清掉高亮');
  if (String(await evaluate("document.querySelector('#pageIndicator')?.textContent ?? ''")) !== hitPage) {
    throw new Error('无命中不该跳页');
  }

  await typeSearch('立体效果');
  await waitFor("document.querySelector('#searchHits')?.textContent.includes('页') && document.querySelectorAll('.ppt-find-box').length > 0", '再次查找恢复高亮');

  await evaluate(`(() => {
    globalThis.__nativeRequestFullscreenHighlight = document.documentElement.requestFullscreen.bind(document.documentElement);
    document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await click('#btnPresent');
    await waitFor("!document.querySelector('#presenter').hidden && !document.fullscreenElement", '全屏失败仍进入演示');
    if (Number(await highlightCount()) !== 0) throw new Error('放映中不能把查找高亮留给观众');
    const presentPage = String(await evaluate("document.querySelector('#pageIndicator')?.textContent ?? ''"));
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true, cancelable: true }))`);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
    if (String(await evaluate("document.querySelector('#pageIndicator')?.textContent ?? ''")) !== presentPage) {
      throw new Error('放映里 Ctrl+G 和 Enter 不能拿去查找');
    }
    if (await evaluate("document.activeElement === document.querySelector('#searchInput')")) {
      throw new Error('放映里不能把焦点送回搜索框');
    }
    if (Number(await highlightCount()) !== 0) throw new Error('放映中 Ctrl+G 不能把黄框画回来');
    await press('Escape', 27, 'Escape');
    await waitFor("document.querySelector('#presenter').hidden", 'Esc 离开放映');
    await waitFor("document.querySelectorAll('.ppt-find-box').length > 0", '退出放映后若仍命中再标');
  } finally {
    await evaluate(`(() => {
      if (globalThis.__nativeRequestFullscreenHighlight) {
        document.documentElement.requestFullscreen = globalThis.__nativeRequestFullscreenHighlight;
      }
      delete globalThis.__nativeRequestFullscreenHighlight;
    })()`);
  }

  const pdf = new TextEncoder().encode('%PDF-1.4\ntrailer\n%%EOF');
  await evaluate(`(() => {
    const file = new File([Uint8Array.from(${JSON.stringify([...pdf])})], 'not-a-deck.pdf');
    const input = document.querySelector('#fileInput');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('#fileInfo')?.textContent === '未打开文件'", '认错后回到未打开');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true, cancelable: true }))`);
  if (String(await evaluate("document.querySelector('#fileInfo')?.textContent ?? ''")) !== '未打开文件') {
    throw new Error('打开失败后 Ctrl+G 不该再打开文件');
  }
  if (Number(await highlightCount()) !== 0) throw new Error('打开失败必须清掉高亮');

  console.log('  独立查看器查找命中页内标字通过');
}
