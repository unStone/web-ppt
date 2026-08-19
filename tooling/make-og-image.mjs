/**
 * 生成官网的社交分享卡片 packages/site/public/og.png（1200×630）。
 *
 *   node tooling/make-og-image.mjs
 *
 * 用 Chrome headless 栅格化，而不是提交一个来历不明的二进制：
 * 卡片上的数字要跟着 README 一起改，能重新生成才不会烂掉。
 * X / Facebook 都不接受 SVG 作为 og:image，所以必须出位图。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));

if (!CHROME) {
  console.log('未找到 Chrome，跳过 og.png 生成（仓库里已有的保持不变）');
  process.exit(0);
}

const W = 1200, H = 630;

// 指标与 README / 官网 hero 保持一致
const STATS = [
  ['42ms', '210 页首屏'],
  ['68KB', 'gzip 核心包'],
  ['0', '服务端依赖'],
  ['0', '框架依赖'],
];

const SANS = '-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Helvetica,sans-serif';
const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect x="0" y="0" width="${W}" height="7" fill="#e8622c"/>

  <rect x="72" y="70" width="46" height="46" rx="12" fill="#e8622c"/>
  <text x="95" y="103" text-anchor="middle" font-family="${SANS}" font-size="27" font-weight="700" fill="#fff">P</text>
  <text x="134" y="103" font-family="${SANS}" font-size="27" font-weight="650" fill="#16161a">Web-PPT</text>

  <text x="72" y="245" font-family="${SANS}" font-size="70" font-weight="700" fill="#16161a" letter-spacing="-2">纯浏览器</text>
  <text x="72" y="330" font-family="${SANS}" font-size="70" font-weight="700" fill="#16161a" letter-spacing="-2">渲染 PPT</text>
  <text x="72" y="392" font-family="${MONO}" font-size="24" fill="#5c5c66">.pptx / .ppt · 不需要后端，也不用装 Office</text>

  <g font-family="${SANS}">
${STATS.map(([n, label], i) => {
  const x = 72 + i * 190;
  return `    <text x="${x}" y="500" font-size="40" font-weight="650" fill="#e8622c">${n}</text>\n` +
         `    <text x="${x}" y="530" font-size="17" fill="#8a8a94">${label}</text>`;
}).join('\n')}
  </g>

  <g>
    <rect x="905" y="150" width="230" height="130" rx="8" fill="#fff" stroke="#e3e3e7" stroke-width="2"/>
    <rect x="921" y="170" width="90" height="9" rx="4" fill="#c9c9cf"/>
    <rect x="921" y="188" width="150" height="6" rx="3" fill="#e3e3e7"/>
    <rect x="921" y="202" width="120" height="6" rx="3" fill="#e3e3e7"/>
    <circle cx="1090" cy="245" r="24" fill="#2E75B6" opacity=".85"/>

    <rect x="880" y="255" width="230" height="130" rx="8" fill="#fff" stroke="#e3e3e7" stroke-width="2"/>
    <rect x="896" y="275" width="110" height="9" rx="4" fill="#c9c9cf"/>
    <rect x="896" y="300" width="42" height="60" rx="3" fill="#e8622c" opacity=".8"/>
    <rect x="946" y="322" width="42" height="38" rx="3" fill="#70AD47" opacity=".8"/>
    <rect x="996" y="288" width="42" height="72" rx="3" fill="#2E75B6" opacity=".8"/>

    <rect x="855" y="360" width="230" height="130" rx="8" fill="#fff" stroke="#e3e3e7" stroke-width="2"/>
    <rect x="871" y="380" width="130" height="9" rx="4" fill="#c9c9cf"/>
    <path d="M871 460 L911 424 L951 442 L991 400 L1031 416" fill="none" stroke="#e8622c"
          stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <text x="1128" y="570" text-anchor="end" font-family="${MONO}" font-size="20" fill="#8a8a94">github.com/unStone/web-ppt</text>
</svg>`;

const tmp = join(root, 'out/og');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
writeFileSync(join(tmp, 'card.html'),
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden}</style>${svg}`);

execFileSync(CHROME, [
  '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  `--window-size=${W},${H}`, `--screenshot=${join(tmp, 'og.png')}`, join(tmp, 'card.html'),
], { stdio: 'ignore', timeout: 60_000 });

const out = join(root, 'packages/site/public/og.png');
mkdirSync(dirname(out), { recursive: true });
renameSync(join(tmp, 'og.png'), out);
rmSync(tmp, { recursive: true, force: true });
console.log(`packages/site/public/og.png 已生成（${W}×${H}）`);
