export async function runStandaloneNotesClearContract({ evaluate, request, waitFor, click }) {
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
  const notesClosed = () => evaluate(`document.querySelector('#notesPanel')?.hidden === true
    && (document.querySelector('#notesBody')?.textContent ?? '') === ''
    && document.querySelector('#btnNotes')?.disabled === true`);

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') && document.querySelector('#stage')?.dataset.openPhase === 'ready'",
    '独立查看器打开 showcase',
  );
  if (await evaluate("document.querySelector('#btnNotes')?.disabled")) {
    throw new Error('打开成功后备注按钮仍不可用');
  }
  await click('#btnNotes');
  await waitFor("document.querySelector('#notesPanel')?.hidden === false && (document.querySelector('#notesBody')?.textContent ?? '').length > 0", '本页备注可打开');
  const openedNotes = String(await evaluate("document.querySelector('#notesBody')?.textContent ?? ''"));

  const pdf = new TextEncoder().encode('%PDF-1.4\ntrailer\n%%EOF');
  await openLocal(pdf, 'not-a-deck.pdf');
  await waitFor("document.querySelector('#fileInfo')?.textContent === '未打开文件' && document.querySelector('#stage')?.dataset.openPhase === 'error'", '认错后回到未打开');
  if (!await notesClosed()) throw new Error('打开失败后仍留着上一份备注');

  await press('n', 78, 'KeyN');
  if (!await notesClosed()) throw new Error('失败后按 N 又打开了上一份备注');
  await evaluate("document.querySelector('#btnNotes').click()");
  if (!await notesClosed()) throw new Error('失败后点按钮又打开了上一份备注');

  await evaluate(`(async () => {
    const bytes = await fetch('/demo/showcase.pptx').then((r) => r.arrayBuffer());
    const file = new File([bytes], 'after-fail.pptx');
    const input = document.querySelector('#fileInput');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('after-fail.pptx') && document.querySelector('#stage')?.dataset.openPhase === 'ready'",
    '失败后再打开成功',
  );
  if (await evaluate("document.querySelector('#notesPanel')?.hidden !== true || document.querySelector('#btnNotes')?.disabled")) {
    throw new Error('再打开成功后备注没有保持收起或按钮仍禁用');
  }
  await click('#btnNotes');
  await waitFor("document.querySelector('#notesPanel')?.hidden === false && (document.querySelector('#notesBody')?.textContent ?? '').length > 0", '新稿本页备注可再开');
  if (String(await evaluate("document.querySelector('#notesBody')?.textContent ?? ''")) !== openedNotes) {
    throw new Error('再打开后本页备注不是这份稿的正文');
  }

  await press('Escape', 27, 'Escape');
  await waitFor("document.querySelector('#notesPanel')?.hidden === true", '浏览态 Esc 关备注');

  await click('#btnNotes');
  await waitFor("document.querySelector('#notesPanel')?.hidden === false", '再开备注以便看网格 Esc');
  await press('g', 71, 'KeyG');
  await waitFor("document.querySelector('.slide-grid:not([hidden])')", '网格开着');
  await press('Escape', 27, 'Escape');
  await waitFor(
    "!document.querySelector('.slide-grid:not([hidden])') && document.querySelector('#notesPanel')?.hidden === false",
    'Esc 先关网格，备注还在',
  );

  await evaluate(`(() => {
    globalThis.__nativeRequestFullscreenNotes = document.documentElement.requestFullscreen.bind(document.documentElement);
    document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await click('#btnPresent');
    await waitFor("!document.querySelector('#presenter').hidden && !document.fullscreenElement", '全屏失败仍进入演示');
    await press('Escape', 27, 'Escape');
    await waitFor(
      "document.querySelector('#presenter').hidden && document.querySelector('#notesPanel')?.hidden === false",
      '放映中 Esc 先离开放映，备注还在',
    );
  } finally {
    await evaluate(`(() => {
      if (globalThis.__nativeRequestFullscreenNotes) {
        document.documentElement.requestFullscreen = globalThis.__nativeRequestFullscreenNotes;
      }
      delete globalThis.__nativeRequestFullscreenNotes;
    })()`);
  }

  console.log('  独立查看器失败后不再留着上一份备注通过');
}
