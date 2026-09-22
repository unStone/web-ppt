export async function runStandaloneOpenSessionContract({ evaluate, request, waitFor }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);
  const press = async (name, value, code = name) => {
    const key = { key: name, code, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };

  await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /')",
    '独立查看器打开会话前 showcase',
  );

  await evaluate(`(async () => {
    const first = await fetch('/demo/sample-chart.pptx').then((r) => r.arrayBuffer());
    const second = await fetch('/demo/showcase.pptx').then((r) => r.arrayBuffer());
    const delayed = new File([first], 'held-chart.pptx');
    delayed.arrayBuffer = () => new Promise((resolve) => {
      globalThis.__releaseHeldOpen = () => resolve(first);
    });
    const input = document.querySelector('#fileInput');
    const transfer = new DataTransfer();
    transfer.items.add(delayed);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    globalThis.__secondOpen = { name: 'user-second.pptx', bytes: second };
  })()`, true);

  await waitFor("document.querySelector('#stage')?.dataset.openPhase === 'opening' && document.querySelector('#fileInfo')?.textContent === '正在打开…'", '换文件立刻拆掉旧页并进入打开');
  if (await evaluate("document.querySelector('#stage svg')")) {
    throw new Error('独立查看器打开中仍留着旧幻灯片');
  }
  await press('g', 71, 'KeyG');
  if (await evaluate("document.querySelector('.slide-grid:not([hidden])')")) {
    throw new Error('打开中 G 制造了网格');
  }

  await evaluate(`(() => {
    const file = new File([globalThis.__secondOpen.bytes], globalThis.__secondOpen.name);
    const input = document.querySelector('#fileInput');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await evaluate('globalThis.__releaseHeldOpen()');
  await waitFor("document.querySelector('#fileInfo')?.textContent.includes('user-second.pptx') && document.querySelector('#stage')?.dataset.openPhase === 'ready'", '后一次本地打开赢');
  if (await evaluate("document.querySelector('#fileInfo').textContent.includes('held-chart.pptx')")) {
    throw new Error('被换掉的本地打开仍写进了文件信息');
  }
  console.log('  独立查看器打开会话通过');
}
