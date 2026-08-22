import { collectFonts, parse, renderSlideToSvg, setFontDecoder } from '@web-ppt/core';
import type { Presentation } from '@web-ppt/core';
import { loadFontsFor, unloadFonts } from '@web-ppt/fonts';
import { eotToTtf } from 'mtx-decompressor';
import { Viewer } from '@web-ppt/viewer-core';
import { featuredOf, fetchSamples, type Sample } from './samples-index';
import { fetchBytes, whyFailed } from './fetch-bytes';

/**
 * 接上嵌入字体解码器。
 *
 * PowerPoint 的 fntdata 是 MTX 压缩的 EOT，浏览器一个都不认；解开它需要
 * LZCOMP + CTF 重建，体积不小，所以 core 只留 hook，由用得上的一方注入。
 * 官网当然用得上——不接的话，凡是靠嵌入字体的文件全部回退成系统字体。
 */
setFontDecoder(eotToTtf);

/* ── 元素 ─────────────────────────────────────── */
const $ = <T extends Element>(sel: string): T => document.querySelector<T>(sel)!;

const demo = $<HTMLElement>('#demoRoot');
const stage = $<HTMLElement>('#stage');
const thumbs = $<HTMLElement>('#thumbs');
const pager = $<HTMLElement>('#pager');
const meta = $<HTMLElement>('#meta');
const prevBtn = $<HTMLButtonElement>('#prev');
const nextBtn = $<HTMLButtonElement>('#next');
const pick = $<HTMLInputElement>('#pick');
const stageWrap = $<HTMLElement>('#stageWrap');
const presentBtn = $<HTMLButtonElement>('#present');
const downloadLink = $<HTMLAnchorElement>('#download');
const linkToast = $<HTMLElement>('#linkToast');
const presentBar = $<HTMLElement>('#presentBar');
const pPager = $<HTMLElement>('#pPager');
const cjkBtn = $<HTMLButtonElement>('#cjkFonts');
const shareBtn = $<HTMLButtonElement>('#share');

let viewer: Viewer | null = null;
/** 当前这份文件的字节，供「下载」直接用——已经在内存里，不必再走一次网络 */
let currentUrl: string | null = null;

/* ── 载入并渲染 ───────────────────────────────── */

function setStatus(html: string, cls = ''): void {
  stage.innerHTML = `<div class="${cls}">${html}</div>`;
}

const fmtMB = (n: number): string => `${(n / 1048576).toFixed(1)}MB`;

/**
 * 下载进度。远程样本有好几 MB，走的是别人的网络，跟引擎快慢没有半点关系 ——
 * 只转个圈会让人把等待算到渲染头上，而这恰恰是本项目最不该被误解的地方。
 * 所以下载单独显示进度，计时也单独列，别和解析 / 首屏混在一起。
 */
function setProgress(got: number, total: number): void {
  const pct = total ? Math.min(100, (got / total) * 100) : 0;
  stage.innerHTML =
    `<div class="loading">` +
    `<div class="loading-label">下载中 · ${fmtMB(got)}${total ? ` / ${fmtMB(total)}` : ''}</div>` +
    `<div class="loading-bar"><i style="width:${total ? pct.toFixed(1) : 0}%"></i></div>` +
    `<div class="loading-note">下载完成后才开始解析，解析与渲染全在本地</div>` +
    `</div>`;
}

/**
 * 把当前文件挂到「下载」按钮上。
 *
 * 字节已经在内存里，直接做成 blob URL 即可——再发一次请求既慢又可能拿不到
 * （本地打开的文件根本没有地址）。旧的 URL 必须回收，否则每换一份就漏几 MB。
 */
function armDownload(bytes: ArrayBuffer, name: string): void {
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
  downloadLink.href = currentUrl;
  downloadLink.download = /\.pptx?$/i.test(name) ? name : `${name}.pptx`;
}

