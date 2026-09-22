import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { installDomEnv } from './lib/dom-env.mjs';
import { recordCount } from './lib/measured.mjs';
import { deck, label, slideXml, sp } from './lib/ooxml.mjs';

installDomEnv();
Object.assign(globalThis, {
  NodeFilter: window.NodeFilter,
  Text: window.Text,
  Range: window.Range,
});

class FakeHighlight {
  constructor(...ranges) {
    this.items = ranges;
  }
  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }
}

const store = new Map();
Object.defineProperty(globalThis, 'CSS', {
  configurable: true,
  value: {
    highlights: {
      delete(name) { return store.delete(name); },
      get(name) { return store.get(name); },
      set(name, value) { store.set(name, value); },
    },
  },
});
globalThis.Highlight = FakeHighlight;

const root = resolve('.');
const out = resolve(root, 'out/viewer-search-highlight');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'core-entry.mjs'), `export * as core from '${root}/packages/core/src/index.ts';`);
const api = await bundleBrowser({
  root,
  entry: resolve(root, 'packages/viewer/src/viewer-search-highlight.ts'),
  output: resolve(out, 'highlight.mjs'),
});
const searchApi = await bundleBrowser({
  root,
  entry: resolve(root, 'packages/viewer/src/viewer-search.ts'),
  output: resolve(out, 'search.mjs'),
});
const coreBundle = await bundleBrowser({
  root,
  entry: resolve(out, 'core-entry.mjs'),
  output: resolve(out, 'core.mjs'),
});

let count = 0;
const check = (condition, label) => {
  assert(condition, label);
  count++;
};

assert.throws(() => api.collectSearchRanges(document.body, '   '), /空查询不能标字/);
count++;

{
  const host = document.createElement('div');
  const first = document.createElement('span');
  first.textContent = '立';
  const second = document.createElement('span');
  second.textContent = '体效果';
  host.append(first, second);
  document.body.append(host);
  const ranges = api.collectSearchRanges(host, '立体效果');
  check(ranges.length === 1, '同一容器拆 run 也能标出');
  check(ranges[0].toString() === '立体效果', '跨节点 Range 覆盖完整查询词');
  host.remove();
}

{
  const stage = document.createElement('div');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const left = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
  const right = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
  const a = document.createElement('div');
  a.textContent = 'Hello';
  const b = document.createElement('div');
  b.textContent = 'World';
  left.append(a);
  right.append(b);
  svg.append(left, right);
  stage.append(svg);
  document.body.append(stage);
  check(api.collectSearchRanges(stage, 'oW').length === 0, '相邻形状不会拼成假命中');
  check(api.collectSearchRanges(stage, 'Hello').length === 1, '单个形状内的词能标出');
  stage.remove();
}

{
  const host = document.createElement('div');
  host.textContent = 'Hit HIT hit';
  document.body.append(host);
  const painted = api.applySearchHighlight([host], 'hit');
  check(painted === 3, '大小写不敏感，能数出全部命中');
  check(api.searchHighlightCount() === 1, 'registry 只登记当前这一处');
  api.clearSearchHighlight();
  check(api.searchHighlightCount() === 0, '清除后 registry 没有 ppt-find');
  check(api.applySearchHighlight([host], '   ') === 0, '空查询只清除不标字');
  check(api.searchHighlightCount() === 0, '空查询不会留下高亮');
  assert.throws(() => api.applySearchHighlight([host], 'hit', 3), /查找当前命中越界：3，共 3 处/);
  count++;
  const origRects = Range.prototype.getClientRects;
  Range.prototype.getClientRects = function () {
    return {
      length: 1,
      0: { left: 10, top: 20, width: 40, height: 12, right: 50, bottom: 32 },
      item(i) { return this[i]; },
      [Symbol.iterator]: function* () { yield this[0]; },
    };
  };
  try {
    api.applySearchHighlight([host], 'hit');
    const boxes = [...host.querySelectorAll('.ppt-find-box')];
    check(boxes.length === 3, '可见层按命中数叠黄框');
    check(boxes.filter((box) => box.classList.contains('ppt-find-current')).length === 1, '默认深色框是第一处');
    api.applySearchHighlight([host], 'hit', 1);
    const moved = [...host.querySelectorAll('.ppt-find-box')];
    check(moved.length === 3 && moved[1].classList.contains('ppt-find-current') && !moved[0].classList.contains('ppt-find-current'), '指定下标时深色框跟着走');
    api.clearSearchHighlight();
    check(api.searchOverlayBoxCount() === 0, '清除后黄框也空');
  } finally {
    Range.prototype.getClientRects = origRects;
  }
  host.remove();
}

