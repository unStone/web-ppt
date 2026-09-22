import { bindCommentsTools } from './comments-tools';
import { prepareAdvancedRendering } from '@web-ppt/core/advanced-rendering';
import { prepareModernCharts } from '@web-ppt/core/modern-charts';
import { parse, presentationToPrintableHtml, slideToPng, slideToSvgFile } from '@web-ppt/core';
import { Viewer } from '@web-ppt/viewer-core';
import type { Presentation } from '@web-ppt/core';
import { bindSwipeNav } from '../../site/src/swipe-nav';
import { presentRewindKey } from '../../site/src/present-back-key';
import { bindBlankScreen } from '../../site/src/blank-screen';
import { bindSlideNumber } from '../../site/src/slide-number';
import { bindSlideEnds } from '../../site/src/slide-ends';
import { bindSlideGrid } from '../../site/src/slide-grid';
import { fetchBytes } from '../../site/src/fetch-bytes';
import { abandonPresentation, createOpenGeneration, nextOpenPaint } from '../../site/src/open-session';
import { clampOpenPage, clearOpenFileParam, clearOpenPageParam, parseOpenPage, writeOpenPageParam } from '../../site/src/open-page';
import { cancelOpenPassword, openWithPresentationPassword } from '../../site/src/password-dialog';
import { identifyOpenBytes } from '../../site/src/open-kind';
import { formatOpenFileInfo } from './open-file-info';
import { enableViewerNotes, resetViewerNotes, setViewerNotesOpen } from './viewer-notes';
import { bindViewerSearch } from './viewer-search';
import {
  describeOpenFailure,
  restoreOpenDropHint,
  showOpenCancelled,
  showOpenDownload,
  showOpenError,
  showOpenOpening,
  showOpenParsing,
} from './open-status';

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
const btnNotes = $<HTMLButtonElement>('btnNotes');
const searchInput = $<HTMLInputElement>('searchInput');
const searchHits = $('searchHits');
const zoomLabel = $('zoomLabel');
const animInfo = $('animInfo');
const presenter = $('presenter');

let viewer: Viewer | null = null;
const opens = createOpenGeneration();
let openAbort: AbortController | null = null;
const addressPage = parseOpenPage(new URLSearchParams(location.search).get('p'));
/** 只有地址驱动的那一次远程打开才回写 p。本地文件的页码不能写进还指着远程文件的地址。 */
let bindAddressPage = false;
const commentsTools = bindCommentsTools($<HTMLButtonElement>('btnComments'), () => viewer);
let pres: Presentation | null = null;
let toastTimer = 0;
let fitMode = true;
let search: ReturnType<typeof bindViewerSearch> | undefined;

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
  syncSwipeSurface();
  search?.syncHighlight();
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
  syncSwipeSurface();
  search?.syncHighlight();
}

function stepZoom(dir: 1 | -1): void {
  if (!viewer || !pres) return;
  const current = fitMode ? stageScroll.clientWidth / pres.width : viewer.zoomLevel;
  applyZoom(current * (dir > 0 ? 1.25 : 0.8));
}

// ---------- 渲染 ----------

function updateChrome(): void {
  commentsTools.sync();
  if (!viewer) return;
  enableViewerNotes(btnNotes);
  pageIndicator.textContent = `${viewer.index + 1} / ${viewer.count}`;
  thumbs.querySelectorAll('.thumb').forEach((t, i) => t.classList.toggle('active', i === viewer!.index));
  thumbs.querySelector('.thumb.active')?.scrollIntoView({ block: 'nearest' });
  notesBody.textContent = viewer.slide.notes ?? '';
  if (fitMode) applyFit();
  if (bindAddressPage) writeOpenPageParam(viewer.index + 1);
  search?.syncHighlight();
}

function abortRemoteOpen(): void {
  openAbort?.abort();
  openAbort = null;
}

function detachOpen(): void {
  commentsTools.reset();
  exitPresent();
  grid.reset();
  numbers.clear();
  blank.clear();
  cancelOpenPassword();
  search?.reset();
  resetViewerNotes(notesPanel, notesBody, btnNotes);
  viewer?.destroy();
  viewer = null;
  pres = null;
  pageIndicator.textContent = '- / -';
  thumbs.innerHTML = '';
  grid.syncChrome();
}

