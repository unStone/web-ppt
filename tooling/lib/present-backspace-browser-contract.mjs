async function pressKey(request, name, value, code = name) {
  const key = { key: name, code, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
  await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}

function installFullscreen(root) {
  const target = root == null
    ? 'document.documentElement'
    : `document.querySelector(${JSON.stringify(root)})`;
  return `(() => {
    const el = ${target};
    globalThis.__nativeRequestFullscreenBack = el.requestFullscreen.bind(el);
    el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`;
}

function restoreFullscreen(root) {
  const target = root == null
    ? 'document.documentElement'
    : `document.querySelector(${JSON.stringify(root)})`;
  return `(() => {
    const el = ${target};
    if (el && globalThis.__nativeRequestFullscreenBack) {
      el.requestFullscreen = globalThis.__nativeRequestFullscreenBack;
    }
    delete globalThis.__nativeRequestFullscreenBack;
  })()`;
}

function hiddenExpr(stage) {
  const selector = JSON.stringify(`${stage} [data-el]`);
  return `(() => {
    const nodes = document.querySelectorAll(${selector});
    return [...nodes].filter((node) => node.style.visibility === 'hidden').map((node) => node.getAttribute('data-el')).sort().join(',');
  })()`;
}

function dispatchKey(key, extra = '') {
  return `(() => {
    const event = new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true${extra} });
    return document.dispatchEvent(event);
  })()`;
}

/**
 * 放映中退格走上一步。浏览、搜索、页码、遮罩、网格、Home/End、备注、Esc、换文件不改义。
 * Mac 文档里的 Delete 在浏览器里是 Backspace；key 为 Delete 的向前删除不退。
 */
export async function runPresentBackspaceContract({ evaluate, request, click, waitFor }, {
  trigger,
  fullscreenRoot = null,
  host,
  stage,
  pager,
  prevButton,
  nextButton,
  presenting,
  notesOpen,
  fileInput = null,
  fileLabel = null,
  restoreSample = null,
  restoreText = null,
  search = null,
  hint = null,
  animLabel = null,
}) {
  const pageExpr = `document.querySelector(${JSON.stringify(pager)}).textContent`;
  const hidden = hiddenExpr(stage);
  const oneSlide = `document.querySelectorAll(${JSON.stringify(`${stage} svg`)}).length === 1`;
  const animExpr = animLabel
    ? `document.querySelector(${JSON.stringify(animLabel)})?.textContent || ''`
    : null;
  const chipSel = JSON.stringify(`${host} .slide-number`);
  const chipOn = (text) => `(() => { const el = document.querySelector(${chipSel}); return !!el && !el.hidden && el.textContent === ${JSON.stringify(text)}; })()`;
  const chipOff = `(() => { const el = document.querySelector(${chipSel}); return !el || el.hidden || el.textContent === ''; })()`;
  const veilOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on`)})`;
  const whiteOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on.is-white`)})`;
  const gridOn = `document.querySelector('.slide-grid:not([hidden])')`;

  if (hint) {
    const text = await evaluate(`document.querySelector(${JSON.stringify(hint)}).textContent`);
    if (!text.includes('Backspace 上一步')) throw new Error(`提示条没有写退格：${text}`);
  }

  await evaluate(`document.querySelector(${JSON.stringify(fullscreenRoot ?? stage)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
  await evaluate(`(() => {
    const prev = document.querySelector(${JSON.stringify(prevButton)});
    const pager = document.querySelector(${JSON.stringify(pager)});
    for (let i = 0; i < 16 && pager && !pager.textContent.startsWith('1 /'); i++) prev.click();
  })()`);
  await waitFor(`${pageExpr}.startsWith('1 /')`, '退格契约回到第一页');
  const total = String(await evaluate(pageExpr)).split(' / ')[1];
  if (total !== '7') throw new Error(`退格契约需要 7 页文稿，实际 ${await evaluate(pageExpr)}`);
  const page = (n) => `${n} / ${total}`;
  if (await evaluate(notesOpen)) await click(`${host} .speaker-aids-close`);
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await evaluate(installFullscreen(fullscreenRoot));

  let failure = null;
  try {
    await click(nextButton);
    await waitFor(`${pageExpr} === ${JSON.stringify(page(2))}`, '浏览态先到第二页');
    if (await evaluate(dispatchKey('Backspace')) !== true || await evaluate(pageExpr) !== page(2)) {
      throw new Error('浏览态 Backspace 被拦截或翻了页');
    }
    await pressKey(request, 'Backspace', 8, 'Backspace');
    if (await evaluate(pageExpr) !== page(2)) throw new Error('浏览态真实退格翻了页');

    if (fileInput) {
      const typed = await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(fileInput)});
        input.focus();
        const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
        const kept = input.dispatchEvent(event);
        input.blur();
        return kept;
      })()`);
      if (typed !== true || await evaluate(pageExpr) !== page(2)) throw new Error('文件框里的退格翻了页');
    }

    if (search) {
      const typed = await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(search)});
        input.value = 'qq';
        input.focus();
        const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
        const kept = input.dispatchEvent(event);
        const value = input.value;
        input.blur();
        return kept && value === 'qq';
      })()`);
      if (typed !== true || await evaluate(pageExpr) !== page(2)) throw new Error('搜索框里的退格翻了页或清掉了查询');
    }

    await click(trigger);
    await waitFor(`${presenting} && ${pageExpr} === ${JSON.stringify(page(2))}`, '进入放映仍在第二页');

    if (search) {
      const typed = await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(search)});
        input.value = 'qq';
        input.focus();
        const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
        const kept = input.dispatchEvent(event);
        const value = input.value;
        input.blur();
        return kept && value === 'qq';
      })()`);
      if (typed !== true || await evaluate(pageExpr) !== page(2)) throw new Error('放映中搜索框里的退格翻了页');
    }

    await pressKey(request, 'End', 35, 'End');
    await waitFor(`${pageExpr} === ${JSON.stringify(page(7))} && ${oneSlide}`, 'End 仍到最后一页', 200);
    const startHidden = await evaluate(hidden);
    const startAnim = animExpr ? await evaluate(animExpr) : '';

    await pressKey(request, 'ArrowRight', 39, 'ArrowRight');
    await waitFor(
      `${pageExpr} === ${JSON.stringify(page(7))} && ${hidden} !== ${JSON.stringify(startHidden)}`,
      '最后一页下一步先播一批',
    );
    const playedHidden = await evaluate(hidden);
    if (animExpr && !String(await evaluate(animExpr)).startsWith('动画 1/')) {
      throw new Error(`播完一批后计数应为 1，实际 ${await evaluate(animExpr)}`);
    }

    if (await evaluate(dispatchKey('Delete')) !== true) throw new Error('向前删除被 preventDefault');
    await pressKey(request, 'Delete', 46, 'Delete');
    if (await evaluate(pageExpr) !== page(7) || await evaluate(hidden) !== playedHidden) {
      throw new Error('Delete 退了批次或翻了页');
    }

    await pressKey(request, 'Backspace', 8, 'Backspace');
    await waitFor(
      `${pageExpr} === ${JSON.stringify(page(7))} && ${hidden} === ${JSON.stringify(startHidden)}`,
      '退格收回这一批且页码不动',
    );
    if (animExpr && await evaluate(animExpr) !== startAnim) {
      throw new Error(`退格后计数没有回到 ${startAnim}`);
    }

    await pressKey(request, 'ArrowRight', 39, 'ArrowRight');
    await waitFor(`${hidden} === ${JSON.stringify(playedHidden)}`, '修饰键测试前再播一批');
    for (const [label, extra] of [['Ctrl', ', ctrlKey: true'], ['Meta', ', metaKey: true'], ['Alt', ', altKey: true'], ['Shift', ', shiftKey: true']]) {
      if (await evaluate(dispatchKey('Backspace', extra)) !== true || await evaluate(hidden) !== playedHidden || await evaluate(pageExpr) !== page(7)) {
        throw new Error(`${label}+Backspace 退了批次`);
      }
    }

    await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
    await pressKey(request, '4', 52, 'Digit4');
    await waitFor(chipOn('4'), '未确认页码出现');
    await pressKey(request, 'Backspace', 8, 'Backspace');
    await waitFor(
      `${chipOff} && ${pageExpr} === ${JSON.stringify(page(7))} && ${hidden} === ${JSON.stringify(startHidden)}`,
      '退格丢掉页码并退回一批，不跳到第 4 页',
    );

    await pressKey(request, 'ArrowRight', 39, 'ArrowRight');
    await waitFor(`${hidden} === ${JSON.stringify(playedHidden)}`, '黑屏前再播一批');
    await pressKey(request, 'b', 66, 'KeyB');
    await waitFor(`${veilOn} && !${whiteOn}`, '黑屏');
    await pressKey(request, 'Backspace', 8, 'Backspace');
    await waitFor(
      `!${veilOn} && ${pageExpr} === ${JSON.stringify(page(7))} && ${hidden} === ${JSON.stringify(playedHidden)}`,
      '黑屏中的退格只揭遮罩',
    );
    await pressKey(request, 'w', 87, 'KeyW');
    await waitFor(whiteOn, '白屏');
    await pressKey(request, 'Backspace', 8, 'Backspace');
    await waitFor(
      `!${veilOn} && ${hidden} === ${JSON.stringify(playedHidden)}`,
      '白屏中的退格只揭遮罩',
    );

    await pressKey(request, 'Home', 36, 'Home');
    await waitFor(`${pageExpr} === ${JSON.stringify(page(1))}`, 'Home 仍回第一页');
    await pressKey(request, 'End', 35, 'End');
    await waitFor(`${pageExpr} === ${JSON.stringify(page(7))} && ${oneSlide} && ${hidden} === ${JSON.stringify(startHidden)}`, 'End 仍从最后一页开头开始', 200);
    await pressKey(request, 'Backspace', 8, 'Backspace');
    await waitFor(`${pageExpr} === ${JSON.stringify(page(6))}`, '本页开头的退格才去上一页');

    await pressKey(request, 'End', 35, 'End');
    await waitFor(`${pageExpr} === ${JSON.stringify(page(7))} && ${oneSlide}`, '网格测试回到最后一页', 200);
    const beforeNotes = await evaluate(hidden);
    await pressKey(request, 'n', 78, 'KeyN');
    if (await evaluate(pageExpr) !== page(7) || await evaluate(hidden) !== beforeNotes) {
      throw new Error('N 被当成了下一页');
    }
    if (notesOpen.includes('notesPanel')) {
      if (!await evaluate(`document.querySelector('#notesPanel').hidden`)) {
        await pressKey(request, 'n', 78, 'KeyN');
      }
    } else if (await evaluate(notesOpen)) {
      await pressKey(request, 'n', 78, 'KeyN');
      await waitFor(`!${notesOpen} && ${pageExpr} === ${JSON.stringify(page(7))}`, 'N 仍关上备注');
    }

    await pressKey(request, 'g', 71, 'KeyG');
    await waitFor(gridOn, '放映网格');
    await pressKey(request, 'Backspace', 8, 'Backspace');
    if (await evaluate(`${pageExpr} !== ${JSON.stringify(page(7))} || !${gridOn}`)) {
      throw new Error('网格开着时退格翻了页或关了网格');
    }
    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor(`!${gridOn} && ${presenting}`, 'Esc 先关网格');

    if (notesOpen.includes('notesPanel')) {
      await pressKey(request, 's', 83, 'KeyS');
      if (!await evaluate(`document.querySelector('#notesPanel').hidden`)) throw new Error('查看器放映中 s 打开了浏览备注');
    } else {
      await pressKey(request, 's', 83, 'KeyS');
      await waitFor(`${notesOpen} && ${pageExpr} === ${JSON.stringify(page(7))}`, 's 仍打开备注且退格没有把它关掉');
      await pressKey(request, 'Backspace', 8, 'Backspace');
      await waitFor(`${notesOpen} && ${pageExpr} === ${JSON.stringify(page(6))}`, '备注开着时退格仍走上一步');
      await pressKey(request, 'n', 78, 'KeyN');
      await waitFor(`!${notesOpen}`, 'N 仍关上备注');
    }

    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor(`!${presenting}`, 'Esc 离开放映');
    const left = await evaluate(pageExpr);
    if (await evaluate(dispatchKey('Backspace')) !== true || await evaluate(pageExpr) !== left) {
      throw new Error('退出后浏览态退格又翻了页');
    }

    if (fileInput && fileLabel) {
      await click(trigger);
      await waitFor(presenting, '换文件前再进放映');
      await evaluate(`(async () => {
        const bytes = await fetch('/demo/showcase.pptx').then((response) => response.arrayBuffer());
        const input = document.querySelector(${JSON.stringify(fileInput)});
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], 'present-backspace.pptx'));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`, true);
      await waitFor(
        `document.querySelector(${JSON.stringify(fileLabel)}).textContent.includes('present-backspace.pptx') && ${pageExpr}.startsWith('1 /') && !${presenting}`,
        '换文件后离开放映',
      );
      await pressKey(request, 'Backspace', 8, 'Backspace');
      if (!String(await evaluate(pageExpr)).startsWith('1 /')) throw new Error('换文件后浏览态退格翻了页');
      if (restoreSample) {
        await click(restoreSample);
        await waitFor(
          `document.querySelector(${JSON.stringify(fileLabel)}).textContent.includes(${JSON.stringify(restoreText)}) && ${pageExpr}.startsWith('1 /') && !${presenting}`,
          '换回原本文稿',
        );
      }
    }
    console.log('  放映退格上一步通过');
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (await evaluate(gridOn)) await pressKey(request, 'Escape', 27, 'Escape');
      if (await evaluate(veilOn)) await pressKey(request, 'b', 66, 'KeyB');
      if (await evaluate(presenting)) await pressKey(request, 'Escape', 27, 'Escape');
      if (!notesOpen.includes('notesPanel') && await evaluate(notesOpen)) await click(`${host} .speaker-aids-close`);
    } catch (cleanup) {
      failure ??= cleanup;
    }
    try {
      await evaluate(restoreFullscreen(fullscreenRoot));
    } catch (cleanup) {
      failure ??= cleanup;
    }
  }
  if (failure) throw failure;
}

