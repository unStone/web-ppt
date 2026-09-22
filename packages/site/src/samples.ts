import { bindCommentsTools } from './comments-tools';
import { prepareAdvancedRendering } from '@web-ppt/core/advanced-rendering';
import { prepareModernCharts } from '@web-ppt/core/modern-charts';
import { collectFonts, parse, setFontDecoder } from '@web-ppt/core';
import type { Presentation } from '@web-ppt/core';
import { loadFontsFor } from '@web-ppt/fonts';
import { eotToTtf } from 'mtx-decompressor';
import { Viewer } from '@web-ppt/viewer-core';
import { fetchBytes, whyFailed } from './fetch-bytes';
import { identifyOpenBytes, mapOpenError } from './open-kind';
import { fetchSamples, type Sample } from './samples-index';
import { languageReady, refreshSiteLinks, setAttributeText, setMessage, setSiteLink, setText } from './i18n/runtime';
import { createViewerStatus, setOpenPhase } from './viewer-status';
import { abandonPresentation, nextOpenPaint } from './open-session';
import { message } from './i18n/message';
import { bindFullscreenLanguage, moveLanguageControl, ownsViewerKey } from './i18n/controls';
import { bindCopyButton } from './copy-button';
import { presentRewindKey } from './present-back-key';
import { bindPresentMode, isPresentAdvanceTarget, presentVerticalStep } from './present-mode';
import { bindBlankScreen } from './blank-screen';
import { bindSlideNumber } from './slide-number';
import { bindSlideEnds } from './slide-ends';
import { bindSpeakerAids } from './speaker-aids';
import { bindSwipeNav } from './swipe-nav';
import { bindSlideGrid, type SlideGrid } from './slide-grid';
import { clampOpenPage, clearOpenPageParam, parseOpenPage, writeOpenPageParam } from './open-page';

/**
 * 样本页：先挑，再看。
 *
 * 不预生成缩略图，也不进页就把十几份文件全拉下来——那是几十 MB 的账，
 * 而且和「引擎有多快」毫无关系。卡片只摆文字，点了才下载、才渲染。
 * 渲染就在本页的浮层里完成，看完关掉接着挑，不用来回跳。
 */

/**
 * 接上嵌入字体解码器。
 *
 * PowerPoint 的 fntdata 是 MTX 压缩的 EOT，浏览器一个都不认；解开它需要
 * LZCOMP + CTF 重建，体积不小，所以 core 只留 hook，由用得上的一方注入。
 * 官网当然用得上——不接的话，凡是靠嵌入字体的文件全部回退成系统字体。
 */
setFontDecoder(eotToTtf);

const grid = document.querySelector<HTMLElement>('#sampleGrid')!;
// 卡片是构建时预渲染进 HTML 的（见 vite.config.ts），那种情况下占位符压根不存在
const status = document.querySelector<HTMLElement>('#sampleStatus');

/* ── 卡片 ─────────────────────────────────────── */

function card(s: Sample): HTMLElement {
  const el = document.createElement('article');
  el.className = 'sample-card';
  el.dataset.file = s.file;
  el.dataset.url = s.url;

  const h = document.createElement('h3');
  h.textContent = s.title; // 外部文本，只走 textContent
  el.append(h);

  if (s.highlight) {
    const p = document.createElement('p');
    p.className = 'sample-highlight';
    p.textContent = s.highlight;
    el.append(p);
  }

  const foot = document.createElement('div');
  foot.className = 'sample-foot';

  const open = document.createElement('button');
  open.className = 'chip act';
  setText(open, '预览');
  open.addEventListener('click', () => void openSample(s));
  foot.append(open);

  const inDemo = document.createElement('a');
  inDemo.className = 'chip';
  setSiteLink(inDemo, `./?sample=${encodeURIComponent(s.file)}`);
  setText(inDemo, '在首页打开');
  setAttributeText(inDemo, 'title', '带缩略图栏与演示的完整查看器');
  foot.append(inDemo);

  el.append(foot);

  // 授权与出处：文件是别人的，署名不能省
  const credit = document.createElement('p');
  credit.className = 'sample-credit';
  const bits: string[] = [];
  if (s.author) bits.push(s.author);
  if (s.license) bits.push(s.license);
  credit.textContent = bits.join(' · ');
  if (s.source) {
    if (bits.length) credit.append(' · ');
    const a = document.createElement('a');
    a.href = s.source;
    a.target = '_blank';
    // 出处指向不受控的第三方，收录样本不等于给对方背书
    a.rel = 'noopener noreferrer nofollow';
    setText(a, '出处');
    credit.append(a);
  }
  if (credit.textContent.trim()) el.append(credit);

  return el;
}

