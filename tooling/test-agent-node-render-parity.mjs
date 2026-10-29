/**
 * Agent 003：浏览器原生路径与 Node 注入路径的整页 SVG 指纹对照。
 *
 *   node tooling/test-agent-node-render-parity.mjs [--dist]
 *
 * 「同一字体」的实现：仓库样本字体字节（latin / latin-bold / chinese，斜体为
 * 运行时翻转 OS/2 fsSelection 与 head macStyle 派生的同度量声明）在浏览器经
 * FontFace、在 Node 经 fonts Provider 注册为同一字族，全部 run 的字体栈改写为该
 * 字族——两端唯一的剩余变量就是测字来源（浏览器 canvas vs Node HarfBuzz）。
 *
 * 对照口径与票据一致：资源按实际字节寻址、同一 idPrefix；差异页必须归因
 * （公式布局的测量源不同 / 艺术字 textPath 的字间距对测量微差的放大），
 * 缺字固件不满足「同一字体」前提，跳过并计数。
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { countedAssert } from './lib/counted-assert.mjs';
import { fontSample } from './lib/font-glyph-samples.mjs';
import { waitForDevToolsPort } from './lib/chrome-devtools-launch.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'out/agent-node-render');
mkdirSync(out, { recursive: true });
const { assert, record } = countedAssert('agentNodeParity');
const dist = process.argv.includes('--dist');

/** 斜体声明：同度量克隆，只翻转 OS/2 fsSelection 与 head macStyle 的 italic 位。 */
function italicDeclared(bytes) {
  const clone = new Uint8Array(bytes);
  const view = new DataView(clone.buffer);
  const numTables = view.getUint16(4);
  const table = (tag) => {
    for (let i = 0; i < numTables; i++) {
      const record = 12 + i * 16;
      if (String.fromCharCode(...clone.subarray(record, record + 4)) === tag) return view.getUint32(record + 8);
    }
    throw new Error(`样本字体缺少 ${tag} 表`);
  };
  view.setUint16(table('OS/2') + 62, view.getUint16(table('OS/2') + 62) | 0x1);
  view.setUint16(table('head') + 44, view.getUint16(table('head') + 44) | 0x1);
  return clone;
}

const FACES = {
  latin: { bytes: fontSample('latin.ttf'), family: 'AgentParityLatin', weight: '400', style: 'normal' },
  bold: { bytes: fontSample('latin-bold.ttf'), family: 'AgentParityLatin', weight: '700', style: 'normal' },
  italic: { bytes: italicDeclared(fontSample('latin.ttf')), family: 'AgentParityLatin', weight: '400', style: 'italic' },
  boldItalic: { bytes: italicDeclared(fontSample('latin-bold.ttf')), family: 'AgentParityLatin', weight: '700', style: 'italic' },
  chinese: { bytes: fontSample('chinese.ttf'), family: 'AgentParityCJK', weight: '400', style: 'normal' },
};
const FONT_STACK = ['AgentParityCJK', 'AgentParityLatin'];
const FIXTURES = readdirSync(join(root, 'fixtures')).filter((f) => f.endsWith('.pptx') && !/encrypted/.test(f)).sort();

// ---------------- 构建两端运行时 ----------------
const bundlePath = join(out, dist ? 'parity-dist.mjs' : 'parity-source.mjs');
{
  const entry = join(out, dist ? 'parity-dist-entry.ts' : 'parity-source-entry.ts');
  writeFileSync(entry,
    `export * from '${join(root, 'packages/core/src/node-export.ts')}';\n`
    + `export * from '${join(root, 'packages/core/src/index.ts')}';\n`
    + `export * from '${join(root, 'packages/fonts/src/glyphs/index.ts')}';\n`
    + `export * from '${join(root, 'packages/fonts/src/glyphs/harfbuzz.ts')}';\n`);
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=node', '--log-level=warning', `--outfile=${bundlePath}`],
    { cwd: root, stdio: 'inherit' });
}
const browserBundle = join(out, 'parity-browser.mjs');
{
  const entry = join(out, 'parity-browser-entry.ts');
  writeFileSync(entry, `export * from '${join(root, 'packages/core/src/index.ts')}';\n`);
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=browser', '--log-level=warning', `--outfile=${browserBundle}`],
    { cwd: root, stdio: 'inherit' });
}

