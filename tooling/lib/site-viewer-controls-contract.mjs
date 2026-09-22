export async function runViewerFullscreenContract({ evaluate, request, click, waitFor }, trigger, stage, pager) {
  await click(trigger);
  await waitFor("document.fullscreenElement?.contains(document.querySelector('#siteLanguage'))", '全屏内语言入口');
  await click('[data-site-locale="zh-CN"]');
  await evaluate(`globalThis.__fullscreenView = document.querySelector('${stage}').firstElementChild`);
  const page = await evaluate(`document.querySelector('${pager}').textContent`);
  await evaluate("document.querySelector('[data-site-locale=en]').focus()");
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  await waitFor("document.documentElement.lang === 'en'", '全屏 Enter 切语言');
  if (!await evaluate(`globalThis.__fullscreenView === document.querySelector('${stage}').firstElementChild && document.querySelector('${pager}').textContent === ${JSON.stringify(page)}`)) throw new Error('语言按钮 Enter 被演示快捷键抢走或重建了视图');
  await evaluate('document.exitFullscreen()', true);
  await waitFor("!document.fullscreenElement && !document.querySelector('.fullscreen-language #siteLanguage')", '退出全屏归还语言入口');
}

export async function runViewerCopyContract({ evaluate, click, waitFor }, selector, idle, idleEn) {
  await evaluate(`(() => {
    globalThis.__writeClipboard = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async (value) => { globalThis.__copiedText = value; };
  })()`);
  try {
    const expected = await evaluate(`document.querySelector('${selector}').dataset.copy ?? location.href`);
    await click(selector);
    await waitFor(`document.querySelector('${selector}').textContent === 'Copied'`, '英文复制完成');
    if (await evaluate('globalThis.__copiedText') !== expected) throw new Error('复制改写了代码或当前分享地址');
    await click('[data-site-locale="zh-CN"]');
    await waitFor(`document.querySelector('${selector}').textContent === '已复制'`, '已复制提示切中文');
    await waitFor(`document.querySelector('${selector}').textContent === ${JSON.stringify(idle)}`, '定时恢复当前语言');
    await evaluate("navigator.clipboard.writeText = async () => { throw new DOMException('denied', 'NotAllowedError'); }");
    await click(selector);
    await waitFor(`document.querySelector('${selector}').textContent === '复制失败'`, '剪贴板被拒不能伪装成功');
    await click('[data-site-locale="en"]');
    await waitFor(`document.querySelector('${selector}').textContent === 'Copy failed'`, '复制失败切英文');
    await waitFor(`document.querySelector('${selector}').textContent === ${JSON.stringify(idleEn)}`, '英文恢复复制按钮');
  } finally { await evaluate('navigator.clipboard.writeText = globalThis.__writeClipboard'); }
}

