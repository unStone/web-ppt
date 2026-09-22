function dispatchSwipeScript(target, dx, dy, clickAfter = false) {
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
    if (${clickAfter}) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  })()`;
}

export async function runStandaloneSwipeNavContract({ evaluate, request, waitFor, click }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);

  await request('Page.navigate', { url: await standalone('/missing.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent === '未打开文件' && document.querySelector('#stage')?.dataset.openPhase === 'error' && document.querySelector('#pageIndicator')?.textContent === '- / -'",
    '独立查看器打开失败',
  );
  await evaluate(dispatchSwipeScript('#stage', -80, 0));
  if (await evaluate("document.querySelector('#pageIndicator').textContent") !== '- / -') {
    throw new Error('打开失败后滑动制造了假页码');
  }

  await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /')",
    '独立查看器 showcase',
  );

  await evaluate(dispatchSwipeScript('#stage', -80, 0));
  await waitFor("document.querySelector('#pageIndicator').textContent.startsWith('2 /')", '向左滑下一页');
  await evaluate(dispatchSwipeScript('#stage', 80, 0));
  await waitFor("document.querySelector('#pageIndicator').textContent.startsWith('1 /')", '向右滑上一页');

  const stay = await evaluate("document.querySelector('#pageIndicator').textContent");
  await evaluate(dispatchSwipeScript('#stage', 0, 90));
  await evaluate(dispatchSwipeScript('#stage', -20, 0));
  if (await evaluate("document.querySelector('#pageIndicator').textContent") !== stay) {
    throw new Error('竖滑或短滑被当成翻页');
  }

  await click('#btnNotes');
  await waitFor("!document.querySelector('#notesPanel').hidden", '打开备注');
  await evaluate(dispatchSwipeScript('#notesBody', -80, 0));
  if (await evaluate("document.querySelector('#pageIndicator').textContent") !== stay) {
    throw new Error('备注上滑被当成翻页');
  }
  await click('#btnNotes');
  await waitFor("document.querySelector('#notesPanel').hidden", '关掉备注');

  await evaluate(dispatchSwipeScript('#thumbs', -80, 0));
  if (await evaluate("document.querySelector('#pageIndicator').textContent") !== stay) {
    throw new Error('缩略图上滑被当成翻页');
  }

  await click('#btnZoomIn');
  await waitFor("document.querySelector('#zoomLabel').textContent !== '适应' && !document.querySelector('#stage').classList.contains('swipe-x')", '放大后不允许滑翻页');
  await evaluate(dispatchSwipeScript('#stage', -80, 0));
  if (await evaluate("document.querySelector('#pageIndicator').textContent") !== stay) {
    throw new Error('放大后左右滑被当成翻页');
  }
  await click('#btnFit');
  await waitFor("document.querySelector('#zoomLabel').textContent === '适应' && document.querySelector('#stage').classList.contains('swipe-x')", '回到适应');

  await evaluate(`(() => {
    globalThis.__nativeRequestFullscreenSwipe = document.documentElement.requestFullscreen.bind(document.documentElement);
    document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await click('#btnPresent');
    await waitFor("!document.querySelector('#presenter').hidden && !document.fullscreenElement", '全屏失败仍进入演示');
    await evaluate(dispatchSwipeScript('#stage', -80, 0));
    const onlySwipe = await evaluate("document.querySelector('#pageIndicator').textContent");
    await evaluate(dispatchSwipeScript('#pvNotes', -80, 0));
    if (await evaluate("document.querySelector('#pageIndicator').textContent") !== onlySwipe) {
      throw new Error('演讲者备注上滑被当成翻页');
    }
    const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor("document.querySelector('#presenter').hidden", '滑动契约离开演示');

    await evaluate("document.querySelector('#btnPrev').click()");
    for (let i = 0; i < 16; i++) await evaluate("document.querySelector('#btnPrev').click()");
    await waitFor("document.querySelector('#pageIndicator').textContent.startsWith('1 /')", '滑动连跳对照回到第一页');
    await click('#btnPresent');
    await waitFor("!document.querySelector('#presenter').hidden", '滑动连跳对照再进演示');
    await evaluate(dispatchSwipeScript('#stage', -80, 0, true));
    if (await evaluate("document.querySelector('#pageIndicator').textContent") !== onlySwipe) {
      throw new Error('放映滑动被随后的 click 连跳');
    }
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor("document.querySelector('#presenter').hidden", '滑动契约结束演示');
  } finally {
    await evaluate(`(() => {
      if (globalThis.__nativeRequestFullscreenSwipe) {
        document.documentElement.requestFullscreen = globalThis.__nativeRequestFullscreenSwipe;
      }
      delete globalThis.__nativeRequestFullscreenSwipe;
    })()`);
  }

  await request('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  try {
    await evaluate("document.querySelector('#btnPrev').click()");
    for (let i = 0; i < 16; i++) await evaluate("document.querySelector('#btnPrev').click()");
    await waitFor("document.querySelector('#pageIndicator').textContent.startsWith('1 /')", '小视口回到第一页');
    await evaluate(dispatchSwipeScript('#stage', -80, 0));
    await waitFor("document.querySelector('#pageIndicator').textContent.startsWith('2 /')", '小视口向左滑下一页');
  } finally {
    await request('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  }

  console.log('  独立查看器滑动翻页通过');
}
