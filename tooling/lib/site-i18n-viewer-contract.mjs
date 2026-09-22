import { runViewerFullscreenContract, runViewerCopyContract, runViewerNavigationKeysContract, runViewerPresentFallbackContract, runViewerSpeakerAidsContract, runViewerSwipeNavContract, runViewerBlankScreenContract } from './site-viewer-controls-contract.mjs';
import { runViewerPresentBarContract } from './site-present-bar-browser-contract.mjs';
import { runViewerSlideGridContract } from './site-slide-grid-browser-contract.mjs';
import { runViewerOpenSessionContract } from './site-open-session-browser-contract.mjs';
import { runViewerOpenKindContract } from './site-open-kind-browser-contract.mjs';
import { runSiteOpenStartPageContract } from './site-open-start-page-browser-contract.mjs';
import { runBlankPeriodContract } from './blank-period-browser-contract.mjs';
import { runWhiteScreenContract } from './white-screen-browser-contract.mjs';
import { runSlideNumberContract } from './slide-number-browser-contract.mjs';
import { runSlideEndsContract } from './slide-ends-browser-contract.mjs';
import { runNotesKeyContract } from './notes-key-browser-contract.mjs';
import { runPresentVerticalContract } from './present-vertical-browser-contract.mjs';
import { runPresentRewindContract } from './present-rewind-browser-contract.mjs';
import { runPresentBackspaceContract } from './present-backspace-browser-contract.mjs';
import { runPresentPrevLetterContract } from './present-prev-letter-browser-contract.mjs';

