import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import WebSocket from 'ws';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 每个样本使用独立浏览器进程和空缓存，避免扩展注册状态污染冷加载测量。 */
export async function withChartBrowser(root, run) {
  const executable = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
  if (!executable) throw new Error('找不到 Chrome/Chromium；请设置 CHROME_BIN');
  const profile = mkdtempSync(join(tmpdir(), 'web-ppt-chart-cost-'));
  const server = createServer((request, response) => {
    try {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><link rel="icon" href="data:,">'
          + '<title>共享图表浏览器测量</title><style>.mount{width:640px;height:360px;display:inline-block}</style>'
          + '<div id="first" class="mount"></div><div id="last" class="mount"></div>'); return;
      }
      const path = resolve(root, `.${decodeURIComponent(pathname)}`);
      if (!path.startsWith(resolve(root) + sep)) throw new Error('路径越界');
      const bytes = readFileSync(path), script = ['.js', '.mjs'].includes(extname(path));
      response.writeHead(200, { 'content-type': script ? 'text/javascript' : 'application/octet-stream',
        'cache-control': 'no-store', ...(script ? { 'content-encoding': 'gzip' } : {}) }).end(script ? gzipSync(bytes) : bytes);
    } catch { response.writeHead(404).end(); }
  });
  let child, socket, serial = 0;
  const pageErrors = [];
  const browserLogs = [];
  const pending = new Map();
  try {
    const address = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address())));
    const url = `http://127.0.0.1:${address.port}/`;
    const port = await new Promise((resolve, reject) => {
      child = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--enable-precise-memory-info', `--user-data-dir=${profile}`, '--remote-debugging-port=0', url], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      const timer = setTimeout(() => reject(new Error('Chrome 启动超时')), 10000);
      child.stderr.on('data', bytes => {
        stderr += bytes.toString(); const match = stderr.match(/DevTools listening on ws:\/\/[^:]+:(\d+)/);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); reject(new Error(`Chrome 提前退出 ${code}`)); });
    });
    let target;
    for (let attempt = 0; attempt < 100 && !target; attempt++) {
      target = (await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()))
        .find(item => item.type === 'page' && item.url === url);
      if (!target) await delay(50);
    }
    if (!target) throw new Error('没有测量页面');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const rejectAll = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
    socket.on('error', rejectAll); socket.on('close', () => rejectAll(new Error('DevTools 连接关闭')));
    socket.on('message', bytes => {
      const message = JSON.parse(bytes.toString());
      if (message.method === 'Log.entryAdded') browserLogs.push(message.params.entry);
      if (message.method === 'Runtime.exceptionThrown') pageErrors.push({ type: 'exception', details: message.params.exceptionDetails });
      if (message.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(message.params.type)) {
        pageErrors.push({ type: message.params.type, args: message.params.args, stackTrace: message.params.stackTrace });
      }
      const item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    });
    const request = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)); }, 60000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      try {
        const response = await request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? '测量脚本失败');
        if (pageErrors.length) throw new Error('测量页面出现未处理异常或 console error');
        return response.result?.value;
      } catch (error) { throw Object.assign(error, { expression, pageErrors: [...pageErrors] }); }
    };
    await request('Runtime.enable'); await request('Network.enable'); await request('Log.enable');
    await request('Network.setCacheDisabled', { cacheDisabled: true });
    await request('Emulation.setDeviceMetricsOverride', { width: 1360, height: 800, deviceScaleFactor: 1, mobile: false });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`)) break;
      if (attempt === 99) throw new Error('测量页面未就绪');
      await delay(50);
    }
    return await run({ evaluate, request, pageErrors, browserLogs, version: await request('Browser.getVersion') });
  } finally {
    socket?.close();
    for (const item of pending.values()) clearTimeout(item.timer);
    const running = () => child && child.exitCode === null && child.signalCode === null;
    const waitExit = ms => Promise.race([new Promise(resolve => child.once('close', resolve)), delay(ms)]);
    if (running()) { child.kill('SIGTERM'); await waitExit(2000); }
    if (running()) { child.kill('SIGKILL'); await waitExit(2000); }
    child?.stderr?.destroy(); child?.unref();
    if (!running()) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
