async function press(request, name, value, modifiers = 0) {
  const key = {
    key: name,
    code: name === 'b' ? 'KeyB' : name === '.' ? 'Period' : name === ',' ? 'Comma' : name,
    windowsVirtualKeyCode: value,
    nativeVirtualKeyCode: value,
    modifiers,
  };
  await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}

function installFullscreen(root) {
  if (root == null) {
    return `(() => {
      const el = document.documentElement;
      globalThis.__nativeRequestFullscreenPeriod = el.requestFullscreen.bind(el);
      el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
    })()`;
  }
  return `(() => {
    const el = document.querySelector(${JSON.stringify(root)});
    globalThis.__nativeRequestFullscreenPeriod = el.requestFullscreen.bind(el);
    el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`;
}

function restoreFullscreen(root) {
  const target = root == null
    ? 'document.documentElement'
    : `document.querySelector(${JSON.stringify(root)})`;
  return `(() => {
    const el = ${target};
    if (el && globalThis.__nativeRequestFullscreenPeriod) {
      el.requestFullscreen = globalThis.__nativeRequestFullscreenPeriod;
    }
    delete globalThis.__nativeRequestFullscreenPeriod;
  })()`;
}

export async function runBlankPeriodContract({ evaluate, request, click, waitFor }, {
  trigger,
  fullscreenRoot = null,
  stage,
  pager,
  prevButton,
  gridButton,
  blankButton,
  presenting,
  search = null,
  hint = null,
}) {
  const blankOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on`)})`;
  const pageExpr = `document.querySelector(${JSON.stringify(pager)}).textContent`;
  const gridOn = `document.querySelector('.slide-grid:not([hidden])')`;
  const scroll = fullscreenRoot ?? stage;

  await evaluate(`document.querySelector(${JSON.stringify(scroll)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
  if (prevButton) {
    await evaluate(`(() => {
      const prev = document.querySelector(${JSON.stringify(prevButton)});
      for (let i = 0; i < 16; i++) prev.click();
    })()`);
    await waitFor(`${pageExpr}.startsWith('1 /')`, '句号契约回到第一页');
  }
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);

  const title = await evaluate(`document.querySelector(${JSON.stringify(blankButton)}).title`);
  if (!title.includes('B') || !title.includes('.')) throw new Error(`黑屏按钮没写句号：${title}`);
  if (hint) {
    const text = await evaluate(`document.querySelector(${JSON.stringify(hint)}).textContent`);
    if (!text.includes('B 或 . 黑屏')) throw new Error(`提示条没有写句号：${text}`);
  }

  const browsePage = await evaluate(pageExpr);
  await press(request, '.', 190);
  if (await evaluate(blankOn)) throw new Error('浏览态句号不该黑屏');
  if (await evaluate(pageExpr) !== browsePage) throw new Error('浏览态句号翻了页');

  if (search) {
    const searchValue = `document.querySelector(${JSON.stringify(search)}).value`;
    if (await evaluate(searchValue) !== '') throw new Error('浏览态句号写进了搜索框');
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(search)});
      input.value = 'zzz';
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    })()`);
    await request('Input.dispatchKeyEvent', {
      type: 'keyDown', key: '.', code: 'Period', text: '.', unmodifiedText: '.',
      windowsVirtualKeyCode: 190, nativeVirtualKeyCode: 190,
    });
    await request('Input.dispatchKeyEvent', {
      type: 'keyUp', key: '.', code: 'Period', windowsVirtualKeyCode: 190, nativeVirtualKeyCode: 190,
    });
    await waitFor(`${searchValue} === 'zzz.' && !${blankOn} && ${pageExpr} === ${JSON.stringify(browsePage)}`, '搜索框里的句号留在查询里');
    await waitFor(
      `document.querySelector('#searchHits').textContent === '无结果' && ${pageExpr} === ${JSON.stringify(browsePage)} && !${blankOn}`,
      '查询里的句号不跳页',
    );
    await evaluate(`document.querySelector(${JSON.stringify(search)}).blur()`);
  }

  let exited = false;
  let failure = null;
  await evaluate(installFullscreen(fullscreenRoot));
  try {
    await click(trigger);
    await waitFor(`${presenting} && !document.fullscreenElement`, '句号契约进入演示');
    const start = await evaluate(pageExpr);
    if (search && await evaluate(`document.querySelector(${JSON.stringify(search)}).value`) !== 'zzz.') {
      throw new Error('进入放映改写了查询');
    }

    await press(request, '.', 190);
    await waitFor(blankOn, '放映中句号黑屏');
    if (await evaluate(pageExpr) !== start) throw new Error('句号黑屏改变了页码');
    const shown = await evaluate(`document.querySelector(${JSON.stringify(blankButton)}).title`);
    if (!shown.includes('B') || !shown.includes('.')) throw new Error(`黑屏中的按钮提示丢了句号：${shown}`);
    await press(request, '.', 190);
    await waitFor(`!${blankOn}`, '再按句号恢复');
    if (await evaluate(pageExpr) !== start) throw new Error('句号恢复改变了页码');

    await press(request, 'b', 66);
    await waitFor(blankOn, 'B 打开黑屏以便句号关掉');
    await press(request, '.', 190);
    await waitFor(`!${blankOn} && ${pageExpr} === ${JSON.stringify(start)}`, '句号关掉 B 打开的黑屏');
    await press(request, '.', 190);
    await waitFor(blankOn, '句号再打开');
    await press(request, 'b', 66);
    await waitFor(`!${blankOn} && ${pageExpr} === ${JSON.stringify(start)}`, 'B 关掉句号打开的黑屏');

    await press(request, '.', 190);
    await waitFor(blankOn, '再黑一次以便点层');
    await evaluate(`document.querySelector(${JSON.stringify(`${stage} .present-blank`)}).dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await waitFor(`!${blankOn} && ${pageExpr} === ${JSON.stringify(start)}`, '点黑层恢复且不翻页');

    await press(request, '.', 190);
    await waitFor(blankOn, '再黑一次以便空格');
    await press(request, ' ', 32);
    await waitFor(`!${blankOn} && ${pageExpr} === ${JSON.stringify(start)}`, '黑屏中空格只恢复');

    await press(request, '.', 190, 4);
    if (await evaluate(blankOn) || await evaluate(pageExpr) !== start || !await evaluate(presenting)) {
      throw new Error('⌘+. 黑了屏、翻了页或结束了放映');
    }
    const whiteOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on.is-white`)})`;
    await press(request, ',', 188);
    await waitFor(`${whiteOn} && ${pageExpr} === ${JSON.stringify(start)}`, '逗号打开白屏而不是黑屏');
    if (await evaluate(`document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on:not(.is-white)`)})`)) {
      throw new Error('逗号被当成黑屏');
    }
    await press(request, ',', 188);
    await waitFor(`!${blankOn} && ${pageExpr} === ${JSON.stringify(start)}`, '再按逗号关掉白屏');

    if (search && await evaluate(`document.querySelector(${JSON.stringify(search)}).value`) !== 'zzz.') {
      throw new Error('放映中的句号改写了查询');
    }

    await evaluate(`(() => {
      const host = document.querySelector(${JSON.stringify(fullscreenRoot ?? stage)});
      host?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    })()`);
    await click(gridButton);
    await waitFor(gridOn, '放映打开网格');
    await press(request, '.', 190);
    if (await evaluate(blankOn) || await evaluate(pageExpr) !== start || !await evaluate(gridOn)) {
      throw new Error('网格开着时句号黑了屏、翻了页或关掉了网格');
    }
    const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor(`!${gridOn} && ${presenting} && !${blankOn} && ${pageExpr} === ${JSON.stringify(start)}`, 'Esc 先关网格');

    await press(request, '.', 190);
    await waitFor(blankOn, '关网格后句号仍能黑屏');
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor(`!(${presenting}) && !${blankOn}`, 'Esc 离开放映并清掉黑层');
    exited = true;
  } catch (error) {
    failure = error;
  } finally {
    if (!exited) {
      try {
        if (await evaluate(gridOn)) await press(request, 'Escape', 27);
        if (await evaluate(presenting)) await press(request, 'Escape', 27);
      } catch (cleanup) {
        failure ??= cleanup;
      }
    }
    try {
      await evaluate(restoreFullscreen(fullscreenRoot));
    } catch (cleanup) {
      failure ??= cleanup;
    }
  }
  if (failure) throw failure;
  // 刚退出放映后，headless 的 Input.dispatchKeyEvent 再送句号会让主线程不再响应。
  // 监听器仍在 document 上，页面内派发走的是同一条「浏览态不黑屏」。
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true, cancelable: true }))`);
  if (await evaluate(blankOn) || await evaluate(presenting)) throw new Error('退出后句号仍黑屏或留在放映');
}

export async function runStandaloneBlankPeriodContract({ evaluate, request, waitFor, click }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);
  await request('Page.navigate', { url: await standalone('/missing.pptx') });
  await waitFor("document.querySelector('#fileInfo')?.textContent === '未打开文件'", '句号契约打开失败');
  await press(request, '.', 190);
  if (await evaluate("document.querySelector('#stage .present-blank.is-on')")) {
    throw new Error('打开失败后句号制造了黑屏');
  }

  await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') && !document.querySelector('#searchInput').disabled",
    '句号契约 showcase',
  );
  await runBlankPeriodContract({ evaluate, request, waitFor, click }, {
    trigger: '#btnPresent',
    stage: '#stage',
    pager: '#pageIndicator',
    prevButton: '#btnPrev',
    gridButton: '#pvGrid',
    blankButton: '#pvBlank',
    presenting: "!document.querySelector('#presenter').hidden",
    search: '#searchInput',
    hint: '.hint',
  });
  console.log('  放映句号黑屏通过');
}