const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const serve = (bytes, mime) => { res.writeHead(200, { 'content-type': mime }); res.end(bytes); };
  if (path === '/parity.html') return serve('<!doctype html><meta charset="utf-8">', 'text/html; charset=utf-8');
  if (path === '/bundle.mjs') return serve(readFileSync(browserBundle), 'text/javascript');
  if (path.startsWith('/font/')) {
    const face = FACES[path.slice('/font/'.length)];
    return face ? serve(face.bytes, 'font/ttf') : (res.writeHead(404), res.end());
  }
  if (path.startsWith('/fixture/')) {
    try { return serve(readFileSync(join(root, 'fixtures', path.slice('/fixture/'.length))), 'application/octet-stream'); }
    catch { res.writeHead(404); return res.end(); }
  }
  res.writeHead(404); res.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const browserBinary = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
].filter(Boolean).find((candidate) => existsSync(candidate));
if (!browserBinary) throw new Error('找不到 Chrome/Chromium；可通过 CHROME_BIN 指定真实浏览器');

const profile = mkdtempSync(join(tmpdir(), 'agent-parity-'));
const child = spawn(browserBinary, [
  '--headless=new', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`,
  '--remote-debugging-port=0', `http://127.0.0.1:${port}/parity.html`,
], { stdio: ['ignore', 'ignore', 'ignore'] });
try {
  const devtools = await waitForDevToolsPort({ profile, isRunning: () => child.exitCode === null });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await fetch(`http://127.0.0.1:${devtools}/json/list`).then((r) => r.json())).find((t) => t.type === 'page'); }
    catch { /* DevTools 端口就绪前重试 */ }
    if (!target) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!target) throw new Error('Chrome 没有创建对照页面');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
  let serial = 0;
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => reject(new Error(`Chrome DevTools ${method} 请求超时`)), 180_000);
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      message.error ? reject(new Error(message.error.message)) : resolve(message);
    };
    socket.addEventListener('message', onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.result?.exceptionDetails) {
      throw new Error(`对照页面脚本失败：${response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text}`);
    }
    return response.result?.result?.value;
  };
  await new Promise((resolve) => {
    socket.addEventListener('message', (event) => {
      if (JSON.parse(event.data).method === 'Page.loadEventFired') resolve();
    });
    void request('Page.enable');
    void request('Page.navigate', { url: `http://127.0.0.1:${port}/parity.html` });
    setTimeout(resolve, 5000);
  });

  const faceMeta = JSON.stringify(Object.fromEntries(Object.entries(FACES)
    .map(([key, face]) => [key, { family: face.family, weight: face.weight, style: face.style }])));
  const loaded = await evaluate(`(async () => {
    const core = await import('http://127.0.0.1:${port}/bundle.mjs');
    await Promise.all(Object.entries(${faceMeta}).map(async ([key, meta]) => {
      const face = new FontFace(meta.family, await (await fetch('/font/' + key)).arrayBuffer(),
        { weight: meta.weight, style: meta.style });
      await face.load();
      document.fonts.add(face);
    }));
    await document.fonts.ready;
    window.__parity = async (name) => {
      const bytes = new Uint8Array(await (await fetch('/fixture/' + name)).arrayBuffer());
      const pres = await core.parse(bytes, { keepPackage: true, lazy: false });
      const rewrite = (body) => { for (const p of body.paragraphs) for (const r of p.runs) r.fonts = ['${FONT_STACK[0]}', '${FONT_STACK[1]}']; };
      const pages = [];
      for (const slide of pres.slides) {
        for (const el of slide.elements) if (el.kind === 'shape' && el.text) rewrite(el.text);
        let svg = core.renderSlideToSvg(pres, slide, { textMode: 'svg', idPrefix: 'parity' });
        for (const [url, asset] of Object.entries(pres.package.assets ?? {})) {
          let binary = '';
          for (let o = 0; o < asset.bytes.length; o += 0x8000) binary += String.fromCharCode(...asset.bytes.subarray(o, o + 0x8000));
          svg = svg.replaceAll(url, 'data:' + asset.mime + ';base64,' + btoa(binary));
        }
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(svg));
        pages.push({ sha: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
          math: svg.includes('Cambria Math'), textPath: svg.includes('<textPath') });
      }
      pres.dispose?.();
      return { pages, name };
    };
    return 'ready';
  })()`);
  assert.equal(loaded, 'ready', '对照页面字体与渲染入口就绪');

  // ---------------- Node 侧 ----------------
  const hb = await import('harfbuzzjs');
  const lib = dist
    ? { ...(await import('@web-ppt/core')), ...(await import('@web-ppt/core/node')),
      ...(await import('@web-ppt/fonts/glyphs')), ...(await import('@web-ppt/fonts/glyphs/harfbuzz')) }
    : await import(pathToFileURL(bundlePath).href);
  const { createFontProvider, withFontMeasurement } = lib;
  const provider = createFontProvider({ loadShaper: async () => lib.createHarfBuzzShaper(hb) });
  for (const [id, face] of Object.entries(FACES)) await provider.register({ id, origin: 'explicit', bytes: face.bytes }, { purpose: 'edit' });
  const faceForRun = (style, script) => {
    const key = style.b ? (style.i ? 'boldItalic' : 'bold') : (style.i ? 'italic' : 'latin');
    return script === 'cjk' || script === 'hani' ? 'chinese' : key;
  };

  async function nodeParity(name) {
    const bytes = new Uint8Array(readFileSync(join(root, 'fixtures', name)));
    const pres = await lib.parse(bytes, { keepPackage: true, lazy: false });
    const rewrite = (body) => { for (const p of body.paragraphs) for (const r of p.runs) r.fonts = [...FONT_STACK]; };
    const pages = [];
    for (const slide of pres.slides) {
      for (const el of slide.elements) if (el.kind === 'shape' && el.text) rewrite(el.text);
      const measured = await withFontMeasurement(provider, (measure) => {
        let svg = lib.renderSlideSvgInNode(pres, slide, { measureText: measure, idPrefix: 'parity' });
        for (const [url, asset] of Object.entries(pres.package.assets ?? {})) {
          svg = svg.replaceAll(url, `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString('base64')}`);
        }
        return { sha: createHash('sha256').update(svg).digest('hex'),
          math: svg.includes('Cambria Math'), textPath: svg.includes('<textPath') };
      }, { purpose: 'edit', language: 'zh', faceForRun });
      if (!measured.ok) { pres.dispose?.(); return { reason: measured.reason }; }
      pages.push(measured.value.result);
    }
    pres.dispose?.();
    return { pages };
  }

  // ---------------- 逐固件比对 ----------------
  let compared = 0, identical = 0, skippedNoFont = 0;
  const unattributed = [];
  const attributed = [];
  const pageMismatches = [];
  for (const name of FIXTURES) {
    const browser = await evaluate(`window.__parity(${JSON.stringify(name)})`);
    const node = await nodeParity(name);
    if (node.reason === 'missing-glyphs') { skippedNoFont++; continue; }
    if (node.reason) throw new Error(`${name}：Node 侧对照失败 ${node.reason}`);
    if (browser.pages.length !== node.pages.length) {
      throw new Error(`${name}：两端页数不一致（${browser.pages.length} vs ${node.pages.length}）`);
    }
    for (let i = 0; i < node.pages.length; i++) {
      compared++;
      const a = browser.pages[i], b = node.pages[i];
      if (a.sha === b.sha) { identical++; continue; }
      // 差异必须可归因：公式布局的测量源（mathMeasure 在两端不同），或艺术字
      // textPath 的字间距把测量微差放大到可见量级。
      if (a.math || b.math || a.textPath || b.textPath) attributed.push(`${name}#${i + 1}`);
      else unattributed.push(`${name}#${i + 1}`);
      pageMismatches.push(`${name}#${i + 1}`);
    }
  }
  provider.dispose();

  // 计数保持固定（不随固件数漂移）：汇总断言，细节落盘 parity.json。
  assert.ok(loaded === 'ready' && compared > 0, `对照集非空（比对 ${compared} 页）`);
  assert.equal(unattributed.length, 0, `差异页必须归因（公式测量源 / textPath 字距放大），未归因页：${unattributed.slice(0, 8).join('、')}${unattributed.length > 8 ? ' 等' : ''}`);
  assert.ok(attributed.length <= Math.ceil(compared * 0.05), `归因差异页占比异常（${attributed.length}/${compared}），需要复核测量口径`);
  writeFileSync(join(out, 'parity.json'), JSON.stringify({
    mode: dist ? 'dist' : 'source', fixtures: FIXTURES.length, skippedNoFont, compared,
    identical, attributed: attributed.length, attributedPages: attributed, pageMismatches,
  }, null, 2) + '\n');
  console.log(`Node 与浏览器原生路径指纹对照：${compared} 页中 ${identical} 页逐字节一致，`
    + `${attributed.length} 页差异均已归因（公式测量源 / textPath 字距放大），${skippedNoFont} 份固件因注入字体缺字不满足同一字体前提`);
  record();
} finally {
  child.kill();
  server.close();
}
