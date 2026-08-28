import { collectFonts, parse, setFontDecoder } from '@web-ppt/core';
import type { Presentation } from '@web-ppt/core';
import { loadFontsFor } from '@web-ppt/fonts';
import { eotToTtf } from 'mtx-decompressor';
import { Viewer } from '@web-ppt/viewer-core';
import { fetchBytes, whyFailed } from './fetch-bytes';
import { fetchSamples, type Sample } from './samples-index';

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

const fmtMB = (n: number): string => `${(n / 1048576).toFixed(1)}MB`;

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
  open.textContent = '预览';
  open.addEventListener('click', () => void openSample(s));
  foot.append(open);

  const inDemo = document.createElement('a');
  inDemo.className = 'chip';
  inDemo.href = `./?sample=${encodeURIComponent(s.file)}`;
  inDemo.textContent = '在首页打开';
  inDemo.title = '带缩略图栏与全屏演示的完整查看器';
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
    a.textContent = '出处';
    credit.append(a);
  }
  if (credit.textContent.trim()) el.append(credit);

  return el;
}

/* ── 预览浮层 ─────────────────────────────────── */

let viewer: Viewer | null = null;
let downloadUrl: string | null = null;

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
  '<button class="chip act preview-full">全屏演示</button>' +
  '<button class="icon preview-close" title="关闭（Esc）" aria-label="关闭">⨯</button>' +
  '</div>' +
  '<div class="stage-wrap preview-wrap"><div class="stage preview-stage"></div></div>' +
  '<div class="demo-foot">' +
  '<button class="icon preview-prev" title="上一页" aria-label="上一页">‹</button>' +
  '<span class="pager preview-pager">— / —</span>' +
  '<button class="icon preview-next" title="下一页" aria-label="下一页">›</button>' +
  '</div></div>';
document.body.append(overlay);

const q = <T extends Element>(sel: string): T => overlay.querySelector<T>(sel)!;
const pTitle = q<HTMLElement>('.preview-title');
const pMeta = q<HTMLElement>('.preview-meta');
const pStage = q<HTMLElement>('.preview-stage');
const pWrap = q<HTMLElement>('.preview-wrap');
const pPager = q<HTMLElement>('.preview-pager');
const pDl = q<HTMLAnchorElement>('.preview-dl');
const pShare = q<HTMLButtonElement>('.preview-share');

function setStage(html: string, cls = ''): void {
  pStage.innerHTML = `<div class="${cls}">${html}</div>`;
}

function setProgress(got: number, total: number): void {
  const pct = total ? Math.min(100, (got / total) * 100) : 0;
  pStage.innerHTML =
    '<div class="loading">' +
    `<div class="loading-label">下载中 · ${fmtMB(got)}${total ? ` / ${fmtMB(total)}` : ''}</div>` +
    `<div class="loading-bar"><i style="width:${total ? pct.toFixed(1) : 0}%"></i></div>` +
    '<div class="loading-note">下载完成后才开始解析，解析与渲染全在本地</div>' +
    '</div>';
}

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

function syncPager(): void {
  if (!viewer) return;
  pPager.textContent = `${viewer.index + 1} / ${viewer.count}`;
}

function closePreview(): void {
  if (document.fullscreenElement === pWrap) void document.exitFullscreen();
  overlay.hidden = true;
  syncUrl();
  viewer?.destroy();
  viewer = null;
  if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
  pStage.innerHTML = '';
  pMeta.textContent = '';
}

/** 地址栏等于「正在预览哪一份」，复制出去就能分享 */
function syncUrl(file?: string): void {
  const url = new URL(location.href);
  url.search = file ? `?sample=${encodeURIComponent(file)}` : '';
  history.replaceState(null, '', url.pathname + url.search);
}

