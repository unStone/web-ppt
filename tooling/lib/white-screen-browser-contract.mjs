async function press(request, name, value, modifiers = 0) {
  const code = name === 'b' || name === 'B' ? 'KeyB'
    : name === 'w' || name === 'W' ? 'KeyW'
      : name === 'n' || name === 'N' ? 'KeyN'
        : name === '.' ? 'Period'
          : name === ',' || name === '<' ? 'Comma'
            : name === ' ' ? 'Space'
              : name;
  const key = {
    key: name,
    code,
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
      globalThis.__nativeRequestFullscreenWhite = el.requestFullscreen.bind(el);
      el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
    })()`;
  }
  return `(() => {
    const el = document.querySelector(${JSON.stringify(root)});
    globalThis.__nativeRequestFullscreenWhite = el.requestFullscreen.bind(el);
    el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`;
}

function restoreFullscreen(root) {
  const target = root == null
    ? 'document.documentElement'
    : `document.querySelector(${JSON.stringify(root)})`;
  return `(() => {
    const el = ${target};
    if (el && globalThis.__nativeRequestFullscreenWhite) {
      el.requestFullscreen = globalThis.__nativeRequestFullscreenWhite;
    }
    delete globalThis.__nativeRequestFullscreenWhite;
  })()`;
}

function dispatchKey(key, extra = {}) {
  const flags = Object.entries({ ...extra, key, bubbles: true, cancelable: true })
    .map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
    .join(', ');
  return `document.dispatchEvent(new KeyboardEvent('keydown', { ${flags} }))`;
}

export async function runWhiteScreenContract({ evaluate, request, click, waitFor }, {
  trigger,
  fullscreenRoot = null,
  stage,
  pager,
  prevButton,
  nextButton,
  gridButton,
  blankButton,
  presenting,
  search = null,
  hint = null,
}) {
  const veilOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on`)})`;
  const whiteOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on.is-white`)})`;
  const blackOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on:not(.is-white)`)})`;
  const pageExpr = `document.querySelector(${JSON.stringify(pager)}).textContent`;
  const gridOn = `document.querySelector('.slide-grid:not([hidden])')`;
  const scroll = fullscreenRoot ?? stage;
  const background = `getComputedStyle(document.querySelector(${JSON.stringify(`${stage} .present-blank`)})).backgroundColor`;

  await evaluate(`document.querySelector(${JSON.stringify(scroll)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
  if (prevButton) {
    await evaluate(`(() => {
      const prev = document.querySelector(${JSON.stringify(prevButton)});
      for (let i = 0; i < 16; i++) prev.click();
    })()`);
    await waitFor(`${pageExpr}.startsWith('1 /')`, '白屏契约回到第一页');
  }
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await evaluate(`(() => {
    globalThis.__whiteBubbled = [];
    globalThis.__whiteBubble = (event) => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
        globalThis.__whiteBubbled.push(event.key);
      }
    };
    document.addEventListener('keydown', globalThis.__whiteBubble);
  })()`);

  const title = await evaluate(`document.querySelector(${JSON.stringify(blankButton)}).title`);
  if (!title.includes('B') || title.includes('W')) throw new Error(`黑屏按钮被改成了白屏：${title}`);
  if (hint) {
    const text = await evaluate(`document.querySelector(${JSON.stringify(hint)}).textContent`);
    if (!text.includes('B 或 . 黑屏') || !text.includes('W 或 , 白屏')) {
      throw new Error(`提示条没有同时写黑屏和白屏：${text}`);
    }
  }

  const browsePage = await evaluate(pageExpr);
  await press(request, 'w', 87);
  await press(request, ',', 188);
  await press(request, '<', 188);
  if (await evaluate(veilOn)) throw new Error('浏览态出现了遮罩');
  if (await evaluate(pageExpr) !== browsePage) throw new Error('浏览态 W 或逗号翻了页');

  if (search) {
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(search)});
      input.value = 'zzz';
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    })()`);
    await request('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'w', code: 'KeyW', text: 'w', unmodifiedText: 'w',
      windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87,
    });
    await request('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87,
    });
    await request('Input.dispatchKeyEvent', {
      type: 'keyDown', key: ',', code: 'Comma', text: ',', unmodifiedText: ',',
      windowsVirtualKeyCode: 188, nativeVirtualKeyCode: 188,
    });
    await request('Input.dispatchKeyEvent', {
      type: 'keyUp', key: ',', code: 'Comma', windowsVirtualKeyCode: 188, nativeVirtualKeyCode: 188,
    });
    await waitFor(
      `document.querySelector(${JSON.stringify(search)}).value === 'zzzw,' && !${veilOn} && ${pageExpr} === ${JSON.stringify(browsePage)}`,
      '搜索框里的 W 和逗号留在查询里',
    );
    await evaluate(`document.querySelector(${JSON.stringify(search)}).blur()`);
  }

  let exited = false;
  let failure = null;
  await evaluate(installFullscreen(fullscreenRoot));
  try {
    await click(trigger);
    await waitFor(`${presenting} && !document.fullscreenElement`, '白屏契约进入演示');
    const start = await evaluate(pageExpr);

    await press(request, 'w', 87);
    await waitFor(`${whiteOn} && ${pageExpr} === ${JSON.stringify(start)}`, '放映中 W 白屏');
    if (!String(await evaluate(background)).includes('255, 255, 255')) throw new Error('白屏层不是白色');
    if (await evaluate(`document.querySelector(${JSON.stringify(blankButton)}).getAttribute('aria-pressed')`) !== 'false') {
      throw new Error('白屏时 B 按钮算成了按下');
    }
    await press(request, 'w', 87);
    await waitFor(`!${veilOn} && ${pageExpr} === ${JSON.stringify(start)}`, '再按 W 恢复');

    await press(request, ',', 188);
    await waitFor(whiteOn, '逗号打开白屏');
    await press(request, 'w', 87);
    await waitFor(`!${veilOn} && ${pageExpr} === ${JSON.stringify(start)}`, 'W 关掉逗号打开的白屏');
    await press(request, 'W', 87, 8);
    await waitFor(`${whiteOn} && ${pageExpr} === ${JSON.stringify(start)}`, 'Shift+W 白屏');
    await press(request, ',', 188);
    await waitFor(`!${veilOn}`, '逗号关掉 Shift+W');

    await press(request, 'w', 87);
    await waitFor(whiteOn, '再白一次以便换成黑');
    await press(request, 'b', 66);
    await waitFor(`${blackOn} && !${whiteOn} && ${pageExpr} === ${JSON.stringify(start)}`, 'B 把白屏换成黑屏');
    if (!String(await evaluate(background)).includes('0, 0, 0')) throw new Error('换成黑屏后层不是黑色');
    await press(request, ',', 188);
    await waitFor(`${whiteOn} && ${pageExpr} === ${JSON.stringify(start)}`, '逗号把黑屏换成白屏');
    await press(request, '.', 190);
    await waitFor(`${blackOn} && ${pageExpr} === ${JSON.stringify(start)}`, '句号把白屏换成黑屏');
    await press(request, 'w', 87);
    await waitFor(whiteOn, 'W 再换成白');
    await evaluate(`document.querySelector(${JSON.stringify(blankButton)}).click()`);
    await waitFor(`${blackOn} && ${pageExpr} === ${JSON.stringify(start)}`, 'B 按钮把白屏换成黑屏');
    await press(request, 'b', 66);
    await waitFor(`!${veilOn}`, 'B 关掉黑屏');

    await press(request, 'w', 87);
    await waitFor(whiteOn, '再白一次以便点层');
    await evaluate(`document.querySelector(${JSON.stringify(`${stage} .present-blank`)}).dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await waitFor(`!${veilOn} && ${pageExpr} === ${JSON.stringify(start)}`, '点白层恢复且不翻页');

    const armed = async (key, value, label) => {
      await evaluate('globalThis.__whiteBubbled = []');
      await press(request, key, value);
      await waitFor(`!${veilOn} && ${pageExpr} === ${JSON.stringify(start)}`, label);
      if (await evaluate('globalThis.__whiteBubbled.length') !== 0) {
        throw new Error(`${label}：按键还冒泡到了翻页`);
      }
    };
    await press(request, 'w', 87);
    await waitFor(whiteOn, '再白一次以便空格');
    await armed(' ', 32, '白屏中空格只恢复');
    await press(request, 'w', 87);
    await waitFor(whiteOn, '再白一次以便方向键');
    await armed('ArrowRight', 39, '白屏中方向键只恢复');
    await press(request, 'w', 87);
    await waitFor(whiteOn, '再白一次以便 Enter');
    await armed('Enter', 13, '白屏中 Enter 只恢复');
    await evaluate('globalThis.__whiteBubbled = []');
    await press(request, 'Enter', 13);
    if (await evaluate('globalThis.__whiteBubbled.length') !== 1) throw new Error('没有遮罩时 Enter 没有到达原来的监听');
    if (await evaluate(veilOn)) throw new Error('没有遮罩时 Enter 打出了白屏');
    if (await evaluate(pageExpr) !== start && prevButton) {
      await evaluate(`(() => {
        const prev = document.querySelector(${JSON.stringify(prevButton)});
        const pager = document.querySelector(${JSON.stringify(pager)});
        for (let i = 0; i < 8 && pager.textContent !== ${JSON.stringify(start)}; i++) prev.click();
      })()`);
      await waitFor(`${pageExpr} === ${JSON.stringify(start)}`, 'Enter 前进后回到原页');
    }

    await press(request, 'w', 87);
    await waitFor(whiteOn, '再白一次以便 N');
    await press(request, 'n', 78);
    await press(request, 'n', 78);
    if (!await evaluate(whiteOn) || await evaluate(pageExpr) !== start) throw new Error('N 清掉了白屏或翻了页');

    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }))`);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', metaKey: true, bubbles: true, cancelable: true }))`);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true, cancelable: true }))`);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', metaKey: true, bubbles: true, cancelable: true }))`);
    if (!await evaluate(whiteOn) || await evaluate(pageExpr) !== start || !await evaluate(presenting)) {
      throw new Error('修饰键清掉了白屏、翻了页或结束了放映');
    }
    await press(request, '<', 188);
    if (!await evaluate(whiteOn) || await evaluate(pageExpr) !== start) throw new Error('< 被当成白屏键');

    if (search) {
      await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(search)});
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      })()`);
      await request('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'w', code: 'KeyW', text: 'w', unmodifiedText: 'w',
        windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87,
      });
      await request('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });
      await waitFor(
        `document.querySelector(${JSON.stringify(search)}).value.endsWith('w') && ${whiteOn} && ${pageExpr} === ${JSON.stringify(start)}`,
        '放映中搜索框里的 W 不改白屏',
      );
      await evaluate(`document.querySelector(${JSON.stringify(search)}).blur()`);
    }

    if (nextButton) {
      await evaluate(`(() => {
        const next = document.querySelector(${JSON.stringify(nextButton)});
        const pager = document.querySelector(${JSON.stringify(pager)});
        const from = pager.textContent;
        for (let i = 0; i < 16 && pager.textContent === from; i++) next.click();
      })()`);
      await waitFor(`${pageExpr} !== ${JSON.stringify(start)} && ${whiteOn}`, '下一页仍翻页且保持白屏');
      if (prevButton) {
        await evaluate(`(() => {
          const prev = document.querySelector(${JSON.stringify(prevButton)});
          const pager = document.querySelector(${JSON.stringify(pager)});
          for (let i = 0; i < 16 && pager.textContent !== ${JSON.stringify(start)}; i++) prev.click();
        })()`);
        await waitFor(`${pageExpr} === ${JSON.stringify(start)} && ${whiteOn}`, '回到原页时白屏还在');
      }
    }

    await evaluate(`(() => {
      const host = document.querySelector(${JSON.stringify(fullscreenRoot ?? stage)});
      host?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    })()`);
    await click(gridButton);
    await waitFor(gridOn, '白屏时打开网格');
    await press(request, 'w', 87);
    await press(request, ',', 188);
    if (!await evaluate(whiteOn) || await evaluate(pageExpr) !== start || !await evaluate(gridOn)) {
      throw new Error('网格开着时 W 或逗号改了白屏、翻了页或关掉了网格');
    }
    const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor(`!${gridOn} && ${presenting} && ${whiteOn} && ${pageExpr} === ${JSON.stringify(start)}`, 'Esc 先关网格且白屏还在');

    await click(gridButton);
    await waitFor(gridOn, '再开网格以便点页');
    await evaluate(`document.querySelector('.slide-grid-item[data-index="2"]').click()`);
    await waitFor(
      `!${gridOn} && ${presenting} && !${veilOn} && ${pageExpr}.startsWith('3 /')`,
      '点网格页清掉白屏并跳页',
    );

    await press(request, 'w', 87);
    await waitFor(whiteOn, '跳页后 W 仍能白屏');
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor(`!(${presenting}) && !${veilOn}`, 'Esc 离开放映并清掉白屏');
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
      await evaluate(`(() => {
        document.removeEventListener('keydown', globalThis.__whiteBubble);
        delete globalThis.__whiteBubble;
        delete globalThis.__whiteBubbled;
      })()`);
      await evaluate(restoreFullscreen(fullscreenRoot));
    } catch (cleanup) {
      failure ??= cleanup;
    }
  }
  if (failure) throw failure;
  await evaluate(dispatchKey('w'));
  await evaluate(dispatchKey(','));
  if (await evaluate(veilOn) || await evaluate(presenting)) throw new Error('退出后 W 或逗号仍白屏或留在放映');
}

export async function runStandaloneWhiteScreenContract({ evaluate, request, waitFor, click }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);
  await request('Page.navigate', { url: await standalone('/missing.pptx') });
  await waitFor("document.querySelector('#fileInfo')?.textContent === '未打开文件'", '白屏契约打开失败');
  await press(request, 'w', 87);
  await press(request, ',', 188);
  if (await evaluate("document.querySelector('#stage .present-blank.is-on')")) {
    throw new Error('打开失败后 W 或逗号制造了遮罩');
  }

  await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') && !document.querySelector('#searchInput').disabled",
    '白屏契约 showcase',
  );
  await runWhiteScreenContract({ evaluate, request, waitFor, click }, {
    trigger: '#btnPresent',
    stage: '#stage',
    pager: '#pageIndicator',
    prevButton: '#btnPrev',
    nextButton: '#btnNext',
    gridButton: '#pvGrid',
    blankButton: '#pvBlank',
    presenting: "!document.querySelector('#presenter').hidden",
    search: '#searchInput',
    hint: '.hint',
  });
  console.log('  放映白屏通过');
}