/** netMs 为空表示本地文件，没有下载这一段 */
async function show(bytes: ArrayBuffer, label: string, netMs?: number): Promise<void> {
  setStatus('', 'spin');
  // 让上面这帧先画出来，否则大文件解析会把「下载中」一直定在屏幕上。
  // 不能只等 rAF —— 标签页在后台时它根本不触发，await 会一直挂着；
  // 补一个定时器兜底，谁先到算谁。
  await new Promise((r) => {
    let done = false;
    const go = (): void => { if (!done) { done = true; r(null); } };
    requestAnimationFrame(go);
    setTimeout(go, 50);
  });

  const t0 = performance.now();
  let pres: Presentation;
  try {
    pres = await parse(bytes);
  } catch (e) {
    thumbs.innerHTML = '';
    setStatus(`解析失败：${e instanceof Error ? e.message : String(e)}`, 'err');
    meta.textContent = '';
    return;
  }
  const parseMs = performance.now() - t0;

  viewer?.destroy();
  stage.innerHTML = '';
  viewer = new Viewer(stage, pres, { skipHidden: true });
  // 每翻一页补一次字体：已经下过的切片是免费的，没下过的才是这一页真需要的
  viewer.onChange = () => { sync(); syncUrl(); void ensureFonts(pres); };
  // 演示时超链接照常打开；嵌在页面里时不行——第 5 页那种整页链接的封面
  // 会让任何一次点击都把人带走（orcid-ooxml-strict 就是这样）。
  viewer.onLinkClick = (href) => {
    if (presenting()) return false;
    showLinkToast(href);
    return true;
  };
  // 本地打开的文件不必再给一个「下载」——那是把人家自己的文件还回去；
  // 也没有可分享的地址，别摆一个复制出去打不开的链接
  downloadLink.hidden = netMs === undefined;
  shareBtn.hidden = netMs === undefined;
  if (netMs !== undefined) armDownload(bytes, label);

  // 地址里带的页码只认一次，之后就归查看器自己管
  if (pendingPage > 1) { viewer.goTo(Math.min(pendingPage, pres.slides.length) - 1); }
  pendingPage = 1;
  syncUrl();

  void ensureFonts(pres);

  const renderT0 = performance.now();
  buildThumbs(pres);
  sync();

  const kb = Math.round(bytes.byteLength / 1024);
  meta.textContent =
    `${label} · ${kb}KB · ${pres.slides.length} 页 · ` +
    // 秒级用 s、毫秒级用 ms：同源小文件本来就是几十毫秒，写成「0.0s」像是没测
    (netMs === undefined
      ? ''
      : `下载 ${netMs >= 1000 ? `${(netMs / 1000).toFixed(1)}s` : `${netMs.toFixed(0)}ms`} · `) +
    `解析 ${parseMs.toFixed(0)}ms · 首屏 ${(performance.now() - renderT0 + parseMs).toFixed(0)}ms`;
}

/**
 * 中文字体替换的开关，记在 localStorage 里。
 *
 * 拉丁替换（Calibri→Carlito 这类）一个字重才十几 KB 且度量兼容，没有关的理由；
 * 中文一页几百 KB，值不值得要看的人自己判断，所以只给中文做开关。
 */
const CJK_KEY = 'web-ppt:cjk-fonts';
let cjkFonts = localStorage.getItem(CJK_KEY) !== '0';

/**
 * 补齐当前页缺的字体。
 *
 * **只看当前页**。中文切片一片三十来 KB，多问一页就多几十上百 KB，而 64 页的
 * 文件里绝大多数页根本不会被翻到；翻到了再补，已下过的切片本来就是免费的。
 *
 * 字体到齐后必须**重渲当前页**：排版是同步的、加载是异步的，首帧一定是按
 * 回退字体断的行。`refresh()` 只重渲，不动页码与动画进度。
 */
async function ensureFonts(pres: Presentation): Promise<void> {
  const v = viewer;
  if (!v) return;
  const at = v.index;
  const usages = collectFonts([pres.slides[at]]);
  if (!usages.length) return;

  const done = await loadFontsFor(usages, { cjk: cjkFonts });
  // 期间换了文件或翻了页就作罢；一个都没换成替代字体也没必要重渲
  if (viewer !== v || v.index !== at || !done.some((d) => d.status === 'substituted')) return;
  v.refresh();
}

function syncCjkButton(): void {
  cjkBtn.setAttribute('aria-pressed', String(cjkFonts));
}
syncCjkButton();

cjkBtn.addEventListener('click', () => {
  cjkFonts = !cjkFonts;
  localStorage.setItem(CJK_KEY, cjkFonts ? '1' : '0');
  syncCjkButton();
  // 关掉时把已注入的中文 @font-face 撤回，页面立刻回到系统字体；
  // 已下载的字节留在 HTTP 缓存里，再打开是免费的
  if (!cjkFonts) {
    unloadFonts({ cjkOnly: true });
    viewer?.refresh();
  } else if (viewer) {
    void ensureFonts(viewer.presentation);
  }
});

