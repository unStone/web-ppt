/** 语言入口本身需要真实键盘和触点可达，不能仅靠脚本 click 绕过布局。 */
export async function runSiteLanguageInputContract({ request, evaluate, waitFor }, page) {
  await request('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
  await request('Emulation.setTouchEmulationEnabled', { enabled: true });
  const layout = await evaluate(`(() => {
    const controls = [...document.querySelectorAll('#siteLanguage a,.app-header #newFile,.app-header .file-button')];
    return controls.map((node) => {
      const rect = node.getBoundingClientRect();
      return { text: node.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
  })()`);
  if (layout.some((rect) => rect.left < 0 || rect.right > 321 || rect.top < 0 || rect.bottom > 844)) {
    throw new Error(`${page} 的窄屏语言/文件入口不可达：${JSON.stringify(layout)}`);
  }
  const point = await evaluate(`(() => {
    const rect = document.querySelector('[data-site-locale="zh-CN"]').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await request('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await request('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitFor("document.documentElement.lang === 'zh-CN'", `${page} 触屏切中文`);
  await evaluate("document.querySelector('[data-site-locale=\"en\"]').focus()");
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  await waitFor("document.documentElement.lang === 'en'", `${page} 键盘切英文`);
  await request('Emulation.setTouchEmulationEnabled', { enabled: false });
  await request('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
}
