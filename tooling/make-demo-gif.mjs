/**
 * 录 README 用的演示 GIF。
 *
 *   npm run demo-gif
 *
 * 为什么要脚本而不是手录：录屏是一次性产物，引擎一改就过期，而且没人知道
 * 当初录的是哪个版本、哪一份文件。这里录的是 `fixtures/showcase.pptx`——
 * 仓库自己生成的确定性样本，改了渲染重跑一遍就是新的，和 fixture / og 图
 * 同一个路子。
 *
 * 零新依赖：Node 24 自带 WebSocket，直接说 CDP 驱动本机 Chrome，不引
 * puppeteer / playwright。合成交给 ffmpeg（`brew install ffmpeg`）。
 *
 * 抓帧用 `Page.startScreencast` 而不是逐帧 `captureScreenshot`：前者由渲染器
 * 在真实合成时机推帧并带时间戳，动画的节奏是真的；后者每帧几十毫秒，边截边
 * 播只会截出一串抖动的残帧。静止时不产帧，所以停顿是靠时间戳重采样补出来的，
 * 不占抓取成本。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── 参数 ─────────────────────────────────────── */

const DECK = 'fixtures/showcase.pptx';
const OUT = join(root, 'docs/demo.gif');
/** 输出宽度。GitHub 的 README 正文栏约 900px，再宽只是白白撑大文件 */
const W = 900;
const H = Math.round((W * 9) / 16);
/** 抓帧按 2 倍分辨率，缩回来字才不糊；GIF 调色板本来就吃不下太多细节 */
const SCALE = 2;
const FPS = 12;
/** 调色板上限。幻灯片是大片平色，128 色肉眼看不出差别，文件却小一大截 */
const COLORS = 128;

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/**
 * 分镜。`hold` 是这一步之后停多久（毫秒）——切换与入场动画本身还要时间，
 * 停顿是留给人看清的。
 *
 * 挑页的理由：第 1 页是 144 个预设形状，一眼就能看出覆盖面；中间三页各挑一
 * 类能力；最后一页专门用来逐批播动画——这条是竞品都没有的，必须让人看见。
 */
const STORY = [
  { act: 'goTo', arg: 0, hold: 1700 },  // 预设形状库（144 个）
  { act: 'next', hold: 1400 },          // 效果 · 填充（带切换效果）
  { act: 'goTo', arg: 3, hold: 1500 },  // 文字特性
  { act: 'goTo', arg: 5, hold: 1500 },  // 自定义几何 · 组合嵌套 · 调节值
  { act: 'goTo', arg: 6, hold: 900 },   // 立体效果 · 动画
  { act: 'animAll', hold: 700 },        // 逐批推进动画，每批之间停一下
  { act: 'hold', hold: 1800 },          // 收尾，留一拍再循环
];

/* ── 静态服务器 ───────────────────────────────── */

const MIME = {
  '.js': 'text/javascript',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
};

const HARNESS = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;background:#fff;overflow:hidden}
  #stage{width:${W}px;height:${H}px;position:relative;overflow:hidden}
  #stage svg{width:100%;height:100%;display:block}
</style>
<div id="stage"></div>
<script type="importmap">
{"imports":{
  "@web-ppt/core":"/packages/core/dist/core.js",
  "@web-ppt/viewer-core":"/packages/viewer-core/dist/viewer-core.js"
}}
</script>
<script type="module">
import { parse } from '@web-ppt/core';
import { Viewer } from '@web-ppt/viewer-core';
const bytes = await (await fetch(new URLSearchParams(location.search).get('file'))).arrayBuffer();
const pres = await parse(bytes);
const v = new Viewer(document.getElementById('stage'), pres);
v.setAnimate(true);          // 不开就没有切换效果，也不会按批次分动画
window.__v = v;
window.__ready = true;
</script>`;

function serve() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__harness.html') {
      res.setHeader('content-type', MIME['.html']);
      return res.end(HARNESS);
    }
    const file = join(root, path);
    // 只服务仓库内的文件；路径穿越直接拒
    if (!file.startsWith(root) || !existsSync(file)) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* ── CDP ──────────────────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome(port) {
  const bin = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!bin) throw new Error(`未找到 Chrome。装一个，或把路径加进 CHROME_CANDIDATES`);
  const profile = mkdtempSync(join(tmpdir(), 'webppt-gif-'));
  const proc = spawn(bin, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--disable-gpu',
    // 无头下默认会按省电策略降帧，动画会被抽稀
    '--disable-features=CalculateNativeWinOcclusion',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ], { stdio: 'ignore' });

  for (let i = 0; i < 80; i++) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      return { proc, profile, ws: v.webSocketDebuggerUrl, version: v.Browser };
    } catch { await sleep(250); }
  }
  proc.kill();
  throw new Error('Chrome 起不来');
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { ws, ready, send, on: (fn) => listeners.push(fn) };
}

/* ── 主流程 ───────────────────────────────────── */

if (!existsSync(join(root, 'packages/core/dist/core.js'))) {
  console.error('先 npm run build —— 录制用的是构建产物，不是源码');
  process.exit(1);
}

const server = await serve();
const port = server.address().port;
const chrome = await launchChrome(9422);
console.log(`Chrome: ${chrome.version}`);

const cdp = connect(chrome.ws);
await cdp.ready;

const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
const call = (method, params) => cdp.send(method, params, sessionId);

await call('Page.enable');
await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: SCALE, mobile: false,
});

await call('Page.navigate', { url: `http://127.0.0.1:${port}/__harness.html?file=/${DECK}` });

