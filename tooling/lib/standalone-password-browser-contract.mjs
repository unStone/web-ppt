const PASSWORD = 'web-ppt-2024';

export async function runStandalonePasswordContract({ evaluate, request, waitFor }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);
  const press = async (name, value, code = name) => {
    const key = { key: name, code, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };
  const submitPassword = async (password) => evaluate(`(() => {
    const input = document.querySelector('#viewerPassword');
    const form = document.querySelector('#viewerPasswordForm');
    if (!input || !form) throw new Error('密码框不在');
    input.value = ${JSON.stringify(password)};
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  })()`);

  await request('Page.navigate', { url: await standalone('/demo/sample-encrypted-agile.pptx') });
  await waitFor(
    "document.querySelector('#viewerPasswordDialog')?.open === true && document.activeElement?.id === 'viewerPassword' && document.querySelector('#fileInfo')?.textContent === '正在打开…'",
    '远程加密稿弹出密码框',
  );
  if (await evaluate("document.querySelector('#stage svg')")) {
    throw new Error('密码框出现时仍留着旧幻灯片');
  }
  if (!await evaluate("document.querySelector('#viewerPasswordDescription')?.textContent.includes('sample-encrypted-agile.pptx')")) {
    throw new Error('密码框没有按文本显示文件名');
  }
  await press('g', 71, 'KeyG');
  if (await evaluate("document.querySelector('.slide-grid:not([hidden])')")) {
    throw new Error('密码框打开时 G 制造了网格');
  }

  await submitPassword('wrong');
  await waitFor(
    "document.querySelector('#viewerPasswordDialog')?.open === true && document.querySelector('#viewerPasswordFeedback')?.getAttribute('role') === 'alert' && document.querySelector('#viewerPasswordFeedback')?.textContent === '密码错误，请重试'",
    '错误密码留在框里重试',
  );

  await submitPassword(PASSWORD);
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('sample-encrypted-agile.pptx') && document.querySelector('#stage')?.dataset.openPhase === 'ready' && document.querySelector('#stage svg') && !document.querySelector('#viewerPasswordDialog')",
    '正确密码打开加密稿',
  );

  await request('Page.navigate', { url: await standalone('/demo/sample-encrypted-agile.pptx') });
  await waitFor("document.querySelector('#viewerPasswordDialog')?.open === true", '再次打开加密稿');
  await evaluate("document.querySelector('#viewerPasswordCancel').click()");
  await waitFor(
    "document.querySelector('#stage')?.dataset.openPhase === 'error' && /已取消打开/.test(document.querySelector('#stage')?.textContent ?? '') && document.querySelector('#fileInfo')?.textContent === '未打开文件' && document.querySelector('#pageIndicator')?.textContent === '- / -' && !document.querySelector('#viewerPasswordDialog')",
    '取消停在当前这一代',
  );
  await press('g', 71, 'KeyG');
  if (await evaluate("document.querySelector('.slide-grid:not([hidden])')")) {
    throw new Error('取消后 G 制造了网格');
  }

  await request('Page.navigate', { url: await standalone('/demo/sample-encrypted-agile.pptx') });
  await waitFor("document.querySelector('#viewerPasswordDialog')?.open === true", 'Esc 前再次打开加密稿');
  await press('Escape', 27);
  await waitFor(
    "document.querySelector('#stage')?.dataset.openPhase === 'error' && /已取消打开/.test(document.querySelector('#stage')?.textContent ?? '') && !document.querySelector('#viewerPasswordDialog')",
    'Esc 取消密码框',
  );

  await request('Page.navigate', { url: await standalone('/demo/sample-encrypted-agile.pptx') });
  await waitFor("document.querySelector('#viewerPasswordDialog')?.open === true", '换文件前密码框仍开着');
  await evaluate(`(async () => {
    const bytes = await fetch('/demo/showcase.pptx').then((r) => r.arrayBuffer());
    const file = new File([bytes], 'after-password.pptx');
    const input = document.querySelector('#fileInput');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('after-password.pptx') && document.querySelector('#stage')?.dataset.openPhase === 'ready' && document.querySelector('#stage svg') && !document.querySelector('#viewerPasswordDialog')",
    '密码框开着时后一次打开赢',
  );
  if (await evaluate("/已取消打开/.test(document.querySelector('#stage')?.textContent ?? '') || document.querySelector('#fileInfo').textContent.includes('sample-encrypted-agile')")) {
    throw new Error('被换掉的密码框取消写进了新打开');
  }
  if (String(await evaluate('location.search')).includes('file=')) {
    throw new Error('密码框开着时换本地没有清掉 file');
  }
  console.log('  独立查看器加密稿密码框通过');
}