export async function runStandalonePresentBackspaceContract({ evaluate, request, click, waitFor }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);
  await request('Page.navigate', { url: await standalone('/missing.pptx') });
  await waitFor("document.querySelector('#fileInfo')?.textContent === '未打开文件'", '退格契约打开失败');
  await pressKey(request, 'Backspace', 8, 'Backspace');
  if (await evaluate("document.querySelector('#pageIndicator')?.textContent") !== '- / -') {
    throw new Error('打开失败后退格翻了页');
  }

  await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') && !document.querySelector('#searchInput').disabled",
    '退格契约打开 showcase',
  );
  await runPresentBackspaceContract({ evaluate, request, click, waitFor }, {
    trigger: '#btnPresent',
    host: '#presenter',
    stage: '#stage',
    pager: '#pageIndicator',
    prevButton: '#btnPrev',
    nextButton: '#btnNext',
    presenting: "!document.querySelector('#presenter').hidden",
    notesOpen: "!document.querySelector('#notesPanel').hidden",
    fileInput: '#fileInput',
    fileLabel: '#fileInfo',
    search: '#searchInput',
    hint: '.hint',
    animLabel: '#pvAnim',
  });
  await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') && document.querySelector('#presenter').hidden",
    '退格契约交还 showcase',
  );
}
