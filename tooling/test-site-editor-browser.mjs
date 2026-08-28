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

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/site-editor-browser');
mkdirSync(out, { recursive: true });
const bundle = join(out, 'editor-page.js');
const aliases = [
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
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
    }))()`);
    throw new Error(`等待${label}超时：${JSON.stringify(state)}`);
  };
  const click = async (selector) => {
    const point = await evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
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
  try {
    await request('Runtime.enable');
    await waitFor(`document.querySelector('#fileName')?.textContent === 'showcase.pptx'
      && document.querySelector('#documentKind')?.textContent === 'PPTX · 可编辑'
      && !document.querySelector('#editorApp')?.dataset.loading`, '默认文稿就绪');
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
  console.log(`\n\x1b[32m✓ 官网 .ppt 转换闭环通过（下载 ${result.bytes} bytes）\x1b[0m`);
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