function sync(): void {
  if (!viewer) return;
  pager.textContent = `${viewer.index + 1} / ${viewer.count}`;
  pPager.textContent = pager.textContent;
  prevBtn.disabled = viewer.index === 0;
  nextBtn.disabled = viewer.index === viewer.count - 1;
  thumbs.querySelectorAll('.thumb').forEach((t, i) => {
    t.classList.toggle('active', i === viewer!.index);
  });
  // 只滚缩略图栏，不要用 scrollIntoView —— 它会滚动所有可滚动祖先，
  // 包括 document 本身：首屏 Demo 一加载完就把整页往下拽一段。
  const active = thumbs.children[viewer.index] as HTMLElement | undefined;
  if (active) {
    const a = active.getBoundingClientRect();
    const box = thumbs.getBoundingClientRect();
    if (a.top < box.top) thumbs.scrollTop += a.top - box.top;
    else if (a.bottom > box.bottom) thumbs.scrollTop += a.bottom - box.bottom;
  }
}

/**
 * 缩略图虚拟化：先插占位，进入视口才真渲染。
 * 210 页的文件初始只渲 7 个 —— 和 packages/viewer 里同一套做法。
 */
function buildThumbs(pres: Presentation): void {
  thumbs.innerHTML = '';
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      io.unobserve(el);
      const i = Number(el.dataset.i);
      // 不走 slideSvg 的缓存：缩略图与主视图同时在页面上，defs id 会撞
      el.innerHTML = viewer!.renderSlide(i);
    }
  }, { root: thumbs, rootMargin: '300px 0px' });

  for (let i = 0; i < pres.slides.length; i++) {
    const el = document.createElement('div');
    el.className = 'thumb';
    el.dataset.i = String(i);
    el.dataset.n = String(i + 1);
    el.addEventListener('click', () => viewer?.goTo(i, i < viewer.index ? 'backward' : 'forward'));
    thumbs.appendChild(el);
    io.observe(el);
  }
}

async function loadUrl(src: string, label: string): Promise<void> {
  thumbs.innerHTML = '';
  setProgress(0, 0);
  meta.textContent = '下载中…';
  try {
    const { bytes, ms } = await fetchBytes(src, setProgress);
    await show(bytes, label, ms);
  } catch (e) {
    // 样本取不到是网络或样本库的事，跟引擎无关。指一条还走得通的路：
    // 本地文件的解析压根不需要网络。
    setStatus(
      `示例载入失败（${whyFailed(e)}）<br>把自己的 .pptx / .ppt 拖进来试试，解析不依赖网络。`,
      'err',
    );
    meta.textContent = '';
  }
}

/* ── 可分享地址 ───────────────────────────────── */

/**
 * 地址栏始终等于「现在正在看的东西」，复制出去就能分享。
 *
 * 参数里放的是**文件名**，不是地址：文件名只用来在两份白名单里查条目
 * （HTML 里写死的内置样本、以及已经校验过来源的远程清单），
 * 任何时候都不会去 fetch 查询串里的东西。
 */
const shareName = (src: string): string => src.slice(src.lastIndexOf('/') + 1);

/**
 * 把当前状态写回地址栏。用 replaceState：分享的是「此刻」，不该把历史堆满。
 * `page` 显式传 1 用于「刚点了另一个样本、新查看器还没建好」的时刻——
 * 这时 `viewer` 还是上一份文件的，读它的页码会写出个错的。
 */
