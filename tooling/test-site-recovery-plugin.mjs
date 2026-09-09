import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { installDomEnv } from './lib/dom-env.mjs';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const { window, dom } = installDomEnv();
dom.reconfigure({ url: 'https://web-ppt.test/editor.html?lang=zh-CN' });
for (const name of ['location', 'history', 'localStorage', 'AbortController', 'DOMException']) {
  Object.defineProperty(globalThis, name, { value: window[name], configurable: true });
}
// 本用例观察服务与恢复决策的 DOM 边界；实际 IndexedDB 往返由官网浏览器契约验证。
// 在存储边界拒绝 IO，防止测试无意中把错误的伪实现当成原生数据库。
globalThis.indexedDB = { open() { throw new Error('此用例不执行存储 IO'); } };
document.documentElement.lang = 'zh-CN';
document.head.innerHTML = '<link rel="canonical" href="https://web-ppt.test/editor.html">';
document.body.innerHTML = `<header id="localeHome"><nav id="siteLanguage"></nav></header>
<input id="recoveryToggle" type="checkbox" checked>
<section id="recoveryPrompt" hidden><span></span><p id="recoverySummary"></p>
<button id="restoreRecovery"></button><button id="discardRecovery"></button></section>
<p id="recoveryState"></p>`;
const root = process.cwd(), out = resolve(root, 'out/site-recovery-plugin');
mkdirSync(out, { recursive: true });
const { Context, editorRecoveryPlugin, languageReady } = await bundleBrowser({ root,
  entry: resolve(root, 'tooling/lib/site-recovery-plugin-api.mjs'), output: resolve(out, 'api.mjs') });
await languageReady;
const context = new Context(), notices = [];
const config = { notice: (...args) => notices.push(args) };
const signal = new AbortController().signal;
const candidate = { updatedAt: 0, frameCount: 2, latestLabel: '移动形状' };
const prompt = document.querySelector('#recoveryPrompt');
const control = document.querySelector('#siteLanguage');
const toggle = document.querySelector('#recoveryToggle');

try {
  const first = await context.plugin(editorRecoveryPlugin, config);
  const recovery = context.editorRecovery;
  const options = recovery.openOptions(signal).recovery;
  const pending = options.decide(candidate);
  assert.equal(prompt.hidden, false);
  assert.equal(prompt.contains(control), true);
  await first.dispose();
  assert.equal(await pending, 'cancel', '卸载不能悬挂恢复决策');
  assert.equal(prompt.hidden, true);
  assert.equal(control.parentElement.id, 'localeHome', '同一语言入口回到原位');
  assert.equal(context.get('editorRecovery'), undefined, 'Cordis 撤销服务注册');
  const before = notices.length;
  options.onError(new Error('迟到的存储错误'));
  assert.equal(notices.length, before, '旧服务异步回调不再更新反馈');
  assert.equal(await options.decide(candidate), 'cancel', '卸载前捕获的回调不能重新打开提示');
  assert.equal(prompt.hidden, true);
  assert.throws(() => recovery.openOptions(signal), /已释放/);
  toggle.click();
  assert.equal(localStorage.getItem('web-ppt:site:recovery-enabled'), null, '卸载后 DOM 控件不再写偏好');

  const second = await context.plugin(editorRecoveryPlugin, config);
  toggle.checked = true;
  toggle.click();
  assert.equal(localStorage.getItem('web-ppt:site:recovery-enabled'), 'false');
  assert.equal(notices.length, before + 1, '重新加载后一次变化只有一次反馈');
  assert.deepEqual(context.editorRecovery.openOptions(signal), {});
  await second.dispose();
  const third = await context.plugin(editorRecoveryPlugin, config);
  assert.deepEqual(context.editorRecovery.openOptions(signal), {}, '服务重建保留本机偏好');
  toggle.checked = false; toggle.click();
  const choice = context.editorRecovery.openOptions(signal).recovery.decide(candidate);
  document.querySelector('#restoreRecovery').click();
  assert.equal(await choice, 'restore');
  assert.equal(prompt.hidden, true);
  assert.equal(control.parentElement.id, 'localeHome');
  await third.dispose();
  console.log('Cordis 恢复服务：注册/卸载、悬挂选择取消、迟到回调隔离、偏好保留与无重复监听通过');
} finally {
  await context.fiber.dispose();
  dom.window.close();
}
