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
      await evaluate('(async () => { await new Promise((resolve) => setTimeout(resolve, 2100)); })()', true);
      if (await evaluate(shown)) throw new Error('能悬停时 2s 后控制条应隐去');
    }

    const readInput = () => evaluate(`(() => {
      const matches = (query) => window.matchMedia(query).matches;
      return {
        points: navigator.maxTouchPoints,
        hoverFine: matches('(hover: hover) and (pointer: fine)'),
        hover: matches('(hover: hover)'), hoverNone: matches('(hover: none)'),
        fine: matches('(pointer: fine)'), coarse: matches('(pointer: coarse)'), none: matches('(pointer: none)'),
        anyHover: matches('(any-hover: hover)'), anyHoverNone: matches('(any-hover: none)'),
        anyFine: matches('(any-pointer: fine)'), anyCoarse: matches('(any-pointer: coarse)'), anyNone: matches('(any-pointer: none)'),
      };
    })()`);
    const previousInput = await readInput();
    const sameInput = (actual) => Object.entries(previousInput).every(([key, value]) => actual[key] === value);
    // 契约失败与输入能力未恢复可能同时发生；两者都要报出，不能让后者盖掉前者的根因。
    let contractFailure = null;
    try {
      // hover/pointer 不受 setEmulatedMedia 支持；触屏仿真直接建立真实的输入设备能力。
      await request('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      if (await evaluate("window.matchMedia('(hover: hover) and (pointer: fine)').matches")) {
        throw new Error('触屏仿真后仍被当成可悬停');
      }
      if (!await evaluate("navigator.maxTouchPoints === 1 && window.matchMedia('(hover: none) and (pointer: coarse)').matches")) {
        throw new Error('触屏仿真未建立单触点、无悬停与粗指针能力');
      }
      if (!await evaluate(shown)) await pressT();
      await waitFor(`${presenting} && ${shown}`, '不能悬停时控制条保持可见');
      await evaluate('(async () => { await new Promise((resolve) => setTimeout(resolve, 2100)); })()', true);
      if (!await evaluate(`${presenting} && ${shown}`)) throw new Error('不能悬停时控制条不应自动隐去');
    } catch (error) {
      contractFailure = error;
    }
    // 原生触屏与已启用仿真都可能有触点，先回到 embedder，按实际能力决定是否重启仿真。
    await request('Emulation.setTouchEmulationEnabled', { enabled: false });
    let restoredInput = await readInput();
    if (!sameInput(restoredInput) && previousInput.points > 0) {
      await request('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: previousInput.points });
      restoredInput = await readInput();
    }
    if (!sameInput(restoredInput)) {
      const restoreFailure = new Error(`触屏仿真未恢复原输入能力：${JSON.stringify({ previousInput, restoredInput })}`);
      if (contractFailure) throw new AggregateError([contractFailure, restoreFailure], '触屏放映契约失败，且输入能力未恢复');
      throw restoreFailure;
    }
    if (contractFailure) throw contractFailure;

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
  }
}
