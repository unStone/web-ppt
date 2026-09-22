import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { installDomEnv } from './lib/dom-env.mjs';
import { recordCount } from './lib/measured.mjs';
import { deck, label, slideXml, sp } from './lib/ooxml.mjs';

installDomEnv();

const root = resolve('.');
const out = resolve(root, 'out/viewer-search-lazy');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'core-entry.mjs'), `export * as core from '${root}/packages/core/src/index.ts';`);

const api = await bundleBrowser({
  root,
  entry: resolve(root, 'packages/viewer/src/viewer-search.ts'),
  output: resolve(out, 'viewer-search.mjs'),
});
const { core } = await bundleBrowser({
  root,
  entry: resolve(out, 'core-entry.mjs'),
  output: resolve(out, 'core.mjs'),
});

let count = 0;
const check = (condition, label) => {
  assert(condition, label);
  count++;
};

const zip = deck({
  slides: [
    slideXml(sp({ x: 80, y: 90, w: 240, h: 40, name: 'a', text: label('首页甲') })),
    slideXml(sp({ x: 80, y: 90, w: 240, h: 40, name: 'b', text: label('中间页乙') })),
    slideXml(sp({ x: 80, y: 90, w: 240, h: 40, name: 'c', text: label('后页丙 HIT') })),
  ],
  width: 1280,
  height: 720,
  name: 'SearchLazy',
});
const pres = await core.parse(zip);

function wrapSlides(slides, onRead) {
  const accessed = [];
  const list = [];
  for (let i = 0; i < slides.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(slides, i);
    Object.defineProperty(list, i, {
      enumerable: true,
      configurable: true,
      get() {
        accessed.push(i);
        onRead?.();
        return desc.get ? desc.get.call(slides) : desc.value;
      },
    });
  }
  list.length = slides.length;
  return { list, accessed };
}

await assert.rejects(
  () => api.searchSlidesIncrementally({
    slides: pres.slides,
    query: '   ',
    cache: new Map(),
    isCurrent: () => true,
    onHit() {},
  }),
  /空查询不能扫描后页/,
);
count++;

{
  const { list, accessed } = wrapSlides(pres.slides);
  const hits = [];
  const result = await api.searchSlidesIncrementally({
    slides: list,
    query: 'HIT',
    cache: new Map(),
    isCurrent: () => accessed.length < 2,
    onHit: (index) => hits.push(index),
    deadlineMs: 0,
    yieldToMain: async () => {},
  });
  check(result === 'cancelled', '换代后扫描标记为取消');
  check(accessed.join(',') === '0,1', '取消后不读后页');
  check(hits.length === 0, '取消时后页命中尚未出现');
}

{
  const { list, accessed } = wrapSlides(pres.slides);
  const cache = new Map();
  const hits = [];
  const first = await api.searchSlidesIncrementally({
    slides: list,
    query: 'HIT',
    cache,
    isCurrent: () => true,
    onHit: (index) => hits.push(index),
  });
  check(first === 'done' && hits.join(',') === '2', '首次查找读到命中页');
  check(accessed.join(',') === '0,1,2', '首次查找会读完全部页');
  accessed.length = 0;
  const again = [];
  const second = await api.searchSlidesIncrementally({
    slides: list,
    query: 'HIT',
    cache,
    isCurrent: () => true,
    onHit: (index) => again.push(index),
  });
  check(second === 'done' && again.join(',') === '2', '缓存后仍能命中');
  check(accessed.length === 0, '缓存命中不再读 slides[i]');
}

{
  let now = 0;
  const yields = [];
  const { list } = wrapSlides(pres.slides, () => {
    now += 30;
  });
  await api.searchSlidesIncrementally({
    slides: list,
    query: 'HIT',
    cache: new Map(),
    isCurrent: () => true,
    onHit() {},
    deadlineMs: 50,
    now: () => now,
    yieldToMain: async () => {
      yields.push(now);
    },
  });
  check(yields.length >= 1, '超过 50ms 才让出主线程');
}

const query = document.createElement('input');
query.type = 'search';
query.value = '上一份';
query.disabled = false;
const hitsLabel = document.createElement('span');
hitsLabel.textContent = '3 页';
const thumbs = document.createElement('div');
thumbs.innerHTML = '<div class="thumb hit"></div>';
const bound = api.bindViewerSearch({
  query,
  hitsLabel,
  thumbs,
  highlightRoots: () => [],
  presentation: () => null,
  viewer: () => null,
  presenting: () => false,
  onJump() {},
});
bound.reset();
check(query.value === '' && hitsLabel.textContent === '' && query.disabled, 'reset 清空并禁用');
check(!thumbs.querySelector('.hit'), 'reset 清掉胶片栏命中');
bound.enable();
check(!query.disabled, '打开成功后启用搜索');

const source = readFileSync(resolve(root, 'packages/viewer/src/main.ts'), 'utf8');
check(source.includes('bindViewerSearch'), '查看器查找走增量扫描');
check(!source.includes('slides.forEach'), '查找路径不再 slides.forEach');
check(!source.includes('slideText'), '产品层不再同步 slideText 全表');
const detach = source.slice(source.indexOf('function detachOpen'), source.indexOf('function beginOpen'));
check(detach.includes('search?.reset()'), '换文件中止查找');
const finish = source.slice(source.indexOf('async function finishOpen'), source.indexOf('const openFile'));
check(finish.includes('search?.enable()'), '打开成功后才启用搜索');
check(!finish.includes('runSearch('), '打开成功后仍不自动查找');
const engine = readFileSync(resolve(root, 'packages/viewer/src/viewer-search.ts'), 'utf8');
check(engine.includes('deadlineMs') && engine.includes('yieldToMain'), '扫描按 50ms 让出');
check(!engine.includes('slides.forEach'), '扫描不用 forEach');

recordCount('viewerSearchLazy', count);
console.log(`独立查看器查找不再一次打穿后页 ${count} 项通过`);
