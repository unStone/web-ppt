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
    globalThis.__nativeRequestFullscreenNotesKey = el.requestFullscreen.bind(el);
    el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`;
}

function restoreFullscreen(root) {
  const target = root == null
    ? 'document.documentElement'
    : `document.querySelector(${JSON.stringify(root)})`;
  return `(() => {
    const el = ${target};
    if (el && globalThis.__nativeRequestFullscreenNotesKey) {
      el.requestFullscreen = globalThis.__nativeRequestFullscreenNotesKey;
    }
    delete globalThis.__nativeRequestFullscreenNotesKey;
  })()`;
}

function dispatchKey(key, extra = '') {
  return `(() => {
    const event = new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true${extra} });
    return document.dispatchEvent(event);
  })()`;
}

/**
 * 官网放映里 s 只打开备注。浏览不认，N 仍是开关。
 * Ctrl/⌘/Alt 用合成事件，避免真 Chrome 弹出保存对话框。
 */
export async function runNotesKeyContract({ evaluate, request, click, waitFor }, {
  trigger,
  fullscreenRoot = null,
  host,
  stage,
  pager,
  prevButton,
  notesButton,
  presenting,
  fileInput = null,
}) {
  const pageExpr = `document.querySelector(${JSON.stringify(pager)}).textContent`;
  const openExpr = `document.querySelector(${JSON.stringify(host)}).classList.contains('has-speaker-aids')`;
  const chipSel = JSON.stringify(`${host} .slide-number`);
  const chipOn = (text) => `(() => { const el = document.querySelector(${chipSel}); return !!el && !el.hidden && el.textContent === ${JSON.stringify(text)}; })()`;
  const chipOff = `(() => { const el = document.querySelector(${chipSel}); return !el || el.hidden || el.textContent === ''; })()`;
  const veilOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on`)})`;
  const gridOn = `document.querySelector('.slide-grid:not([hidden])')`;
  const notesText = `document.querySelector(${JSON.stringify(`${host} .speaker-notes`)})?.textContent.includes('形状库')`;

  await evaluate(`document.querySelector(${JSON.stringify(fullscreenRoot ?? stage)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
  await evaluate(`(() => {
    const prev = document.querySelector(${JSON.stringify(prevButton)});
    const pager = document.querySelector(${JSON.stringify(pager)});
    for (let i = 0; i < 16 && pager && !pager.textContent.startsWith('1 /'); i++) prev.click();
  })()`);
  await waitFor(`${pageExpr}.startsWith('1 /')`, '备注键契约回到第一页');
  if (await evaluate(openExpr)) await click(`${host} .speaker-aids-close`);
  await waitFor(`!${openExpr}`, '备注键契约从关上的备注开始');
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await evaluate(installFullscreen(fullscreenRoot));

  let failure = null;
  try {
    if (await evaluate(dispatchKey('s')) !== true) throw new Error('浏览态 s 被 preventDefault');
    await pressKey(request, 's', 83, 'KeyS');
    if (await evaluate(openExpr)) throw new Error('浏览态 s 打开了备注');

    await click(trigger);
    await waitFor(`${presenting} && !${openExpr}`, '进入放映并收起备注');
    const page = await evaluate(pageExpr);

    if (fileInput) {
      const typed = await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(fileInput)});
        input.focus();
        const event = new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true });
        const kept = input.dispatchEvent(event);
        input.blur();
        return kept;
      })()`);
      if (typed !== true || await evaluate(openExpr)) throw new Error('输入框里的 s 打开了备注');
    }

    await pressKey(request, 's', 83, 'KeyS');
    await waitFor(`${openExpr} && ${notesText} && ${pageExpr} === ${JSON.stringify(page)}`, '放映中 s 打开本页备注');
    await pressKey(request, 's', 83, 'KeyS');
    if (!await evaluate(openExpr) || await evaluate(pageExpr) !== page) throw new Error('再按 s 关上了备注或翻了页');
    if (await evaluate(dispatchKey('s')) !== false) throw new Error('已打开时 s 没有吃掉按键');

    await pressKey(request, 'n', 78, 'KeyN');
    await waitFor(`!${openExpr}`, '放映中 N 仍能关上备注');
    for (const [label, extra] of [['Ctrl', ', ctrlKey: true'], ['Meta', ', metaKey: true'], ['Alt', ', altKey: true']]) {
      if (await evaluate(dispatchKey('s', extra)) !== true || await evaluate(openExpr)) {
        throw new Error(`${label}+S 打开了备注`);
      }
    }
    await pressKey(request, 'S', 83, 'KeyS', 8);
    await waitFor(`${openExpr} && ${pageExpr} === ${JSON.stringify(page)}`, 'Shift+S 同样打开备注');

    await pressKey(request, 'n', 78, 'KeyN');
    await waitFor(`!${openExpr}`, '数字缓冲前先关上备注');
    await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
    await pressKey(request, '3', 51, 'Digit3');
    await waitFor(chipOn('3'), '未确认页码出现');
    await pressKey(request, 's', 83, 'KeyS');
    await waitFor(`${chipOff} && ${pageExpr} === ${JSON.stringify(page)} && ${openExpr} && ${notesText}`, 's 丢掉页码并打开备注');

    await pressKey(request, 'b', 66, 'KeyB');
    await waitFor(veilOn, '黑屏仍可盖上');
    await pressKey(request, 'n', 78, 'KeyN');
    await waitFor(`!${openExpr} && ${veilOn}`, '黑屏中 N 关上备注且遮罩还在');
    await pressKey(request, 's', 83, 'KeyS');
    await waitFor(`${openExpr} && ${veilOn} && ${pageExpr} === ${JSON.stringify(page)}`, '黑屏中 s 打开备注且不揭遮罩');
    await pressKey(request, 'b', 66, 'KeyB');
    await waitFor(`!${veilOn}`, '再按 B 揭掉黑屏');

    await pressKey(request, 'n', 78, 'KeyN');
    await waitFor(`!${openExpr}`, '网格前关上备注');
    await pressKey(request, 'g', 71, 'KeyG');
    await waitFor(gridOn, '放映网格打开');
    await pressKey(request, 's', 83, 'KeyS');
    if (await evaluate(openExpr) || !await evaluate(gridOn)) throw new Error('网格开着时 s 打开了备注或关了网格');
    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor(`!${gridOn} && ${presenting} && !${openExpr}`, 'Esc 先关网格');

    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor(`!${presenting} && !${openExpr}`, '放映中按过 s 也不改写浏览开关');

    await click(notesButton);
    await waitFor(openExpr, '浏览里先打开备注');
    await click(trigger);
    await waitFor(`${presenting} && !${openExpr}`, '进入放映再次收起');
    await pressKey(request, 's', 83, 'KeyS');
    await waitFor(openExpr, '第二次放映仍能用 s 打开');
    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor(`!${presenting} && ${openExpr}`, '退出后恢复进入前已经打开的浏览备注');
    await click(`${host} .speaker-aids-close`);
    await waitFor(`!${openExpr}`, '备注键契约结束时关上');
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

export async function runStandaloneNotesKeyContract({ evaluate, request, waitFor }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);
  await request('Page.navigate', { url: await standalone('/missing.pptx') });
  await waitFor("document.querySelector('#fileInfo')?.textContent === '未打开文件'", '备注键契约打开失败');
  await pressKey(request, 's', 83, 'KeyS');
  if (await evaluate("document.querySelector('#pageIndicator')?.textContent") !== '- / -') {
    throw new Error('打开失败后 s 翻了页');
  }
  if (!await evaluate("document.querySelector('#notesPanel').hidden")) throw new Error('打开失败后 s 打开了备注');

  await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') && !document.querySelector('#btnNotes').disabled",
    '备注键契约 showcase',
  );
  const hint = await evaluate("document.querySelector('.hint')?.textContent");
  if (!hint?.includes('N 备注')) throw new Error(`查看器提示条丢掉了 N：${hint}`);
  await pressKey(request, 's', 83, 'KeyS');
  if (!await evaluate("document.querySelector('#notesPanel').hidden")) throw new Error('查看器浏览态 s 打开了备注');
  await pressKey(request, 'n', 78, 'KeyN');
  await waitFor("!document.querySelector('#notesPanel').hidden && document.querySelector('#notesBody')?.textContent.includes('形状库')", '查看器 N 仍打开备注');
  await pressKey(request, 'n', 78, 'KeyN');
  await waitFor("document.querySelector('#notesPanel').hidden", '查看器 N 仍关上备注');

  await evaluate(`(() => {
    document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await evaluate("document.querySelector('#btnPresent').click()");
    await waitFor("!document.querySelector('#presenter').hidden && document.querySelector('#pvNotes')?.textContent.includes('形状库')", '查看器放映侧栏已有备注');
    const page = await evaluate("document.querySelector('#pageIndicator').textContent");
    await pressKey(request, 's', 83, 'KeyS');
    if (await evaluate("document.querySelector('#pageIndicator').textContent") !== page) throw new Error('查看器放映中 s 翻了页');
    if (!await evaluate("document.querySelector('#pvNotes')?.textContent.includes('形状库')")) throw new Error('查看器放映中 s 藏起了侧栏备注');
    if (!await evaluate("document.querySelector('#notesPanel').hidden")) throw new Error('查看器放映中 s 打开了被盖住的浏览备注');
  } finally {
    await pressKey(request, 'Escape', 27, 'Escape');
    await waitFor("document.querySelector('#presenter').hidden", '备注键契约离开放映');
  }
  console.log('  放映备注键通过');
}
