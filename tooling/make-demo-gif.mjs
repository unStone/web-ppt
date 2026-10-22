/**
 * 录 README 用的演示 GIF。
 *
 *   npm run demo-gif                     # 录全部分镜
 *   npm run demo-gif -- swiss            # 只录一份
 *   npm run demo-gif -- --stills eddi    # 每页截一张图 + 跳页按钮位置，挑分镜用
 *
 * 为什么要脚本而不是手录：录屏是一次性产物，引擎一改就过期，而且没人知道
 * 当初录的是哪个版本、哪一份文件。这里录的是官网样本库里的真实文件——
 * 同一份 `.pptx`、同一条渲染链路（见 lib/demo-gif-page.mjs），README 上看到的
 * 就是样本页里打开的样子；改了渲染重跑一遍就是新的。
 *
 * 录制页由 esbuild 从源码打包，不依赖上一次 `npm run build` 留下的 dist。
 * 零新依赖：Node 24 自带 WebSocket，直接说 CDP 驱动本机 Chrome，不引
 * puppeteer / playwright。合成交给 ffmpeg（`brew install ffmpeg`）。
 *
 * 抓帧用 `Page.startScreencast` 而不是逐帧 `captureScreenshot`：前者由渲染器
 * 在真实合成时机推帧并带时间戳，动画的节奏是真的；后者每帧几十毫秒，边截边
 * 播只会截出一串抖动的残帧。静止时不产帧，所以停顿是靠时间戳重采样补出来的，
 * 不占抓取成本。
 */
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceAliasArgs } from './lib/bundle-browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(root, 'out/demo-gif');
const SAMPLES = 'https://unstone.github.io/web-ppt-samples/samples/';

/* ── 参数 ─────────────────────────────────────── */

/** 输出宽度。GitHub 的 README 正文栏约 900px，再宽只是白白撑大文件 */
const W = 900;
/** 设备像素比。逐页截图按它出 2 倍图；screencast 实测（Chrome 155 无头）仍按 CSS 像素推帧，GIF 即为 1 倍 */
const SCALE = 2;
const FPS = 12;

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/**
 * 分镜。`hold` 是这一步之后停多久（毫秒）——切换与入场动画本身还要时间，
 * 停顿是留给人看清的；`animAll` 逐批播完当前页动画，`hold` 是每批之后的停顿。
 * `goTo` 的页码从 0 起，按跳过隐藏页之后的顺序数。
 * `click` 点当前页里指向 `slide` 页的跳页按钮，和观众在样本页里点的是同一个元素。
 *
 * `colors` 是调色板上限：大片平色的版式 128 色肉眼看不出差别，
 * 满页插画的课件压到 128 色会出明显色带。
 */
const REELS = {
  swiss: {
    sample: 'swiss-grid-systems.pptx',
    out: 'docs/demo-swiss.gif',
    colors: 128,
    // 封面 → 八条原则 → 三款字体 → 网格四类 → 16px 推导 → 数字时代 → 结尾：
    // 每页都是同一套模块网格的不同用法，连着看才看得出「网格」本身。
    // 每页一组 onBegin 入场序列，引擎还不会进页自动起播（PowerPoint 会），
    // 所以进页后点一次，整串 afterEffect 依次播完——和演示模式里点一下的效果相同
    story: [0, 3, 6, 7, 8, 11, 13].flatMap((arg) => [
      { act: 'goTo', arg, hold: 500 },
      { act: 'animAll', hold: 3600 },
    ]),
  },
  eddi: {
    sample: 'eddi-welcome-tutorial.pptx',
    out: 'docs/demo-eddi.gif',
    colors: 256,
    // 整份课件没有一次「下一页」，全靠按钮跳页导航：JOIN → 开场 → 课程 → 工作台，
    // 再从「工具与材料」总览点进邮件说明、点返回、再点进疫情统计
    story: [
      { act: 'goTo', arg: 0, hold: 1600 },
      { act: 'click', slide: 2, hold: 1800 },
      { act: 'click', slide: 3, hold: 1800 },
      { act: 'click', slide: 8, hold: 1800 },
      { act: 'click', slide: 9, hold: 1800 },
      { act: 'goTo', arg: 11, hold: 1600 },
      { act: 'click', slide: 13, hold: 1800 },
      { act: 'click', slide: 12, hold: 1400 },
      { act: 'click', slide: 22, hold: 2200 },
    ],
  },
};

