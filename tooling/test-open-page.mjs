import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { installDomEnv } from './lib/dom-env.mjs';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const { window, dom } = installDomEnv();
dom.reconfigure({ url: 'https://web-ppt.test/viewer/?file=/deck.pptx&p=5#stage' });
for (const name of ['location', 'history']) {
  Object.defineProperty(globalThis, name, { value: window[name], configurable: true });
}

const root = process.cwd();
const out = resolve(root, 'out/open-page');
mkdirSync(out, { recursive: true });
const api = await bundleBrowser({
  root,
  entry: resolve(root, 'packages/site/src/open-page.ts'),
  output: resolve(out, 'open-page.mjs'),
});

assert.equal(api.parseOpenPage(null), 1);
assert.equal(api.parseOpenPage(''), 1);
assert.equal(api.parseOpenPage('foo'), 1);
assert.equal(api.parseOpenPage('0'), 1);
assert.equal(api.parseOpenPage('-3'), 1);
assert.equal(api.parseOpenPage('1.9'), 1);
assert.equal(api.parseOpenPage('3'), 3);
assert.equal(api.parseOpenPage('03'), 3);
assert.equal(api.parseOpenPage('999'), 999);

assert.equal(api.clampOpenPage(3, 7), 3);
assert.equal(api.clampOpenPage(1, 7), 1);
assert.equal(api.clampOpenPage(999, 7), 7);
assert.throws(() => api.clampOpenPage(3, 0), /没有幻灯片/);
assert.throws(() => api.clampOpenPage(0, 7), /≥1/);

api.writeOpenPageParam(4);
assert.equal(location.search, '?file=%2Fdeck.pptx&p=4');
assert.equal(location.hash, '#stage');
api.writeOpenPageParam(4);
assert.equal(location.search, '?file=%2Fdeck.pptx&p=4');
api.writeOpenPageParam(1);
assert.equal(location.search, '?file=%2Fdeck.pptx');
api.writeOpenPageParam(2);
assert.equal(location.search, '?file=%2Fdeck.pptx&p=2');
api.clearOpenPageParam();
assert.equal(location.search, '?file=%2Fdeck.pptx');
assert.equal(location.hash, '#stage');
assert.throws(() => api.writeOpenPageParam(0), /≥1/);

dom.reconfigure({ url: 'https://web-ppt.test/samples.html?sample=deck.pptx&p=5' });
api.writeOpenPageParam(4);
assert.equal(location.search, '?sample=deck.pptx&p=4');
api.writeOpenPageParam(1);
assert.equal(location.search, '?sample=deck.pptx');
api.writeOpenPageParam(3);
assert.equal(location.search, '?sample=deck.pptx&p=3');
api.clearOpenPageParam();
assert.equal(location.search, '?sample=deck.pptx');

dom.reconfigure({ url: 'https://web-ppt.test/viewer/?file=/deck.pptx&p=5#stage' });
api.clearOpenFileParam();
assert.equal(location.search, '?p=5');
assert.equal(location.hash, '#stage');
api.clearOpenFileParam();
assert.equal(location.search, '?p=5');
api.writeOpenPageParam(3);
assert.equal(location.search, '?p=3');
api.clearOpenPageParam();
assert.equal(location.search, '');
assert.equal(location.hash, '#stage');

console.log('open-page 页码解析与回写通过');