async function openSample(s: Sample): Promise<void> {
  overlay.hidden = false;
  syncUrl(s.file);
  pTitle.textContent = s.title;
  pMeta.textContent = '下载中…';
  pPager.textContent = '— / —';
  viewer?.destroy();
  viewer = null;
  setProgress(0, 0);

  let bytes: ArrayBuffer;
  let netMs: number;
  try {
    ({ bytes, ms: netMs } = await fetchBytes(s.url, setProgress));
  } catch (e) {
    setStage(`载入失败（${whyFailed(e)}）`, 'err');
    pMeta.textContent = '';
    return;
  }
  if (overlay.hidden) return; // 下载途中被关掉了

  setStage('', 'spin');
  const t0 = performance.now();
  let pres: Presentation;
  try {
    pres = await parse(bytes);
  } catch (e) {
    setStage(`解析失败：${e instanceof Error ? e.message : String(e)}`, 'err');
    pMeta.textContent = '';
    return;
  }
  const parseMs = performance.now() - t0;

  pStage.innerHTML = '';
  viewer = new Viewer(pStage, pres, { skipHidden: true });
  viewer.onChange = () => { syncPager(); void ensureFonts(); };
  // 浮层里点到幻灯片自带的外链会把人从站点带走，全屏演示时才放行
  viewer.onLinkClick = () => document.fullscreenElement !== pWrap;
  syncPager();

  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([bytes]));
  pDl.href = downloadUrl;
  pDl.download = s.file;

  void ensureFonts();

  pMeta.textContent =
    `${Math.round(bytes.byteLength / 1024)}KB · ${pres.slides.length} 页 · ` +
    `下载 ${netMs >= 1000 ? `${(netMs / 1000).toFixed(1)}s` : `${netMs.toFixed(0)}ms`} · ` +
    `解析 ${parseMs.toFixed(0)}ms`;
}

/**
 * 复制当前预览的地址。
 *
 * 地址栏本来就等于「正在看哪一份」（openSample 打开时就写好了），所以直接
 * 复制 `location.href` 即可 —— 不必再拼一遍，拼错了反而和地址栏对不上。
 */
pShare.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    pShare.textContent = '已复制';
    pShare.classList.add('done');
  } catch {
    // 剪贴板被拒（非安全上下文 / 用户拒绝）：别假装成功
    pShare.textContent = '复制失败';
  }
  setTimeout(() => { pShare.textContent = '复制链接'; pShare.classList.remove('done'); }, 1400);
});

q<HTMLButtonElement>('.preview-close').addEventListener('click', closePreview);
q<HTMLButtonElement>('.preview-prev').addEventListener('click', () => viewer?.prev());
q<HTMLButtonElement>('.preview-next').addEventListener('click', () => viewer?.next());
q<HTMLButtonElement>('.preview-full').addEventListener('click', async () => {
  const v = viewer;
  if (!v) return;
  // 先切初始态、等它真的画出来，再进全屏。理由同首页：同一个任务里改完 DOM
  // 就请求全屏的话，放大动画拿到的还是上一帧像素（静态终态）
  v.setAnimate(true);
  await new Promise<void>((res) => {
    let done = false;
    const go = (): void => { if (!done) { done = true; res(); } };
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 60);
  });
  pWrap.requestFullscreen().catch(() => v.setAnimate(false));
});
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement !== pWrap) viewer?.setAnimate(false);
});
// 点浮层的空白处关掉；点到内容区不关
overlay.addEventListener('click', (e) => { if (e.target === overlay) closePreview(); });

addEventListener('keydown', (e) => {
  if (overlay.hidden || !viewer) return;
  if (e.key === 'Escape' && !document.fullscreenElement) { closePreview(); return; }
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { viewer.next(); e.preventDefault(); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { viewer.prev(); e.preventDefault(); }
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
    if (status) status.textContent = '样本清单暂时取不到，稍后再试；首页的内置样本不依赖它。';
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
  const want = new URLSearchParams(location.search).get('sample');
  const hit = want ? shown.get(want) : undefined;
  if (hit) void openSample(hit);
}

void build();