/* ── 命令行 ───────────────────────────────────── */

const argv = process.argv.slice(2);
const stills = argv.includes('--stills');
const names = argv.filter((a) => !a.startsWith('--'));
for (const name of names) {
  if (!REELS[name]) throw new Error(`未知分镜 ${name}，可选：${Object.keys(REELS).join(', ')}`);
}
const selected = names.length ? names : Object.keys(REELS);

/* ── 样本与录制页 ─────────────────────────────── */

/** 样本缓存在 out/（已忽略），只在缺失时下载，避免每次重录都拉几十 MB */
async function ensureSample(file) {
  const path = join(WORK, 'samples', file);
  if (existsSync(path)) return path;
  const res = await fetch(SAMPLES + file);
  if (!res.ok) throw new Error(`样本 ${file} 下载失败：HTTP ${res.status}（${SAMPLES + file}）`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error(`样本 ${file} 不是 Zip 包，样本库可能改了文件名`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  console.log(`下载 ${file}（${(bytes.length / 1048576).toFixed(1)} MB）`);
  return path;
}

function bundlePage() {
  const output = join(WORK, 'page.js');
  execFileSync('npx', [
    'esbuild', join(root, 'tooling/lib/demo-gif-page.mjs'), '--bundle', '--format=esm',
    '--platform=browser', '--log-level=error', ...sourceAliasArgs(root), `--outfile=${output}`,
  ], { cwd: root, stdio: 'inherit' });
  return output;
}

const HARNESS = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;background:#fff;overflow:hidden}
  #stage{width:100vw;height:100vh;position:relative;overflow:hidden}
  #stage svg{width:100%;height:100%;display:block}
  #ring{position:fixed;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;
    border:4px solid #e5322d;box-sizing:border-box;opacity:0;pointer-events:none;z-index:9}
  #ring.on{animation:ring .7s ease-out}
  @keyframes ring{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
</style>
<div id="stage"></div><div id="ring"></div>
<script type="module" src="/page.js"></script>`;

function serve(page) {
  const MIME = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8' };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__harness.html') {
      res.setHeader('content-type', MIME['.html']);
      return res.end(HARNESS);
    }
    if (path === '/page.js') {
      res.setHeader('content-type', MIME['.js']);
      return res.end(readFileSync(page));
    }
    // 只服务缓存目录里的样本；路径穿越直接拒
    const file = join(WORK, path);
    if (!path.startsWith('/samples/') || !file.startsWith(join(WORK, 'samples')) || !existsSync(file)) {
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
  const profile = mkdtempSync(join(WORK, 'chrome-'));
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

/** 打开一份样本，返回已就绪的页面会话；视口按样本自己的宽高比定 */
async function openDeck(cdp, port, sample) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => cdp.send(method, params, sessionId);
  const evaluate = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`页面脚本出错：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value;
  };

  await call('Page.enable');
  await call('Runtime.enable');
  const errors = [];
  cdp.on((msg) => {
    if (msg.sessionId === sessionId && msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    }
  });
  await call('Emulation.setDeviceMetricsOverride', { width: W, height: Math.round((W * 9) / 16), deviceScaleFactor: SCALE, mobile: false });
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/__harness.html?file=/samples/${sample}` });

  // 几十 MB 的课件含字体下载，给足一分钟
  let ready = false;
  for (let i = 0; i < 300 && !ready && !errors.length; i++) {
    ready = (await evaluate('window.__ready === true')) === true;
    if (!ready) await sleep(200);
  }
  if (errors.length) throw new Error(`${sample} 渲染失败：${errors.join('\n')}`);
  if (!ready) throw new Error(`${sample} 一分钟内没有渲染出来`);

  const { width, height, count } = await evaluate('({ width: __demo.width, height: __demo.height, count: __demo.viewer.count })');
  const H = Math.round((W * height) / width);
  await call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
  await evaluate('__demo.viewer.refresh()');
  return { call, evaluate, sessionId, targetId, H, count };
}

/* ── 挑分镜：逐页截图 ─────────────────────────── */

async function captureStills(name, deck) {
  const dir = join(WORK, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const links = [];
  for (let i = 0; i < deck.count; i++) {
    await deck.evaluate(`(__demo.viewer.goTo(${i}), __demo.viewer.finishAnimations())`);
    await sleep(500);
    const { data } = await deck.call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(dir, `s${String(i).padStart(2, '0')}.png`), Buffer.from(data, 'base64'));
    links.push({ index: i, links: await deck.evaluate('__demo.links()') });
  }
  writeFileSync(join(dir, 'links.json'), JSON.stringify(links, null, 2));
  // 缩略图拼成一张总览，挑分镜时一眼看完
  const cols = 4;
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', join(dir, 's%02d.png'),
    '-vf', `scale=440:-1,pad=iw+8:ih+8:4:4:white,tile=${cols}x${Math.ceil(deck.count / cols)}`,
    '-frames:v', '1', join(dir, 'contact.png')]);
  console.log(`✓ ${name}: ${deck.count} 页 → ${dir.replace(root + '/', '')}/（contact.png + links.json）`);
}

/* ── 录制 ─────────────────────────────────────── */

async function record(name, reel, deck, cdp) {
  const frames = [];
  cdp.on((msg) => {
    if (msg.method !== 'Page.screencastFrame' || msg.sessionId !== deck.sessionId) return;
    void deck.call('Page.screencastFrameAck', { sessionId: msg.params.sessionId });
    const png = Buffer.from(msg.params.data, 'base64');
    frames.push({ t: msg.params.metadata.timestamp * 1000, png, w: png.readUInt32BE(16), h: png.readUInt32BE(20) });
  });

  await deck.call('Page.startScreencast', {
    format: 'png', maxWidth: W * SCALE, maxHeight: deck.H * SCALE, everyNthFrame: 1,
  });

  for (const step of reel.story) {
    if (step.act === 'goTo') await deck.evaluate(`__demo.viewer.goTo(${step.arg})`);
    else if (step.act === 'next') await deck.evaluate('__demo.viewer.next()');
    else if (step.act === 'animAll') {
      // 一批一批推，每批之间留出停顿——「按点击分批」这件事得看得出是分批的
      if (!(await deck.evaluate('__demo.viewer.hasPendingAnimation'))) throw new Error(`${name}: 当前页没有待播动画`);
      while (await deck.evaluate('__demo.viewer.hasPendingAnimation')) {
        await deck.evaluate('__demo.viewer.playNextAnimation()');
        await sleep(step.hold);
      }
      continue;
    } else if (step.act === 'click') {
      const before = await deck.evaluate('__demo.viewer.index');
      const link = (await deck.evaluate('__demo.links()')).find((l) => l.slide === String(step.slide));
      if (!link) throw new Error(`${name}: 第 ${before} 页没有指向 ${step.slide} 的跳页按钮`);
      const x = link.x + link.w / 2, y = link.y + link.h / 2;
      await deck.evaluate(`__demo.pulse(${x}, ${y})`);
      await sleep(350);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await deck.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      }
      // 点了没跳就是录了一段假交互，宁可失败
      if ((await deck.evaluate('__demo.viewer.index')) === before) throw new Error(`${name}: 点击跳页按钮后仍停在第 ${before} 页`);
    } else if (step.act !== 'hold') throw new Error(`${name}: 未知分镜动作 ${step.act}`);
    await sleep(step.hold);
  }

  await deck.call('Page.stopScreencast');
  // 视口按样本宽高比改过一次，开录时合成器可能先推一帧改之前的画面（元数据里的
  // deviceHeight 已是新值，只有像素尺寸露馅）。只丢开头这几帧；录到中途尺寸还在变，
  // 说明画面本身不稳定，直接报错。尺寸不一的帧混进去，ffmpeg 的 paletteuse 会报 Internal bug
  const size = (f) => `${f.w}×${f.h}`;
  const stable = size(frames.at(-1));
  const start = frames.findIndex((f) => size(f) === stable);
  const stray = frames.slice(start).filter((f) => size(f) !== stable);
  if (stray.length) throw new Error(`${name}: 录制中途出现 ${stray.length} 帧尺寸不是 ${stable}（如 ${size(stray[0])}）`);
  frames.splice(0, start);
  if (frames.length < 8) throw new Error(`${name}: 只抓到 ${frames.length} 帧，八成是没播起来`);

  /* 按时间戳重采样成定帧率：静止时不产帧，靠这一步把停顿补回来 */
  const work = mkdtempSync(join(WORK, 'frames-'));
  const t0 = frames[0].t;
  const total = frames.at(-1).t - t0;
  let cursor = 0;
  let n = 0;
  for (let t = 0; t <= total; t += 1000 / FPS) {
    while (cursor + 1 < frames.length && frames[cursor + 1].t - t0 <= t) cursor++;
    writeFileSync(join(work, `f${String(n++).padStart(5, '0')}.png`), frames[cursor].png);
  }

  /* 合成 GIF：先统计全片调色板再套用，比逐帧自适应小得多也稳得多。
     外加 1px 灰边：白底幻灯片放在 GitHub 的白底页面上，没有边界就和正文糊成一片 */
  const frame = `scale=${W - 2}:-1:flags=lanczos,pad=iw+2:ih+2:1:1:color=0xD0D7DE`;
  const out = join(root, reel.out);
  mkdirSync(dirname(out), { recursive: true });
  const pal = join(work, 'palette.png');
  const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  const src = join(work, 'f%05d.png');
  try {
    ff(['-framerate', String(FPS), '-i', src,
      '-vf', `${frame},palettegen=max_colors=${reel.colors}:stats_mode=diff`, pal]);
    ff(['-framerate', String(FPS), '-i', src, '-i', pal,
      '-lavfi', `${frame}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      '-loop', '0', out]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const kb = Math.round(readFileSync(out).length / 1024);
  console.log(`✓ ${reel.out} — ${reel.sample}，${W}×${deck.H}，${n} 帧 / ${(total / 1000).toFixed(1)}s，${kb}KB`);
}

/* ── 主流程 ───────────────────────────────────── */

mkdirSync(WORK, { recursive: true });
for (const name of selected) await ensureSample(REELS[name].sample);
const page = bundlePage();
const server = await serve(page);
const port = server.address().port;
const chrome = await launchChrome(9422);
console.log(`Chrome: ${chrome.version}`);
const cdp = connect(chrome.ws);
await cdp.ready;

try {
  for (const name of selected) {
    const reel = REELS[name];
    const deck = await openDeck(cdp, port, reel.sample);
    console.log(`${name}: ${reel.sample}（${deck.count} 页）`);
    if (stills) await captureStills(name, deck);
    else await record(name, reel, deck, cdp);
    await cdp.send('Target.closeTarget', { targetId: deck.targetId });
  }
} finally {
  cdp.ws.close();
  // Chrome 退出前还在写 profile，不等它退干净就删目录会撞 ENOTEMPTY
  const exited = new Promise((r) => chrome.proc.once('exit', r));
  chrome.proc.kill();
  await exited;
  server.close();
  rmSync(chrome.profile, { recursive: true, force: true });
}
