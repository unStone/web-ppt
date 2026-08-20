import { parse, renderSlideToSvg } from '@web-ppt/core';
import type { Presentation } from '@web-ppt/core';
import { Viewer } from '@web-ppt/viewer-core';

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

let viewer: Viewer | null = null;

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
  viewer.onChange = sync;

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

function sync(): void {
  if (!viewer) return;
  pager.textContent = `${viewer.index + 1} / ${viewer.count}`;
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
    const t0 = performance.now();
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Content-Length 可能没有（分块传输）：那就只报已下载量，不画百分比
    const total = Number(res.headers.get('content-length')) || 0;
    let bytes: ArrayBuffer;

    if (!res.body) {
      bytes = await res.arrayBuffer(); // 老浏览器没有流，退回一次性读取
    } else {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let got = 0;
      let painted = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        // 每 64KB 更新一次就够了，每个分块都重排 DOM 反而拖慢下载
        if (got - painted > 65536) {
          painted = got;
          setProgress(got, total);
        }
      }
      const merged = new Uint8Array(got);
      let at = 0;
      for (const c of chunks) {
        merged.set(c, at);
        at += c.length;
      }
      bytes = merged.buffer;
    }

    await show(bytes, label, performance.now() - t0);
  } catch (e) {
    // 样本取不到是网络或样本库的事，跟引擎无关。别把 HTTP 码甩给用户，
    // 指一条还走得通的路：本地文件的解析压根不需要网络。
    const why = e instanceof TypeError ? '网络不通' : e instanceof Error ? e.message : String(e);
    setStatus(
      `示例载入失败（${why}）<br>把自己的 .pptx / .ppt 拖进来试试，解析不依赖网络。`,
      'err',
    );
    meta.textContent = '';
  }
}

/* ── 交互 ─────────────────────────────────────── */

function selectChip(chip: HTMLElement): void {
  document.querySelectorAll('.samples .chip').forEach((c) => c.classList.remove('active'));
  chip.classList.add('active');
  void loadUrl(chip.dataset.src!, chip.textContent!.trim());
}

document.querySelectorAll<HTMLButtonElement>('.samples .chip').forEach((chip) => {
  chip.addEventListener('click', () => selectChip(chip));
});

prevBtn.addEventListener('click', () => viewer?.prev());
nextBtn.addEventListener('click', () => viewer?.next());

async function openFile(file: File): Promise<void> {
  document.querySelectorAll('.samples .chip').forEach((c) => c.classList.remove('active'));
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

// demo 在视口内时方向键翻页
addEventListener('keydown', (e) => {
  if (!viewer) return;
  const r = demo.getBoundingClientRect();
  if (r.bottom < 80 || r.top > innerHeight - 80) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { viewer.next(); e.preventDefault(); }
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
void loadUrl('demo/showcase.pptx', 'showcase.pptx');

/* ── 远程样本库 ───────────────────────────────── */

/**
 * 精选样本放在独立仓库（web-ppt-samples），官网启动后异步追加成 chip。
 *
 * 分工的理由：HTML 里静态写死的那几个是**基线** —— 与站点同源、首屏即可用、
 * 首轮抓取能看到、JS 或远程仓库出事都不影响。远程样本纯属增补，取不到就
 * 安静跳过：不弹错、不留占位，用户根本察觉不到样本库挂了。
 *
 * 加新样本只改样本仓库的 index.json，官网这边一行都不用动。
 */
const SAMPLES_INDEX = 'https://unstone.github.io/web-ppt-samples/index.json';

/** 清单是别处来的数据，可以指向任意地址：把真正会去拉取的源钉死在这里 */
const SAMPLE_ORIGINS = ['https://unstone.github.io', 'https://cdn.jsdelivr.net'];
const MAX_REMOTE_SAMPLES = 24;

async function loadRemoteSamples(): Promise<void> {
  const bar = document.querySelector('.samples');
  if (!bar) return;

  let data: unknown;
  try {
    const res = await fetch(SAMPLES_INDEX);
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return; // 样本库不可达不该影响基线，静默即可
  }

  const doc = data as { base?: unknown; samples?: unknown };
  const base = typeof doc.base === 'string' ? doc.base : SAMPLES_INDEX;
  const all = Array.isArray(doc.samples) ? doc.samples : [];

  /** 清单条目 → chip；字段不合规或指向白名单外的源就返回 null */
  const makeChip = (raw: unknown): HTMLButtonElement | null => {
    const s = raw as { file?: unknown; title?: unknown; highlight?: unknown };
    if (typeof s.file !== 'string' || typeof s.title !== 'string') return null;

    let url: URL;
    try { url = new URL(s.file, base); } catch { return null; }
    if (!SAMPLE_ORIGINS.includes(url.origin)) return null;

    const chip = document.createElement('button');
    chip.className = 'chip remote';
    chip.dataset.src = url.href;
    chip.textContent = s.title; // 外部文本，只走 textContent
    if (typeof s.highlight === 'string') chip.title = s.highlight;
    chip.addEventListener('click', () => selectChip(chip));
    return chip;
  };

  // 只展示标了 demo 的精选。样本库会一直加，示例栏不该跟着无限变长；
  // 大文件也不适合默认摆在这儿 —— 让人为了看一眼先等几十秒是劝退的。
  // 整份清单一个都没标时退回全量，免得旧版清单把示例栏弄空。
  const curated = all.filter((s) => (s as { demo?: unknown }).demo === true);
  const shown = (curated.length ? curated : all).slice(0, MAX_REMOTE_SAMPLES);
  const rest = curated.length ? all.filter((s) => !curated.includes(s)) : [];

  for (const raw of shown) {
    const chip = makeChip(raw);
    if (chip) bar.appendChild(chip);
  }

  if (!rest.length) return;

  // 精选之外的不是藏起来，只是不默认占位：点开就地展开，不跳走
  const more = document.createElement('button');
  more.className = 'chip more';
  more.textContent = `更多 ${rest.length} 个`;
  more.title = '样本库里还有这些，多为大文件或风格重复的';
  more.addEventListener('click', () => {
    for (const raw of rest.slice(0, MAX_REMOTE_SAMPLES)) {
      const chip = makeChip(raw);
      if (chip) bar.insertBefore(chip, more);
    }
    more.remove();
  });
  bar.appendChild(more);
}

void loadRemoteSamples();

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