export async function runViewerPresentFallbackContract({ evaluate, request, click, waitFor }, trigger, host, stage, pager) {
  const original = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(host)});
    globalThis.__nativeRequestFullscreen = el.requestFullscreen.bind(el);
    el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
    return document.querySelector(${JSON.stringify(pager)}).textContent;
  })()`);
  try {
    await click(trigger);
    await waitFor(
      `document.querySelector(${JSON.stringify(host)})?.classList.contains('is-presenting') && !document.fullscreenElement`,
      '全屏失败仍进入演示',
    );
    if (!await evaluate(`document.querySelector(${JSON.stringify(host)}).contains(document.querySelector('#siteLanguage'))
      && getComputedStyle(document.querySelector(${JSON.stringify(host)} + ' .present-bar')).display === 'flex'`)) {
      throw new Error('页面内放映未挂上语言入口或控制条');
    }
    await evaluate(`(() => {
      const stage = document.querySelector(${JSON.stringify(stage)});
      const pager = document.querySelector(${JSON.stringify(pager)});
      const start = pager.textContent;
      // 当前页可能先播完动画再翻页；连点直到页码变，才是用户「点着往下走」的结果
      for (let i = 0; i < 16 && pager.textContent === start; i++) {
        stage.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    })()`);
    await waitFor(
      `document.querySelector(${JSON.stringify(pager)}).textContent !== ${JSON.stringify(original)}`,
      '点舞台前进',
    );
    const advanced = await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`);
    await evaluate(`document.querySelector(${JSON.stringify(host)} + ' .present-bar').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    if (await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`) !== advanced) {
      throw new Error('点控制条被当成舞台前进');
    }
    const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor(
      `!document.querySelector(${JSON.stringify(host)})?.classList.contains('is-presenting') && !document.fullscreenElement && !document.querySelector('.fullscreen-language #siteLanguage')`,
      'Esc 离开页面内演示并归还语言入口',
    );
  } finally {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(host)});
      if (globalThis.__nativeRequestFullscreen) el.requestFullscreen = globalThis.__nativeRequestFullscreen;
      delete globalThis.__nativeRequestFullscreen;
    })()`);
  }
}

export async function runViewerSpeakerAidsContract({ evaluate, request, click, waitFor }, notesBtn, host, pager, presentBtn, prevBtn, nextBtn) {
  await evaluate(`document.querySelector(${JSON.stringify(host)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
  await evaluate(`(() => { const prev = document.querySelector(${JSON.stringify(prevBtn)}); for (let i = 0; i < 16; i++) prev.click(); })()`);
  await waitFor(`document.querySelector(${JSON.stringify(pager)}).textContent.startsWith('1 /')`, '备注契约回到第一页');
  if (await evaluate(`document.querySelector(${JSON.stringify(notesBtn)}).disabled`)) throw new Error('已打开文稿备注仍禁用');
  await click(notesBtn);
  await waitFor(
    `document.querySelector(${JSON.stringify(host)} + ' .speaker-notes')?.textContent.includes('形状库') && document.querySelector(${JSON.stringify(host)} + ' .speaker-next svg') && document.querySelector(${JSON.stringify(host)}).classList.contains('has-speaker-aids')`,
    '第一页备注与下一页预览',
  );
  await click(nextBtn);
  await waitFor(
    `document.querySelector(${JSON.stringify(host)} + ' .speaker-notes')?.textContent.includes('效果与填充')`,
    '备注跟随翻页',
  );
  await click(`${host} .speaker-aids-close`);
  await waitFor(`!document.querySelector(${JSON.stringify(host)}).classList.contains('has-speaker-aids')`, '关闭备注');
  const noteKey = { key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78, nativeVirtualKeyCode: 78 };
  await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...noteKey });
  await request('Input.dispatchKeyEvent', { type: 'keyUp', ...noteKey });
  await waitFor(`document.querySelector(${JSON.stringify(host)}).classList.contains('has-speaker-aids')`, 'N 打开备注');
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(host)});
    globalThis.__nativeRequestFullscreenNotes = el.requestFullscreen.bind(el);
    el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await click(presentBtn);
    await waitFor(
      `document.querySelector(${JSON.stringify(host)})?.classList.contains('is-presenting') && !document.querySelector(${JSON.stringify(host)}).classList.contains('has-speaker-aids')`,
      '进入演示收起备注',
    );
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...noteKey });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...noteKey });
    await waitFor(`document.querySelector(${JSON.stringify(host)}).classList.contains('has-speaker-aids')`, '放映中 N 再开备注');
    const page = await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`);
    await evaluate(`document.querySelector(${JSON.stringify(host)} + ' .speaker-aids').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    if (await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`) !== page) {
      throw new Error('点备注层被当成舞台前进');
    }
    const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor(
      `!document.querySelector(${JSON.stringify(host)})?.classList.contains('is-presenting') && document.querySelector(${JSON.stringify(host)}).classList.contains('has-speaker-aids')`,
      '退出演示恢复浏览备注',
    );
  } finally {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(host)});
      if (globalThis.__nativeRequestFullscreenNotes) el.requestFullscreen = globalThis.__nativeRequestFullscreenNotes;
      delete globalThis.__nativeRequestFullscreenNotes;
    })()`);
  }
  await evaluate(`(() => { const next = document.querySelector(${JSON.stringify(nextBtn)}); for (let i = 0; i < 16; i++) next.click(); })()`);
  await waitFor(
    `document.querySelector(${JSON.stringify(host)} + ' .speaker-next-empty:not([hidden])') && document.querySelector(${JSON.stringify(host)} + ' .speaker-next[hidden]')`,
    '最后一页没有下一页',
  );
  await click(`${host} .speaker-aids-close`);
  await waitFor(`!document.querySelector(${JSON.stringify(host)}).classList.contains('has-speaker-aids')`, '验收结束关掉备注');
}

