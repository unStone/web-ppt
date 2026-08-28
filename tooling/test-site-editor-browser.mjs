/** 官网产品层的 .ppt 转换确认、零命令拒绝与下载命名必须在真实浏览器观察。 */
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { runSiteEditorToolbarContract } from './lib/site-editor-toolbar-contract.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/site-editor-browser');
mkdirSync(out, { recursive: true });
const bundle = join(out, 'editor-page.js');
const aliases = [
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ['@web-ppt/edit-core/generate', join(root, 'packages/edit-core/src/generate/index.ts')],
  ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
  ['@web-ppt/viewer-core', join(root, 'packages/viewer-core/src/index.ts')],
  ['@web-ppt/editor', join(root, 'packages/editor/src/index.ts')],
];
execFileSync('npx', [
  'esbuild', join(root, 'packages/site/src/editor-page.ts'), '--bundle', '--format=esm',
  '--platform=browser', '--log-level=error',
  ...aliases.map(([from, to]) => `--alias:${from}=${to}`), `--outfile=${bundle}`,
], { cwd: root, stdio: 'inherit' });

const browser = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
].filter(Boolean).find((candidate) => existsSync(candidate));
if (!browser) throw new Error('找不到 Chrome/Chromium；可通过 CHROME_BIN 指定真实浏览器');

const editorHtml = readFileSync(join(root, 'packages/site/editor.html'), 'utf8')
  .replace('./src/editor-page.css', './editor-page.css')
  .replace('./src/editor-page.ts', './editor-page.js');
const routes = new Map([
  ['/editor.html', ['text/html; charset=utf-8', editorHtml]],
  ['/editor-page.js', ['text/javascript; charset=utf-8', readFileSync(bundle)]],
  ['/editor-page.css', ['text/css; charset=utf-8', readFileSync(join(root, 'packages/site/src/editor-page.css'))]],
  ['/demo/showcase.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/showcase.pptx'))]],
  ['/fixtures/sample.ppt', ['application/vnd.ms-powerpoint', readFileSync(join(root, 'fixtures/sample.ppt'))]],
  ['/fixtures/sample-editor-shape-format.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-shape-format.pptx'))]],
  ['/fixtures/sample-editor-text.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-text.pptx'))]],
  ['/fixtures/sample-editor-image-content.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-image-content.pptx'))]],
  ['/fixtures/sample-editor-format-painter.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-format-painter.pptx'))]],
  ['/fixtures/sample-editor-transitions.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-transitions.pptx'))]],
  ['/fixtures/sample-editor-animations.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync(join(root, 'fixtures/sample-editor-animations.pptx'))]],
  ['/assets/replacement.png', ['image/png', readFileSync(join(root, 'packages/site/public/og.png'))]],
]);
const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const route = routes.get(pathname);
  if (!route) return void response.writeHead(404).end('Not found');
  response.writeHead(200, { 'content-type': route[0] });
  response.end(route[1]);
});

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
let child;
let profile;
let diagnostics = '';

function assertPngDimensions(data, width, height, label) {
  const png = Buffer.from(data, 'base64');
  const actual = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  if (actual.width !== width || actual.height !== height) {
    throw new Error(`${label}截图尺寸错误：${JSON.stringify(actual)}`);
  }
  return png;
}

function browserRunning() {
  return child && child.exitCode === null && child.signalCode === null;
}

async function waitForBrowserExit(milliseconds) {
  if (!browserRunning()) return true;
  return Promise.race([
    new Promise((resolveExit) => child.once('close', () => resolveExit(true))),
    delay(milliseconds).then(() => false),
  ]);
}

async function launch(url) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    child = spawn(browser, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--window-size=1280,720', `--user-data-dir=${profile}`, '--remote-debugging-port=0', url,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const timeout = setTimeout(() => rejectLaunch(new Error('Chrome DevTools 启动超时')), 10000);
    child.stderr.on('data', (chunk) => {
      diagnostics += chunk.toString('utf8');
      const match = diagnostics.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (!match) return;
      clearTimeout(timeout);
      resolveLaunch(Number(match[1]));
    });
    child.once('error', rejectLaunch);
  });
}

async function pageTarget(port, url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const target = targets.find((candidate) => candidate.type === 'page' && candidate.url === url);
      if (target) return target.webSocketDebuggerUrl;
    } catch { /* DevTools 端口刚出现时尚未开始响应。 */ }
    await delay(100);
  }
  throw new Error('Chrome 没有创建官网编辑页');
}

