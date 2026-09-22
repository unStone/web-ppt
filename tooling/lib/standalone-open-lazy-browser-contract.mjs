export async function runStandaloneOpenLazyContract({ evaluate, request, waitFor, click }) {
  const standalone = (query = '') => evaluate(`new URL(${JSON.stringify(query ? `/standalone.html?${query}` : '/standalone.html')}, location.href).href`);
  const openLocal = (bytes, name) => evaluate(`(() => {
    const file = new File([Uint8Array.from(${JSON.stringify([...bytes])})], ${JSON.stringify(name)});
    const input = document.querySelector('#fileInput');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const fileInfo = () => evaluate("document.querySelector('#fileInfo')?.textContent ?? ''");

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') && document.querySelector('#stage')?.dataset.openPhase === 'ready'",
    '独立查看器打开 showcase',
  );
  const opened = String(await fileInfo());
  if (!opened.includes('7 页')) throw new Error('打开成功后状态栏没有页数');
  if (opened.includes('页有备注')) throw new Error('打开成功后仍为了备注去扫全部页');
  if (await evaluate("document.querySelector('#searchInput')?.value !== '' || document.querySelector('#searchInput')?.disabled")) {
    throw new Error('刚打开时搜索框不是空的或仍不可用');
  }

  await click('#btnNotes');
  await waitFor("document.querySelector('#notesPanel')?.hidden === false && (document.querySelector('#notesBody')?.textContent ?? '').length > 0", '本页备注仍可打开');

  await evaluate("document.querySelector('#searchInput').value = '形状库'");
  await evaluate("document.querySelector('#searchInput').dispatchEvent(new Event('input', { bubbles: true }))");
  await waitFor("document.querySelector('#searchHits')?.textContent.includes('页')", '用户打字后才查找');

  await evaluate(`(async () => {
    const bytes = await fetch('/demo/showcase.pptx').then((r) => r.arrayBuffer());
    const file = new File([bytes], 'after-search.pptx');
    const input = document.querySelector('#fileInput');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('after-search.pptx') && document.querySelector('#stage')?.dataset.openPhase === 'ready'",
    '换文件打开成功',
  );
  if (await evaluate("document.querySelector('#searchInput')?.value !== '' || document.querySelector('#searchHits')?.textContent !== ''")) {
    throw new Error('换文件没有清空上一份的搜索');
  }
  const after = String(await fileInfo());
  if (after.includes('页有备注')) throw new Error('换文件后仍报全稿备注页数');

  const pdf = new TextEncoder().encode('%PDF-1.4\ntrailer\n%%EOF');
  await evaluate("document.querySelector('#searchInput').value = '残留'");
  await openLocal(pdf, 'not-a-deck.pdf');
  await waitFor("document.querySelector('#fileInfo')?.textContent === '未打开文件' && document.querySelector('#stage')?.dataset.openPhase === 'error'", '认错后回到未打开');
  if (await evaluate("document.querySelector('#searchInput')?.value !== '' || document.querySelector('#searchHits')?.textContent !== '' || !document.querySelector('#searchInput')?.disabled")) {
    throw new Error('打开失败没有清空并禁用搜索');
  }

  console.log('  独立查看器打开不再扫完全部页通过');
}
