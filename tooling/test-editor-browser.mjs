/** jsdom 不含布局与浏览器 SVG 实现；票据的上屏预算必须在真实引擎里取证。 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const browser = candidates.find((candidate) => existsSync(candidate));
if (!browser) throw new Error('找不到 Chrome/Chromium；可通过 CHROME_BIN 指定真实浏览器');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const file = resolve(root, `.${pathname}`);
    if (!file.startsWith(`${resolve(root)}${sep}`) || !statSync(file).isFile()) throw new Error('not found');
    response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  } catch {
    response.writeHead(404).end('Not found');
  }
});

let address;
let profile;
let child;
let diagnostics = '';
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function launch(url) {
  return new Promise((resolveLaunch, reject) => {
    child = spawn(browser, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--user-data-dir=${profile}`, '--remote-debugging-port=0', url,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const timeout = setTimeout(() => reject(new Error('Chrome DevTools 启动超时')), 10000);
    child.stderr.on('data', (chunk) => {
      diagnostics += chunk.toString('utf8');
      const match = diagnostics.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (!match) return;
      clearTimeout(timeout);
      resolveLaunch(Number(match[1]));
    });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Chrome 提前退出 ${code}`));
    });
  });
}

async function pageTarget(port, url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const target = targets.find((candidate) => candidate.type === 'page' && candidate.url === url);
      if (target) return target;
    } catch { /* DevTools 端口刚出现时可能还没开始响应。 */ }
    await delay(100);
  }
  throw new Error('Chrome 没有创建编辑契约页面');
}

async function browserResult(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.once('open', resolveOpen);
    socket.once('error', reject);
  });
  let serial = 0;
  const pending = new Map();
  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  };
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timeout);
      request.resolve(message);
    }
  });
  socket.on('error', rejectPending);
  socket.on('close', () => rejectPending(new Error('Chrome DevTools 连接提前关闭')));
  const evaluate = (expression) => new Promise((resolveEvaluation, rejectEvaluation) => {
    const id = ++serial;
    const timeout = setTimeout(() => {
      pending.delete(id);
      rejectEvaluation(new Error('Chrome DevTools 请求超时'));
    }, 5000);
    pending.set(id, { resolve: resolveEvaluation, reject: rejectEvaluation, timeout });
    socket.send(JSON.stringify({
      id, method: 'Runtime.evaluate', params: { expression, returnByValue: true },
    }));
  });
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      const response = await evaluate(`(() => {
        const report = document.querySelector('#report');
        return report ? { status: report.dataset.status ?? 'running', p95: report.dataset.p95,
          hitP95: report.dataset.hitP95, fontFaces: report.dataset.fontFaces,
          text: report.textContent } : { status: 'running' };
      })()`);
      const result = response.result?.result?.value;
      if (result?.status === 'pass' || result?.status === 'fail') return result;
      await delay(100);
    }
    throw new Error('真实浏览器编辑契约执行超时');
  } finally {
    socket.close();
  }
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

try {
  profile = mkdtempSync(join(tmpdir(), 'web-ppt-editor-browser-'));
  address = await new Promise((resolveAddress, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveAddress(server.address()));
  });
  const url = `http://127.0.0.1:${address.port}/tooling/editor-browser.html`;
  const port = await launch(url);
  const target = await pageTarget(port, url);
  const result = await browserResult(target.webSocketDebuggerUrl);
  if (result.status !== 'pass') throw new Error(`真实浏览器编辑契约未通过：${result.text}`);
  console.log(`  Chrome · 点选反馈 p95 ${result.hitP95}ms · 60 元素提交 p95 ${result.p95}ms`
    + ` · ${result.fontFaces} 个嵌入 @font-face`);
} finally {
  if (browserRunning()) {
    child.kill('SIGTERM');
    if (!await waitForBrowserExit(2000) && browserRunning()) {
      child.kill('SIGKILL');
      await waitForBrowserExit(2000);
    }
  }
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  if (browserRunning()) throw new Error(`无法停止 Chrome；为避免破坏仍在使用的目录，保留 ${profile}`);
  if (profile) rmSync(profile, { recursive: true, force: true });
}
