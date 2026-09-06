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
