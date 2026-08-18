import { parse, presentationToPrintableHtml, slideToSvgFile, slideText } from 'web-ppt';
import { Viewer } from '@web-ppt/viewer-core';
import type { Presentation } from 'web-ppt';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const stage = $('stage');
const stageScroll = $('stageScroll');
const thumbs = $('thumbs');
const fileInfo = $('fileInfo');
const pageIndicator = $('pageIndicator');
const fileInput = $<HTMLInputElement>('fileInput');
const toast = $('toast');
const notesPanel = $('notesPanel');
const notesBody = $('notesBody');
const searchInput = $<HTMLInputElement>('searchInput');
const searchHits = $('searchHits');
const zoomLabel = $('zoomLabel');
const animInfo = $('animInfo');
const presenter = $('presenter');

let viewer: Viewer | null = null;
let pres: Presentation | null = null;
let toastTimer = 0;
let fitMode = true;
let hits: number[] = [];
let hitPos = -1;

function showToast(msg: string, ok = false): void {
  toast.textContent = msg;
  toast.className = ok ? 'ok' : '';
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), ok ? 2500 : 6000);
}

// ---------- 缩放 ----------

function applyFit(): void {
  if (!pres) return;
  fitMode = true;
  stage.classList.add('fit');
  stage.style.width = '';
  stage.style.height = '';
  stage.style.aspectRatio = `${pres.width} / ${pres.height}`;
  viewer?.setZoom(1);
  zoomLabel.textContent = '适应';
}

function applyZoom(z: number): void {
  if (!pres || !viewer) return;
  fitMode = false;
  stage.classList.remove('fit');
  viewer.setZoom(z);
  stage.style.aspectRatio = '';
  stage.style.width = `${pres.width * viewer.zoomLevel}px`;
  stage.style.height = `${pres.height * viewer.zoomLevel}px`;
  zoomLabel.textContent = `${Math.round(viewer.zoomLevel * 100)}%`;
}

function stepZoom(dir: 1 | -1): void {
  if (!viewer || !pres) return;
  const current = fitMode ? stageScroll.clientWidth / pres.width : viewer.zoomLevel;
  applyZoom(current * (dir > 0 ? 1.25 : 0.8));
}

// ---------- 渲染 ----------

function updateChrome(): void {
  if (!viewer) return;
  pageIndicator.textContent = `${viewer.index + 1} / ${viewer.count}`;
  thumbs.querySelectorAll('.thumb').forEach((t, i) => t.classList.toggle('active', i === viewer!.index));
  thumbs.querySelector('.thumb.active')?.scrollIntoView({ block: 'nearest' });
  notesBody.textContent = viewer.slide.notes ?? '';
  if (fitMode) applyFit();
}

async function openData(data: ArrayBuffer, name: string): Promise<void> {
  try {
    const t0 = performance.now();
    const parsed = await parse(data);
    const ms = Math.round(performance.now() - t0);
    pres = parsed;

    viewer?.destroy();
    stage.innerHTML = '';
    viewer = new Viewer(stage, parsed, { animate: false, autoAdvance: false, skipHidden: true });
    viewer.onChange = updateChrome;
    viewer.onLinkClick = (href) => {
      showToast(`打开链接：${href}`, true);
      return false; // 仍交给浏览器新开标签页
    };
    viewer.onAnimStep = (done, total) => {
      animInfo.textContent = total ? `动画 ${done}/${total}` : '';
    };

    buildThumbs(parsed.slides.length);

    const notesCount = parsed.slides.filter((s) => s.notes).length;
    const extra = parsed.source === 'ppt' ? ' · .ppt 二进制格式' : '';
    fileInfo.textContent =
      `${name} · ${parsed.slides.length} 页 · ${parsed.width | 0}×${parsed.height | 0}px · ${ms}ms` +
      (notesCount ? ` · ${notesCount} 页有备注` : '') + extra;

    applyFit();
    updateChrome();
    runSearch();
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err));
    console.error(err);
  }
}

const openFile = async (file: File): Promise<void> => openData(await file.arrayBuffer(), file.name);

// ---------- 缩略图（虚拟化） ----------

