import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { SLIDE_TRANSITION_TYPES, transitionDirections, ANIMATION_EFFECTS } from '@web-ppt/editor';
import { PRESET_DEFINITION_NAMES } from '@web-ppt/core/geometry/handles';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--built')) {
  execFileSync('npm', ['run', 'build', '-w', '@web-ppt/site'], { cwd: root, stdio: 'inherit' });
}
const dist = join(root, 'packages/site/dist');
for (const name of readdirSync(join(dist, 'assets')).filter((file) => file.endsWith('.js'))) {
  for (const [reference] of readFileSync(join(dist, 'assets', name), 'utf8').matchAll(/assets\/[^"\s]+\.css/g)) {
    assert.ok(existsSync(join(dist, reference)), `动态预加载引用缺失：${reference}`);
  }
}
for (const page of ['index', 'samples', 'editor']) {
  for (const language of ['zh-CN', 'en']) {
    const file = `${page}${language === 'en' ? '.en' : ''}.html`;
    const html = readFileSync(join(root, 'packages/site/dist', file), 'utf8');
    const document = new JSDOM(html).window.document;
    if (page === 'editor') {
      const values = (id) => [...document.querySelector(id).options].map((node) => node.value);
      assert.deepEqual(values('#shapePreset'), [...PRESET_DEFINITION_NAMES], `${file} 静态形状目录必须与公开 API 完整一致`);
      assert.deepEqual(values('#transitionType'), [...SLIDE_TRANSITION_TYPES], `${file} 静态切换目录必须与公开 API 完整一致`);
      assert.deepEqual(values('#transitionDirection').sort(), ['', ...new Set(SLIDE_TRANSITION_TYPES.flatMap(transitionDirections))].sort(),
        `${file} 静态方向目录必须与公开 API 完整一致`);
      assert.deepEqual(values('#animationEffect'), [...ANIMATION_EFFECTS], `${file} 静态动画效果目录必须与公开 API 完整一致`);
    }
    assert.equal(document.documentElement.lang, language, `${file} 的无脚本语言`);
    const canonical = document.querySelector('link[rel="canonical"]').href;
    const site = 'https://unstone.github.io/web-ppt/';
    const chinese = site + (page === 'index' ? '' : `${page}.html`);
    const english = `${site}${page}.en.html`;
    assert.equal(canonical, language === 'en' ? english : chinese, `${file} canonical`);
    assert.equal(document.querySelector('link[hreflang="zh-CN"]').href, chinese, `${file} 中文互链`);
    assert.equal(document.querySelector('link[hreflang="en"]').href, english, `${file} 英文互链`);
    assert.equal(document.querySelector('link[hreflang="x-default"]').href, english, `${file} 默认互链`);
    assert.equal(document.querySelector('meta[property="og:url"]').content, canonical, `${file} 分享地址`);
    assert.equal(document.querySelector('meta[property="og:locale"]').content, language === 'en' ? 'en_US' : 'zh_CN');
    assert.equal(document.querySelector('meta[property="og:title"]').content, document.title, `${file} 分享标题`);
    const description = document.querySelector('meta[name="description"]').content;
    assert.equal(document.querySelector('meta[property="og:description"]').content, description, `${file} 分享描述`);
    const schema = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
    for (const item of schema['@graph'] ?? [schema]) {
      assert.equal(item.inLanguage, language, `${file} JSON-LD 语言`);
      assert.equal(item.url, canonical, `${file} JSON-LD 地址`);
      if (language === 'en') assert.doesNotMatch(item.description ?? '', /\p{Script=Han}/u, `${file} JSON-LD 描述`);
    }
    assert.ok(document.querySelector('#siteLanguage'), `${file} 无脚本语言入口`);
    if (language !== 'en') continue;
    assert.match(document.title, /Web-PPT/);
    for (const anchor of document.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href');
      if (href.startsWith('#') || anchor.closest('[data-site-language]')) continue;
      const url = new URL(href, canonical);
      if (url.origin !== new URL(canonical).origin) continue;
      if (/\/(?:index|samples|editor)(?:\.en)?\.html$|\/$/.test(url.pathname)) {
        assert.ok(url.pathname.endsWith('.en.html'), `${file} 无脚本导航不能丢失语言：${href}`);
      }
    }
    for (const control of document.querySelectorAll('.sample-foot button,.sample-foot a,.sample-credit a')) {
      assert.doesNotMatch(control.textContent, /\p{Script=Han}/u, `${file} 样本卡产品操作必须翻译`);
    }
    const walker = document.createTreeWalker(document.body, 4);
    for (let node; (node = walker.nextNode());) {
      if (node.parentElement.closest('script,style,[data-site-language],.sample-card')) continue;
      assert.doesNotMatch(node.data, /\p{Script=Han}/u, `${file} 尚未翻译的静态文本`);
    }
  }
}
console.log('官网中英文静态页面、语言互链和无脚本元数据通过');
if (!process.argv.includes('--static-only')) {
  execFileSync(process.execPath, ['tooling/test-site-editor-browser.mjs', '--i18n-dist'], { cwd: root, stdio: 'inherit' });
}
