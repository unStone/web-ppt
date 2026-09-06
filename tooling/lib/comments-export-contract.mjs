import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

export async function runCommentsExportContract({ core, comments, load }) {
  const p = await core.parse(load('sample-editor-comments.pptx'), { lazy: false });
  const plain = await core.slideToSvgFile(p, p.slides[0]);
  const marked = await core.slideToSvgFile(p, p.slides[0], undefined, { showComments: true });
  assert(!plain.includes('ppt-comment') && marked.includes('ppt-comment'));
  assert(!marked.includes('foreignObject'));
  const dom = new JSDOM(await core.presentationToPrintableHtml(p, { showComments: true }));
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('.ppt-comments li').length, 3);
  assert.equal(doc.querySelector('.ppt-comments p').textContent, '第一条 <script> & English');
  assert.equal(doc.querySelector('.ppt-comments b').textContent, '审阅 & Review');
  assert.equal(doc.querySelector('.ppt-comments time').textContent, ' · 2026-01-02T03:04:05Z');
  assert.equal(doc.querySelectorAll('script').length, 0);
  const defaultPrint = new JSDOM(await core.presentationToPrintableHtml(p));
  assert.equal(defaultPrint.window.document.querySelectorAll('.ppt-comments').length, 0);
  const previous = globalThis.document;
  globalThis.document = doc;
  try {
    const host = doc.createElement('div'); doc.body.append(host);
    const panel = comments.createCommentsPanel(host, 'empty');
    panel.setSlide(p.slides[0]);
    assert.equal(host.querySelectorAll('li').length, 2);
    assert.equal(host.querySelector('li p').textContent, '第一条 <script> & English');
    assert.equal(host.querySelector('script'), null);
    panel.setSlide(p.slides[1]); assert.equal(host.querySelectorAll('li').length, 1);
    panel.setSlide(p.slides[2]); assert.equal(host.querySelector('[data-comments-empty]').hidden, false);
    panel.dispose(); panel.setSlide(p.slides[0]); assert.equal(host.childElementCount, 0);
  } finally { globalThis.document = previous; dom.window.close(); defaultPrint.window.close(); p.dispose(); }
  return 16;
}
