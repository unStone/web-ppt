export async function runSiteOpenStartPageContract({ evaluate, request, waitFor, click }) {
  const home = (query) => evaluate(`new URL(${JSON.stringify(query ? `index.html?${query}` : 'index.html')}, location.href).href`);
  const openHome = async (query) => {
    await request('Page.navigate', { url: await home(query) });
    await evaluate("document.querySelector('#demoRoot')?.scrollIntoView({ block: 'start', behavior: 'instant' })");
  };
  const ready = (pager) =>
    `document.querySelector('#stage')?.dataset.openPhase === 'ready' && document.querySelector('#pager')?.textContent === ${JSON.stringify(pager)}`;
  const dropShowcase = (name) => evaluate(`(async () => {
    const bytes = await fetch('demo/showcase.pptx').then((r) => r.arrayBuffer());
    const files = new DataTransfer();
    files.items.add(new File([bytes], ${JSON.stringify(name)}));
    const input = document.querySelector('#pick');
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);

  await openHome('p=3');
  await waitFor(`${ready('3 / 7')} && document.querySelector('#meta')?.textContent.includes('showcase.pptx')`, '首页 p=3 停在第 3 页');
  if (await evaluate("new URL(location.href).searchParams.has('p') || new URL(location.href).searchParams.has('sample')")) {
    throw new Error('首页落到指定页后没有清掉地址参数');
  }
  await waitFor(
    "document.querySelector('#thumbs .thumb.active')?.dataset.n === '3' && !!document.querySelector('#thumbs .thumb.active svg')",
    '首页深链后胶片栏当前格已渲染',
  );

  await click('.chip[data-src="demo/showcase.pptx"]');
  await waitFor(`${ready('1 / 7')} && document.querySelector('#meta')?.textContent.includes('showcase.pptx')`, '再点 chip 从第 1 页开');

  await openHome('p=foo');
  await waitFor(ready('1 / 7'), '非法 p 落到第一页');

  await openHome('p=0');
  await waitFor(ready('1 / 7'), 'p=0 落到第一页');

  await openHome('p=999');
  await waitFor(ready('7 / 7'), '超出总页夹到最后一页');

  await openHome('p=3');
  await waitFor(ready('3 / 7'), '换本地前停在第 3 页');
  await dropShowcase('local-after-page.pptx');
  await waitFor(
    `${ready('1 / 7')} && document.querySelector('#meta')?.textContent.includes('local-after-page.pptx')`,
    '换本地文件从第 1 页开',
  );

  await openHome('sample=not-a-real-sample.pptx&p=5');
  await waitFor(
    "document.querySelector('#stage')?.dataset.openPhase === 'pending' && document.querySelector('#pager')?.textContent === '— / —' && !document.querySelector('#stage svg')",
    '清单没有的 sample 不打开默认稿',
  );
  await dropShowcase('after-missing-sample.pptx');
  await waitFor(
    `${ready('1 / 7')} && document.querySelector('#meta')?.textContent.includes('after-missing-sample.pptx')`,
    '不存在的 sample 带着 p 时拖进来仍从第 1 页开',
  );
  if (await evaluate("document.querySelector('#pager')?.textContent") !== '1 / 7') {
    throw new Error('失败深链把地址页套到了下一份文件');
  }

  await openHome('p=2');
  await waitFor(ready('2 / 7'), '放映前再次落到第 2 页');
  await evaluate(`document.querySelector('#demoRoot')?.scrollIntoView({ block: 'start', behavior: 'instant' })`);
  await evaluate(`(() => {
    const host = document.querySelector('#stageWrap');
    if (host) host.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
    document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  await click('#present');
  await waitFor(
    "document.querySelector('#stageWrap')?.classList.contains('is-presenting') && document.querySelector('#pPager')?.textContent === '2 / 7'",
    '深链页进放映仍是第 2 页',
  );
  const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
  await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
  await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
  await waitFor("!document.querySelector('#stageWrap')?.classList.contains('is-presenting')", '离开放映');
  if (await evaluate("document.querySelector('#pager')?.textContent") !== '2 / 7') {
    throw new Error('离开放映后离开了深链页');
  }

  console.log('  官网首页深链围着目标页通过');
}