async function runContract(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.once('open', resolveOpen);
    socket.once('error', rejectOpen);
  });
  let serial = 0;
  const pending = new Map();
  const consoleFailures = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.method === 'Runtime.consoleAPICalled'
      && (message.params.type === 'warning' || message.params.type === 'error')) {
      consoleFailures.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleFailures.push(message.params.exceptionDetails.exception?.description ?? '页面异常');
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message);
  });
  const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = ++serial;
    const timeout = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`Chrome DevTools ${method} 请求超时`));
    }, 15000);
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, awaitPromise = false) => {
    const response = await request('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.exception?.description ?? '页面脚本执行失败');
    }
    return response.result?.result?.value;
  };
  const waitFor = async (expression, label, attempts = 100) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    const state = await evaluate(`(() => ({
      kind: document.querySelector('#documentKind')?.textContent,
      status: document.querySelector('#statusText')?.textContent,
      loading: document.querySelector('#editorApp')?.dataset.loading,
      file: document.querySelector('#fileName')?.textContent,
      animations: document.querySelectorAll('#animationTimeline li').length,
      animationHtml: document.querySelector('#animationTimeline')?.innerHTML,
    }))()`);
    throw new Error(`等待${label}超时：${JSON.stringify(state)}`);
  };
  const click = async (selector) => {
    const point = await evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      node.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    if (!point) throw new Error(`找不到 ${selector}`);
    await request('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1,
    });
    await request('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1,
    });
  };
  const dispatchKey = async (key, code, virtualKeyCode, modifiers = 0) => {
    const params = { key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode, modifiers };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  };
  try {
    await request('Runtime.enable');
    await request('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
    });
    await waitFor(`document.querySelector('#fileName')?.textContent === 'showcase.pptx'
      && document.querySelector('#documentKind')?.textContent === 'PPTX · 可编辑'
      && !document.querySelector('#editorApp')?.dataset.loading`, '默认文稿就绪');
    await evaluate(`(() => {
      const original = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) {
          globalThis.__capturedDownload = { name: this.download, href: this.href };
          return;
        }
        return original.call(this);
      };
    })()`);
    await runSiteEditorToolbarContract({ evaluate, waitFor, click });
    await evaluate("document.querySelector('#editorInspector').scrollTop = 0");
    const desktopLayout = await evaluate(`(() => {
      const panel = document.querySelector('.object-panel').getBoundingClientRect();
      const canvas = document.querySelector('#canvasViewport').getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
        panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom, width: panel.width, height: panel.height },
        canvas: { width: canvas.width, height: canvas.height } };
    })()`);
    if (desktopLayout.width !== 1280 || desktopLayout.height !== 720
      || desktopLayout.scrollWidth > desktopLayout.width
      || desktopLayout.panel.left < 0 || desktopLayout.panel.right > desktopLayout.width + 1
      || desktopLayout.panel.bottom > desktopLayout.height + 1
      || desktopLayout.panel.width < 200 || desktopLayout.panel.height < 300
      || desktopLayout.canvas.width < 300 || desktopLayout.canvas.height < 300) {
      throw new Error(`1280×720 工具栏布局越界：${JSON.stringify(desktopLayout)}`);
    }
    const desktopShot = await request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, 'toolbar-1280x720.png'), assertPngDimensions(desktopShot.result.data, 1280, 720, '桌面'));
    await request('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    if (!await evaluate("document.querySelector('#editorApp').dataset.inspectorOpen === 'true'")) {
      await click('#inspectorToggle');
    }
    await evaluate("document.querySelector('#editorInspector').scrollTop = 0");
    await waitFor("document.querySelector('#editorApp').dataset.inspectorOpen === 'true'", '移动端格式抽屉');
    const mobileLayout = await evaluate(`(() => {
      const panel = document.querySelector('.object-panel').getBoundingClientRect();
      const canvas = document.querySelector('#canvasViewport').getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
        panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom, width: panel.width, height: panel.height },
        canvas: { width: canvas.width, height: canvas.height } };
    })()`);
    if (mobileLayout.width !== 390 || mobileLayout.height !== 844
      || mobileLayout.scrollWidth > mobileLayout.width
      || mobileLayout.panel.left < 71 || mobileLayout.panel.right > mobileLayout.width + 1
      || mobileLayout.panel.bottom > mobileLayout.height + 1
      || mobileLayout.panel.width < 250 || mobileLayout.panel.height < 300
      || mobileLayout.canvas.width < 200 || mobileLayout.canvas.height < 200) {
      throw new Error(`390×844 工具栏布局越界：${JSON.stringify(mobileLayout)}`);
    }
    const mobileShot = await request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(out, 'toolbar-390x844.png'), assertPngDimensions(mobileShot.result.data, 390, 844, '移动端'));
    await request('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
    });
    await click('#newFile');
    await waitFor(`document.querySelector('#fileName')?.textContent === '未命名演示文稿.pptx'
      && document.querySelector('#slideCount')?.textContent === '1'
      && !document.querySelector('#editorApp')?.dataset.loading`, '空白文稿就绪');
    const blank = await evaluate(`(() => ({
      kind: document.querySelector('#documentKind')?.textContent,
      shapeDisabled: document.querySelector('#addShape')?.disabled,
      tableDisabled: document.querySelector('#addTable')?.disabled,
      saveDisabled: document.querySelector('#saveFile')?.disabled,
      page: document.querySelector('#pageIndicator')?.textContent,
    }))()`);
    if (blank.kind !== 'PPTX · 可编辑' || blank.shapeDisabled || blank.tableDisabled
      || blank.saveDisabled || blank.page !== '1 / 1') {
      throw new Error(`空白文稿没有进入可编辑状态：${JSON.stringify(blank)}`);
    }
    await click('#addSlide');
    await waitFor(`document.querySelector('#slideCount')?.textContent === '2'
      && document.querySelector('#pageIndicator')?.textContent === '2 / 2'`, '空白文稿新增页面');
    await evaluate("document.querySelector('[data-web-ppt-editor]').focus({ preventScroll: true })");
    await dispatchKey('PageUp', 'PageUp', 33);
    await waitFor(`document.querySelector('#pageIndicator')?.textContent === '1 / 2'
      && document.querySelector('[data-slide-id][aria-current="true"] .slide-number')?.textContent === '1'`,
    '可信 PageUp 同步产品分页器');
    await dispatchKey('PageDown', 'PageDown', 34);
    await waitFor(`document.querySelector('#pageIndicator')?.textContent === '2 / 2'
      && document.querySelector('[data-slide-id][aria-current="true"] .slide-number')?.textContent === '2'`,
    '可信 PageDown 同步产品分页器');
    const blankInitialCount = await evaluate("document.querySelectorAll('[data-edit-id]').length");
    await click('#addShape');
    await waitFor("document.querySelector('#fileName')?.textContent.startsWith('●')", '空白文稿编辑命令');
    await click('#undo');
    await click('#redo');
    const blankEditedCount = await evaluate("document.querySelectorAll('[data-edit-id]').length");
    if (blankEditedCount !== blankInitialCount + 1) throw new Error('空白文稿撤销重做没有恢复插入形状');
    await click('#saveFile');
    await waitFor('!!globalThis.__capturedDownload', '空白 PPTX 下载');
    const blankDownload = await evaluate(`(async () => {
      const captured = globalThis.__capturedDownload;
      const bytes = new Uint8Array(await fetch(captured.href).then((response) => response.arrayBuffer()));
      return { name: captured.name, bytes: Array.from(bytes.slice(0, 4)) };
    })()`, true);
    if (blankDownload.name !== '未命名演示文稿.pptx'
      || blankDownload.bytes[0] !== 0x50 || blankDownload.bytes[1] !== 0x4b) {
      throw new Error(`空白文稿下载无效：${JSON.stringify(blankDownload)}`);
    }
    await evaluate('globalThis.__capturedDownload = null');
    await evaluate(`(async () => {
      const bytes = await fetch('/fixtures/sample.ppt').then((response) => response.arrayBuffer());
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'sample.ppt', { type: 'application/vnd.ms-powerpoint' }));
      const input = document.querySelector('#fileInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await waitFor("document.querySelector('#documentKind')?.textContent.startsWith('PPT ·') && !document.querySelector('#editorApp')?.dataset.loading", '.ppt 打开');
    const initialCount = await evaluate("document.querySelectorAll('[data-edit-id]').length");
    await evaluate(`(() => {
      globalThis.__conversionPrompts = [];
      globalThis.__confirmConversion = false;
      window.confirm = (message) => {
        globalThis.__conversionPrompts.push(message);
        return globalThis.__confirmConversion;
      };
    })()`);
    await click('#editMode');
    await delay(100);
    const promptState = await evaluate(`(() => ({
      prompts: globalThis.__conversionPrompts?.length,
      disabled: document.querySelector('#editMode').disabled,
      kind: document.querySelector('#documentKind').textContent,
      mode: document.querySelector('#editMode').getAttribute('aria-pressed'),
      status: document.querySelector('#statusText').textContent,
    }))()`);
    if (promptState.prompts !== 1) {
      throw new Error(`转换拒绝提示没有出现：${JSON.stringify(promptState)}`);
    }
    const rejected = await evaluate(`(() => ({
      prompt: globalThis.__conversionPrompts[0],
      edit: document.querySelector('#editMode').getAttribute('aria-pressed'),
      addDisabled: document.querySelector('#addShape').disabled,
      saveDisabled: document.querySelector('#saveFile').disabled,
      undoDisabled: document.querySelector('#undo').disabled,
      dirty: document.querySelector('#fileName').textContent.startsWith('●'),
      elements: document.querySelectorAll('[data-edit-id]').length,
    }))()`);
    if (!rejected.prompt.includes('sample.pptx') || !rejected.prompt.includes('不会覆盖原文件')
      || !rejected.prompt.includes('带原因的框架占位')
      || rejected.edit !== 'false' || !rejected.addDisabled || !rejected.saveDisabled
      || !rejected.undoDisabled || rejected.dirty || rejected.elements !== initialCount) {
      throw new Error(`拒绝转换没有保持 view 与零命令：${JSON.stringify(rejected)}`);
    }

    await evaluate('globalThis.__confirmConversion = true');
    await click('#editMode');
    await waitFor("document.querySelector('#editMode')?.getAttribute('aria-pressed') === 'true'", '转换后编辑模式');
    const accepted = await evaluate(`(() => ({
      kind: document.querySelector('#documentKind').textContent,
      addDisabled: document.querySelector('#addShape').disabled,
      saveDisabled: document.querySelector('#saveFile').disabled,
      prompts: globalThis.__conversionPrompts.length,
    }))()`);
    if (accepted.kind !== 'PPT → PPTX · 可编辑' || accepted.addDisabled || accepted.saveDisabled
      || accepted.prompts !== 2) throw new Error(`确认转换后未开放编辑：${JSON.stringify(accepted)}`);

    await click('#addShape');
    await waitFor("document.querySelector('#fileName')?.textContent.startsWith('●')", '编辑命令提交');
    const editedCount = await evaluate("document.querySelectorAll('[data-edit-id]').length");
    if (editedCount !== initialCount + 1) throw new Error('确认转换后插入命令没有生效');
    await click('#saveFile');
    await waitFor('!!globalThis.__capturedDownload', 'PPTX 下载');
    const downloaded = await evaluate(`(async () => {
      const captured = globalThis.__capturedDownload;
      const bytes = new Uint8Array(await fetch(captured.href).then((response) => response.arrayBuffer()));
      return { name: captured.name, bytes: Array.from(bytes), status: document.querySelector('#statusText').textContent };
    })()`, true);
    if (downloaded.name !== 'sample.pptx' || downloaded.bytes[0] !== 0x50
      || downloaded.bytes[1] !== 0x4b || !downloaded.status.includes('PPTX')) {
      throw new Error(`下载结果不符合 .ppt 另存契约：${JSON.stringify({ ...downloaded, bytes: downloaded.bytes.slice(0, 4) })}`);
    }
    writeFileSync(join(out, 'sample.pptx'), Uint8Array.from(downloaded.bytes));
    if (consoleFailures.length) throw new Error(`官网编辑页产生 console warning/error：${consoleFailures.join(' | ')}`);
    return { bytes: downloaded.bytes.length, prompt: rejected.prompt };
  } finally {
    socket.terminate();
  }
}

try {
  profile = mkdtempSync(join(tmpdir(), 'web-ppt-site-editor-'));
  const address = await new Promise((resolveAddress, rejectAddress) => {
    server.once('error', rejectAddress);
    server.listen(0, '127.0.0.1', () => resolveAddress(server.address()));
  });
  const url = `http://127.0.0.1:${address.port}/editor.html`;
  const port = await launch(url);
  const result = await runContract(await pageTarget(port, url));
  console.log(`\n\x1b[32m✓ 官网编辑工具栏与 .ppt 转换闭环通过（下载 ${result.bytes} bytes）\x1b[0m`);
} finally {
  if (browserRunning()) {
    child.kill('SIGTERM');
    if (!await waitForBrowserExit(2000) && browserRunning()) {
      child.kill('SIGKILL');
      await waitForBrowserExit(2000);
    }
  }
  child?.stderr?.destroy();
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  if (profile && !browserRunning()) {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
