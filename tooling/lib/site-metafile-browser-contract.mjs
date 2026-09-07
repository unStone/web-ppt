import { mkdirSync, writeFileSync } from 'node:fs';
import { openFixture } from './site-editor-browser-helpers.mjs';

export async function runSiteMetafileBrowserContract(context) {
  await openFixture(context, '/fixtures/sample-emf-plus.pptx', 'emf-plus-ui.pptx');
  await context.waitFor(`(() => {
    const images = [...document.querySelectorAll('#canvasMount svg image')];
    return images.filter(n => decodeURIComponent(n.getAttribute('href') || n.getAttribute('xlink:href') || '').includes('linearGradient')).length === 2;
  })()`, 'EMF+ 按需模块绘制 Only/Dual 两张图片');
  mkdirSync('out/emf-plus', { recursive: true });
  const screenshot = await context.request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync('out/emf-plus/browser.png', Buffer.from(screenshot.result.data, 'base64'));
}
