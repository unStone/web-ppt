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

function layoutScript() {
  return `(() => {
    const thumbs = document.querySelector('#thumbs');
    const stage = document.querySelector('#stage');
    const side = document.querySelector('.pv-side');
    const presenter = document.querySelector('#presenter');
    const ts = getComputedStyle(thumbs);
    const tr = thumbs.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const sideR = side.getBoundingClientRect();
    return {
      thumbsDisplay: ts.display,
      thumbsW: Math.round(tr.width),
      thumbsAria: thumbs.getAttribute('aria-hidden'),
      stageW: Math.round(sr.width),
      sideW: Math.round(sideR.width),
      sideH: Math.round(sideR.height),
      presenting: !presenter.hidden,
      pending: document.querySelectorAll('#thumbs .thumb.pending').length,
      rendered: document.querySelectorAll('#thumbs .thumb:not(.pending)').length,
      page: document.querySelector('#pageIndicator').textContent,
      vw: innerWidth,
      blank: !!document.querySelector('#stage .present-blank.is-on'),
    };
  })()`;
}

export async function runStandaloneSmallViewportContract({ evaluate, request, waitFor, click }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);
  const press = async (name, value, code = name) => {
    const key = { key: name, code, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };
  const desktop = { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false };
  const phone = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };

  await request('Emulation.setDeviceMetricsOverride', phone);
  try {
    await request('Page.navigate', { url: await standalone('/missing.pptx') });
    await waitFor(
      "document.querySelector('#fileInfo')?.textContent === '未打开文件' && document.querySelector('#pageIndicator')?.textContent === '- / -'",
      '小视口打开失败',
    );
    await evaluate(dispatchSwipeScript('#stage', -80, 0));
    if (await evaluate("document.querySelector('#pageIndicator').textContent") !== '- / -') {
      throw new Error('打开失败后窄屏滑动制造了假页码');
    }

    await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
    await waitFor(
      "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /')",
      '窄屏首次打开 showcase',
    );
    await waitFor(
      "getComputedStyle(document.querySelector('#thumbs')).display === 'none' && document.querySelector('#thumbs').getAttribute('aria-hidden') === 'true'",
      '窄屏藏栏',
    );
    const narrow = await evaluate(layoutScript());
    if (narrow.thumbsW > 1) throw new Error(`窄屏栏仍占宽度：${JSON.stringify(narrow)}`);
    if (narrow.stageW < 300) throw new Error(`窄屏舞台仍然被挤：${JSON.stringify(narrow)}`);
    if (narrow.rendered !== 0) throw new Error(`窄屏不该先渲染看不见的缩略图：${JSON.stringify(narrow)}`);

    await evaluate(dispatchSwipeScript('#stage', -80, 0));
    await waitFor("document.querySelector('#pageIndicator').textContent.startsWith('2 /')", '窄屏向左滑下一页');

    await evaluate(`(() => {
      globalThis.__nativeRequestFullscreenViewport = document.documentElement.requestFullscreen.bind(document.documentElement);
      document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
    })()`);
    try {
      await click('#btnPresent');
      await waitFor("!document.querySelector('#presenter').hidden && !document.fullscreenElement", '窄屏全屏失败仍进入演示');
      const presenting = await evaluate(layoutScript());
      // 并排 320 列会把 390 宽舞台挤到约 70px；改到下方后侧栏接近视口宽，舞台应仍接近全宽
      if (presenting.sideW >= 300 && presenting.sideW <= 340) {
        throw new Error(`窄屏放映侧栏仍是 320px 列：${JSON.stringify(presenting)}`);
      }
      if (presenting.stageW < 240) throw new Error(`窄屏放映当前页仍然不可用：${JSON.stringify(presenting)}`);

      const start = presenting.page;
      await press('b', 66, 'KeyB');
      await waitFor("document.querySelector('#stage .present-blank.is-on')", '窄屏放映 B 黑屏');
      if (await evaluate("document.querySelector('#pageIndicator').textContent") !== start) {
        throw new Error('窄屏 B 黑屏改变了页码');
      }
      const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
      await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
      await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
      await waitFor(
        "document.querySelector('#presenter').hidden && !document.querySelector('#stage .present-blank.is-on')",
        '窄屏 Esc 离开放映并清掉黑层',
      );
    } finally {
      await evaluate(`(() => {
        if (globalThis.__nativeRequestFullscreenViewport) {
          document.documentElement.requestFullscreen = globalThis.__nativeRequestFullscreenViewport;
        }
        delete globalThis.__nativeRequestFullscreenViewport;
      })()`);
    }
  } finally {
    await request('Emulation.setDeviceMetricsOverride', desktop);
  }

  await waitFor(
    "getComputedStyle(document.querySelector('#thumbs')).display !== 'none' && document.querySelector('#thumbs').getAttribute('aria-hidden') === 'false'",
    '拉宽后栏回来',
  );
  const wide = await evaluate(layoutScript());
  if (wide.thumbsDisplay === 'none' || wide.thumbsW < 160 || wide.thumbsW > 184) {
    throw new Error(`宽屏缩略图栏被误藏或宽度不对：${JSON.stringify(wide)}`);
  }
  if (wide.stageW > wide.vw - 140) throw new Error(`宽屏舞台没有给栏留位置：${JSON.stringify(wide)}`);
  await waitFor("document.querySelectorAll('#thumbs .thumb:not(.pending)').length > 0", '拉宽后补渲缩略图');

  await evaluate(`(() => {
    globalThis.__nativeRequestFullscreenViewportWide = document.documentElement.requestFullscreen.bind(document.documentElement);
    document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await click('#btnPresent');
    await waitFor("!document.querySelector('#presenter').hidden", '宽屏再进演示对照');
    const widePresent = await evaluate(layoutScript());
    if (widePresent.sideW < 300 || widePresent.sideW > 340) {
      throw new Error(`宽屏放映侧栏被误改排：${JSON.stringify(widePresent)}`);
    }
    const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor("document.querySelector('#presenter').hidden", '宽屏对照离开演示');
  } finally {
    await evaluate(`(() => {
      if (globalThis.__nativeRequestFullscreenViewportWide) {
        document.documentElement.requestFullscreen = globalThis.__nativeRequestFullscreenViewportWide;
      }
      delete globalThis.__nativeRequestFullscreenViewportWide;
    })()`);
  }

  console.log('  独立查看器小视口布局通过');
}