let thumbObserver: IntersectionObserver | null = null;

/**
 * 只渲染进入视口的缩略图。
 * 全量渲染 200 页要解析全部幻灯片（惰性解析的收益会被这一步吃光），
 * 还要往 DOM 里插 200 份 SVG。改成按需渲染后，首屏只付可见的那几张。
 */
function buildThumbs(count: number): void {
  thumbObserver?.disconnect();
  thumbs.innerHTML = '';

  const ratio = pres ? `${pres.width} / ${pres.height}` : '16 / 9';
  const items: HTMLElement[] = [];

  for (let i = 0; i < count; i++) {
    const div = document.createElement('div');
    div.className = 'thumb pending';
    div.dataset.index = String(i);
    // 占位就按幻灯片宽高比撑开，布局稳定后观察器才能算准可见范围
    div.style.aspectRatio = ratio;
    div.innerHTML = `<span class="no">${i + 1}</span>`;
    div.addEventListener('click', () => viewer?.goTo(i));
    thumbs.appendChild(div);
    items.push(div);
  }

  thumbObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const div = e.target as HTMLElement;
      thumbObserver?.unobserve(div);
      renderThumb(div);
    }
  }, { root: thumbs, rootMargin: '300px 0px' });

  for (const it of items) thumbObserver.observe(it);
}

function renderThumb(div: HTMLElement): void {
  if (!viewer || !pres || !div.classList.contains('pending')) return;
  const i = Number(div.dataset.index);
  const slide = pres.slides[i];
  div.classList.remove('pending');
  div.style.aspectRatio = '';
  div.innerHTML =
    viewer.renderSlide(i) +
    `<span class="no">${i + 1}</span>` +
    (slide.hidden ? '<span class="hidden-badge">隐藏</span>' : '');
  if (slide.hidden) div.classList.add('hidden-slide');
  if (i === viewer.index) div.classList.add('active');
}

// ---------- 搜索 ----------

function runSearch(): void {
  const q = searchInput.value.trim();
  hits = [];
  hitPos = -1;
  thumbs.querySelectorAll('.thumb').forEach((t) => t.classList.remove('hit'));
  if (!q || !pres) {
    searchHits.textContent = '';
    return;
  }
  const lower = q.toLowerCase();
  pres.slides.forEach((s, i) => {
    if (slideText(s).toLowerCase().includes(lower)) hits.push(i);
  });
  searchHits.textContent = hits.length ? `${hits.length} 页` : '无结果';
  hits.forEach((i) => thumbs.children[i]?.classList.add('hit'));
  // 命中页可能还没渲染，滚动到它时再由观察器补上
  if (hits.length) {
    hitPos = 0;
    viewer?.goTo(hits[0]);
  }
}

function nextHit(): void {
  if (!hits.length) return;
  hitPos = (hitPos + 1) % hits.length;
  viewer?.goTo(hits[hitPos]);
}

// ---------- 演示模式 ----------

let presenting = false;

function renderPresenter(): void {
  if (!viewer) return;
  // 把主舞台整体移进演示视图，动画与切换都作用在同一份 DOM 上
  const holder = $('pvCurrent');
  if (stage.parentElement !== holder) holder.appendChild(stage);
  $('pvNext').innerHTML = viewer.index + 1 < viewer.count ? viewer.renderSlide(viewer.index + 1) : '';
  $('pvNotes').textContent = viewer.slide.notes ?? '';
  $('pvPage').textContent = `${viewer.index + 1} / ${viewer.count}`;
  const total = viewer.animationTotal;
  $('pvAnim').textContent = total ? `动画 ${viewer.animationDone}/${total}` : '';
}

/** 退出演示时把舞台放回主布局 */
function restoreStage(): void {
  if (stage.parentElement !== stageScroll) stageScroll.appendChild(stage);
  applyFit();
}

async function enterPresent(): Promise<void> {
  if (!viewer) return;
  presenting = true;
  presenter.hidden = false;
  // 演示模式下才播放切换与元素动画
  viewer.setAnimate(true);
  renderPresenter();
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    /* 用户可能拒绝全屏，仍保持演示布局 */
  }
}

