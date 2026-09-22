function dispatchSwipeScript(target, dx, dy) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(target)});
    const r = el.getBoundingClientRect();
    const x = r.left + Math.max(8, r.width / 2);
    const y = r.top + Math.max(8, r.height / 2);
    const fire = (type, cx, cy) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 91, pointerType: 'touch', isPrimary: true,
      clientX: cx, clientY: cy,
    }));
    fire('pointerdown', x, y);
    fire('pointermove', x + ${dx}, y + ${dy});
    fire('pointerup', x + ${dx}, y + ${dy});
  })()`;
}

async function pressEscape({ request }) {
  const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
  await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
  await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
}

export async function runViewerSlideGridContract(
  { evaluate, request, click, waitFor },
  browseBtn,
  presentGrid,
  presentTrigger,
  host,
  pager,
  prevBtn,
  { hideBrowseOnWide = true } = {},
) {
  await request('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector(${JSON.stringify(host)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
  await evaluate(`(() => { const prev = document.querySelector(${JSON.stringify(prevBtn)}); for (let i = 0; i < 16; i++) prev.click(); })()`);
  await waitFor(`document.querySelector(${JSON.stringify(pager)}).textContent.startsWith('1 /')`, '网格契约回到第一页');

  if (hideBrowseOnWide) {
    if (!await evaluate(`document.querySelector(${JSON.stringify(browseBtn)})?.hidden`)) {
      throw new Error('宽屏已有缩略图栏时仍显示全部按钮');
    }
  } else if (await evaluate(`document.querySelector(${JSON.stringify(browseBtn)})?.hidden`)) {
    throw new Error('没有持久栏时宽屏仍藏全部按钮');
  }

  await request('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  try {
    await evaluate(`document.querySelector(${JSON.stringify(host)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
    await waitFor(`!document.querySelector(${JSON.stringify(browseBtn)}).hidden && !document.querySelector(${JSON.stringify(browseBtn)}).disabled`, '窄屏出现全部按钮');
    await click(browseBtn);
    await waitFor("document.querySelector('.slide-grid:not([hidden])') && document.querySelectorAll('.slide-grid-item').length === 7 && document.querySelectorAll('.slide-grid-item svg').length >= 1", '打开七页网格且可见格已渲染');

    const stay = await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`);
    await evaluate(dispatchSwipeScript('.slide-grid-list', -80, 0));
    if (await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`) !== stay) {
      throw new Error('网格上滑被当成翻页');
    }
    await evaluate("document.querySelector('.slide-grid').click()");
    await waitFor("!document.querySelector('.slide-grid:not([hidden])')", '点遮罩关网格');
    if (await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`) !== stay) {
      throw new Error('点遮罩改变了页码');
    }

    await click(browseBtn);
    await waitFor("document.querySelector('.slide-grid:not([hidden])')", '再开网格以便 Esc');
    await pressEscape({ request });
    await waitFor("!document.querySelector('.slide-grid:not([hidden])')", 'Esc 关网格');
    if (await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`) !== stay) {
      throw new Error('Esc 关网格改变了页码');
    }

    await click(browseBtn);
    await waitFor("document.querySelector('.slide-grid-item[data-index=\"2\"]')", '网格第三页');
    await click('.slide-grid-item[data-index="2"]');
    await waitFor(
      `document.querySelector(${JSON.stringify(pager)}).textContent.startsWith('3 /') && !document.querySelector('.slide-grid:not([hidden])')`,
      '点第 3 页跳转并关网格',
    );
  } finally {
    await request('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  }

  await evaluate(`document.querySelector(${JSON.stringify(host)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(host)});
    globalThis.__nativeRequestFullscreenGrid = el.requestFullscreen.bind(el);
    el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await click(presentTrigger);
    await waitFor(
      `document.querySelector(${JSON.stringify(host)})?.classList.contains('is-presenting')`,
      '网格契约进入演示',
    );
    await click(presentGrid);
    await waitFor("document.querySelector('.slide-grid:not([hidden])')", '放映打开网格');
    await pressEscape({ request });
    await waitFor(
      `document.querySelector(${JSON.stringify(host)})?.classList.contains('is-presenting') && !document.querySelector('.slide-grid:not([hidden])')`,
      'Esc 只关网格不离开放映',
    );
    await pressEscape({ request });
    await waitFor(
      `!document.querySelector(${JSON.stringify(host)})?.classList.contains('is-presenting')`,
      '再 Esc 离开放映',
    );
  } finally {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(host)});
      if (globalThis.__nativeRequestFullscreenGrid) el.requestFullscreen = globalThis.__nativeRequestFullscreenGrid;
      delete globalThis.__nativeRequestFullscreenGrid;
    })()`);
    await request('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  }
}
