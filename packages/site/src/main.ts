import { parse } from '@web-ppt/core';
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

async function show(bytes: ArrayBuffer, label: string): Promise<void> {
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
  const active = thumbs.children[viewer.index];
  active?.scrollIntoView({ block: 'nearest' });
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
  setStatus('', 'spin');
  meta.textContent = '载入中…';
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await show(await res.arrayBuffer(), label);
  } catch (e) {
    setStatus(`载入失败：${e instanceof Error ? e.message : String(e)}`, 'err');
    meta.textContent = '';
  }
}

/* ── 交互 ─────────────────────────────────────── */

document.querySelectorAll<HTMLButtonElement>('.samples .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.samples .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    void loadUrl(chip.dataset.src!, chip.textContent!.trim());
  });
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

  $('#arch').innerHTML = `
<svg viewBox="0 0 900 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Web-PPT 架构图">
  <text x="92" y="18" text-anchor="middle" fill="var(--fg-faint)" font-size="10.5" letter-spacing=".08em">输入</text>
  ${box(20, 28, 145, 56, '.pptx', 'Zip + OOXML')}
  ${box(20, 100, 145, 56, '.ppt', 'CFB + OfficeArt')}
  ${box(20, 172, 145, 56, 'EMF / WMF', 'GDI 记录流')}

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
