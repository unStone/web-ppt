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
    globalThis.__nativeRequestFullscreenEnds = el.requestFullscreen.bind(el);
    el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`;
}

function restoreFullscreen(root) {
  const target = root == null
    ? 'document.documentElement'
    : `document.querySelector(${JSON.stringify(root)})`;
  return `(() => {
    const el = ${target};
    if (el && globalThis.__nativeRequestFullscreenEnds) {
      el.requestFullscreen = globalThis.__nativeRequestFullscreenEnds;
    }
    delete globalThis.__nativeRequestFullscreenEnds;
  })()`;
}

export async function runSlideEndsContract({ evaluate, request, click, waitFor }, {
  trigger,
  fullscreenRoot = null,
  host,
  stage,
  pager,
  prevButton,
  nextButton,
  presenting,
  search = null,
  hint = null,
  browseJumps = false,
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
  const bubbled = 'globalThis.__endBubbled.length';

  await evaluate(`document.querySelector(${JSON.stringify(fullscreenRoot ?? stage)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
  await evaluate(`(() => {
    const prev = document.querySelector(${JSON.stringify(prevButton)});
    const pager = document.querySelector(${JSON.stringify(pager)});
    for (let i = 0; i < 16 && pager && !pager.textContent.startsWith('1 /'); i++) prev.click();
  })()`);
  await waitFor(`${pageExpr}.startsWith('1 /')`, '首尾页契约回到第一页');
  const total = String(await evaluate(pageExpr)).split(' / ')[1];
  if (total !== '7') throw new Error(`首尾页契约需要 7 页文稿，实际 ${await evaluate(pageExpr)}`);
  const page = (n) => `${n} / ${total}`;
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);

  if (hint) {
    const text = await evaluate(`document.querySelector(${JSON.stringify(hint)}).textContent`);
    if (!text.includes('Home / End 首尾页')) throw new Error(`提示条没有写首尾页：${text}`);
  }

  const pressDigit = (digit) => pressKey(request, digit, 48 + Number(digit), `Digit${digit}`);
  const pressEnter = async () => {
    await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
    await pressKey(request, 'Enter', 13, 'Enter');
  };
  const pressEndKey = (name, value) => pressKey(request, name, value, name);
  const modifiedHome = (flag) => evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', code: 'Home', ${flag}: true, bubbles: true, cancelable: true }))`,
  );
  const backToFirst = async () => {
    await evaluate(`(() => {
      const prev = document.querySelector(${JSON.stringify(prevButton)});
      const pager = document.querySelector(${JSON.stringify(pager)});
      for (let i = 0; i < 16 && !pager.textContent.startsWith('1 /'); i++) prev.click();
    })()`);
    await waitFor(`${pageExpr} === ${JSON.stringify(page(1))}`, '回到第一页');
  };
  const toPage = async (n) => {
    if (await evaluate(pageExpr) === page(n)) return;
    await backToFirst();
    await pressDigit(String(n));
    await waitFor(chipOn(String(n)), `准备跳到第 ${n} 页`);
    await pressEnter();
    await waitFor(`${pageExpr} === ${JSON.stringify(page(n))} && ${chipOff}`, `放到第 ${n} 页`);
  };

  await evaluate(`(() => {
    globalThis.__endBubbled = [];
    globalThis.__endBubble = (event) => {
      if (event.key === 'Home' || event.key === 'End') {
        globalThis.__endBubbled.push({ key: event.key, prevented: event.defaultPrevented });
      }
    };
    document.addEventListener('keydown', globalThis.__endBubble);
  })()`);

  let failure = null;
  try {
    await click(nextButton);
    await click(nextButton);
    await waitFor(`${pageExpr} === ${JSON.stringify(page(3))}`, '浏览到第 3 页');

    if (search) {
      await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(search)});
        input.value = 'qq';
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      })()`);
      await pressEndKey('Home', 36);
      await waitFor(
        `document.querySelector(${JSON.stringify(search)}).value === 'qq' && ${pageExpr} === ${JSON.stringify(page(3))}`,
        '浏览态搜索框里的 Home 不跳页',
      );
      await evaluate(`document.querySelector(${JSON.stringify(search)}).blur()`);
    }

    await evaluate('globalThis.__endBubbled = []');
    await pressEndKey('Home', 36);
    await pressEndKey('End', 35);
    if (browseJumps) {
      await waitFor(`${pageExpr} === ${JSON.stringify(page(7))}`, '浏览态 End 到最后一页');
      await backToFirst();
      await click(nextButton);
      await click(nextButton);
      await waitFor(`${pageExpr} === ${JSON.stringify(page(3))}`, '浏览态再次到第 3 页');
      await pressEndKey('Home', 36);
      await waitFor(`${pageExpr} === ${JSON.stringify(page(1))}`, '浏览态 Home 回第一页');
    } else {
      const seen = await evaluate('globalThis.__endBubbled');
      if (await evaluate(pageExpr) !== page(3)) throw new Error('浏览态 Home / End 翻了页');
      if (!Array.isArray(seen) || seen.length !== 2 || seen.some((item) => item.prevented)) {
        throw new Error(`浏览态 Home / End 被拦截：${JSON.stringify(seen)}`);
      }
      await backToFirst();
    }

    await evaluate(installFullscreen(fullscreenRoot));
    await click(trigger);
    await waitFor(`${presenting} && !document.fullscreenElement`, '首尾页契约进入演示');
    await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);

    await evaluate('globalThis.__endBubbled = []');
    await pressEndKey('End', 35);
    await waitFor(`${pageExpr} === ${JSON.stringify(page(7))} && ${chipOff} && !${veilOn}`, '放映 End 到最后一页');
    if (await evaluate(bubbled) !== 0) throw new Error('放映 End 冒泡了');
    await pressEndKey('Home', 36);
    await waitFor(`${pageExpr} === ${JSON.stringify(page(1))} && !${veilOn}`, '放映 Home 回第一页');
    if (await evaluate(bubbled) !== 0) throw new Error('放映 Home 冒泡了');

    await toPage(4);
    await pressDigit('2');
    await waitFor(`${chipOn('2')} && ${pageExpr} === ${JSON.stringify(page(4))}`, 'Home 前有未确认页码');
    await pressEndKey('Home', 36);
    await waitFor(`${pageExpr} === ${JSON.stringify(page(1))} && ${chipOff}`, 'Home 丢掉页码并回到第一页');

    await toPage(3);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', code: 'Home', repeat: true, bubbles: true, cancelable: true }))`);
    if (await evaluate(pageExpr) !== page(3)) throw new Error('按住连发的 Home 又跳了一次');
    await pressEndKey('Home', 36);
    await waitFor(`${pageExpr} === ${JSON.stringify(page(1))}`, '松开后的 Home 仍回第一页');

    await pressKey(request, 'w', 87, 'KeyW');
    await waitFor(`${whiteOn} && ${pageExpr} === ${JSON.stringify(page(1))}`, '第一页白屏');
    for (const flag of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
      await modifiedHome(flag);
      if (!await evaluate(`${whiteOn} && ${pageExpr} === ${JSON.stringify(page(1))}`)) {
        throw new Error(`${flag} 的 Home 揭了遮罩或翻了页`);
      }
    }
    await pressEndKey('Home', 36);
    await waitFor(`!${veilOn} && ${pageExpr} === ${JSON.stringify(page(1))}`, '已在第一页的 Home 揭掉白屏');

    await toPage(4);
    await pressKey(request, 'w', 87, 'KeyW');
    await waitFor(`${whiteOn} && ${pageExpr} === ${JSON.stringify(page(4))}`, '第 4 页白屏');
    await pressEndKey('End', 35);
    await waitFor(`${pageExpr} === ${JSON.stringify(page(7))} && !${veilOn}`, '白屏上的 End 到最后一页并揭掉遮罩');

    await pressKey(request, 'b', 66, 'KeyB');
    await waitFor(`${veilOn} && !${whiteOn} && ${pageExpr} === ${JSON.stringify(page(7))}`, '最后一页黑屏');
    await pressEndKey('End', 35);
    await waitFor(`!${veilOn} && ${pageExpr} === ${JSON.stringify(page(7))}`, '已在最后一页的 End 只揭掉黑屏');
    await pressKey(request, 'b', 66, 'KeyB');
    await waitFor(veilOn, '再黑一次');
    await pressEndKey('Home', 36);
    await waitFor(`${pageExpr} === ${JSON.stringify(page(1))} && !${veilOn}`, '黑屏上的 Home 回第一页并揭掉遮罩');

    if (search) {
      await toPage(4);
      await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(search)});
        input.value = 'qq';
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      })()`);
      await pressEndKey('Home', 36);
      await waitFor(
        `document.querySelector(${JSON.stringify(search)}).value === 'qq' && ${pageExpr} === ${JSON.stringify(page(4))}`,
        '放映中搜索框里的 Home 不跳页',
      );
      await evaluate(`document.querySelector(${JSON.stringify(search)}).blur()`);
      await pressEndKey('Home', 36);
      await waitFor(`${pageExpr} === ${JSON.stringify(page(1))}`, '离开搜索框后 Home 回第一页');
    }

    await toPage(3);
    await pressKey(request, 'g', 71, 'KeyG');
    await waitFor(`${gridOn} && ${pageExpr} === ${JSON.stringify(page(3))}`, '网格打开');
    await pressEndKey('Home', 36);
    await pressEndKey('End', 35);
    if (!await evaluate(`${gridOn} && ${pageExpr} === ${JSON.stringify(page(3))}`)) {
      throw new Error('网格开着时 Home / End 跳了页或关掉了网格');
    }
    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor(`!${gridOn} && ${presenting} && ${pageExpr} === ${JSON.stringify(page(3))}`, 'Esc 先关网格');
    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor(`!${presenting} && !${veilOn} && ${pageExpr} === ${JSON.stringify(page(3))}`, 'Esc 离开放映');
    await backToFirst();

    if (fileInput && fileLabel) {
      await click(trigger);
      await waitFor(presenting, '换文件前再进演示');
      await pressEndKey('End', 35);
      await waitFor(`${pageExpr} === ${JSON.stringify(page(7))}`, '换文件前在最后一页');
      await evaluate(`(async () => {
        const bytes = await fetch('/demo/showcase.pptx').then((response) => response.arrayBuffer());
        const input = document.querySelector(${JSON.stringify(fileInput)});
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], 'slide-ends.pptx'));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`, true);
      await waitFor(
        `document.querySelector(${JSON.stringify(fileLabel)}).textContent.includes('slide-ends.pptx') && ${pageExpr}.startsWith('1 /') && !${presenting} && ${chipOff}`,
        '换文件后离开演示并回到第一页',
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
        document.removeEventListener('keydown', globalThis.__endBubble);
        delete globalThis.__endBubble;
        delete globalThis.__endBubbled;
      })()`);
      await evaluate(restoreFullscreen(fullscreenRoot));
    } catch (cleanup) {
      failure ??= cleanup;
    }
  }
  if (failure) throw failure;
}