function syncUrl(page = viewer ? viewer.index + 1 : 1): void {
  const active = document.querySelector<HTMLElement>('.samples .chip.active');
  const url = new URL(location.href);
  url.search = '';
  if (active?.dataset.src) {
    url.searchParams.set('sample', shareName(active.dataset.src));
    if (page > 1) url.searchParams.set('p', String(page)); // 首页不写，地址短一点
  }
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

shareBtn.addEventListener('click', async () => {
  // 本地拖进来的文件没有可分享的地址，按钮本身也已经隐藏，这里只做兜底
  try {
    await navigator.clipboard.writeText(location.href);
    shareBtn.textContent = '已复制';
    shareBtn.classList.add('done');
    setTimeout(() => { shareBtn.textContent = '复制链接'; shareBtn.classList.remove('done'); }, 1400);
  } catch {
    // 剪贴板被拒（非安全上下文 / 用户拒绝）：选中地址栏这件事我们做不到，
    // 至少别假装成功
    shareBtn.textContent = '复制失败';
    setTimeout(() => { shareBtn.textContent = '复制链接'; }, 1400);
  }
});

/* ── 交互 ─────────────────────────────────────── */

function selectChip(chip: HTMLElement): void {
  document.querySelectorAll('.samples .chip').forEach((c) => c.classList.remove('active'));
  chip.classList.add('active');
  syncUrl(1);
  void loadUrl(chip.dataset.src!, chip.textContent!.trim());
}

document.querySelectorAll<HTMLButtonElement>('.samples .chip').forEach((chip) => {
  chip.addEventListener('click', () => selectChip(chip));
});

prevBtn.addEventListener('click', () => viewer?.prev());
nextBtn.addEventListener('click', () => viewer?.next());

/* ── 幻灯片里的超链接 ─────────────────────────── */

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** 把误点到的链接摆出来，让人自己决定去不去，而不是直接跳走 */
function showLinkToast(href: string): void {
  linkToast.textContent = '';
  linkToast.append('这一处是超链接：');
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = href; // 外部文本，只走 textContent
  linkToast.append(a);
  linkToast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { linkToast.hidden = true; }, 6000);
}

/* ── 全屏演示 ─────────────────────────────────── */

const presenting = (): boolean => document.fullscreenElement === stageWrap;

async function enterPresent(): Promise<void> {
  if (!viewer || presenting()) return;

  // 顺序不能反：必须先切到动画初始态，再请求全屏。
  // 反过来的话，浏览器全屏放大那两三百毫秒里画面还停在静态终态，
  // 进去了才跳回第一步 —— 看着就是「先把这页演完，再从头演一遍」。
  // 演示模式才播动画：嵌在页面里时逐批点击会让翻页变得很慢。
  viewer.setAnimate(true);
  linkToast.hidden = true;
  try {
    await stageWrap.requestFullscreen();
  } catch {
    viewer.setAnimate(false); // 没进成全屏就退回静态终态，别把内嵌视图留在第 0 步
    return;
  }
  sync();
}

presentBtn.addEventListener('click', () => void enterPresent());
$<HTMLButtonElement>('#pExit').addEventListener('click', () => void document.exitFullscreen());
$<HTMLButtonElement>('#pPrev').addEventListener('click', () => viewer?.prev());
$<HTMLButtonElement>('#pNext').addEventListener('click', () => viewer?.next());

document.addEventListener('fullscreenchange', () => {
  if (presenting()) return;
  viewer?.setAnimate(false);
  sync();
});

// 鼠标停下就把控制条收起来，别挡着幻灯片
let barTimer: ReturnType<typeof setTimeout> | null = null;
stageWrap.addEventListener('mousemove', () => {
  if (!presenting()) return;
  presentBar.classList.add('show');
  if (barTimer) clearTimeout(barTimer);
  barTimer = setTimeout(() => presentBar.classList.remove('show'), 2000);
});

async function openFile(file: File): Promise<void> {
  document.querySelectorAll('.samples .chip').forEach((c) => c.classList.remove('active'));
  syncUrl(); // 本地文件分享不出去，把地址还原成干净的
  thumbs.innerHTML = '';
  setStatus('', 'spin');
  await show(await file.arrayBuffer(), file.name);
}

pick.addEventListener('change', () => {
  const f = pick.files?.[0];
  if (f) void openFile(f);
});

// 整块 demo 都是拖放目标
let dragDepth = 0;
demo.addEventListener('dragenter', (e) => { e.preventDefault(); if (++dragDepth === 1) demo.classList.add('dragging'); });
demo.addEventListener('dragover', (e) => e.preventDefault());
demo.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; demo.classList.remove('dragging'); } });
demo.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  demo.classList.remove('dragging');
  const f = e.dataTransfer?.files?.[0];
  if (f) void openFile(f);
});

// demo 在视口内时方向键翻页；全屏演示时不看位置——它已经占满屏幕了
addEventListener('keydown', (e) => {
  if (!viewer) return;
  if (!presenting()) {
    const r = demo.getBoundingClientRect();
    if (r.bottom < 80 || r.top > innerHeight - 80) return;
  }
  // 空格/回车是演示时最顺手的「下一步」，但只在全屏里接管，
  // 否则会把页面正常的滚动和按钮触发一起抢走
  const forward = e.key === 'ArrowRight' || e.key === 'PageDown'
    || (presenting() && (e.key === ' ' || e.key === 'Enter'));
  if (forward) { viewer.next(); e.preventDefault(); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { viewer.prev(); e.preventDefault(); }
});

document.querySelectorAll<HTMLButtonElement>('.copy').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(btn.dataset.copy!);
    btn.textContent = '已复制';
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('done'); }, 1400);
  });
});

