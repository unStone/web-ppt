const PASSWORD = 'web-ppt-2024';

export async function runStandaloneOpenPageContract({ evaluate, request, waitFor, click }) {
  const standalone = (query) => evaluate(`new URL(${JSON.stringify(`/standalone.html?${query}`)}, location.href).href`);
  const press = async (name, value, code = name) => {
    const key = { key: name, code, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };
  const search = () => evaluate('location.search');

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent === '1 / 7'",
    '深链对照：无 p 停在第一页',
  );

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx&p=3') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#stage')?.dataset.openPhase === 'ready' && document.querySelector('#pageIndicator')?.textContent === '3 / 7'",
    '地址 p=3 停在第 3 页',
  );
  if (!String(await search()).includes('p=3')) throw new Error('落到第 3 页后地址丢掉了 p=3');
  await waitFor(
    "document.querySelector('#thumbs .thumb.active')?.dataset.index === '2' && !!document.querySelector('#thumbs .thumb.active svg')",
    '深链后胶片栏当前格已渲染',
  );

  await click('#btnNext');
  await waitFor("document.querySelector('#pageIndicator')?.textContent === '4 / 7'", '从深链页翻到下一页');
  if (!String(await search()).includes('p=4')) throw new Error('翻页没有回写 p=4');

  await evaluate('history.back()');
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent === '1 / 7' && !location.search.includes('p=')",
    '后退回到上一份完整导航',
  );

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx&p=foo') });
  await waitFor(
    "document.querySelector('#pageIndicator')?.textContent === '1 / 7' && document.querySelector('#stage')?.dataset.openPhase === 'ready'",
    '非法 p 落到第一页',
  );
  if (String(await search()).includes('p=')) throw new Error('非法 p 成功打开后还留在地址里');

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx&p=0') });
  await waitFor("document.querySelector('#pageIndicator')?.textContent === '1 / 7'", 'p=0 落到第一页');

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx&p=999') });
  await waitFor(
    "document.querySelector('#pageIndicator')?.textContent === '7 / 7' && /[?&]p=7(?:&|$)/.test(location.search)",
    '超出总页夹到最后一页并回写',
  );

  await request('Page.navigate', { url: await standalone('file=/demo/sample-hidden.pptx&p=2') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('sample-hidden.pptx') && document.querySelector('#pageIndicator')?.textContent === '2 / 5'",
    '深链可以停在隐藏页',
  );

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx&p=3') });
  await waitFor("document.querySelector('#pageIndicator')?.textContent === '3 / 7'", '放映前再次落到第 3 页');
  await evaluate(`(() => {
    globalThis.__nativeRequestFullscreenPage = document.documentElement.requestFullscreen.bind(document.documentElement);
    document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await click('#btnPresent');
    await waitFor(
      "!document.querySelector('#presenter').hidden && document.querySelector('#pvPage')?.textContent === '3 / 7'",
      '深链页进放映仍是第 3 页',
    );
    await press('Escape', 27);
    await waitFor("document.querySelector('#presenter').hidden", 'Esc 离开放映');
    if (await evaluate("document.querySelector('#pageIndicator')?.textContent") !== '3 / 7') {
      throw new Error('离开放映后离开了深链页');
    }
  } finally {
    await evaluate(`(() => {
      if (globalThis.__nativeRequestFullscreenPage) {
        document.documentElement.requestFullscreen = globalThis.__nativeRequestFullscreenPage;
      }
      delete globalThis.__nativeRequestFullscreenPage;
    })()`);
  }

  await press('g', 71, 'KeyG');
  await waitFor("document.querySelector('.slide-grid:not([hidden])')", '深链后打开网格');
  await click('.slide-grid-item[data-index="4"]');
  await waitFor(
    "document.querySelector('#pageIndicator')?.textContent === '5 / 7' && !document.querySelector('.slide-grid:not([hidden])')",
    '网格跳页',
  );
  if (!String(await search()).includes('p=5')) throw new Error('网格跳页没有回写 p=5');

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx&p=3') });
  await waitFor("document.querySelector('#pageIndicator')?.textContent === '3 / 7'", '换文件前停在第 3 页');
  await evaluate(`(async () => {
    const bytes = await fetch('/demo/sample-chart.pptx').then((r) => r.arrayBuffer());
    const file = new File([bytes], 'local-after-page.pptx');
    const input = document.querySelector('#fileInput');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('local-after-page.pptx') && document.querySelector('#stage')?.dataset.openPhase === 'ready'",
    '本地打开覆盖地址稿',
  );
  if (!await evaluate("document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') === true")) {
    throw new Error('换本地文件仍停在上一份的页码');
  }
  if (String(await search()).includes('p=')) throw new Error('换本地文件没有清掉 p');
  if (String(await search()).includes('file=')) throw new Error('换本地文件没有清掉 file');

  await request('Page.navigate', { url: await standalone('file=/missing.pptx&p=3') });
  await waitFor(
    "document.querySelector('#stage')?.dataset.openPhase === 'error' && document.querySelector('#fileInfo')?.textContent === '未打开文件' && document.querySelector('#pageIndicator')?.textContent === '- / -'",
    '失败打开不落页',
  );
  if (!String(await search()).includes('p=3')) throw new Error('失败打开改掉了地址里的 p');
  await press('g', 71, 'KeyG');
  if (await evaluate("document.querySelector('.slide-grid:not([hidden])')")) {
    throw new Error('失败打开后 G 制造了网格');
  }

  await request('Page.navigate', { url: await standalone('file=/demo/sample-encrypted-agile.pptx&p=2') });
  await waitFor("document.querySelector('#viewerPasswordDialog')?.open === true", '加密深链先问密码');
  await evaluate(`(() => {
    const input = document.querySelector('#viewerPassword');
    const form = document.querySelector('#viewerPasswordForm');
    if (!input || !form) throw new Error('密码框不在');
    input.value = ${JSON.stringify(PASSWORD)};
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  })()`);
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('sample-encrypted-agile.pptx') && document.querySelector('#stage')?.dataset.openPhase === 'ready'",
    '加密深链密码正确后打开',
  );
  if (await evaluate("document.querySelector('#pageIndicator')?.textContent") !== '2 / 3') {
    throw new Error('加密深链密码正确后没有停在第 2 页');
  }

  console.log('  独立查看器 ?p= 深链通过');
}