const zip = deck({
  slides: [
    slideXml(sp({ x: 80, y: 90, w: 240, h: 40, name: 'a', text: label('首页甲') })),
    slideXml(sp({ x: 80, y: 90, w: 240, h: 40, name: 'b', text: label('中间页乙') })),
    slideXml(sp({ x: 80, y: 90, w: 240, h: 40, name: 'c', text: label('后页丙 HIT') })),
  ],
  width: 1280,
  height: 720,
  name: 'SearchHighlight',
});
const pres = await coreBundle.core.parse(zip);
let index = 0;
let presenting = false;
const stage = document.createElement('div');
stage.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>后页丙 HIT</div></foreignObject></svg>';
document.body.append(stage);
const query = document.createElement('input');
query.type = 'search';
query.disabled = false;
const hitsLabel = document.createElement('span');
const thumbs = document.createElement('div');
thumbs.innerHTML = '<div></div><div></div><div></div>';
const bound = searchApi.bindViewerSearch({
  query,
  hitsLabel,
  thumbs,
  highlightRoots: () => [stage],
  presentation: () => pres,
  viewer: () => ({
    get index() { return index; },
    goTo(next) { index = next; },
  }),
  presenting: () => presenting,
  onJump() {},
});
bound.enable();
query.value = 'HIT';
await bound.run();
check(index === 2, '命中页会跳过去');
check(api.searchHighlightCount() >= 1, '命中页标出查询词');
presenting = true;
bound.syncHighlight();
check(api.searchHighlightCount() === 0, '放映中清掉高亮');
presenting = false;
bound.syncHighlight();
check(api.searchHighlightCount() >= 1, '退出放映后若仍命中再标');
query.value = '';
await bound.run();
check(api.searchHighlightCount() === 0, '空查询清掉高亮');
query.value = 'zzz-no-such';
await bound.run();
check(hitsLabel.textContent === '无结果', '无命中写无结果');
check(api.searchHighlightCount() === 0, '无命中不留高亮');
query.value = 'HIT';
await bound.run();
bound.reset();
check(api.searchHighlightCount() === 0 && query.value === '' && query.disabled, 'reset 清高亮并禁用');

{
  const zip2 = deck({
    slides: [
      slideXml(sp({ x: 80, y: 90, w: 400, h: 40, name: 'a', text: label('alpha once') })),
      slideXml(sp({ x: 80, y: 90, w: 400, h: 40, name: 'b', text: label('alpha alpha') })),
    ],
    width: 1280,
    height: 720,
    name: 'Occurrence',
  });
  const pres2 = await coreBundle.core.parse(zip2);
  let index2 = 0;
  const stage2 = document.createElement('div');
  document.body.append(stage2);
  const renderStage = () => {
    stage2.textContent = index2 === 0 ? 'alpha once' : 'alpha alpha';
  };
  const query2 = document.createElement('input');
  query2.type = 'search';
  const hits2 = document.createElement('span');
  const thumbs2 = document.createElement('div');
  thumbs2.innerHTML = '<div></div><div></div>';
  const bound2 = searchApi.bindViewerSearch({
    query: query2,
    hitsLabel: hits2,
    thumbs: thumbs2,
    highlightRoots: () => [stage2],
    presentation: () => pres2,
    viewer: () => ({
      get index() { return index2; },
      goTo(next) { index2 = next; },
    }),
    presenting: () => false,
    onJump() { renderStage(); },
  });
  bound2.enable();
  query2.value = 'alpha';
  await bound2.run();
  check(index2 === 0 && hits2.textContent === '2 页', '一页只有一处时仍只写页数');
  await bound2.nextOrRun();
  check(index2 === 1 && hits2.textContent === '2 页 · 第 1/2 处', '下一页的多处从第 1 处开始');
  await bound2.nextOrRun();
  check(index2 === 1 && hits2.textContent === '2 页 · 第 2/2 处', '同页还有下一次时 Enter 不翻页');
  await bound2.previous();
  check(index2 === 1 && hits2.textContent === '2 页 · 第 1/2 处', 'Shift+Enter 回到上一处');
  await bound2.previous();
  check(index2 === 0 && hits2.textContent === '2 页', '本页开头再往前去上一页');
  query2.value = 'once';
  await bound2.nextOrRun();
  check(index2 === 0 && hits2.textContent === '1 页', '输入已改时 Enter 按新词查找');
  stage2.remove();
}