function dispatchSwipeScript(target, dx, dy, clickAfter = false) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(target)});
    const r = el.getBoundingClientRect();
    const x = r.left + Math.max(8, r.width / 2);
    const y = r.top + Math.max(8, r.height / 2);
    const fire = (type, cx, cy) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 91, pointerType: 'touch', isPrimary: true,
      clientX: cx, clientY: cy,
    }));
    fire('pointerdown', x, y);
    fire('pointermove', x + ${dx}, y + ${dy});
    fire('pointerup', x + ${dx}, y + ${dy});
    if (${clickAfter}) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  })()`;
}

export async function runViewerSwipeNavContract({ evaluate, request, click, waitFor }, host, stage, pager, notesBtn, presentBtn, prevBtn) {
  await evaluate(`document.querySelector(${JSON.stringify(host)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
  await evaluate(`(() => { const prev = document.querySelector(${JSON.stringify(prevBtn)}); for (let i = 0; i < 16; i++) prev.click(); })()`);
  await waitFor(`document.querySelector(${JSON.stringify(pager)}).textContent.startsWith('1 /')`, '滑动契约回到第一页');

  await evaluate(dispatchSwipeScript(stage, -80, 0));
  await waitFor(`document.querySelector(${JSON.stringify(pager)}).textContent.startsWith('2 /')`, '向左滑下一页');
  await evaluate(dispatchSwipeScript(stage, 80, 0));
  await waitFor(`document.querySelector(${JSON.stringify(pager)}).textContent.startsWith('1 /')`, '向右滑上一页');

  const stay = await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`);
  await evaluate(dispatchSwipeScript(stage, 0, 90));
  await evaluate(dispatchSwipeScript(stage, -20, 0));
  if (await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`) !== stay) {
    throw new Error('竖滑或短滑被当成翻页');
  }

  await click(notesBtn);
  await waitFor(
    `document.querySelector(${JSON.stringify(host)}).classList.contains('has-speaker-aids')`,
    '滑动契约打开备注',
  );
  await evaluate(dispatchSwipeScript(`${host} .speaker-notes`, -80, 0));
  if (await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`) !== stay) {
    throw new Error('辅助层上滑被当成翻页');
  }
  await click(`${host} .speaker-aids-close`);
  await waitFor(`!document.querySelector(${JSON.stringify(host)}).classList.contains('has-speaker-aids')`, '滑动契约关掉备注');

  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(host)});
    globalThis.__nativeRequestFullscreenSwipe = el.requestFullscreen.bind(el);
    el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await click(presentBtn);
    await waitFor(
      `document.querySelector(${JSON.stringify(host)})?.classList.contains('is-presenting')`,
      '滑动契约进入演示',
    );
    await evaluate(dispatchSwipeScript(stage, -80, 0));
    const onlySwipe = await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`);
    const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor(
      `!document.querySelector(${JSON.stringify(host)})?.classList.contains('is-presenting')`,
      '滑动契约离开演示',
    );
    await evaluate(`(() => { const prev = document.querySelector(${JSON.stringify(prevBtn)}); for (let i = 0; i < 16; i++) prev.click(); })()`);
    await waitFor(`document.querySelector(${JSON.stringify(pager)}).textContent.startsWith('1 /')`, '滑动连跳对照回到第一页');
    await click(presentBtn);
    await waitFor(
      `document.querySelector(${JSON.stringify(host)})?.classList.contains('is-presenting')`,
      '滑动连跳对照再进演示',
    );
    await evaluate(dispatchSwipeScript(stage, -80, 0, true));
    if (await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`) !== onlySwipe) {
      throw new Error('放映滑动被随后的 click 连跳');
    }
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor(
      `!document.querySelector(${JSON.stringify(host)})?.classList.contains('is-presenting')`,
      '滑动契约结束演示',
    );
  } finally {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(host)});
      if (globalThis.__nativeRequestFullscreenSwipe) el.requestFullscreen = globalThis.__nativeRequestFullscreenSwipe;
      delete globalThis.__nativeRequestFullscreenSwipe;
    })()`);
  }

  await request('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  try {
    await evaluate(`document.querySelector(${JSON.stringify(host)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
    await evaluate(`(() => { const prev = document.querySelector(${JSON.stringify(prevBtn)}); for (let i = 0; i < 16; i++) prev.click(); })()`);
    await waitFor(`document.querySelector(${JSON.stringify(pager)}).textContent.startsWith('1 /')`, '小视口回到第一页');
    await evaluate(dispatchSwipeScript(stage, -80, 0));
    await waitFor(`document.querySelector(${JSON.stringify(pager)}).textContent.startsWith('2 /')`, '小视口向左滑下一页');
  } finally {
    await request('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  }
}

export async function runViewerBlankScreenContract({ evaluate, request, click, waitFor }, trigger, host, stage, pager, prevBtn, presentNext) {
  await evaluate(`document.querySelector(${JSON.stringify(host)})?.scrollIntoView({ block: 'nearest', behavior: 'instant' })`);
  await evaluate(`(() => { const prev = document.querySelector(${JSON.stringify(prevBtn)}); for (let i = 0; i < 16; i++) prev.click(); })()`);
  await waitFor(`document.querySelector(${JSON.stringify(pager)}).textContent.startsWith('1 /')`, '黑屏契约回到第一页');

  const blankOn = `document.querySelector(${JSON.stringify(`${stage} .present-blank.is-on`)})`;
  const press = async (name, value) => {
    const key = { key: name, code: name === 'b' ? 'KeyB' : name, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };

  await press('b', 66);
  if (await evaluate(blankOn)) throw new Error('浏览态 B 不该黑屏');

  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(host)});
    globalThis.__nativeRequestFullscreenBlank = el.requestFullscreen.bind(el);
    el.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await click(trigger);
    await waitFor(
      `document.querySelector(${JSON.stringify(host)})?.classList.contains('is-presenting') && !document.fullscreenElement`,
      '黑屏契约进入演示',
    );
    const start = await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`);
    await press('b', 66);
    await waitFor(blankOn, '放映中 B 黑屏');
    if (await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`) !== start) {
      throw new Error('B 黑屏改变了页码');
    }
    await press('b', 66);
    await waitFor(`!${blankOn}`, '再按 B 恢复');
    if (await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`) !== start) {
      throw new Error('恢复黑屏改变了页码');
    }

    await press('b', 66);
    await waitFor(blankOn, '再黑一次以便点层');
    await evaluate(`document.querySelector(${JSON.stringify(`${stage} .present-blank`)}).dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await waitFor(`!${blankOn}`, '点黑层恢复');
    if (await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`) !== start) {
      throw new Error('点黑层被当成舞台前进');
    }

    await press('b', 66);
    await waitFor(blankOn, '再黑一次以便 pointerup 后 click 打到幻灯片');
    await evaluate(`(() => {
      const layer = document.querySelector(${JSON.stringify(`${stage} .present-blank`)});
      const slide = document.querySelector(${JSON.stringify(`${stage} svg`)}) || layer;
      layer.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      slide.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    })()`);
    await waitFor(`!${blankOn}`, 'pointerup 恢复黑层');
    if (await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`) !== start) {
      throw new Error('pointerup 后的 click 翻了页');
    }

    await press('b', 66);
    await waitFor(blankOn, '再黑一次以便空格');
    await press(' ', 32);
    await waitFor(`!${blankOn}`, '黑屏中空格只恢复');
    if (await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`) !== start) {
      throw new Error('黑屏中空格翻了页');
    }

    await press('b', 66);
    await waitFor(blankOn, '再黑一次以便滑动');
    await evaluate(dispatchSwipeScript(`${stage} .present-blank`, -80, 0));
    await waitFor(`!${blankOn}`, '滑黑层只恢复');
    if (await evaluate(`document.querySelector(${JSON.stringify(pager)}).textContent`) !== start) {
      throw new Error('滑黑层翻了页');
    }

    await press('b', 66);
    await waitFor(blankOn, '再黑一次以便控制条翻页');
    await evaluate(`(() => {
      const next = document.querySelector(${JSON.stringify(presentNext)});
      const pager = document.querySelector(${JSON.stringify(pager)});
      const from = pager.textContent;
      for (let i = 0; i < 16 && pager.textContent === from; i++) next.click();
    })()`);
    await waitFor(
      `document.querySelector(${JSON.stringify(pager)}).textContent !== ${JSON.stringify(start)} && !!${blankOn}`,
      '控制条下一页仍翻页且保持黑屏',
    );

    const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...escape });
    await waitFor(
      `!document.querySelector(${JSON.stringify(host)})?.classList.contains('is-presenting') && !${blankOn}`,
      'Esc 离开放映并清掉黑层',
    );
  } finally {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(host)});
      if (globalThis.__nativeRequestFullscreenBlank) el.requestFullscreen = globalThis.__nativeRequestFullscreenBlank;
      delete globalThis.__nativeRequestFullscreenBlank;
    })()`);
  }
  await press('b', 66);
  if (await evaluate(blankOn)) throw new Error('退出后 B 仍黑屏');
}

export async function runViewerNavigationKeysContract({ request, click, waitFor }, next, pager) {
  await click(next);
  await waitFor(`document.querySelector('${pager}').textContent === '3 / 7'`, '按钮翻页');
  for (const [name, value, expected] of [['ArrowRight', 39, '4 / 7'], ['ArrowLeft', 37, '3 / 7'], ['ArrowLeft', 37, '2 / 7']]) {
    const key = { key: name, code: name, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    await waitFor(`document.querySelector('${pager}').textContent === '${expected}'`, '按钮焦点不抢走方向翻页');
  }
}