export async function runSiteI18nViewerContract({ evaluate, request, click, waitFor }) {
  const url = await evaluate("new URL('index.en.html', location.href).href");
  await evaluate("localStorage.setItem('web-ppt:cjk-fonts', '0')");
  await request('Page.navigate', { url });
  await waitFor("document.querySelector('#demoRoot') && document.documentElement.lang === 'en'", '英文首页查看器');
  await evaluate("document.querySelector('#demoRoot').scrollIntoView({ block: 'start', behavior: 'instant' })");
  await waitFor("document.querySelector('#stage svg') && document.querySelector('#meta').textContent.includes('showcase.pptx')", '默认文稿实际渲染');
  await waitFor("document.querySelector('#meta').textContent.includes('Slides: 7') && document.querySelector('#meta').textContent.includes('Parse ')", '英文查看器耗时与页数');
  await click('#next');
  await waitFor("document.querySelector('#pager').textContent === '2 / 7'", '查看器切到第二页');
  const before = await evaluate(`(() => {
    globalThis.__languageViewer = document.querySelector('#stage').firstElementChild;
    return { download: document.querySelector('#download').href, name: document.querySelector('#download').download };
  })()`);
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#meta').textContent.includes('7 页')", '已打开查看器切中文');
  if (!await evaluate(`globalThis.__languageViewer === document.querySelector('#stage').firstElementChild
    && document.querySelector('#pager').textContent === '2 / 7'
    && document.querySelector('#download').href === ${JSON.stringify(before.download)}
    && document.querySelector('#download').download === ${JSON.stringify(before.name)}`)) throw new Error('查看器语言切换改变了视图、页码或原文件下载');
  await runViewerFullscreenContract({ evaluate, request, click, waitFor }, '#present', '#stage', '#pager');
  await runViewerNavigationKeysContract({ request, click, waitFor }, '#next', '#pager');
  await runViewerPresentFallbackContract({ evaluate, request, click, waitFor }, '#present', '#stageWrap', '#stage', '#pager');
  await runViewerSpeakerAidsContract({ evaluate, request, click, waitFor }, '#speakerAids', '#stageWrap', '#pager', '#present', '#prev', '#next');
  await runViewerSwipeNavContract({ evaluate, request, click, waitFor }, '#stageWrap', '#stage', '#pager', '#speakerAids', '#present', '#prev');
  await runViewerBlankScreenContract({ evaluate, request, click, waitFor }, '#present', '#stageWrap', '#stage', '#pager', '#prev', '#pNext');
  await runBlankPeriodContract({ evaluate, request, click, waitFor }, {
    trigger: '#present',
    fullscreenRoot: '#stageWrap',
    stage: '#stage',
    pager: '#pager',
    prevButton: '#prev',
    gridButton: '#pGrid',
    blankButton: '#pBlank',
    presenting: "document.querySelector('#stageWrap')?.classList.contains('is-presenting')",
  });
  await runWhiteScreenContract({ evaluate, request, click, waitFor }, {
    trigger: '#present',
    fullscreenRoot: '#stageWrap',
    stage: '#stage',
    pager: '#pager',
    prevButton: '#prev',
    nextButton: '#pNext',
    gridButton: '#pGrid',
    blankButton: '#pBlank',
    presenting: "document.querySelector('#stageWrap')?.classList.contains('is-presenting')",
  });
  await runSlideNumberContract({ evaluate, request, click, waitFor }, {
    trigger: '#present',
    fullscreenRoot: '#stageWrap',
    host: '#stageWrap',
    stage: '#stage',
    pager: '#pager',
    prevButton: '#prev',
    presenting: "document.querySelector('#stageWrap')?.classList.contains('is-presenting')",
    fileInput: '#pick',
    fileLabel: '#meta',
    restoreSample: '.samples .chip[data-src="demo/showcase.pptx"]',
    restoreText: 'showcase.pptx',
  });
  await runSlideEndsContract({ evaluate, request, click, waitFor }, {
    trigger: '#present',
    fullscreenRoot: '#stageWrap',
    host: '#stageWrap',
    stage: '#stage',
    pager: '#pager',
    prevButton: '#prev',
    nextButton: '#next',
    presenting: "document.querySelector('#stageWrap')?.classList.contains('is-presenting')",
    fileInput: '#pick',
    fileLabel: '#meta',
    restoreSample: '.samples .chip[data-src="demo/showcase.pptx"]',
    restoreText: 'showcase.pptx',
  });
  await runNotesKeyContract({ evaluate, request, click, waitFor }, {
    trigger: '#present',
    fullscreenRoot: '#stageWrap',
    host: '#stageWrap',
    stage: '#stage',
    pager: '#pager',
    prevButton: '#prev',
    notesButton: '#speakerAids',
    presenting: "document.querySelector('#stageWrap')?.classList.contains('is-presenting')",
    fileInput: '#pick',
  });
  await runPresentVerticalContract({ evaluate, request, click, waitFor }, {
    trigger: '#present',
    fullscreenRoot: '#stageWrap',
    host: '#stageWrap',
    stage: '#stage',
    pager: '#pager',
    prevButton: '#prev',
    notesButton: '#speakerAids',
    presenting: "document.querySelector('#stageWrap')?.classList.contains('is-presenting')",
    fileInput: '#pick',
    fileLabel: '#meta',
    restoreSample: '.samples .chip[data-src="demo/showcase.pptx"]',
    restoreText: 'showcase.pptx',
  });
  await runPresentRewindContract({ evaluate, request, click, waitFor }, {
    trigger: '#present',
    host: '#stageWrap',
    stage: '#stage',
    pager: '#pager',
    presenting: "document.querySelector('#stageWrap')?.classList.contains('is-presenting')",
    notesOpen: "document.querySelector('#stageWrap')?.classList.contains('has-speaker-aids')",
    fileInput: '#pick',
    fileLabel: '#meta',
    restoreSample: '.samples .chip[data-src="demo/showcase.pptx"]',
    restoreText: 'showcase.pptx',
  });
  await runPresentBackspaceContract({ evaluate, request, click, waitFor }, {
    trigger: '#present',
    fullscreenRoot: '#stageWrap',
    host: '#stageWrap',
    stage: '#stage',
    pager: '#pager',
    prevButton: '#prev',
    nextButton: '#next',
    presenting: "document.querySelector('#stageWrap')?.classList.contains('is-presenting')",
    notesOpen: "document.querySelector('#stageWrap')?.classList.contains('has-speaker-aids')",
    fileInput: '#pick',
    fileLabel: '#meta',
    restoreSample: '.samples .chip[data-src="demo/showcase.pptx"]',
    restoreText: 'showcase.pptx',
  });
  await runPresentPrevLetterContract({ evaluate, request, click, waitFor }, {
    trigger: '#present',
    fullscreenRoot: '#stageWrap',
    host: '#stageWrap',
    stage: '#stage',
    pager: '#pager',
    prevButton: '#prev',
    nextButton: '#next',
    presenting: "document.querySelector('#stageWrap')?.classList.contains('is-presenting')",
    notesOpen: "document.querySelector('#stageWrap')?.classList.contains('has-speaker-aids')",
    fileInput: '#pick',
    fileLabel: '#meta',
    restoreSample: '.samples .chip[data-src="demo/showcase.pptx"]',
    restoreText: 'showcase.pptx',
  });
  await runViewerPresentBarContract({ evaluate, request, click, waitFor }, '#present', '#stageWrap', '#stage', '#pager');
  await runViewerSlideGridContract({ evaluate, request, click, waitFor }, '#gridBtn', '#pGrid', '#present', '#stageWrap', '#pager', '#prev');
  await runViewerOpenSessionContract({ evaluate, click, waitFor, request });
  await runViewerCopyContract({ evaluate, click, waitFor }, '.copy', '复制', 'Copy');
  await evaluate(`(async () => {
    const bytes = await fetch('/fixtures/sample-editor-shape-format.pptx').then((response) => response.arrayBuffer());
    const files = new DataTransfer(); files.items.add(new File([bytes], '<本地 & 文件>.pptx'));
    const input = document.querySelector('#pick'); input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor("document.querySelector('#meta').textContent.includes('<本地 & 文件>.pptx')", '查看器本地文稿');
  await click('[data-site-locale="en"]');
  await waitFor("document.querySelector('#meta').textContent.includes('Slides: 1') && document.querySelector('#meta').textContent.includes('Parse ')", '本地文件元数据切英文');
  if (!await evaluate("document.querySelector('#meta').textContent.startsWith('<本地 & 文件>.pptx') && document.querySelector('#download').hidden && !document.querySelector('#meta').children.length")) throw new Error('本地文件名被翻译、解析为 HTML 或错误显示下载按钮');
  await click('#speakerAids');
  await waitFor("document.querySelector('#stageWrap .speaker-notes:empty') && document.querySelector('#stageWrap .speaker-next-empty:not([hidden])')", '无备注文稿空状态');
  await click('#speakerAids');
  await evaluate(`(async () => {
    const bytes = await fetch('/fixtures/sample-editor-comments.pptx').then(r=>r.arrayBuffer());
    const files = new DataTransfer(); files.items.add(new File([bytes], 'comments.pptx'));
    const input = document.querySelector('#pick'); input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor("document.querySelector('#meta').textContent.includes('comments.pptx')", '首页批注文稿');
  await click('#commentsTools');
  await waitFor("document.querySelectorAll('#commentsPanel li').length === 2", '首页批注');
  await click('#next');
  await waitFor("document.querySelectorAll('#commentsPanel li').length === 1", '首页批注跟随翻页');
  await click('#commentsPanel [data-close]');
  await runViewerFailureContract({ evaluate, click, waitFor });
}

async function runViewerFailureContract({ evaluate, click, waitFor }) {
  await evaluate(`(() => {
    const original = window.fetch;
    globalThis.__viewerFetch = original;
    const sample = new URL('demo/showcase.pptx', location.href).href;
    window.fetch = (url, ...args) => new URL(url, location.href).href === sample
      ? new Promise((_, reject) => { globalThis.__failViewerDownload = () => reject(new TypeError('offline')); })
      : original(url, ...args);
  })()`);
  try {
    await click('.chip[data-src="demo/showcase.pptx"]');
    await waitFor("document.querySelector('#stage .loading-label')?.textContent === 'Downloading · 0.0MB'", '英文下载进度');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('#stage .loading-label')?.textContent === '下载中 · 0.0MB'", '下载未结束时切中文');
    await evaluate('globalThis.__failViewerDownload()');
    await waitFor("document.querySelector('#stage .err')?.textContent.includes('网络不通')", '中文网络错误');
    await click('[data-site-locale="en"]');
    await waitFor("document.querySelector('#stage .err')?.textContent.includes('Network unavailable')", '网络错误原地切英文');
    if (!await evaluate("document.querySelector('#meta').textContent === ''")) throw new Error('切语言复活了已清除的加载元数据');
    if (!await evaluate("document.querySelector('#speakerAids').disabled && !document.querySelector('#stageWrap').classList.contains('has-speaker-aids')")) throw new Error('下载失败后仍能打开备注');
  } finally { await evaluate('window.fetch = globalThis.__viewerFetch'); }
  await evaluate(`(() => {
    const files = new DataTransfer(); files.items.add(new File(['invalid'], '<无效>.pptx'));
    const input = document.querySelector('#pick'); input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('#stage .err')?.textContent.includes('not a PowerPoint presentation')", '真实无效文件认文件人话');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#stage .err')?.textContent.includes('无法识别的文件')", '认文件错误原地切中文');
  await runViewerOpenKindContract({ evaluate, click, waitFor, request });
  await runSiteOpenStartPageContract({ evaluate, request, waitFor, click });
}