{
  const zipAgain = deck({
    slides: [
      slideXml(sp({ x: 80, y: 90, w: 400, h: 40, name: 'a', text: label('alpha once') })),
      slideXml(sp({ x: 80, y: 90, w: 400, h: 40, name: 'b', text: label('alpha alpha') })),
    ],
    width: 1280,
    height: 720,
    name: 'FindAgain',
  });
  const presAgain = await coreBundle.core.parse(zipAgain);
  let indexAgain = 0;
  let presentingAgain = false;
  const stageAgain = document.createElement('div');
  stageAgain.textContent = 'alpha once';
  document.body.append(stageAgain);
  const queryAgain = document.createElement('input');
  queryAgain.type = 'search';
  const hitsAgain = document.createElement('span');
  const thumbsAgain = document.createElement('div');
  thumbsAgain.innerHTML = '<div></div><div></div>';
  const boundAgain = searchApi.bindViewerSearch({
    query: queryAgain,
    hitsLabel: hitsAgain,
    thumbs: thumbsAgain,
    highlightRoots: () => [stageAgain],
    presentation: () => presAgain,
    viewer: () => ({
      get index() { return indexAgain; },
      goTo(next) { indexAgain = next; },
    }),
    presenting: () => presentingAgain,
    onJump() { stageAgain.textContent = indexAgain === 0 ? 'alpha once' : 'alpha alpha'; },
  });
  boundAgain.enable();
  queryAgain.value = 'alpha';
  await boundAgain.run();
  document.body.focus?.();
  queryAgain.blur();
  check(boundAgain.findAgain(1) === true, '搜索框没聚焦时仍接 Find again');
  check(indexAgain === 1 && hitsAgain.textContent === '2 页 · 第 1/2 处', 'Ctrl+G 与 Enter 走到同一处');
  check(boundAgain.findAgain(-1) === true && indexAgain === 0 && hitsAgain.textContent === '2 页', 'Ctrl+Shift+G 回到上一处');
  const other = document.createElement('input');
  document.body.append(other);
  other.focus();
  check(boundAgain.findAgain(1) === false && indexAgain === 0, '别的输入框里不接 Ctrl+G');
  other.remove();
  presentingAgain = true;
  check(boundAgain.findAgain(1) === false && indexAgain === 0, '放映中不接 Ctrl+G');
  presentingAgain = false;
  queryAgain.value = '   ';
  check(boundAgain.findAgain(1) === false && indexAgain === 0, '空查询不接 Ctrl+G');
  queryAgain.value = 'once';
  check(boundAgain.findAgain(1) === true, '查询已改时 Find again 仍接');
  await Promise.resolve();
  check(indexAgain === 0 && hitsAgain.textContent === '1 页', 'Find again 按新词重扫');
  boundAgain.reset();
  check(boundAgain.findAgain(1) === false, '搜索禁用后不接 Ctrl+G');
  stageAgain.remove();
}

{
  const zip3 = deck({
    slides: [slideXml(sp({ x: 80, y: 90, w: 400, h: 40, name: 'n', text: label('secretword') }))],
    width: 1280,
    height: 720,
    name: 'HiddenNotes',
  });
  const pres3 = await coreBundle.core.parse(zip3);
  const stage3 = document.createElement('div');
  stage3.textContent = '舞台上没有这个词';
  const panel = document.createElement('div');
  panel.hidden = true;
  const notes = document.createElement('div');
  notes.textContent = 'secretword 只在备注';
  panel.append(notes);
  document.body.append(stage3, panel);
  const query3 = document.createElement('input');
  query3.type = 'search';
  const hits3 = document.createElement('span');
  const thumbs3 = document.createElement('div');
  thumbs3.innerHTML = '<div></div>';
  const bound3 = searchApi.bindViewerSearch({
    query: query3,
    hitsLabel: hits3,
    thumbs: thumbs3,
    highlightRoots: () => [stage3, notes],
    presentation: () => pres3,
    viewer: () => ({ index: 0, goTo() {} }),
    presenting: () => false,
    onJump() {},
  });
  bound3.enable();
  query3.value = 'secretword';
  await bound3.run();
  check(api.searchHighlightCount() === 0 && hits3.textContent === '1 页', '关掉的备注不画也不写第几处');
  check(!api.isSearchRootVisible(notes) && api.isSearchRootVisible(stage3), 'hidden 根不可见，舞台可见');
  stage3.remove();
  panel.remove();
}