/* ── 预览浮层 ─────────────────────────────────── */

let viewer: Viewer | null = null;
let downloadUrl: string | null = null;
let loadGeneration = 0;

const overlay = document.createElement('div');
overlay.className = 'preview';
overlay.hidden = true;
overlay.innerHTML =
  '<div class="preview-box" role="dialog" aria-modal="true" aria-label="样本预览">' +
  '<div class="preview-bar">' +
  '<strong class="preview-title"></strong>' +
  '<div class="spacer"></div>' +
  '<span class="meta preview-meta"></span>' +
  '<button class="chip act preview-share">复制链接</button>' +
  // download 属性等预览真的拿到文件、有了 href 再补上，理由同 index.html
  '<a class="chip act preview-dl">下载</a>' +
  '<button class="chip preview-comments" type="button"></button><button class="chip preview-notes" type="button" disabled>演讲者备注</button>' +
  '<button class="chip act preview-full" disabled>演示</button>' +
  '<button class="icon preview-close" title="关闭（Esc）" aria-label="关闭">⨯</button>' +
  '</div>' +
  '<div class="stage-wrap preview-wrap"><div class="stage preview-stage"></div>' +
  '<div class="present-bar">' +
  '<button class="icon preview-p-prev" title="上一页" aria-label="上一页">‹</button>' +
  '<span class="pager preview-p-pager">— / —</span>' +
  '<button class="icon preview-p-next" title="下一页" aria-label="下一页">›</button>' +
  '<button class="icon preview-p-grid" aria-pressed="false">G</button>' +
  '<button class="icon preview-p-notes" title="演讲者备注" aria-label="演讲者备注" disabled>N</button>' +
  '<button class="icon preview-p-blank" aria-pressed="false">B</button>' +
  '<button class="icon preview-p-exit" title="退出演示（Esc）" aria-label="退出演示">⨯</button>' +
  '</div></div>' +
  '<div class="demo-foot">' +
  '<button class="icon preview-prev" title="上一页" aria-label="上一页">‹</button>' +
  '<span class="pager preview-pager">— / —</span>' +
  '<button class="icon preview-next" title="下一页" aria-label="下一页">›</button>' +
  '<button class="chip preview-grid" hidden disabled></button>' +
  '</div></div>';
document.body.append(overlay);