function exitPresent(): void {
  presenting = false;
  presenter.hidden = true;
  viewer?.setAnimate(false);
  restoreStage();
  if (document.fullscreenElement) void document.exitFullscreen();
}

// ---------- 导出 ----------

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function withToast(label: string, fn: () => Promise<void>): Promise<void> {
  showToast(`正在${label}…`, true);
  try {
    await fn();
    showToast(`${label}完成`, true);
  } catch (err) {
    showToast(`${label}失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

const exportPng = (): Promise<void> =>
  withToast('导出 PNG', async () => {
    if (!viewer) return;
    download(await viewer.exportPng(2), `slide-${viewer.index + 1}.png`);
  });

const exportSvg = (): Promise<void> =>
  withToast('导出 SVG', async () => {
    if (!viewer || !pres) return;
    const svg = await slideToSvgFile(pres, viewer.slide);
    download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `slide-${viewer.index + 1}.svg`);
  });

const exportPdf = (): Promise<void> =>
  withToast('生成打印视图', async () => {
    if (!pres) return;
    const html = await presentationToPrintableHtml(pres);
    const win = window.open('', '_blank');
    if (!win) throw new Error('浏览器阻止了新窗口，请允许弹窗');
    win.document.write(html);
    win.document.close();
    win.addEventListener('load', () => win.print());
  });

// ---------- 事件 ----------

$('btnOpen').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files?.[0]) void openFile(fileInput.files[0]);
});
$('btnPrev').addEventListener('click', () => viewer?.prev());
$('btnNext').addEventListener('click', () => viewer?.next());
$('btnZoomIn').addEventListener('click', () => stepZoom(1));
$('btnZoomOut').addEventListener('click', () => stepZoom(-1));
$('btnFit').addEventListener('click', applyFit);
$('btnExportPng').addEventListener('click', () => void exportPng());
$('btnExportSvg').addEventListener('click', () => void exportSvg());
$('btnExportPdf').addEventListener('click', () => void exportPdf());
$('btnPresent').addEventListener('click', () => void enterPresent());
$('pvExit').addEventListener('click', exitPresent);
$('btnNotes').addEventListener('click', () => {
  notesPanel.hidden = !notesPanel.hidden;
  $('btnNotes').classList.toggle('active', !notesPanel.hidden);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (hits.length) nextHit();
    else runSearch();
  }
});
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, 250);
});
let searchTimer = 0;

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ':
      e.preventDefault();
      viewer?.next();
      if (presenting) renderPresenter();
      break;
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
      e.preventDefault();
      viewer?.prev();
      if (presenting) renderPresenter();
      break;
    case 'Home': viewer?.goTo(0); break;
    case 'Enter':
      // 一次性播完本页剩余动画
      viewer?.finishAnimations();
      if (presenting) renderPresenter();
      break;
    case 'End': if (viewer) viewer.goTo(viewer.count - 1); break;
    case '+': case '=': stepZoom(1); break;
    case '-': stepZoom(-1); break;
    case '0': applyFit(); break;
    case 'n': case 'N': $('btnNotes').click(); break;
    case 'f': case 'F': void enterPresent(); break;
    case 'Escape': if (presenting) exitPresent(); break;
    case '/': e.preventDefault(); searchInput.focus(); break;
  }
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && presenting) exitPresent();
});

// Ctrl/Cmd + 滚轮缩放
stageScroll.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  stepZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dragging');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const file = e.dataTransfer?.files?.[0];
  if (file) void openFile(file);
});

window.addEventListener('resize', () => {
  if (fitMode) applyFit();
});

// 启动时加载 ?file= 指定文件，否则加载内置示例
void (async () => {
  const target = new URLSearchParams(location.search).get('file') ?? '/sample.pptx';
  try {
    const res = await fetch(target);
    if (res.ok) await openData(await res.arrayBuffer(), `${target.split('/').pop()}（内置示例）`);
    else {
      const hint = document.querySelector('#dropHint small');
      if (hint) hint.textContent = '';
    }
  } catch {
    /* 无示例文件时静默 */
  }
})();