/* ── 架构图 ───────────────────────────────────── */

function drawArch(): void {
  const box = (x: number, y: number, w: number, h: number, title: string, sub: string, accent = false): string => `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8"
        fill="${accent ? 'var(--accent-soft)' : 'var(--bg)'}"
        stroke="${accent ? 'var(--accent)' : 'var(--line)'}" stroke-width="1.2"/>
      <text x="${x + w / 2}" y="${y + (sub ? 25 : h / 2 + 4)}" text-anchor="middle"
        fill="${accent ? 'var(--accent)' : 'var(--fg)'}" font-size="13" font-weight="600">${title}</text>
      ${sub ? `<text x="${x + w / 2}" y="${y + 43}" text-anchor="middle"
        fill="var(--fg-faint)" font-size="10.5" font-family="var(--mono)">${sub}</text>` : ''}
    </g>`;

  const arrow = (x1: number, y1: number, x2: number, y2: number, label = ''): string => `
    <g>
      <path d="M${x1} ${y1} L${x2 - 7} ${y2}" stroke="var(--fg-faint)" stroke-width="1.2" fill="none"/>
      <path d="M${x2 - 7} ${y2 - 3.5} L${x2} ${y2} L${x2 - 7} ${y2 + 3.5}Z" fill="var(--fg-faint)"/>
      ${label ? `<text x="${(x1 + x2) / 2}" y="${y1 - 7}" text-anchor="middle"
        fill="var(--fg-faint)" font-size="10" font-family="var(--mono)">${label}</text>` : ''}
    </g>`;

  $('#archDiagram').innerHTML = `
<svg viewBox="0 0 900 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Web-PPT 架构图">
  <text x="92" y="18" text-anchor="middle" fill="var(--fg-faint)" font-size="10.5" letter-spacing=".08em">输入</text>
  ${box(20, 28, 145, 56, '.pptx', 'Zip + OOXML')}
  ${box(20, 100, 145, 56, '.ppt', 'CFB + OfficeArt')}
  ${box(20, 172, 145, 56, 'EMF / WMF / PICT', 'GDI / QuickDraw')}

  ${arrow(165, 56, 285, 90, 'fflate')}
  ${arrow(165, 128, 285, 118, 'Escher')}
  ${arrow(165, 200, 285, 146, 'GDI')}

  <text x="368" y="18" text-anchor="middle" fill="var(--fg-faint)" font-size="10.5" letter-spacing=".08em">中间表示</text>
  ${box(285, 72, 166, 92, '统一 Schema', 'types.ts', true)}
  <text x="368" y="180" text-anchor="middle" fill="var(--fg-faint)" font-size="10">与文件格式无关</text>

  ${arrow(451, 100, 570, 62)}
  ${arrow(451, 136, 570, 174)}

  <text x="647" y="18" text-anchor="middle" fill="var(--fg-faint)" font-size="10.5" letter-spacing=".08em">渲染</text>
  ${box(570, 34, 154, 56, 'HTML 文本', 'foreignObject')}
  ${box(570, 146, 154, 56, 'SVG 文本', '自实现断行')}

  ${arrow(724, 62, 790, 62)}
  ${arrow(724, 174, 790, 174)}
  ${box(790, 34, 92, 56, '预览', '可选中')}
  ${box(790, 146, 92, 56, '导出', 'PNG/PDF')}
</svg>`;
}

drawArch();

/**
 * 地址里带的文件名与页码。
 *
 * 内置样本在 HTML 写死的 chip 里就能查到，不必等远程清单；查不到才留给
 * `openRequestedSample` 去清单里找。两条都是白名单查表，不会去 fetch 查询串。
 */
const params = new URLSearchParams(location.search);
const requested = params.get('sample');
let pendingPage = Math.max(1, Math.trunc(Number(params.get('p'))) || 1);

const builtinChip = requested
  ? [...document.querySelectorAll<HTMLElement>('.samples .chip[data-src]')]
    .find((c) => shareName(c.dataset.src!) === requested)
  : undefined;

