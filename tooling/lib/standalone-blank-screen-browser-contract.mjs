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

export async function runStandaloneBlankScreenContract({ evaluate, request, waitFor, click }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);
  const press = async (name, value) => {
    const key = { key: name, code: name === 'b' ? 'KeyB' : name, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };

  await request('Page.navigate', { url: await standalone('/missing.pptx') });
  await waitFor("document.querySelector('#fileInfo')?.textContent === '未打开文件'", '独立查看器打开失败');
  await press('b', 66);
  if (await evaluate("document.querySelector('#stage .present-blank.is-on')")) {
    throw new Error('打开失败后 B 制造了黑屏');
  }

  await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /')",
    '独立查看器 showcase',
  );
  await press('b', 66);
  if (await evaluate("document.querySelector('#stage .present-blank.is-on')")) {
    throw new Error('浏览态 B 不该黑屏');
  }

  await evaluate(`(() => {
    globalThis.__nativeRequestFullscreenBlank = document.documentElement.requestFullscreen.bind(document.documentElement);
    document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await click('#btnPresent');
    await waitFor("!document.querySelector('#presenter').hidden && !document.fullscreenElement", '全屏失败仍进入演示');
    const start = await evaluate("document.querySelector('#pageIndicator').textContent");
    await press('b', 66);
    await waitFor("document.querySelector('#stage .present-blank.is-on')", '放映中 B 黑屏');
    if (await evaluate("document.querySelector('#pageIndicator').textContent") !== start) {
      throw new Error('B 黑屏改变了页码');
    }
    await press('b', 66);
    await waitFor("!document.querySelector('#stage .present-blank.is-on')", '再按 B 恢复');

    await press('b', 66);
    await waitFor("document.querySelector('#stage .present-blank.is-on')", '再黑一次以便点层');
    await evaluate("document.querySelector('#stage .present-blank').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
    await waitFor("!document.querySelector('#stage .present-blank.is-on')", '点黑层恢复');
    if (await evaluate("document.querySelector('#pageIndicator').textContent") !== start) {
      throw new Error('点黑层被当成舞台前进');
    }

    await press('b', 66);
    await waitFor("document.querySelector('#stage .present-blank.is-on')", '再黑一次以便 pointerup 后 click 打到幻灯片');
    await evaluate(`(() => {
      const layer = document.querySelector('#stage .present-blank');
      const slide = document.querySelector('#stage svg') || layer;
      layer.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      slide.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    })()`);
    await waitFor("!document.querySelector('#stage .present-blank.is-on')", 'pointerup 恢复黑层');
    if (await evaluate("document.querySelector('#pageIndicator').textContent") !== start) {
      throw new Error('pointerup 后的 click 翻了页');
    }

    await press('b', 66);
    await waitFor("document.querySelector('#stage .present-blank.is-on')", '再黑一次以便空格');
    await press(' ', 32);
    await waitFor("!document.querySelector('#stage .present-blank.is-on')", '黑屏中空格只恢复');
    if (await evaluate("document.querySelector('#pageIndicator').textContent") !== start) {
      throw new Error('黑屏中空格翻了页');
    }

    await press('b', 66);
    await waitFor("document.querySelector('#stage .present-blank.is-on')", '再黑一次以便滑动');
    await evaluate(dispatchSwipeScript('#stage .present-blank', -80, 0));
    await waitFor("!document.querySelector('#stage .present-blank.is-on')", '滑黑层只恢复');
    if (await evaluate("document.querySelector('#pageIndicator').textContent") !== start) {
      throw new Error('滑黑层翻了页');
    }

    await press('b', 66);
    await waitFor("document.querySelector('#stage .present-blank.is-on')", '再黑一次以便翻页');
    await evaluate(`(() => {
      const next = document.querySelector('#btnNext');
      const pager = document.querySelector('#pageIndicator');
      const from = pager.textContent;
      for (let i = 0; i < 16 && pager.textContent === from; i++) next.click();
    })()`);
    await waitFor(
      `document.querySelector('#pageIndicator').textContent !== ${JSON.stringify(start)} && document.querySelector('#stage .present-blank.is-on')`,
      '下一页仍翻页且保持黑屏',
    );

    const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor(
      "document.querySelector('#presenter').hidden && !document.querySelector('#stage .present-blank.is-on')",
      'Esc 离开放映并清掉黑层',
    );
  } finally {
    await evaluate(`(() => {
      if (globalThis.__nativeRequestFullscreenBlank) {
        document.documentElement.requestFullscreen = globalThis.__nativeRequestFullscreenBlank;
      }
      delete globalThis.__nativeRequestFullscreenBlank;
    })()`);
  }
  await press('b', 66);
  if (await evaluate("document.querySelector('#stage .present-blank.is-on')")) {
    throw new Error('退出后 B 仍黑屏');
  }
  console.log('  独立查看器放映黑屏通过');
}
