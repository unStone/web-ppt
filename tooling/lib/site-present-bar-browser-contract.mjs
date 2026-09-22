export async function runViewerPresentBarContract({ evaluate, request, click, waitFor }, trigger, host, stage, pager) {
  const shown = `document.querySelector(${JSON.stringify(host)} + ' .present-bar')?.classList.contains('show')`;
  const presenting = `document.querySelector(${JSON.stringify(host)})?.classList.contains('is-presenting')`;
  const pressT = async () => {
    const key = { key: 't', code: 'KeyT', windowsVirtualKeyCode: 84, nativeVirtualKeyCode: 84 };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };

  if (await evaluate(presenting)) throw new Error('控制条契约开始时不应已在放映');
  await pressT();
  if (await evaluate(`${presenting} || ${shown}`)) throw new Error('浏览态 T 不该进入放映或唤出控制条');

  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(host)});
    globalThis.__nativeRequestFullscreenBar = el.requestFullscreen.bind(el);
    el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await click(trigger);
    await waitFor(`${presenting} && !document.fullscreenElement && ${shown}`, '进入放映后控制条可见');

    await evaluate(`document.querySelector(${JSON.stringify(host)} + ' .present-bar').classList.remove('show')`);
    if (await evaluate(shown)) throw new Error('未能隐去控制条');
    const start = await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`);
    await evaluate(`(() => {
      const stageEl = document.querySelector(${JSON.stringify(stage)});
      const pagerEl = document.querySelector(${JSON.stringify(pager)});
      for (let i = 0; i < 16 && pagerEl.textContent === ${JSON.stringify(start)}; i++) {
        stageEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    })()`);
    await waitFor(
      `document.querySelector(${JSON.stringify(pager)}).textContent !== ${JSON.stringify(start)}`,
      '控制条隐去后点舞台仍前进',
    );

    await pressT();
    await waitFor(shown, 'T 唤出控制条');
    await pressT();
    await waitFor(`!${shown}`, 'T 再按隐去控制条');

    if (await evaluate("window.matchMedia('(hover: hover) and (pointer: fine)').matches")) {
      await pressT();
      await waitFor(shown, '能悬停时再唤出以便自动隐去');
      await evaluate('await new Promise((resolve) => setTimeout(resolve, 2100))', true);
      if (await evaluate(shown)) throw new Error('能悬停时 2s 后控制条应隐去');
    }

    await request('Emulation.setEmulatedMedia', {
      features: [
        { name: 'hover', value: 'none' },
        { name: 'pointer', value: 'coarse' },
      ],
    });
    try {
      if (await evaluate("window.matchMedia('(hover: hover) and (pointer: fine)').matches")) {
        throw new Error('触屏仿真后仍被当成可悬停');
      }
      if (!await evaluate(shown)) await pressT();
      await waitFor(`${presenting} && ${shown}`, '不能悬停时控制条保持可见');
      await evaluate('await new Promise((resolve) => setTimeout(resolve, 2100))', true);
      if (!await evaluate(`${presenting} && ${shown}`)) throw new Error('不能悬停时控制条不应自动隐去');
    } finally {
      await request('Emulation.setEmulatedMedia', { features: [] });
    }

    const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor(`!${presenting} && !${shown}`, 'Esc 离开放映并收起控制条');
  } finally {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(host)});
      if (globalThis.__nativeRequestFullscreenBar) el.requestFullscreen = globalThis.__nativeRequestFullscreenBar;
      delete globalThis.__nativeRequestFullscreenBar;
    })()`);
    await request('Emulation.setEmulatedMedia', { features: [] });
  }
}