function beginOpen(): number {
  abortRemoteOpen();
  bindAddressPage = false;
  clearOpenPageParam();
  clearOpenFileParam();
  const token = opens.begin();
  detachOpen();
  fileInfo.textContent = '正在打开…';
  showOpenOpening(stage);
  return token;
}

function failOpen(stageError: string): void {
  showOpenError(stage, stageError);
  fileInfo.textContent = '未打开文件';
  pageIndicator.textContent = '- / -';
  grid.syncChrome();
}

async function finishOpen(data: ArrayBuffer, name: string, token: number, applyAddressPage = false): Promise<void> {
  if (!opens.isCurrent(token)) return;
  const identified = identifyOpenBytes(data);
  if (identified.kind === 'reject') {
    failOpen(identified.message);
    return;
  }
  fileInfo.textContent = '正在打开…';
  showOpenParsing(stage, data.byteLength);
  await nextOpenPaint();
  if (!opens.isCurrent(token)) return;
  try {
    await Promise.all([prepareModernCharts(data), prepareAdvancedRendering(data)]);
    if (!opens.isCurrent(token)) return;
    let parseMs = 0;
    const opened = await openWithPresentationPassword(name, async (password) => {
      const t0 = performance.now();
      const parsed = await parse(data, password === undefined ? undefined : { password });
      parseMs = Math.round(performance.now() - t0);
      return parsed;
    });
    if (!opens.isCurrent(token)) {
      abandonPresentation(opened);
      return;
    }
    if (!opened) {
      showOpenCancelled(stage, name);
      fileInfo.textContent = '未打开文件';
      pageIndicator.textContent = '- / -';
      grid.syncChrome();
      return;
    }
    const parsed = opened;
    const ms = parseMs;
    pres = parsed;
    const start = applyAddressPage ? clampOpenPage(addressPage, parsed.slides.length) - 1 : 0;

    stage.innerHTML = '';
    viewer = new Viewer(stage, parsed, {
      animate: false,
      autoAdvance: false,
      skipHidden: true,
      index: start,
    });
    bindAddressPage = applyAddressPage;
    if (!applyAddressPage) clearOpenPageParam();
    stage.dataset.openPhase = 'ready';
    blank.attach();
    blank.clear();
    viewer.onChange = updateChrome;
    viewer.onLinkClick = (href) => {
      showToast(`打开链接：${href}`, true);
      return false; // 仍交给浏览器新开标签页
    };
    viewer.onAnimStep = (done, total) => {
      animInfo.textContent = total ? `动画 ${done}/${total}` : '';
    };

    buildThumbs(parsed.slides.length);

    fileInfo.textContent = formatOpenFileInfo({
      name,
      pages: parsed.slides.length,
      width: parsed.width,
      height: parsed.height,
      parseMs: ms,
      source: parsed.source,
    });

    applyFit();
    updateChrome();
    grid.syncChrome();
    search?.enable();
  } catch (err) {
    if (!opens.isCurrent(token)) return;
    const reason = describeOpenFailure(err);
    failOpen(reason);
    showToast(reason);
    console.error(err);
  }
}

const openFile = async (file: File): Promise<void> => {
  const token = beginOpen();
  const data = await file.arrayBuffer();
  if (!opens.isCurrent(token)) return;
  await finishOpen(data, file.name, token);
};

async function openRemote(src: string, explicit: boolean): Promise<void> {
  abortRemoteOpen();
  const token = opens.tryIdleBegin();
  if (token == null) return;
  detachOpen();
  const ac = new AbortController();
  openAbort = ac;
  fileInfo.textContent = '正在下载…';
  showOpenDownload(stage, 0, 0);
  const name = decodeURIComponent(src.split('/').pop() || src);
  try {
    const { bytes } = await fetchBytes(src, (got, total) => {
      if (opens.isCurrent(token)) showOpenDownload(stage, got, total);
    }, ac.signal);
    if (!opens.isCurrent(token)) return;
    openAbort = null;
    await finishOpen(bytes, explicit ? name : `${name}（内置示例）`, token, true);
  } catch (error) {
    if (!opens.isCurrent(token) || (error instanceof DOMException && error.name === 'AbortError')) return;
    fileInfo.textContent = '未打开文件';
    pageIndicator.textContent = '- / -';
    if (!explicit) {
      restoreOpenDropHint(stage);
      return;
    }
    showOpenError(stage, `下载失败：${describeOpenFailure(error)}`);
    grid.syncChrome();
  }
}