if (builtinChip) selectChip(builtinChip);
else if (requested) setStatus('', 'spin'); // 等远程清单到了再说，省一次下载和一次闪烁
else void loadUrl('demo/showcase.pptx', 'showcase.pptx');

/* ── 远程样本库 ───────────────────────────────── */

/**
 * 精选样本放在独立仓库（web-ppt-samples），官网启动后异步追加成 chip。
 *
 * 分工的理由：HTML 里静态写死的那几个是**基线** —— 与站点同源、首屏即可用、
 * 首轮抓取能看到、JS 或远程仓库出事都不影响。远程样本纯属增补，取不到就
 * 安静跳过：不弹错、不留占位，用户根本察觉不到样本库挂了。
 *
 * 示例栏只放 FEATURED 里点名的那几个。样本库会一直加，这条横栏不该跟着无限变长，
 * 大文件也不适合摆在首屏——让人为了看一眼先等几十秒是劝退的。
 * 其余的去 samples.html 挑：那儿有体积和看点，选完带着地址回来渲染。
 */
async function loadRemoteSamples(): Promise<void> {
  const bar = document.querySelector('.samples');
  if (!bar) return;

  const all = await fetchSamples();
  if (!all.length) return;

  const featured = featuredOf(all);
  for (const s of featured) {
    const chip = document.createElement('button');
    chip.className = 'chip remote';
    chip.dataset.src = s.url;
    chip.textContent = s.title; // 外部文本，只走 textContent
    if (s.highlight) chip.title = s.highlight;
    chip.addEventListener('click', () => selectChip(chip));
    bar.appendChild(chip);
  }

  const rest = all.length - featured.length;
  if (rest <= 0) return;
  const more = document.createElement('a');
  more.className = 'chip more';
  more.href = 'samples.html';
  more.textContent = `更多 ${rest} 个`;
  more.title = '样本库全部条目，逐个挑着看';
  bar.appendChild(more);

  openRequestedSample(all, bar);
}

void loadRemoteSamples();

/**
 * 从样本页点过来时带着 `?sample=<文件名>`。
 *
 * 传文件名而不是地址：地址来自查询串就是外部输入，得再校验一遍来源；
 * 文件名只用来在**已经校验过的**清单里查条目，拿不到就什么也不做。
 */
function openRequestedSample(all: Sample[], bar: Element): void {
  const hit = requested ? all.find((s) => s.file === requested) : undefined;
  if (!hit) return;

  // 精选里已经有这一个就别再摆一遍
  let chip = bar.querySelector<HTMLElement>(`.chip[data-src="${CSS.escape(hit.url)}"]`);
  if (!chip) {
    chip = document.createElement('button');
    chip.className = 'chip remote';
    chip.dataset.src = hit.url;
    chip.textContent = hit.title; // 外部文本，只走 textContent
    if (hit.highlight) chip.title = hit.highlight;
    chip.addEventListener('click', () => selectChip(chip as HTMLElement));
    bar.insertBefore(chip, bar.querySelector('.chip.more'));
  }
  selectChip(chip);
  demo.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/* ── 疑难杂症 ─────────────────────────────────── */

/**
 * 卡片骨架（标题 / 说明 / 天真做法）写死在 index.html 里，这里只把引擎渲染
 * 结果填进每张卡的 .good .pane。
 *
 * 这么分工有两个理由：首轮抓取不执行 JS，标题与说明必须在静态 HTML 里才算数；
 * JS 关掉时也还剩「天真做法」一侧可看，不至于是六个空框。
 *
 * 卡片顺序与 tooling/make-hardcases-fixture.mjs 的 CASES 一一对应，改一边要改两边。
 */
async function renderHardCases(): Promise<void> {
  const panes = document.querySelectorAll<HTMLElement>('#hardGrid .good .pane');
  if (!panes.length) return;

  try {
    const res = await fetch('demo/hardcases.pptx');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pres = await parse(await res.arrayBuffer());
    panes.forEach((host, i) => {
      const slide = pres.slides[i];
      if (slide) host.innerHTML = renderSlideToSvg(pres, slide, { textMode: 'svg' });
    });
  } catch {
    // 案例展示不该拖垮整页：取不到固件就只留天真侧，不弹错
    panes.forEach((p) => { p.textContent = '样本载入失败'; });
  }
}

void renderHardCases();
