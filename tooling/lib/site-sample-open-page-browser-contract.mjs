import { readFileSync } from 'node:fs';

const cors = [{ name: 'Access-Control-Allow-Origin', value: '*' }];
const corsJson = [...cors, { name: 'Content-Type', value: 'application/json' }];

export async function runSiteSampleOpenPageContract({ evaluate, request, waitFor, click, onEvent }) {
  const showcase = readFileSync(new URL('../../fixtures/showcase.pptx', import.meta.url)).toString('base64');
  const hidden = readFileSync(new URL('../../fixtures/sample-hidden.pptx', import.meta.url)).toString('base64');
  const index = Buffer.from(JSON.stringify({
    base: 'https://unstone.github.io/web-ppt-samples/',
    samples: [
      { file: 'page-contract.pptx', title: '页码契约', author: '', highlight: '', license: 'CC0', source: '', demo: true },
      { file: 'hidden-contract.pptx', title: '隐藏契约', author: '', highlight: '', license: 'CC0', source: '', demo: true },
    ],
  })).toString('base64');
  const page = (query) => evaluate(`new URL(${JSON.stringify(query ? `samples.html?${query}` : 'samples.html')}, location.href).href`);
  const press = async (name, value, code = name) => {
    const key = { key: name, code, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };
  const search = () => evaluate('location.search');
  const ready = (pager) =>
    `document.querySelector('.preview-stage')?.dataset.openPhase === 'ready' && document.querySelector('.preview-pager')?.textContent === ${JSON.stringify(pager)}`;

  let failFile = '';
  const transfers = [];
  const unsubscribe = onEvent((event) => {
    if (event.method !== 'Fetch.requestPaused') return;
    const { requestId, request: intercepted } = event.params;
    const url = intercepted.url;
    const headers = url.endsWith('/index.json') ? corsJson : cors;
    let responseCode = 200;
    let body;
    if (url.endsWith('/index.json')) body = index;
    else if (failFile && url.endsWith(failFile)) { responseCode = 503; body = undefined; }
    else if (url.endsWith('page-contract.pptx')) body = showcase;
    else if (url.endsWith('hidden-contract.pptx')) body = hidden;
    else {
      transfers.push(request('Fetch.failRequest', { requestId, errorReason: 'Failed' }));
      return;
    }
    transfers.push(request('Fetch.fulfillRequest', {
      requestId, responseCode, ...(body ? { body } : {}),
      responseHeaders: headers,
    }));
  });

  await request('Fetch.enable', { patterns: [{ urlPattern: 'https://unstone.github.io/web-ppt-samples/*' }] });
  try {
    await request('Page.navigate', { url: await page('') });
    await waitFor("document.querySelectorAll('.sample-card').length >= 2", '清单两张卡');

    await request('Page.navigate', { url: await page('p=5') });
    await waitFor(
      "document.querySelectorAll('.sample-card').length >= 2 && !new URL(location.href).searchParams.has('p') && document.querySelector('.preview')?.hidden === true",
      '没有 sample 的孤儿 p 被清掉',
    );

    await request('Page.navigate', { url: await page('sample=page-contract.pptx&p=3') });
    await waitFor(ready('3 / 7'), '地址 p=3 停在第 3 页');
    if (!String(await search()).includes('p=3')) throw new Error('落到第 3 页后地址丢掉了 p=3');
    if (await evaluate("new URL(location.href).searchParams.get('sample')") !== 'page-contract.pptx') {
      throw new Error('深链打开后丢掉了 sample');
    }

    await click('.preview-next');
    await waitFor(ready('4 / 7'), '从深链页翻到下一页');
    if (!String(await search()).includes('p=4')) throw new Error('翻页没有回写 p=4');

    await evaluate('history.back()');
    await waitFor(
      "document.querySelector('.preview')?.hidden === true && !location.search.includes('sample=') && !location.search.includes('p=')",
      '后退回到上一份完整导航',
    );

    await request('Page.navigate', { url: await page('sample=page-contract.pptx&p=foo') });
    await waitFor(`${ready('1 / 7')} && !location.search.includes('p=')`, '非法 p 落到第一页并删掉');

    await request('Page.navigate', { url: await page('sample=page-contract.pptx&p=0') });
    await waitFor(ready('1 / 7'), 'p=0 落到第一页');

    await request('Page.navigate', { url: await page('sample=page-contract.pptx&p=999') });
    await waitFor(
      `${ready('7 / 7')} && /[?&]p=7(?:&|$)/.test(location.search)`,
      '超出总页夹到最后一页并回写',
    );

    await request('Page.navigate', { url: await page('sample=hidden-contract.pptx&p=2') });
    await waitFor(ready('2 / 5'), '深链可以停在隐藏页');

    await request('Page.navigate', { url: await page('sample=page-contract.pptx&p=3') });
    await waitFor(ready('3 / 7'), '放映前再次落到第 3 页');
    await evaluate(`(() => {
      const host = document.querySelector('.preview-wrap');
      globalThis.__nativePreviewFullscreen = host.requestFullscreen.bind(host);
      host.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
    })()`);
    try {
      await click('.preview-full');
      await waitFor(
        "document.querySelector('.preview-wrap')?.classList.contains('is-presenting') && document.querySelector('.preview-p-pager')?.textContent === '3 / 7'",
        '深链页进放映仍是第 3 页',
      );
      await press('Escape', 27);
      await waitFor("!document.querySelector('.preview-wrap')?.classList.contains('is-presenting')", 'Esc 离开放映');
      if (await evaluate("document.querySelector('.preview-pager')?.textContent") !== '3 / 7') {
        throw new Error('离开放映后离开了深链页');
      }
    } finally {
      await evaluate(`(() => {
        const host = document.querySelector('.preview-wrap');
        if (host && globalThis.__nativePreviewFullscreen) host.requestFullscreen = globalThis.__nativePreviewFullscreen;
        delete globalThis.__nativePreviewFullscreen;
      })()`);
    }

    await press('g', 71, 'KeyG');
    await waitFor("document.querySelector('.slide-grid:not([hidden])')", '深链后打开网格');
    await click('.slide-grid-item[data-index="4"]');
    await waitFor(
      `${ready('5 / 7')} && !document.querySelector('.slide-grid:not([hidden])')`,
      '网格跳页',
    );
    if (!String(await search()).includes('p=5')) throw new Error('网格跳页没有回写 p=5');

    await request('Page.navigate', { url: await page('sample=page-contract.pptx&p=3') });
    await waitFor(ready('3 / 7'), '换样本前停在第 3 页');
    await evaluate("document.querySelector('.sample-card[data-file=\"hidden-contract.pptx\"] button').click()");
    await waitFor(ready('1 / 5'), '换样本从第一页打开');
    if (String(await search()).includes('p=')) throw new Error('换样本没有清掉 p');
    if (await evaluate("new URL(location.href).searchParams.get('sample')") !== 'hidden-contract.pptx') {
      throw new Error('换样本没有改写成新文件名');
    }

    failFile = 'page-contract.pptx';
    await request('Page.navigate', { url: await page('sample=page-contract.pptx&p=3') });
    await waitFor(
      "document.querySelector('.preview-stage .err') && document.querySelector('.preview-pager')?.textContent === '— / —'",
      '失败打开不落页',
    );
    if (!String(await search()).includes('p=3')) throw new Error('失败打开改掉了地址里的 p');
    await press('g', 71, 'KeyG');
    if (await evaluate("document.querySelector('.slide-grid:not([hidden])')")) {
      throw new Error('失败打开后 G 制造了网格');
    }

    failFile = '';
    await request('Page.navigate', { url: await page('sample=page-contract.pptx&p=3') });
    await waitFor(ready('3 / 7'), '关浮层前停在第 3 页');
    await click('.preview-close');
    await waitFor(
      "document.querySelector('.preview')?.hidden === true && !new URL(location.href).searchParams.has('sample') && !new URL(location.href).searchParams.has('p')",
      '关浮层清掉 sample 和 p',
    );

    console.log('  样本页 ?sample= + ?p= 深链通过');
  } finally {
    await Promise.all(transfers);
    await request('Fetch.disable');
    unsubscribe();
  }
}