// ---------- 缩略图（虚拟化） ----------

let thumbObserver: IntersectionObserver | null = null;
const compactBrowse = window.matchMedia('(max-width: 620px)');

function resumePendingThumbs(): void {
  // display:none 时交叉观察不触发；拉宽后必须重新 observe，否则一直是灰块
  if (!thumbObserver || compactBrowse.matches) return;
  thumbs.querySelectorAll<HTMLElement>('.thumb.pending').forEach((el) => {
    thumbObserver!.observe(el);
  });
}

function syncThumbsChrome(): void {
  thumbs.setAttribute('aria-hidden', compactBrowse.matches ? 'true' : 'false');
  resumePendingThumbs();
  grid.syncChrome();
}

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

  // IO 第一次 watch 就会回调。先滚到当前页，深链才不会先 inflate 栏顶那几页。
  const current = items[viewer?.index ?? 0];
  if (current) {
    const a = current.getBoundingClientRect();
    const box = thumbs.getBoundingClientRect();
    if (a.top < box.top) thumbs.scrollTop += a.top - box.top;
    else if (a.bottom > box.bottom) thumbs.scrollTop += a.bottom - box.bottom;
  }
  for (const it of items) thumbObserver.observe(it);
  syncThumbsChrome();
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

// ---------- 演示模式 ----------

let presenting = false;
const pvBlank = $<HTMLButtonElement>('pvBlank');
// 必须排在黑屏之前：遮罩里的 Enter 会先被吃掉，合法页码就确认不到。
const numbers = bindSlideNumber({
  host: presenter,
  presenting: () => presenting,
  keysActive: () => !grid.showing(),
  viewer: () => viewer,
  onJump: () => {
    blank.clear();
    updateChrome();
    if (presenting) renderPresenter();
  },
});
// 必须排在黑屏之前：遮罩会把 Home / End 收成「只恢复」，首尾页就跳不过去。
bindSlideEnds({
  presenting: () => presenting,
  keysActive: () => !grid.showing(),
  viewer: () => viewer,
  onJump: () => {
    blank.clear();
    updateChrome();
    if (presenting) renderPresenter();
  },
});
const blank = bindBlankScreen({
  stage,
  presenting: () => presenting,
  keysActive: () => !grid.showing(),
  button: pvBlank,
});
const grid = bindSlideGrid({
  viewer: () => viewer,
  thumbsVisible: () => !compactBrowse.matches,
  keysActive: () => true,
  browseButtons: [$<HTMLButtonElement>('btnGrid')],
  presentButtons: [$<HTMLButtonElement>('pvGrid')],
  onJump: () => {
    blank.clear();
    updateChrome();
    if (presenting) renderPresenter();
  },
});
search = bindViewerSearch({
  query: searchInput,
  hitsLabel: searchHits,
  thumbs,
  highlightRoots: () => [stage, notesBody],
  presentation: () => pres,
  viewer: () => viewer,
  presenting: () => presenting,
  onJump: () => {
    if (grid.showing()) grid.close();
    updateChrome();
    if (presenting) renderPresenter();
  },
});

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
  search?.syncHighlight();
  presenter.hidden = false;
  // 演示模式下才播放切换与元素动画
  viewer.setAnimate(true);
  numbers.clear();
  blank.clear();
  blank.attach();
  renderPresenter();
  syncSwipeSurface();
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    /* 用户可能拒绝全屏，仍保持演示布局 */
  }
}

function exitPresent(): void {
  presenting = false;
  presenter.hidden = true;
  numbers.clear();
  blank.clear();
  grid.close();
  viewer?.setAnimate(false);
  restoreStage();
  syncSwipeSurface();
  grid.syncChrome();
  search?.syncHighlight();
  if (document.fullscreenElement) void document.exitFullscreen();
}

function isViewerSwipeTarget(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  return !el.closest('a[href],button,input,select,textarea,[data-slide],.present-blank,.pv-side,.slide-grid');
}