export async function runStandaloneSlideEndsContract({ evaluate, request, waitFor, click }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);
  await request('Page.navigate', { url: await standalone('/missing.pptx') });
  await waitFor("document.querySelector('#fileInfo')?.textContent === '未打开文件'", '首尾页契约打开失败');
  await pressKey(request, 'Home', 36, 'Home');
  await pressKey(request, 'End', 35, 'End');
  if (await evaluate("document.querySelector('#pageIndicator')?.textContent") !== '- / -') {
    throw new Error('打开失败后 Home / End 翻了页');
  }
  if (await evaluate("document.querySelector('#presenter .slide-number:not([hidden])')")) {
    throw new Error('打开失败后出现了页码');
  }

  await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') && !document.querySelector('#searchInput').disabled",
    '首尾页契约 showcase',
  );
  await runSlideEndsContract({ evaluate, request, waitFor, click }, {
    trigger: '#btnPresent',
    host: '#presenter',
    stage: '#stage',
    pager: '#pageIndicator',
    prevButton: '#btnPrev',
    nextButton: '#btnNext',
    presenting: "!document.querySelector('#presenter').hidden",
    search: '#searchInput',
    hint: '.hint',
    browseJumps: true,
    fileInput: '#fileInput',
    fileLabel: '#fileInfo',
  });
  console.log('  放映首尾页通过');
}
