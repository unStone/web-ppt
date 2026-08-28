/** 人为制造并行 CPU 负载，证明性能超标会先走环境受扰重测，而不是直接污染功能红灯。 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, setPriority, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

const browser = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((candidate) => existsSync(candidate));
if (!browser) throw new Error('并行负载复现找不到 Chrome/Chromium');

const running = (child) => child.exitCode === null && child.signalCode === null;
const waitForClose = (child, milliseconds) => {
  if (!running(child)) return Promise.resolve(true);
  return Promise.race([
    new Promise((resolve) => child.once('close', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), milliseconds)),
  ]);
};
const workerCount = Math.max(2, availableParallelism());
const workers = Array.from({ length: workerCount }, () => new Worker(`
  const values = new Uint32Array(65_536);
  for (;;) {
    for (let index = 0; index < values.length; index++) values[index] = values[index] + index | 0;
  }
`, { eval: true }));
const workerReady = workers.map((worker) => new Promise((resolve, reject) => {
  worker.once('online', resolve);
  worker.once('error', reject);
}));
const chromeLoads = Array.from({ length: Math.min(6, availableParallelism()) }, () => {
  const profile = mkdtempSync(join(tmpdir(), 'web-ppt-browser-load-'));
  const url = 'data:text/html,<script>let x=1;function work(){const end=performance.now()+12;'
    + 'while(performance.now()<end)x=(Math.sin(x)+Math.sqrt(x*x+1))%997;requestAnimationFrame(work)}work()</script>';
  const child = spawn(browser, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const ready = new Promise((resolve, reject) => {
    let diagnostics = '';
    const timeout = setTimeout(() => reject(new Error('负载 Chrome 启动超时')), 10_000);
    child.stderr.on('data', (chunk) => {
      diagnostics += chunk.toString('utf8');
      if (!diagnostics.includes('DevTools listening on ')) return;
      clearTimeout(timeout);
      resolve();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timeout);
      reject(new Error(`负载 Chrome 提前退出 ${code}`));
    });
  });
  return { child, profile, ready };
});

let stopPromise;
const stopLoad = () => {
  if (stopPromise) return stopPromise;
  stopPromise = (async () => {
    await Promise.all(workers.map((worker) => worker.terminate()));
    await Promise.all(chromeLoads.map(async (load) => {
      if (running(load.child)) load.child.kill('SIGTERM');
      if (!await waitForClose(load.child, 2000) && running(load.child)) {
        load.child.kill('SIGKILL');
        await waitForClose(load.child, 2000);
      }
      load.child.stderr?.destroy();
      load.child.unref();
      if (running(load.child)) throw new Error(`无法停止负载 Chrome，保留 ${load.profile}`);
      rmSync(load.profile, { recursive: true, force: true });
    }));
  })();
  return stopPromise;
};

let child;
const runContract = async () => {
  const command = process.platform === 'win32' ? process.execPath : 'nice';
  const args = process.platform === 'win32'
    ? ['tooling/test-editor-browser.mjs']
    : ['-n', '20', process.execPath, 'tooling/test-editor-browser.mjs'];
  child = spawn(command, args, {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env, WEB_PPT_PERFORMANCE_LOAD_HANDSHAKE: '1', WEB_PPT_PERFORMANCE_DEBUG: '1',
    },
  });
  if (process.platform === 'win32') {
    try { setPriority(child.pid, 19); } catch { /* Chromium 同类负载仍可复现调度竞争。 */ }
  }
  let stdout = '';
  let stderr = '';
  let sawRetry = false;
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.on('message', (message) => {
    if (message?.type !== 'web-ppt-performance-retry-ready') return;
    sawRetry = true;
    void stopLoad().then(
      () => child.connected && child.send({ type: 'web-ppt-performance-load-stopped' }),
      (error) => child.connected && child.send({
        type: 'web-ppt-performance-load-stopped', error: error instanceof Error ? error.stack : String(error),
      }),
    );
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 120_000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    return { code, sawRetry, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
};

try {
  await Promise.all([...workerReady, ...chromeLoads.map((load) => load.ready)]);
  let result;
  let round = 0;
  for (; round < 4; round++) {
    result = await runContract();
    if (result.code !== 0 || result.sawRetry) break;
  }
  if (result.code !== 0 || !result.sawRetry || !result.stdout.includes('Chrome · 点选反馈 p95')) {
    throw new Error(`并行负载复现失败：round=${round + 1} exit=${result.code} retry=${result.sawRetry}`
      + `\n${result.stderr}\n${result.stdout}`);
  }
  console.log(`  性能契约 · ${workerCount} 路计算 + ${chromeLoads.length} 个 Chromium 负载第 ${round + 1} 轮触发受扰重测，安静复测通过`);
} finally {
  if (child && running(child)) child.kill('SIGKILL');
  await stopLoad();
}
