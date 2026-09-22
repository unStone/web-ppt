export async function runStandaloneSlideGridContract({ evaluate, request, waitFor, click }) {
  const standalone = (file) => evaluate(`new URL(${JSON.stringify(`/standalone.html?file=${file}`)}, location.href).href`);
  const press = async (name, value, code = name) => {
    const key = { key: name, code, windowsVirtualKeyCode: value, nativeVirtualKeyCode: value };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };

  await request('Page.navigate', { url: await standalone('/missing.pptx') });
  await waitFor("document.querySelector('#fileInfo')?.textContent === '未打开文件'", '独立查看器打开失败');
  await press('g', 71, 'KeyG');
  if (await evaluate("document.querySelector('.slide-grid:not([hidden])')")) {
    throw new Error('打开失败后 G 制造了网格');
  }

  await request('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await request('Page.navigate', { url: await standalone('/demo/showcase.pptx') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent.startsWith('1 /')",
    '独立查看器 showcase',
  );
  if (!await evaluate("document.querySelector('#btnGrid')?.hidden")) {
    throw new Error('宽屏查看器仍显示全部按钮');
  }

  await request('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  try {
    await waitFor("!document.querySelector('#btnGrid').hidden && !document.querySelector('#btnGrid').disabled", '窄屏查看器出现全部');
    await click('#btnGrid');
    await waitFor("document.querySelector('.slide-grid:not([hidden])') && document.querySelectorAll('.slide-grid-item').length >= 1 && document.querySelectorAll('.slide-grid-item svg').length >= 1", '查看器打开网格且可见格已渲染');
    await click('.slide-grid-item[data-index="2"]');
    await waitFor(
      "document.querySelector('#pageIndicator').textContent.startsWith('3 /') && !document.querySelector('.slide-grid:not([hidden])')",
      '查看器点第 3 页',
    );
  } finally {
    await request('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  }

  await evaluate(`(() => {
    globalThis.__nativeRequestFullscreenGrid = document.documentElement.requestFullscreen.bind(document.documentElement);
    document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen denied'));
  })()`);
  try {
    await click('#btnPresent');
    await waitFor("!document.querySelector('#presenter').hidden && !document.fullscreenElement", '全屏失败仍进入演示');
    await click('#pvGrid');
    await waitFor("document.querySelector('.slide-grid:not([hidden])')", '放映侧栏打开网格');
    await press('Escape', 27, 'Escape');
    await waitFor(
      "!document.querySelector('#presenter').hidden && !document.querySelector('.slide-grid:not([hidden])')",
      'Esc 只关网格',
    );
    await press('Escape', 27, 'Escape');
    await waitFor("document.querySelector('#presenter').hidden", '再 Esc 离开放映');
  } finally {
    await evaluate(`(() => {
      if (globalThis.__nativeRequestFullscreenGrid) {
        document.documentElement.requestFullscreen = globalThis.__nativeRequestFullscreenGrid;
      }
      delete globalThis.__nativeRequestFullscreenGrid;
    })()`);
    await request('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  }
  console.log('  独立查看器全部幻灯片网格通过');
}
