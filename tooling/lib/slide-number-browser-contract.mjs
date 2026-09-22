async function pressKey(request, name, value, code = name, modifiers = 0) {
  const key = { key: name, code, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value, modifiers };
  await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}

function installFullscreen(root) {
  const target = root == null
    ? 'document.documentElement'
    : `document.querySelector(${JSON.stringify(root)})`;
  return `(() => {
    const el = ${target};
    globalThis.__nativeRequestFullscreenNumber = el.requestFullscreen.bind(el);
    el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`;
}

function restoreFullscreen(root) {
  const target = root == null
    ? 'document.documentElement'
    : `document.querySelector(${JSON.stringify(root)})`;
  return `(() => {
    const el = ${target};
    if (el && globalThis.__nativeRequestFullscreenNumber) {
      el.requestFullscreen = globalThis.__nativeRequestFullscreenNumber;
    }
    delete globalThis.__nativeRequestFullscreenNumber;
  })()`;
}

export async function runSlideNumberContract({ evaluate, request, click, waitFor }, {
  trigger,
  fullscreenRoot = null,
  host,
  stage,
  pager,
  prevButton,
  presenting,
  search = null,
  zoomIn = null,
  zoomLabel = null,
  hint = null,
  fileInput = null,
  fileLabel = null,
  restoreSample = null,
  restoreText = null,
}) {
  const chip = `${host} .slide-number`;
  const chipSel = JSON.stringify(chip);
  const pageExpr = `document.querySelector(${JSON.stringify(pager)}).textContent`;
  const chipOn = (text) => `(() => { const el = document.querySelector(${chipSel}); return !!el && !el.hidden && el.textContent === ${JSON.stringify(text)}; })()`;
  const chipOff = `(() => { const el = document.querySelector(${chipSel}); return !el || el.hidden || el.textContent === ''; })()`;
  const veilOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on`)})`;
  const whiteOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on.is-white`)})`;
  const gridOn = `document.querySelector('.slide-grid:not([hidden])')`;
  const bubbled = 'globalThis.__numberBubbled.length';

  await evaluate(`document.querySelector(${JSON.stringify(fullscreenRoot ?? stage)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
  if (prevButton) {
    await evaluate(`(() => {
      const prev = document.querySelector(${JSON.stringify(prevButton)});
      for (let i = 0; i < 16; i++) prev.click();
    })()`);
    await waitFor(`${pageExpr}.startsWith('1 /')`, '数字跳页契约回到第一页');
  }
  const total = String(await evaluate(pageExpr)).split(' / ')[1];
  if (total !== '7') throw new Error(`数字跳页契约需要 7 页文稿，实际 ${await evaluate(pageExpr)}`);
  const page = (n) => `${n} / ${total}`;
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);

  if (hint) {
    const text = await evaluate(`document.querySelector(${JSON.stringify(hint)}).textContent`);
    if (!text.includes('数字+Enter 跳页')) throw new Error(`提示条没有写数字跳页：${text}`);
  }

  const browse = await evaluate(pageExpr);
  await pressKey(request, '3', 51, 'Digit3');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '#', code: 'Digit3', shiftKey: true, bubbles: true, cancelable: true }))`);
  if (!await evaluate(chipOff)) throw new Error('浏览态出现了页码');
  if (await evaluate(pageExpr) !== browse) throw new Error('浏览态数字翻了页');

  if (zoomIn && zoomLabel) {
    const label = `document.querySelector(${JSON.stringify(zoomLabel)}).textContent`;
    await click(zoomIn);
    await waitFor(`${label} !== '适应'`, '放大后离开适应窗口');
    await pressKey(request, '0', 48, 'Digit0');
    await waitFor(`${label} === '适应'`, '浏览态 0 仍是适应窗口');
    if (!await evaluate(chipOff)) throw new Error('浏览态 0 被收成页码');
  }

  if (search) {
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(search)});
      input.value = 'zzz';
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    })()`);
    await request('Input.dispatchKeyEvent', {
      type: 'keyDown', key: '3', code: 'Digit3', text: '3', unmodifiedText: '3',
      windowsVirtualKeyCode: 51, nativeVirtualKeyCode: 51,
    });
    await request('Input.dispatchKeyEvent', {
      type: 'keyUp', key: '3', code: 'Digit3', windowsVirtualKeyCode: 51, nativeVirtualKeyCode: 51,
    });
    await waitFor(
      `document.querySelector(${JSON.stringify(search)}).value === 'zzz3' && ${chipOff} && ${pageExpr} === ${JSON.stringify(browse)}`,
      '浏览态搜索框里的数字留在查询里',
    );
    await evaluate(`document.querySelector(${JSON.stringify(search)}).blur()`);
  }

  const pressDigit = (digit) => pressKey(request, digit, 48 + Number(digit), `Digit${digit}`);
  const pressEnter = async () => {
    await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
    await evaluate('globalThis.__numberBubbled = []');
    await pressKey(request, 'Enter', 13, 'Enter');
  };
  const backToFirst = async () => {
    await evaluate(`(() => {
      const prev = document.querySelector(${JSON.stringify(prevButton)});
      const pager = document.querySelector(${JSON.stringify(pager)});
      for (let i = 0; i < 16 && !pager.textContent.startsWith('1 /'); i++) prev.click();
    })()`);
    await waitFor(`${pageExpr} === ${JSON.stringify(page(1))}`, '回到第一页');
  };

  let failure = null;
  await evaluate(`(() => {
    globalThis.__numberBubbled = [];
    globalThis.__numberBubble = (event) => {
      if (event.key === 'Enter') globalThis.__numberBubbled.push('Enter');
    };
    document.addEventListener('keydown', globalThis.__numberBubble);
  })()`);
  await evaluate(installFullscreen(fullscreenRoot));
  try {
    await click(trigger);
    await waitFor(`${presenting} && !document.fullscreenElement`, '数字跳页契约进入演示');
    await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);

    await pressEnter();
    if (await evaluate(bubbled) !== 1) throw new Error('空缓冲的 Enter 没有到达原来的监听');
    if (await evaluate(pageExpr) === page(3)) throw new Error('空 Enter 跳到了第 3 页');
    if (await evaluate(pageExpr) !== page(1)) await backToFirst();

    await pressDigit('1');
    await waitFor(chipOn('1'), '第一位页码');
    await pressDigit('2');
    await waitFor(`${chipOn('2')} && ${pageExpr} === ${JSON.stringify(page(1))}`, '7 页时第二位改口而不是变成 12');
    await pressEnter();
    await waitFor(`${pageExpr} === ${JSON.stringify(page(2))} && ${chipOff} && !${veilOn}`, 'Enter 跳到第 2 页');
    if (await evaluate(bubbled) !== 0) throw new Error('确认页码的 Enter 又冒泡去前进');
    await backToFirst();

    await pressDigit('3');
    await pressEnter();
    await waitFor(`${pageExpr} === ${JSON.stringify(page(3))} && ${chipOff}`, '3 再 Enter 到第 3 页');
    if (await evaluate(bubbled) !== 0) throw new Error('跳到第 3 页的 Enter 冒泡了');
    await backToFirst();

    const stay = async (digit, label) => {
      const before = await evaluate(pageExpr);
      await pressDigit(digit);
      await waitFor(chipOn(digit), label);
      await pressEnter();
      await waitFor(`${pageExpr} === ${JSON.stringify(before)} && ${chipOff} && !${veilOn}`, `${label}后仍留在当前页`);
      if (await evaluate(bubbled) !== 0) throw new Error(`${label}的 Enter 冒泡去前进了`);
    };
    await stay('0', '0 不是页码');
    if (zoomLabel && await evaluate(`document.querySelector(${JSON.stringify(zoomLabel)}).textContent`) !== '适应') {
      throw new Error('放映中的 0 改成了适应窗口以外的缩放');
    }
    await stay('9', '9 超出 7 页');

    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', ctrlKey: true, bubbles: true, cancelable: true }))`);
    if (!await evaluate(`${chipOff} && ${pageExpr} === ${JSON.stringify(page(1))}`)) {
      throw new Error('Ctrl+3 进了页码缓冲');
    }

    await pressDigit('4');
    await waitFor(chipOn('4'), '点一下之前有页码');
    await evaluate(`document.querySelector(${JSON.stringify(stage)}).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))`);
    await waitFor(`${chipOff} && ${pageExpr} === ${JSON.stringify(page(1))}`, '点一下丢掉页码');
    await pressEnter();
    if (await evaluate(bubbled) !== 1 || await evaluate(pageExpr) === page(4)) {
      throw new Error('丢掉页码之后 Enter 仍跳到第 4 页');
    }
    if (await evaluate(pageExpr) !== page(1)) await backToFirst();

    await pressDigit('5');
    await waitFor(chipOn('5'), '超时前有页码');
    await evaluate('new Promise((resolve) => setTimeout(resolve, 2300))', true);
    await waitFor(`${chipOff} && ${pageExpr} === ${JSON.stringify(page(1))}`, '两秒后页码消失');
    await pressEnter();
    if (await evaluate(bubbled) !== 1 || await evaluate(pageExpr) === page(5)) {
      throw new Error('超时之后 Enter 仍跳到第 5 页');
    }
    if (await evaluate(pageExpr) !== page(1)) await backToFirst();

    if (search) {
      const held = await evaluate(pageExpr);
      await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(search)});
        input.value = 'qq';
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      })()`);
      await request('Input.dispatchKeyEvent', {
        type: 'keyDown', key: '3', code: 'Digit3', text: '3', unmodifiedText: '3',
        windowsVirtualKeyCode: 51, nativeVirtualKeyCode: 51,
      });
      await request('Input.dispatchKeyEvent', {
        type: 'keyUp', key: '3', code: 'Digit3', windowsVirtualKeyCode: 51, nativeVirtualKeyCode: 51,
      });
      await waitFor(
        `document.querySelector(${JSON.stringify(search)}).value === 'qq3' && ${chipOff} && ${pageExpr} === ${JSON.stringify(held)}`,
        '放映中搜索框里的数字留在查询里',
      );
      await evaluate(`document.querySelector(${JSON.stringify(search)}).blur()`);
      if (await evaluate(pageExpr) !== held || !await evaluate(chipOff)) throw new Error('离开搜索框时页码变了');
    }

    await pressDigit('2');
    await waitFor(chipOn('2'), '打开网格前有页码');
    await pressKey(request, 'g', 71, 'KeyG');
    await waitFor(`${gridOn} && ${chipOff} && ${pageExpr} === ${JSON.stringify(page(1))}`, '网格打开并丢掉页码');
    await pressDigit('5');
    if (!await evaluate(`${gridOn} && ${chipOff} && ${pageExpr} === ${JSON.stringify(page(1))}`)) {
      throw new Error('网格开着时数字跳了页或关掉了网格');
    }
    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor(`!${gridOn} && ${presenting} && ${pageExpr} === ${JSON.stringify(page(1))}`, 'Esc 先关网格');

    await pressKey(request, 'w', 87, 'KeyW');
    await waitFor(`${whiteOn} && ${pageExpr} === ${JSON.stringify(page(1))}`, '白屏');
    await pressEnter();
    await waitFor(`!${veilOn} && ${pageExpr} === ${JSON.stringify(page(1))}`, '白屏里空 Enter 只恢复');
    if (await evaluate(bubbled) !== 0) throw new Error('白屏里的空 Enter 冒泡翻页了');

    await pressKey(request, 'w', 87, 'KeyW');
    await waitFor(whiteOn, '再白一次以便非法页码');
    await pressDigit('0');
    await pressEnter();
    await waitFor(`${whiteOn} && ${pageExpr} === ${JSON.stringify(page(1))} && ${chipOff}`, '白屏上的 0 不揭遮罩');
    if (await evaluate(bubbled) !== 0) throw new Error('白屏上的非法 Enter 冒泡了');

    await pressDigit('3');
    await waitFor(`${chipOn('3')} && ${whiteOn}`, '白屏上能接着输页码');
    await pressEnter();
    await waitFor(`${pageExpr} === ${JSON.stringify(page(3))} && !${veilOn} && ${chipOff}`, '白屏上的合法 Enter 跳页并揭掉遮罩');
    if (await evaluate(bubbled) !== 0) throw new Error('白屏确认页码后又前进了');
    await backToFirst();

    await pressKey(request, 'b', 66, 'KeyB');
    await waitFor(`${veilOn} && !${whiteOn}`, '黑屏');
    await pressDigit('2');
    await pressEnter();
    await waitFor(`${pageExpr} === ${JSON.stringify(page(2))} && !${veilOn}`, '黑屏上的合法 Enter 跳页并揭掉遮罩');
    await backToFirst();

    await pressDigit('6');
    await waitFor(chipOn('6'), 'Esc 前有页码');
    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor(`!${presenting} && ${chipOff} && !${veilOn} && ${pageExpr} === ${JSON.stringify(page(1))}`, 'Esc 离开并丢掉页码');

    if (fileInput && fileLabel) {
      await click(trigger);
      await waitFor(presenting, '换文件前再进演示');
      await pressDigit('4');
      await waitFor(chipOn('4'), '换文件前有页码');
      await evaluate(`(async () => {
        const bytes = await fetch('/demo/showcase.pptx').then((response) => response.arrayBuffer());
        const input = document.querySelector(${JSON.stringify(fileInput)});
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], 'slide-number.pptx'));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`, true);
      await waitFor(
        `document.querySelector(${JSON.stringify(fileLabel)}).textContent.includes('slide-number.pptx') && ${pageExpr}.startsWith('1 /') && !${presenting} && ${chipOff}`,
        '换文件后页码消失并回到第一页',
      );
      if (restoreSample) {
        await click(restoreSample);
        await waitFor(
          `document.querySelector(${JSON.stringify(fileLabel)}).textContent.includes(${JSON.stringify(restoreText)}) && document.querySelector(${JSON.stringify(stage)} + ' svg') && ${pageExpr}.startsWith('1 /') && !${presenting}`,
          '换回原本文稿',
        );
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (await evaluate(gridOn)) await pressKey(request, 'Escape', 27, 'Escape');
      if (await evaluate(presenting)) await pressKey(request, 'Escape', 27, 'Escape');
    } catch (cleanup) {
      failure ??= cleanup;
    }
    try {
      await evaluate(`(() => {
        document.removeEventListener('keydown', globalThis.__numberBubble);
        delete globalThis.__numberBubble;
        delete globalThis.__numberBubbled;
      })()`);
      await evaluate(restoreFullscreen(fullscreenRoot));
    } catch (cleanup) {
      failure ??= cleanup;
    }
  }
  if (failure) throw failure;
}

export async function runStandaloneSlideNumberContract({ evaluate, request, waitFor, click }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);
  await request('Page.navigate', { url: await standalone('/missing.pptx') });
  await waitFor("document.querySelector('#fileInfo')?.textContent === '未打开文件'", '数字跳页契约打开失败');
  await pressKey(request, '3', 51, 'Digit3');
  await pressKey(request, 'Enter', 13, 'Enter');
  if (await evaluate("document.querySelector('#presenter .slide-number:not([hidden])')")) {
    throw new Error('打开失败后数字制造了页码');
  }

  await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') && !document.querySelector('#searchInput').disabled",
    '数字跳页契约 showcase',
  );
  await runSlideNumberContract({ evaluate, request, waitFor, click }, {
    trigger: '#btnPresent',
    host: '#presenter',
    stage: '#stage',
    pager: '#pageIndicator',
    prevButton: '#btnPrev',
    presenting: "!document.querySelector('#presenter').hidden",
    search: '#searchInput',
    zoomIn: '#btnZoomIn',
    zoomLabel: '#zoomLabel',
    hint: '.hint',
    fileInput: '#fileInput',
    fileLabel: '#fileInfo',
  });
  console.log('  放映数字跳页通过');
}
