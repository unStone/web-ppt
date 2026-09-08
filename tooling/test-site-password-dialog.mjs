import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { installDomEnv } from './lib/dom-env.mjs';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const { window, dom } = installDomEnv();
dom.reconfigure({ url: 'https://web-ppt.test/?lang=zh-CN' });
for (const name of ['location', 'history', 'localStorage', 'navigator', 'AbortController', 'DOMException']) {
  Object.defineProperty(globalThis, name, { value: window[name], configurable: true });
}
document.documentElement.lang = 'zh-CN';
document.head.innerHTML = '<link rel="canonical" href="https://web-ppt.test/">';
document.body.innerHTML = '<nav id="siteLanguage"></nav>';

// jsdom 还没有原生 dialog 状态机；只补浏览器已经提供的开关语义，产品逻辑原样运行。
window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
window.HTMLDialogElement.prototype.close = function close() {
  this.open = false;
  this.dispatchEvent(new window.Event('close'));
};

const root = process.cwd();
const out = resolve(root, 'out/site-password-dialog');
mkdirSync(out, { recursive: true });
const api = await bundleBrowser({
  root,
  entry: resolve(root, 'packages/site/src/password-dialog.ts'),
  output: resolve(out, 'password-dialog.mjs'),
  aliases: [['@web-ppt/core', resolve(root, 'packages/core/src/index.ts')]],
});

const tick = () => new Promise((resolveTick) => setTimeout(resolveTick));
const submit = async (password) => {
  const input = document.querySelector('#viewerPassword');
  input.value = password;
  document.querySelector('#viewerPasswordForm').dispatchEvent(
    new window.SubmitEvent('submit', { bubbles: true, cancelable: true }),
  );
  await tick();
};

try {
  const calls = [];
  const opening = api.openWithPresentationPassword('默认 <演示>.pptx', async (password) => {
    calls.push(password);
    if (password === undefined) throw new api.PasswordRequiredError();
    if (password === 'wrong') throw new api.WrongPasswordError();
    return { slides: 3 };
  });
  await tick();

  const dialog = document.querySelector('#viewerPasswordDialog');
  assert.ok(dialog?.open, '加密文件必须打开模态密码框');
  assert.equal(dialog.querySelector('h2').textContent, '输入打开密码');
  assert.match(dialog.querySelector('p').textContent, /默认 <演示>\.pptx/,
    '文件名按文本显示，不能拼进 HTML');
  assert.equal(document.activeElement?.id, 'viewerPassword');
  assert.equal(dialog.querySelector('input').type, 'password');

  await submit('wrong');
  assert.equal(dialog.querySelector('[role=alert]').textContent, '密码错误，请重试');
  assert.ok(dialog.open, '密码错误后留在原对话框内重试');

  await submit('web-ppt-2024');
  assert.deepEqual(await opening, { slides: 3 });
  assert.deepEqual(calls, [undefined, 'wrong', 'web-ppt-2024']);
  assert.equal(document.querySelector('#viewerPasswordDialog'), null, '成功后移除密码与对话框 DOM');

  const cancelledCalls = [];
  const cancelled = api.openWithPresentationPassword('cancel.pptx', async (password) => {
    cancelledCalls.push(password);
    throw new api.PasswordRequiredError();
  });
  await tick();
  document.querySelector('#viewerPasswordCancel').click();
  assert.equal(await cancelled, null);
  assert.deepEqual(cancelledCalls, [undefined], '取消不能带空密码再解析一次');

  const broken = new Error('文件损坏');
  await assert.rejects(api.openWithPresentationPassword('broken.pptx', async () => { throw broken; }),
    (error) => error === broken, '非密码错误必须交回原解析错误路径');
  assert.equal(document.querySelector('#viewerPasswordDialog'), null);
  console.log('官网加密文档密码框：首次提示、错误重试、成功清理、取消与异常分流通过');
} finally {
  dom.window.close();
}