const q = <T extends Element>(sel: string): T => overlay.querySelector<T>(sel)!;
const pTitle = q<HTMLElement>('.preview-title');
const pMeta = q<HTMLElement>('.preview-meta');
const pStage = q<HTMLElement>('.preview-stage');
const pWrap = q<HTMLElement>('.preview-wrap');
const pPager = q<HTMLElement>('.preview-pager');
const pPresentPager = q<HTMLElement>('.preview-p-pager');
const pFull = q<HTMLButtonElement>('.preview-full');
const pDl = q<HTMLAnchorElement>('.preview-dl');
const pShare = q<HTMLButtonElement>('.preview-share');
const resetShare = bindCopyButton(pShare, () => location.href, '复制链接');
const releaseFullscreenLanguage = bindFullscreenLanguage(pWrap);
let restoreLanguage: (() => void) | undefined;
let slideGrid: SlideGrid | undefined;
const present = bindPresentMode({
  host: pWrap,
  bar: q('.present-bar'),
  viewer: () => viewer,
  consumeEscape: () => slideGrid?.consumeEscape() ?? false,
  afterChange: () => {
    if (!present.presenting()) {
      blank.clear();
      numbers.clear();
      slideGrid?.close();
    }
    syncPager(); speaker.sync(); slideGrid?.syncChrome();
  },
  onEnter: () => { numbers.clear(); blank.clear(); blank.attach(); },
});
const pBlank = q<HTMLButtonElement>('.preview-p-blank');
// 必须排在黑屏之前：遮罩里的 Enter 会先被吃掉，合法页码就确认不到。
const numbers = bindSlideNumber({
  host: pWrap,
  presenting: () => present.presenting(),
  keysActive: () => !overlay.hidden && !slideGrid?.showing(),
  viewer: () => viewer,
  onJump: () => { blank.clear(); syncPager(); speaker.sync(); },
});
// 必须排在黑屏之前：遮罩会把 Home / End 收成「只恢复」，首尾页就跳不过去。
bindSlideEnds({
  presenting: () => present.presenting(),
  keysActive: () => !overlay.hidden && !slideGrid?.showing(),
  viewer: () => viewer,
  onJump: () => { blank.clear(); syncPager(); speaker.sync(); },
});
const blank = bindBlankScreen({
  stage: pStage,
  presenting: () => present.presenting(),
  keysActive: () => !overlay.hidden && !slideGrid?.showing(),
  button: pBlank,
});
const speaker = bindSpeakerAids({
  host: pWrap,
  button: q<HTMLButtonElement>('.preview-notes'),
  presentButton: q<HTMLButtonElement>('.preview-p-notes'),
  viewer: () => viewer,
  presenting: () => present.presenting(),
  keysActive: () => !overlay.hidden && !slideGrid?.showing(),
});
slideGrid = bindSlideGrid({
  viewer: () => viewer,
  thumbsVisible: () => false,
  keysActive: () => !overlay.hidden,
  browseButtons: [q<HTMLButtonElement>('.preview-grid')],
  presentButtons: [q<HTMLButtonElement>('.preview-p-grid')],
  onJump: () => { blank.clear(); syncPager(); speaker.sync(); },
});
bindSwipeNav({
  host: pWrap,
  viewer: () => viewer,
  isAdvanceTarget: isPresentAdvanceTarget,
  afterChange: () => { syncPager(); speaker.sync(); },
});
setAttributeText(q('[role="dialog"]'), 'aria-label', '样本预览');
setText(pDl, '下载');
setText(pFull, '演示');
setAttributeText(pFull, 'title', '播放动画，能全屏就全屏');
setAttributeText(q('.preview-close'), 'title', '关闭（Esc）');
setAttributeText(q('.preview-close'), 'aria-label', '关闭');
setAttributeText(q('.preview-p-exit'), 'title', '退出演示（Esc）');
setAttributeText(q('.preview-p-exit'), 'aria-label', '退出演示');
for (const [selector, label] of [['.preview-prev', '上一页'], ['.preview-next', '下一页'], ['.preview-p-prev', '上一页'], ['.preview-p-next', '下一页']] as const) {
  setAttributeText(q(selector), 'title', label);
  setAttributeText(q(selector), 'aria-label', label);
}

const { status: setStage, progress: setProgress, parsing: setParsing } = createViewerStatus(pStage);

/**
 * 补齐当前页缺的字体，到齐后重渲。
 *
 * 只看当前页——翻到了再补，已下过的切片是免费的。与首页同一套策略，
 * 细节见 @web-ppt/fonts。
 */
async function ensureFonts(): Promise<void> {
  const v = viewer;
  if (!v) return;
  const at = v.index;
  const usages = collectFonts([v.presentation.slides[at]]);
  if (!usages.length) return;
  const done = await loadFontsFor(usages);
  if (viewer !== v || v.index !== at || !done.some((d) => d.status === 'substituted')) return;
  v.refresh();
}

const commentsButton = q<HTMLButtonElement>('.preview-comments');
setText(commentsButton, '批注');
const commentsTools = bindCommentsTools(commentsButton, () => {
  const current = viewer;
  return current ? { owner: current, slide: current.slide, presentation: () => current.presentation, name: pTitle.textContent ?? 'sample' } : null;
});

function syncPager(): void {
  commentsTools.sync();
  pFull.disabled = !viewer;
  pFull.setAttribute('aria-pressed', String(present.presenting()));
  if (!viewer) return;
  const text = `${viewer.index + 1} / ${viewer.count}`;
  pPager.textContent = text;
  pPresentPager.textContent = text;
  writeOpenPageParam(viewer.index + 1);
  refreshSiteLinks();
}

