import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { installDomEnv } from './lib/dom-env.mjs';
import { recordCount } from './lib/measured.mjs';
import { deck, label, slideXml, sp } from './lib/ooxml.mjs';

installDomEnv();

const root = resolve('.');
const out = resolve(root, 'out/viewer-open-lazy');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'core-entry.mjs'), `export * as core from '${root}/packages/core/src/index.ts';`);

const api = await bundleBrowser({
  root,
  entry: resolve(root, 'packages/viewer/src/open-file-info.ts'),
  output: resolve(out, 'open-file-info.mjs'),
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

const info = api.formatOpenFileInfo({
  name: 'deck.pptx',
  pages: 200,
  width: 1280.4,
  height: 720.9,
  parseMs: 12.6,
});
check(info === 'deck.pptx · 200 页 · 1280×720px · 13ms', '打开态只报名字页数尺寸耗时');
check(!info.includes('备注'), '打开态不报备注页数');

const ppt = api.formatOpenFileInfo({
  name: 'old.ppt',
  pages: 3,
  width: 960,
  height: 720,
  parseMs: 4,
  source: 'ppt',
});
check(ppt.endsWith(' · .ppt 二进制格式'), '.ppt 仍标明二进制格式');

assert.throws(() => api.formatOpenFileInfo({
  name: 'x', pages: Number.NaN, width: 1, height: 1, parseMs: 0,
}), /页数无效/);
count++;
assert.throws(() => api.formatOpenFileInfo({
  name: 'x', pages: 1, width: 1, height: 1, parseMs: -1,
}), /耗时无效/);
count++;

const query = document.createElement('input');
query.type = 'search';
query.value = '上一份';
const hits = document.createElement('span');
hits.textContent = '3 页';
api.resetViewerSearch(query, hits);
check(query.value === '' && hits.textContent === '' && query.disabled, '换文件清空搜索框和命中并禁用');
api.enableViewerSearch(query);
check(!query.disabled, '打开成功后才启用搜索');

const zip = deck({
  slides: [
    slideXml(sp({ x: 80, y: 90, w: 240, h: 40, name: 'a', text: label('首页') })),
    slideXml(sp({ x: 80, y: 90, w: 240, h: 40, name: 'b', text: label('中间页') })),
    slideXml(sp({ x: 80, y: 90, w: 240, h: 40, name: 'c', text: label('后页') })),
  ],
  width: 1280,
  height: 720,
  name: 'OpenLazy',
});
const pres = await core.parse(zip);
const accessed = [];
for (let i = 0; i < pres.slides.length; i++) {
  const desc = Object.getOwnPropertyDescriptor(pres.slides, i);
  Object.defineProperty(pres.slides, i, {
    enumerable: true,
    configurable: true,
    get() {
      accessed.push(i);
      return desc.get.call(pres.slides);
    },
  });
}
void api.formatOpenFileInfo({
  name: 'OpenLazy.pptx',
  pages: pres.slides.length,
  width: pres.width,
  height: pres.height,
  parseMs: 1,
  source: pres.source,
});
check(accessed.length === 0, '格式化状态栏不读 slides[i]');
void pres.slides.filter((slide) => slide.notes).length;
check(accessed.join(',') === '0,1,2', '全页 filter 会读到后页');
pres.dispose();

const source = readFileSync(resolve(root, 'packages/viewer/src/main.ts'), 'utf8');
check(!source.includes('slides.filter'), '打开路径不再 slides.filter');
const finish = source.slice(source.indexOf('async function finishOpen'), source.indexOf('const openFile'));
check(!finish.includes('runSearch('), '打开成功后不再自动查找');
check(!finish.includes('slides.forEach'), '打开成功不再 forEach 后页');
check(finish.includes('formatOpenFileInfo'), '打开成功走标量状态栏');
const detach = source.slice(source.indexOf('function detachOpen'), source.indexOf('function beginOpen'));
check(detach.includes('search?.reset()'), '换文件中止查找并清空搜索');

recordCount('viewerOpenLazy', count);
console.log(`独立查看器打开不再扫完全部页 ${count} 项通过`);