const evaluate = async (expression) =>
  (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;

let ready = false;
for (let i = 0; i < 160 && !ready; i++) {
  ready = (await evaluate('window.__ready === true')) === true;
  if (!ready) await sleep(200);
}
if (!ready) throw new Error('样本没渲染出来');
console.log(`样本: ${DECK}（${await evaluate('window.__v.count')} 页）`);

/* 抓帧 */
const frames = [];
cdp.on((msg) => {
  if (msg.method !== 'Page.screencastFrame' || msg.sessionId !== sessionId) return;
  frames.push({ t: msg.params.metadata.timestamp * 1000, data: msg.params.data });
  void call('Page.screencastFrameAck', { sessionId: msg.params.sessionId });
});

await call('Page.startScreencast', {
  format: 'png', maxWidth: W * SCALE, maxHeight: H * SCALE, everyNthFrame: 1,
});

for (const step of STORY) {
  if (step.act === 'goTo') await evaluate(`window.__v.goTo(${step.arg})`);
  else if (step.act === 'next') await evaluate('window.__v.next()');
  else if (step.act === 'animAll') {
    // 一批一批推，每批之间留出停顿——「按点击分批」这件事得看得出是分批的
    while (await evaluate('window.__v.hasPendingAnimation')) {
      await evaluate('window.__v.playNextAnimation()');
      await sleep(step.hold);
    }
    continue;
  }
  await sleep(step.hold);
}

await call('Page.stopScreencast');
console.log(`抓到 ${frames.length} 帧`);
if (frames.length < 8) throw new Error('帧太少，八成是没播起来');

/* 按时间戳重采样成定帧率：静止时不产帧，靠这一步把停顿补回来 */
const work = mkdtempSync(join(tmpdir(), 'webppt-frames-'));
const t0 = frames[0].t;
const total = frames.at(-1).t - t0;
let cursor = 0;
let n = 0;
for (let t = 0; t <= total; t += 1000 / FPS) {
  while (cursor + 1 < frames.length && frames[cursor + 1].t - t0 <= t) cursor++;
  writeFileSync(join(work, `f${String(n++).padStart(5, '0')}.png`), Buffer.from(frames[cursor].data, 'base64'));
}
console.log(`重采样 → ${n} 帧 / ${FPS}fps（${(total / 1000).toFixed(1)}s）`);

/* 合成 GIF：先统计全片调色板再套用，比逐帧自适应小得多也稳得多 */
mkdirSync(dirname(OUT), { recursive: true });
const pal = join(work, 'palette.png');
const ff = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}`))));
    p.on('error', reject);
  });
const src = join(work, 'f%05d.png');
await ff(['-framerate', String(FPS), '-i', src,
  '-vf', `scale=${W}:-1:flags=lanczos,palettegen=max_colors=${COLORS}:stats_mode=diff`, pal]);
await ff(['-framerate', String(FPS), '-i', src, '-i', pal,
  '-lavfi', `scale=${W}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
  '-loop', '0', OUT]);

const kb = Math.round(readFileSync(OUT).length / 1024);
console.log(`✓ ${OUT.replace(root + '/', '')} — ${W}×${H}, ${kb}KB`);

rmSync(work, { recursive: true, force: true });
rmSync(chrome.profile, { recursive: true, force: true });
cdp.ws.close();
chrome.proc.kill();
server.close();
process.exit(0);
