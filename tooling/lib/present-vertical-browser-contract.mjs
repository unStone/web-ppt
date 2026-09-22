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
    globalThis.__nativeRequestFullscreenVertical = el.requestFullscreen.bind(el);
    el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`;
}

function restoreFullscreen(root) {
  const target = root == null
    ? 'document.documentElement'
    : `document.querySelector(${JSON.stringify(root)})`;
  return `(() => {
    const el = ${target};
    if (el && globalThis.__nativeRequestFullscreenVertical) {
      el.requestFullscreen = globalThis.__nativeRequestFullscreenVertical;
    }
    delete globalThis.__nativeRequestFullscreenVertical;
  })()`;
}

function dispatchKey(key, extra = '') {
  return `(() => {
    const event = new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true${extra} });
    return document.dispatchEvent(event);
  })()`;
}

/**
 * 官网放映里 Down 下一步、Up 上一步。浏览不拦截。
 * 修饰键用合成事件，避免真 Chrome 把 Ctrl+方向键交给浏览器。
 */
export async function runPresentVerticalContract({ evaluate, request, click, waitFor }, {
  trigger,
  fullscreenRoot = null,
  host,
  stage,
  pager,
  prevButton,
  notesButton,
  presenting,
  fileInput = null,
  fileLabel = null,
  restoreSample = null,
  restoreText = null,
}) {
  const pageExpr = `document.querySelector(${JSON.stringify(pager)}).textContent`;
  const openExpr = `document.querySelector(${JSON.stringify(host)}).classList.contains('has-speaker-aids')`;
  const chipSel = JSON.stringify(`${host} .slide-number`);
  const chipOn = (text) => `(() => { const el = document.querySelector(${chipSel}); return !!el && !el.hidden && el.textContent === ${JSON.stringify(text)}; })()`;
  const chipOff = `(() => { const el = document.querySelector(${chipSel}); return !el || el.hidden || el.textContent === ''; })()`;
  const veilOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on`)})`;
  const whiteOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on.is-white`)})`;
  const gridOn = `document.querySelector('.slide-grid:not([hidden])')`;

  await evaluate(`document.querySelector(${JSON.stringify(fullscreenRoot ?? stage)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
  await evaluate(`(() => {
    const prev = document.querySelector(${JSON.stringify(prevButton)});
    const pager = document.querySelector(${JSON.stringify(pager)});
    for (let i = 0; i < 16 && pager && !pager.textContent.startsWith('1 /'); i++) prev.click();
  })()`);
  await waitFor(`${pageExpr}.startsWith('1 /')`, '上下方向键契约回到第一页');
  const total = String(await evaluate(pageExpr)).split(' / ')[1];
  if (total !== '7') throw new Error(`上下方向键契约需要 7 页文稿，实际 ${await evaluate(pageExpr)}`);
  const page = (n) => `${n} / ${total}`;
  if (await evaluate(openExpr)) await click(`${host} .speaker-aids-close`);
  await waitFor(`!${openExpr}`, '上下方向键契约从关上的备注开始');
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await evaluate(installFullscreen(fullscreenRoot));

  let failure = null;
  try {
    if (await evaluate(dispatchKey('ArrowDown')) !== true) throw new Error('浏览态 Down 被 preventDefault');
    await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
    await pressKey(request, 'ArrowUp', 38, 'ArrowUp');
    if (await evaluate(pageExpr) !== page(1)) throw new Error('浏览态 Down / Up 翻了页');

    await click(trigger);
    await waitFor(`${presenting} && ${pageExpr} === ${JSON.stringify(page(1))}`, '进入放映仍在第一页');

    if (fileInput) {
      const typed = await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(fileInput)});
        input.focus();
        const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
        const kept = input.dispatchEvent(event);
        input.blur();
        return kept;
      })()`);
      if (typed !== true || await evaluate(pageExpr) !== page(1)) throw new Error('输入框里的 Down 翻了页');
    }

    await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
    await waitFor(`${pageExpr} === ${JSON.stringify(page(2))}`, '放映中 Down 到下一页');
    await pressKey(request, 'ArrowUp', 38, 'ArrowUp');
    await waitFor(`${pageExpr} === ${JSON.stringify(page(1))}`, '放映中 Up 回到上一页');

    for (const [label, extra] of [['Ctrl', ', ctrlKey: true'], ['Meta', ', metaKey: true'], ['Alt', ', altKey: true'], ['Shift', ', shiftKey: true']]) {
      if (await evaluate(dispatchKey('ArrowDown', extra)) !== true || await evaluate(pageExpr) !== page(1)) {
        throw new Error(`${label}+Down 翻了页`);
      }
    }

    await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
    await pressKey(request, '4', 52, 'Digit4');
    await waitFor(chipOn('4'), '未确认页码出现');
    await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
    await waitFor(`${chipOff} && ${pageExpr} === ${JSON.stringify(page(2))}`, 'Down 丢掉页码并走下一步，不跳到第 4 页');

    await pressKey(request, 'Home', 36, 'Home');
    await waitFor(`${pageExpr} === ${JSON.stringify(page(1))}`, 'Home 仍回第一页');
    await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
    await waitFor(`${pageExpr} === ${JSON.stringify(page(2))}`, 'Home 之后 Down 仍能前进');

    await pressKey(request, 'b', 66, 'KeyB');
    await waitFor(`${veilOn} && !${whiteOn} && ${pageExpr} === ${JSON.stringify(page(2))}`, '黑屏盖住当前页');
    await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
    await waitFor(`!${veilOn} && ${pageExpr} === ${JSON.stringify(page(2))}`, '黑屏中 Down 只揭遮罩');
    await pressKey(request, 'w', 87, 'KeyW');
    await waitFor(`${whiteOn} && ${pageExpr} === ${JSON.stringify(page(2))}`, '白屏盖住当前页');
    await pressKey(request, 'ArrowUp', 38, 'ArrowUp');
    await waitFor(`!${veilOn} && ${pageExpr} === ${JSON.stringify(page(2))}`, '白屏中 Up 只揭遮罩');

    await pressKey(request, 's', 83, 'KeyS');
    await waitFor(`${openExpr} && ${pageExpr} === ${JSON.stringify(page(2))}`, 's 仍打开备注');
    await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
    await waitFor(`${openExpr} && ${pageExpr} === ${JSON.stringify(page(3))}`, 'Down 翻页不关备注');
    await pressKey(request, 'n', 78, 'KeyN');
    await waitFor(`!${openExpr} && ${pageExpr} === ${JSON.stringify(page(3))}`, 'N 仍能关上备注');

    await pressKey(request, 'g', 71, 'KeyG');
    await waitFor(`${gridOn} && ${pageExpr} === ${JSON.stringify(page(3))}`, '放映网格打开');
    await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
    await pressKey(request, 'ArrowUp', 38, 'ArrowUp');
    if (!await evaluate(`${gridOn} && ${pageExpr} === ${JSON.stringify(page(3))}`)) {
      throw new Error('网格开着时 Down / Up 翻了页或关了网格');
    }
    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor(`!${gridOn} && ${presenting} && ${pageExpr} === ${JSON.stringify(page(3))}`, 'Esc 先关网格');
    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor(`!${presenting} && ${pageExpr} === ${JSON.stringify(page(3))}`, 'Esc 离开放映');
    if (await evaluate(dispatchKey('ArrowDown')) !== true || await evaluate(pageExpr) !== page(3)) {
      throw new Error('退出后浏览态 Down 又翻了页');
    }

    if (fileInput && fileLabel) {
      await click(trigger);
      await waitFor(presenting, '换文件前再进演示');
      await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
      await waitFor(`${pageExpr} === ${JSON.stringify(page(4))}`, '换文件前再走一页');
      await evaluate(`(async () => {
        const bytes = await fetch('/demo/showcase.pptx').then((response) => response.arrayBuffer());
        const input = document.querySelector(${JSON.stringify(fileInput)});
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], 'present-vertical.pptx'));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`, true);
      await waitFor(
        `document.querySelector(${JSON.stringify(fileLabel)}).textContent.includes('present-vertical.pptx') && ${pageExpr}.startsWith('1 /') && !${presenting} && ${chipOff}`,
        '换文件后离开演示并回到第一页',
      );
      if (await evaluate(dispatchKey('ArrowDown')) !== true || await evaluate(pageExpr) !== page(1)) {
        throw new Error('换文件后浏览态 Down 翻了页');
      }
      if (restoreSample) {
        await click(restoreSample);
        await waitFor(
          `document.querySelector(${JSON.stringify(fileLabel)}).textContent.includes(${JSON.stringify(restoreText)}) && document.querySelector(${JSON.stringify(stage)} + ' svg') && ${pageExpr}.startsWith('1 /') && !${presenting}`,
          '换回原本文稿',
        );
      }
    }
    if (notesButton && await evaluate(openExpr)) await click(`${host} .speaker-aids-close`);
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (await evaluate(gridOn)) await pressKey(request, 'Escape', 27, 'Escape');
      if (await evaluate(veilOn)) await pressKey(request, 'b', 66, 'KeyB');
      if (await evaluate(presenting)) await pressKey(request, 'Escape', 27, 'Escape');
      if (await evaluate(openExpr)) await click(`${host} .speaker-aids-close`);
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

export async function runStandalonePresentVerticalContract({ evaluate, request, waitFor }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);
  await request('Page.navigate', { url: await standalone('/missing.pptx') });
  await waitFor("document.querySelector('#fileInfo')?.textContent === '未打开文件'", '上下方向键契约打开失败');
  await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
  await pressKey(request, 'ArrowUp', 38, 'ArrowUp');
  if (await evaluate("document.querySelector('#pageIndicator')?.textContent") !== '- / -') {
    throw new Error('打开失败后 Down / Up 翻了页');
  }

  await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') && !document.querySelector('#searchInput').disabled",
    '上下方向键契约 showcase',
  );
  const pageExpr = "document.querySelector('#pageIndicator').textContent";
  await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
  await waitFor(`${pageExpr} === '2 / 7'`, '查看器浏览态 Down 仍翻页');
  await pressKey(request, 'ArrowUp', 38, 'ArrowUp');
  await waitFor(`${pageExpr} === '1 / 7'`, '查看器浏览态 Up 仍回上一页');

  await evaluate(`(() => {
    const input = document.querySelector('#searchInput');
    input.value = 'qq';
    input.focus();
  })()`);
  await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
  if (await evaluate(`${pageExpr} !== '1 / 7' || document.querySelector('#searchInput').value !== 'qq'`)) {
    throw new Error('搜索框里的 Down 翻了页或改了查询');
  }
  await evaluate("document.querySelector('#searchInput').blur()");

  await pressKey(request, 'n', 78, 'KeyN');
  await waitFor("!document.querySelector('#notesPanel').hidden", '查看器 N 仍打开备注');
  await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
  await waitFor(`${pageExpr} === '2 / 7' && !document.querySelector('#notesPanel').hidden`, '浏览备注开着时 Down 仍翻页');
  await pressKey(request, 'n', 78, 'KeyN');
  await waitFor("document.querySelector('#notesPanel').hidden", '查看器 N 仍关上备注');
  await pressKey(request, 'ArrowUp', 38, 'ArrowUp');
  await waitFor(`${pageExpr} === '1 / 7'`, '关上备注后 Up 回到第一页');

  await evaluate(`(() => {
    document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await evaluate("document.querySelector('#btnPresent').click()");
    await waitFor("!document.querySelector('#presenter').hidden", '查看器进入放映');
    await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
    await waitFor(`${pageExpr} === '2 / 7'`, '查看器放映中 Down 到下一页');
    await pressKey(request, 'ArrowUp', 38, 'ArrowUp');
    await waitFor(`${pageExpr} === '1 / 7'`, '查看器放映中 Up 回到上一页');

    await evaluate("document.querySelector('#searchInput').focus()");
    await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
    if (await evaluate(pageExpr) !== '1 / 7') throw new Error('放映中搜索框里的 Down 翻了页');
    await evaluate("document.querySelector('#searchInput').blur()");

    await pressKey(request, '4', 52, 'Digit4');
    await waitFor("document.querySelector('#presenter .slide-number:not([hidden])')?.textContent === '4'", '查看器未确认页码');
    await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
    await waitFor(
      `${pageExpr} === '2 / 7' && !document.querySelector('#presenter .slide-number:not([hidden])')`,
      '查看器 Down 丢掉页码并走下一步',
    );
    await pressKey(request, 'Home', 36, 'Home');
    await waitFor(`${pageExpr} === '1 / 7'`, '查看器放映 Home 仍回第一页');

    await pressKey(request, 'b', 66, 'KeyB');
    await waitFor("document.querySelector('#stage .present-blank.is-on') && !document.querySelector('#stage .present-blank.is-white')", '查看器黑屏');
    await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
    await waitFor(`!document.querySelector('#stage .present-blank.is-on') && ${pageExpr} === '1 / 7'`, '查看器黑屏中 Down 只揭遮罩');
    await pressKey(request, 'w', 87, 'KeyW');
    await waitFor("document.querySelector('#stage .present-blank.is-on.is-white')", '查看器白屏');
    await pressKey(request, 'ArrowUp', 38, 'ArrowUp');
    await waitFor(`!document.querySelector('#stage .present-blank.is-on') && ${pageExpr} === '1 / 7'`, '查看器白屏中 Up 只揭遮罩');

    await pressKey(request, 's', 83, 'KeyS');
    if (!await evaluate("document.querySelector('#notesPanel').hidden")) throw new Error('查看器放映中 s 打开了浏览备注');
    await pressKey(request, 'g', 71, 'KeyG');
    await waitFor("document.querySelector('.slide-grid:not([hidden])')", '查看器放映网格');
    await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
    if (await evaluate(`${pageExpr} !== '1 / 7' || !document.querySelector('.slide-grid:not([hidden])')`)) {
      throw new Error('查看器网格开着时 Down 翻了页或关了网格');
    }
    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor("!document.querySelector('.slide-grid:not([hidden])') && !document.querySelector('#presenter').hidden", '查看器 Esc 先关网格');
    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor("document.querySelector('#presenter').hidden", '查看器 Esc 离开放映');
  } finally {
    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor("document.querySelector('#presenter').hidden", '上下方向键契约离开放映');
  }
  console.log('  放映上下方向键通过');
}