function closePreview(): void {
  loadGeneration++;
  resetShare();
  speaker.reset();
  present.exit();
  slideGrid?.reset();
  numbers.clear();
  blank.clear();
  overlay.hidden = true;
  releaseFullscreenLanguage();
  restoreLanguage?.(); restoreLanguage = undefined;
  syncUrl();
  commentsTools.reset();
  viewer?.destroy();
  viewer = null;
  pFull.disabled = true;
  pFull.removeAttribute('aria-pressed');
  if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
  pDl.hidden = true;
  pDl.removeAttribute('href');
  pDl.removeAttribute('download');
  pStage.innerHTML = '';
  setMessage(pMeta, '');
}

/**
 * 地址栏等于「正在预览哪一份、哪一页」。
 *
 * 点卡打开不能带着上一份的 p——否则新稿套用旧页码。深链那一次才保留地址里的 p。
 */
function syncUrl(file?: string, keepPage = false): void {
  const url = new URL(location.href);
  if (file) url.searchParams.set('sample', file); else url.searchParams.delete('sample');
  if (!file || !keepPage) url.searchParams.delete('p');
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (next !== current) history.replaceState(history.state, '', next);
  refreshSiteLinks();
}

async function openSample(s: Sample, applyAddressPage = false): Promise<void> {
  const requestedPage = applyAddressPage
    ? parseOpenPage(new URLSearchParams(location.search).get('p'))
    : 1;
  const generation = ++loadGeneration;
  resetShare();
  speaker.reset();
  present.exit();
  slideGrid?.reset();
  numbers.clear();
  blank.clear();
  pFull.disabled = true;
  overlay.hidden = false;
  restoreLanguage ??= moveLanguageControl(q('.preview-bar'));
  syncUrl(s.file, applyAddressPage);
  pTitle.textContent = s.title;
  setText(pMeta, '下载中…');
  pPager.textContent = '— / —';
  pDl.hidden = true;
  commentsTools.reset();
  viewer?.destroy();
  viewer = null;
  setProgress(0, 0);

  let bytes: ArrayBuffer;
  let netMs: number;
  try {
    ({ bytes, ms: netMs } = await fetchBytes(s.url, (got, total) => {
      if (generation === loadGeneration) setProgress(got, total);
    }));
  } catch (e) {
    if (generation !== loadGeneration) return;
    setStage(message('载入失败（{reason}）', { reason: whyFailed(e) }), 'err');
    setMessage(pMeta, '');
    return;
  }
  // hidden 不能区分「关闭后又打开」；每个异步出口都只允许当前预览落到 DOM。
  if (generation !== loadGeneration) return;

  const identified = identifyOpenBytes(bytes);
  if (identified.kind === 'reject') {
    if (generation !== loadGeneration) return;
    setStage(message(identified.message), 'err');
    setMessage(pMeta, '');
    return;
  }

  setParsing(bytes.byteLength);
  setText(pMeta, '解析中…');
  await nextOpenPaint();
  if (generation !== loadGeneration) return;

  const t0 = performance.now();
  let pres: Presentation;
  try {
    await Promise.all([prepareModernCharts(bytes), prepareAdvancedRendering(bytes)]);
    pres = await parse(bytes);
  } catch (e) {
    if (generation !== loadGeneration) return;
    const mapped = mapOpenError(e);
    setStage(mapped ? message(mapped) : message('解析失败：{reason}', { reason: e instanceof Error ? e.message : String(e) }), 'err');
    setMessage(pMeta, '');
    return;
  }
  const parseMs = performance.now() - t0;
  if (generation !== loadGeneration) {
    abandonPresentation(pres);
    return;
  }

  let start = 0;
  try {
    start = applyAddressPage ? clampOpenPage(requestedPage, pres.slides.length) - 1 : 0;
  } catch (e) {
    abandonPresentation(pres);
    setStage(message('解析失败：{reason}', { reason: e instanceof Error ? e.message : String(e) }), 'err');
    setMessage(pMeta, '');
    return;
  }

  pStage.innerHTML = '';
  viewer = new Viewer(pStage, pres, { skipHidden: true, index: start });
  setOpenPhase(pStage, 'ready');
  blank.attach();
  blank.clear();
  viewer.onChange = () => { syncPager(); speaker.sync(); void ensureFonts(); };
  // 浮层里点到幻灯片自带的外链会把人从站点带走，放映时才放行
  viewer.onLinkClick = () => !present.presenting();
  syncPager();
  speaker.sync();
  slideGrid?.syncChrome();

  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([bytes]));
  pDl.href = downloadUrl;
  pDl.download = s.file;
  pDl.hidden = false;

  void ensureFonts();

  setText(pMeta, '{kb}KB · {pages} 页 · 下载 {time} · 解析 {parse}ms', {
    kb: Math.round(bytes.byteLength / 1024), pages: pres.slides.length,
    time: netMs >= 1000 ? `${(netMs / 1000).toFixed(1)}s` : `${netMs.toFixed(0)}ms`, parse: parseMs.toFixed(0),
  });
}

