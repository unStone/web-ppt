async function pressKey(request, name, value, code = name) {
  const key = { key: name, code, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
  await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}

function hiddenExpr(stage) {
  const selector = JSON.stringify(`${stage} [data-el]`);
  return `(() => {
    const nodes = document.querySelectorAll(${selector});
    return [...nodes].filter((node) => node.style.visibility === 'hidden').map((node) => node.getAttribute('data-el')).sort().join(',');
  })()`;
}

/**
 * showcase 最后一页有逐次入场。上一步应先收回这一批，页码不动。
 * 浏览、遮罩、网格、页码、Home、备注、Esc、换文件不能跟着改义。
 */
export async function runPresentRewindContract({ evaluate, request, click, waitFor }, {
  trigger,
  host,
  stage,
  pager,
  presenting,
  notesOpen,
  fileInput = null,
  fileLabel = null,
  restoreSample = null,
  restoreText = null,
  animLabel = null,
}) {
  const pageExpr = `document.querySelector(${JSON.stringify(pager)}).textContent`;
  const hidden = hiddenExpr(stage);
  // 前进到最后一页会播切换，旧页还叠在台上时隐藏集会把两页混在一起。
  const oneSlide = `document.querySelectorAll(${JSON.stringify(`${stage} svg`)}).length === 1`;
  const animExpr = animLabel
    ? `document.querySelector(${JSON.stringify(animLabel)})?.textContent || ''`
    : null;
  const chipSel = JSON.stringify(`${host} .slide-number`);
  const chipOn = (text) => `(() => { const el = document.querySelector(${chipSel}); return !!el && !el.hidden && el.textContent === ${JSON.stringify(text)}; })()`;
  const veilOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on`)})`;
  const whiteOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on.is-white`)})`;
  const gridOn = `document.querySelector('.slide-grid:not([hidden])')`;

  await evaluate(`document.querySelector(${JSON.stringify(stage)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
  await evaluate(`document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'))`);
  if (await evaluate(notesOpen)) await click(`${host} .speaker-aids-close`);
  await click(trigger);
  await waitFor(presenting, '退回批次前进入放映');
  const total = String(await evaluate(pageExpr)).split(' / ')[1];
  const last = `${total} / ${total}`;
  const previous = `${Number(total) - 1} / ${total}`;

  await pressKey(request, 'End', 35, 'End');
  await waitFor(`${pageExpr} === ${JSON.stringify(last)} && ${oneSlide}`, 'End 仍到最后一页', 200);
  const startHidden = await evaluate(hidden);
  const startAnim = animExpr ? await evaluate(animExpr) : '';
  if (animExpr && !startAnim.startsWith('动画 0/')) {
    throw new Error(`最后一页应停在第一批之前，实际 ${startAnim}`);
  }

  await pressKey(request, 'ArrowRight', 39, 'ArrowRight');
  await waitFor(
    `${pageExpr} === ${JSON.stringify(last)} && ${hidden} !== ${JSON.stringify(startHidden)}`,
    '最后一页下一步先播一批且不翻页',
  );
  const playedHidden = await evaluate(hidden);
  const playedAnim = animExpr ? await evaluate(animExpr) : '';
  if (animExpr && !playedAnim.startsWith('动画 1/')) throw new Error(`播完一批后计数应为 1，实际 ${playedAnim}`);

  await pressKey(request, 'ArrowLeft', 37, 'ArrowLeft');
  await waitFor(
    `${pageExpr} === ${JSON.stringify(last)} && ${hidden} === ${JSON.stringify(startHidden)}`,
    '上一步收回这一批且页码不动',
  );
  if (animExpr && await evaluate(animExpr) !== startAnim) {
    throw new Error(`退回后计数没有回到 ${startAnim}`);
  }

  await pressKey(request, 'ArrowRight', 39, 'ArrowRight');
  await waitFor(`${hidden} === ${JSON.stringify(playedHidden)}`, '再播回同一批');
  await pressKey(request, 'ArrowUp', 38, 'ArrowUp');
  await waitFor(
    `${pageExpr} === ${JSON.stringify(last)} && ${hidden} === ${JSON.stringify(startHidden)}`,
    'Up 与左方向键同一条退回',
  );

  await pressKey(request, 'ArrowRight', 39, 'ArrowRight');
  await waitFor(`${hidden} === ${JSON.stringify(playedHidden)}`, '遮罩测试前先播一批');
  await pressKey(request, '3', 51, 'Digit3');
  await waitFor(chipOn('3'), '未确认页码');
  await pressKey(request, 'ArrowLeft', 37, 'ArrowLeft');
  await waitFor(
    `${pageExpr} === ${JSON.stringify(last)} && ${hidden} === ${JSON.stringify(startHidden)} && !document.querySelector(${chipSel})?.textContent`,
    '上一步丢掉页码并退回一批，不跳到第 3 页',
  );

  await pressKey(request, 'ArrowRight', 39, 'ArrowRight');
  await waitFor(`${hidden} === ${JSON.stringify(playedHidden)}`, '黑屏前再播一批');
  await pressKey(request, 'b', 66, 'KeyB');
  await waitFor(`${veilOn} && !${whiteOn}`, '黑屏');
  await pressKey(request, 'ArrowLeft', 37, 'ArrowLeft');
  await waitFor(
    `!${veilOn} && ${pageExpr} === ${JSON.stringify(last)} && ${hidden} === ${JSON.stringify(playedHidden)}`,
    '黑屏中的上一步只揭遮罩',
  );
  await pressKey(request, 'w', 87, 'KeyW');
  await waitFor(whiteOn, '白屏');
  await pressKey(request, 'ArrowUp', 38, 'ArrowUp');
  await waitFor(
    `!${veilOn} && ${hidden} === ${JSON.stringify(playedHidden)}`,
    '白屏中的 Up 只揭遮罩',
  );

  const modified = await evaluate(`(() => {
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true, cancelable: true });
    return document.dispatchEvent(event);
  })()`);
  if (modified !== true || await evaluate(hidden) !== playedHidden) throw new Error('Ctrl+Left 退了批次');

  await pressKey(request, 'Home', 36, 'Home');
  await waitFor(`${pageExpr} === ${JSON.stringify(`1 / ${total}`)}`, 'Home 仍回第一页开头');
  await pressKey(request, 'End', 35, 'End');
  await waitFor(`${pageExpr} === ${JSON.stringify(last)} && ${oneSlide} && ${hidden} === ${JSON.stringify(startHidden)}`, 'End 仍从最后一页开头开始', 200);

  await pressKey(request, 'ArrowLeft', 37, 'ArrowLeft');
  await waitFor(`${pageExpr} === ${JSON.stringify(previous)}`, '本页开头的上一步才去上一页');

  await pressKey(request, 'End', 35, 'End');
  await waitFor(`${pageExpr} === ${JSON.stringify(last)} && ${oneSlide}`, '网格测试回到最后一页', 200);
  await pressKey(request, 'g', 71, 'KeyG');
  await waitFor(gridOn, '放映网格');
  await pressKey(request, 'ArrowLeft', 37, 'ArrowLeft');
  if (await evaluate(`${pageExpr} !== ${JSON.stringify(last)} || !${gridOn}`)) {
    throw new Error('网格开着时上一步翻了页或关了网格');
  }
  await pressKey(request, 'Escape', 27, 'Escape');
  await waitFor(`!${gridOn} && ${presenting}`, 'Esc 先关网格');

  if (notesOpen.includes('notesPanel')) {
    await pressKey(request, 's', 83, 'KeyS');
    if (!await evaluate(`document.querySelector('#notesPanel').hidden`)) throw new Error('查看器放映中 s 打开了浏览备注');
  } else {
    await pressKey(request, 's', 83, 'KeyS');
    await waitFor(`${notesOpen} && ${pageExpr} === ${JSON.stringify(last)}`, 's 仍打开备注');
    await pressKey(request, 'n', 78, 'KeyN');
    await waitFor(`!${notesOpen}`, 'N 仍关上备注');
  }

  await pressKey(request, 'Escape', 27, 'Escape');
  await waitFor(`!${presenting}`, 'Esc 离开放映');

  if (fileInput && fileLabel) {
    await click(trigger);
    await waitFor(presenting, '换文件前再进放映');
    await evaluate(`(async () => {
      const bytes = await fetch('/demo/showcase.pptx').then((response) => response.arrayBuffer());
      const input = document.querySelector(${JSON.stringify(fileInput)});
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'present-rewind.pptx'));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await waitFor(
      `document.querySelector(${JSON.stringify(fileLabel)}).textContent.includes('present-rewind.pptx') && ${pageExpr}.startsWith('1 /') && !${presenting}`,
      '换文件后离开放映',
    );
    if (restoreSample) {
      await click(restoreSample);
      await waitFor(
        `document.querySelector(${JSON.stringify(fileLabel)}).textContent.includes(${JSON.stringify(restoreText)}) && ${pageExpr}.startsWith('1 /') && !${presenting}`,
        '换回原本文稿',
      );
    }
  }
  console.log('  放映上一步退回一批通过');
}

export async function runStandalonePresentRewindContract({ evaluate, request, click, waitFor }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);
  await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /')",
    '退回批次契约打开 showcase',
  );
  await pressKey(request, 'ArrowDown', 40, 'ArrowDown');
  await waitFor("document.querySelector('#pageIndicator').textContent === '2 / 7'", '浏览态 Down 仍翻页');
  await pressKey(request, 'ArrowUp', 38, 'ArrowUp');
  await waitFor("document.querySelector('#pageIndicator').textContent === '1 / 7'", '浏览态 Up 仍回上一页');
  await evaluate("document.querySelector('#searchInput').focus()");
  await pressKey(request, 'ArrowLeft', 37, 'ArrowLeft');
  if (await evaluate("document.querySelector('#pageIndicator').textContent") !== '1 / 7') {
    throw new Error('搜索框里的 Left 翻了页');
  }
  await evaluate("document.querySelector('#searchInput').blur()");

  await runPresentRewindContract({ evaluate, request, click, waitFor }, {
    trigger: '#btnPresent',
    host: '#presenter',
    stage: '#stage',
    pager: '#pageIndicator',
    presenting: "!document.querySelector('#presenter').hidden",
    notesOpen: "!document.querySelector('#notesPanel').hidden",
    fileInput: '#fileInput',
    fileLabel: '#fileInfo',
    animLabel: '#pvAnim',
  });
  await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /') && document.querySelector('#presenter').hidden",
    '退回批次契约交还 showcase',
  );
}