function syncSwipeSurface(): void {
  // 放大后要留给画布平移；放映里舞台已被 CSS 适应，始终允许滑。
  stage.classList.toggle('swipe-x', presenting || fitMode);
}

bindSwipeNav({
  host: stage,
  viewer: () => viewer,
  isAdvanceTarget: isViewerSwipeTarget,
  allow: () => presenting || fitMode,
  afterChange: () => { if (presenting) renderPresenter(); },
});

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
    download(await slideToPng(viewer.presentation, viewer.slide, 2, { showComments: commentsTools.showComments }), `slide-${viewer.index + 1}.png`);
  });

const exportSvg = (): Promise<void> =>
  withToast('导出 SVG', async () => {
    if (!viewer || !pres) return;
    const svg = await slideToSvgFile(pres, viewer.slide, undefined, { showComments: commentsTools.showComments });
    download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `slide-${viewer.index + 1}.svg`);
  });

const exportPdf = (): Promise<void> =>
  withToast('生成打印视图', async () => {
    if (!pres) return;
    const html = await presentationToPrintableHtml(pres, { showComments: commentsTools.showComments });
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
btnNotes.addEventListener('click', () => {
  if (!viewer) return;
  setViewerNotesOpen(notesPanel, btnNotes, notesPanel.hidden);
  search?.syncHighlight();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
    if (search?.focusIfAllowed()) e.preventDefault();
    return;
  }
  // Find again 是浏览态的 Ctrl/⌘+G。放映、空查询、别的输入由 findAgain 拒绝，这里也不拦截。
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'g' || e.key === 'G')) {
    if (search?.findAgain(e.shiftKey ? -1 : 1)) e.preventDefault();
    return;
  }
  if (e.target instanceof HTMLInputElement) return;
  // 网页表的退格和裸 P 只在放映里走上一步。浏览态留给页面，搜索框已在上面返回。
  // Ctrl / ⌘+P 是打印，谓词不认修饰键，这里也不能 preventDefault。
  if (presenting && presentRewindKey(e)) {
    e.preventDefault();
    viewer?.prev();
    renderPresenter();
    return;
  }
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ':
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
      // 网页表写的是裸方向键。带修饰键时留给浏览器，不能退批次。
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) break;
      e.preventDefault();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') viewer?.prev();
      else viewer?.next();
      if (presenting) renderPresenter();
      break;
    case 'Home':
    case 'End':
      // 放映里的首尾页由 slide-ends 处理。冒泡到这里的是浏览态，或带修饰键的放映按键。
      if (presenting) break;
      if (e.key === 'Home') viewer?.goTo(0);
      else if (viewer) viewer.goTo(viewer.count - 1);
      break;
    case 'Enter':
      // 一次性播完本页剩余动画
      viewer?.finishAnimations();
      if (presenting) renderPresenter();
      break;
    case '+': case '=': stepZoom(1); break;
    case '-': stepZoom(-1); break;
    case '0': applyFit(); break;
    case 'n': case 'N':
      if (!viewer) return;
      btnNotes.click();
      break;
    case 'f': case 'F': void enterPresent(); break;
    case 'Escape':
      if (grid.consumeEscape()) break;
      if (presenting) {
        exitPresent();
        break;
      }
      if (!notesPanel.hidden) {
        e.preventDefault();
        setViewerNotesOpen(notesPanel, btnNotes, false);
        search?.syncHighlight();
      }
      break;
    case '/':
      if (search?.focusIfAllowed()) e.preventDefault();
      break;
  }
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && presenting) exitPresent();
});

presenter.addEventListener('click', (e) => {
  if (!presenting) return;
  const el = e.target instanceof Element ? e.target : null;
  // 侧栏、按钮、链接自己处理；点到当前页才前进
  if (!el || el.closest('a[href], button, [data-slide], .pv-side, .present-blank, .slide-grid')) return;
  viewer?.next();
  renderPresenter();
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
  syncThumbsChrome();
});
compactBrowse.addEventListener('change', syncThumbsChrome);
syncThumbsChrome();

const requestedFile = new URLSearchParams(location.search).get('file');
void openRemote(requestedFile ?? '/sample.pptx', requestedFile != null);