q<HTMLButtonElement>('.preview-close').addEventListener('click', closePreview);
q<HTMLButtonElement>('.preview-prev').addEventListener('click', () => viewer?.prev());
q<HTMLButtonElement>('.preview-next').addEventListener('click', () => viewer?.next());
q<HTMLButtonElement>('.preview-p-prev').addEventListener('click', () => viewer?.prev());
q<HTMLButtonElement>('.preview-p-next').addEventListener('click', () => viewer?.next());
pFull.addEventListener('click', () => void present.enter());
q<HTMLButtonElement>('.preview-p-exit').addEventListener('click', () => present.exit());
// 点浮层的空白处关掉；点到内容区不关
overlay.addEventListener('click', (e) => { if (e.target === overlay) closePreview(); });

addEventListener('keydown', (e) => {
  if (overlay.hidden) return;
  if (e.key === 'Escape' && !present.presenting() && !document.fullscreenElement) {
    if (slideGrid?.consumeEscape()) return;
    closePreview();
    return;
  }
  if (!viewer || ownsViewerKey(e)) return;
  // 网页表写的是裸方向键。修饰键留给浏览器，不能在浮层里退批次。
  // 退格和裸 P 只在放映里认。浮层浏览仍用左右和空格翻页。Ctrl / ⌘+P 留给打印。
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  // 浮层浏览仍只认左右和空格。Down / Up 留到放映，避免盖住页面时把竖向滚动吃掉。
  const vertical = present.presenting() ? presentVerticalStep(e) : null;
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ' || vertical === 'next') {
    viewer.next(); e.preventDefault();
  }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp' || vertical === 'prev'
    || (present.presenting() && presentRewindKey(e))) {
    viewer.prev(); e.preventDefault();
  }
});

/* ── 装载清单 ─────────────────────────────────── */

/**
 * 认领构建时预渲染的卡片：接上「预览」，并把它们算作已经摆过的条目。
 *
 * 卡片本身是构建期用同一份清单、同一套字段生成的，这里不重建 DOM——重建一遍
 * 会让已经在屏幕上的东西闪一下，纯属倒退。预览要的 url / file 在 data-* 里，
 * 标题直接读 h3，所以清单拿不到时这些卡也照样能用。
 */
function adoptPrerendered(): Map<string, Sample> {
  const shown = new Map<string, Sample>();
  for (const el of grid.querySelectorAll<HTMLElement>('.sample-card[data-file]')) {
    const { file, url } = el.dataset;
    if (!file || !url) continue;
    const s: Sample = {
      url,
      file,
      title: el.querySelector('h3')?.textContent ?? file,
      highlight: '',
      author: '',
      license: '',
      source: '',
      demo: false,
    };
    shown.set(file, s);
    el.querySelector('[data-preview]')?.addEventListener('click', () => void openSample(s));
  }
  return shown;
}

async function build(): Promise<void> {
  const shown = adoptPrerendered();

  const all = await fetchSamples();
  if (!all.length && !shown.size) {
    if (status) setText(status, '样本清单暂时取不到，稍后再试；首页的内置样本不依赖它。');
    return;
  }
  status?.remove();

  // 预渲染之后样本库新增的条目，运行时补在后面；已经在页面上的不动
  for (const s of all) {
    if (shown.has(s.file)) continue;
    shown.set(s.file, s);
    grid.append(card(s));
  }

  // 带 ?sample= 进来的（别人分享的地址）直接把预览打开。
  // 参数只用来在**已校验过来源的**清单里查条目，不会去 fetch 查询串本身。
  const params = new URLSearchParams(location.search);
  const want = params.get('sample');
  const hit = want ? shown.get(want) : undefined;
  if (hit) void openSample(hit, true);
  else if (!want && params.has('p')) {
    clearOpenPageParam();
    refreshSiteLinks();
  }
}

void languageReady.then(build);