{
  const zip4 = deck({
    slides: [slideXml(sp({ x: 80, y: 90, w: 400, h: 40, name: 'w', text: label('word word') }))],
    width: 1280,
    height: 720,
    name: 'NotesStep',
  });
  const pres4 = await coreBundle.core.parse(zip4);
  const stage4 = document.createElement('div');
  stage4.textContent = 'word word';
  const panel4 = document.createElement('div');
  const notes4 = document.createElement('div');
  notes4.textContent = 'word';
  panel4.append(notes4);
  document.body.append(stage4, panel4);
  const query4 = document.createElement('input');
  query4.type = 'search';
  const hits4 = document.createElement('span');
  const thumbs4 = document.createElement('div');
  thumbs4.innerHTML = '<div></div>';
  const bound4 = searchApi.bindViewerSearch({
    query: query4,
    hitsLabel: hits4,
    thumbs: thumbs4,
    highlightRoots: () => [stage4, notes4],
    presentation: () => pres4,
    viewer: () => ({ index: 0, goTo() {} }),
    presenting: () => false,
    onJump() {},
  });
  bound4.enable();
  query4.value = 'word';
  await bound4.run();
  check(hits4.textContent === '1 页 · 第 1/3 处', '备注开着时备注词排在舞台后面');
  await bound4.nextOrRun();
  await bound4.nextOrRun();
  check(hits4.textContent === '1 页 · 第 3/3 处', '可以走到备注里的那一处');
  panel4.hidden = true;
  bound4.syncHighlight();
  check(hits4.textContent === '1 页 · 第 2/2 处', '关上备注后回到舞台最后一处');
  stage4.remove();
  panel4.remove();
}

const highlightSource = readFileSync(resolve(root, 'packages/viewer/src/viewer-search-highlight.ts'), 'utf8');
const searchSource = readFileSync(resolve(root, 'packages/viewer/src/viewer-search.ts'), 'utf8');
const mainSource = readFileSync(resolve(root, 'packages/viewer/src/main.ts'), 'utf8');
check(!highlightSource.includes('includeEditMarkers'), '标字不走编辑标记');
check(!highlightSource.includes("from '@web-ppt/core/render"), '标字不 import render');
check(searchSource.includes('syncHighlight'), '查找会话会同步高亮');
check(searchSource.includes('shiftKey'), 'Shift+Enter 走上一个词');
check(searchSource.includes('findAgain'), '查找会话提供 Find again');
check(mainSource.includes('findAgain'), '文档键盘接到 Ctrl/⌘+G');
check(mainSource.includes('finishAnimations'), '放映里的 Enter 仍是播完动画');
const gridSource = readFileSync(resolve(root, 'packages/site/src/slide-grid.ts'), 'utf8');
check(gridSource.includes('event.altKey') && gridSource.includes('event.metaKey'), '带修饰键的 G 不切换网格');
check(searchSource.includes('isSearchRootVisible'), '关掉的备注不参与下一处');
check(mainSource.includes('search?.syncHighlight()'), '翻页与放映会同步高亮');
check(
  mainSource.slice(mainSource.indexOf('btnNotes.addEventListener')).includes('search?.syncHighlight()'),
  '备注开关会再量一次盒子',
);
check(mainSource.includes("highlightRoots: () => [stage, notesBody]"), '舞台和备注都是标字根');

const renderFiles = ['packages/core/src/render/svg.ts', 'packages/core/src/render/text-html.ts'];
for (const file of renderFiles) {
  const before = readFileSync(resolve(root, file), 'utf8');
  check(before.includes('includeEditMarkers'), `${file} 仍只给编辑器用标记`);
}

recordCount('viewerSearchHighlight', count);
console.log(`独立查看器查找命中页内标字 ${count} 项通过`);
