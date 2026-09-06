import { openFixture } from './site-editor-browser-helpers.mjs';

export async function runSiteCommentsBrowserContract(context) {
  const { evaluate, click, waitFor } = context;
  await openFixture(context, '/fixtures/sample-editor-comments.pptx', 'comments.pptx');
  if (await evaluate("!!document.querySelector('#commentsPanel')")) throw new Error('批注必须默认关闭');
  await click('#commentsTools');
  await waitFor("document.querySelectorAll('#commentsPanel li').length === 2", '批注完整原文');
  await click('[data-site-locale="en"]');
  await waitFor("document.querySelector('#commentsTitle')?.textContent === 'Comments'", '批注切英文');
  if (!await evaluate(`document.querySelector('#commentsPanel li p').textContent === '第一条 <script> & English'
    && !document.querySelector('#commentsPanel script') && !document.querySelector('#fileName').textContent.startsWith('●')`)) throw new Error('批注翻译或读操作污染了原文/文稿');
  await click('#nextSlide');
  await waitFor("document.querySelectorAll('#commentsPanel li').length === 1", '批注跟随切页');
  await click('#nextSlide');
  await waitFor("document.querySelector('#commentsPanel [data-comments-empty]')?.hidden === false", '无批注页空状态');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#commentsPanel [data-comments-empty]')?.textContent === '本页没有批注'", '空状态切中文');
  await click('#prevSlide'); await click('#prevSlide');
  await click('#commentsPanel [data-include-comments]');
  await evaluate(`(() => {
    globalThis.__commentDownloads = [];
    globalThis.__commentOriginalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) void fetch(this.href).then(r => r.arrayBuffer()).then(bytes => globalThis.__commentDownloads.push({ name: this.download, bytes: [...new Uint8Array(bytes)] }));
      else globalThis.__commentOriginalClick.call(this);
    };
  })()`);
  try {
    for (const [index, format] of ['svg', 'png', 'zip', 'print'].entries()) {
      await click(`#commentsPanel [data-comment-export=${format}]`);
      await waitFor(`globalThis.__commentDownloads.length === ${index + 1}`, `批注 ${format} 导出`);
    }
    const saved = await evaluate(`globalThis.__commentDownloads.map(({name,bytes})=>({name,magic:bytes.slice(0,4),text:/\\.(svg|html)$/.test(name)?new TextDecoder().decode(new Uint8Array(bytes)):''}))`);
    if (!saved[0].text.includes('ppt-comment') || saved[0].text.includes('foreignObject')
      || saved[1].magic[0] !== 137 || saved[2].magic[0] !== 80
      || !saved[3].text.includes('第一条 &lt;script&gt; &amp; English') || saved[3].text.includes('<script>')) throw new Error('批注导出没有保留标记/正文');
  } finally { await evaluate('HTMLAnchorElement.prototype.click = globalThis.__commentOriginalClick'); }
  const pixels = await evaluate(`(async () => {
    const core = await import('/chartex-core.mjs');
    const p = await core.parse(await fetch('/fixtures/sample-editor-comments.pptx').then(r=>r.arrayBuffer()), {lazy:false});
    const results = [];
    for (const showComments of [false,true]) {
      const blob = await core.slideToPng(p,p.slides[0],1,{showComments});
      const image=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=p.width;canvas.height=p.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();results.push([...ctx.getImageData(102,102,1,1).data]);
    }
    p.dispose();return results;
  })()`, true);
  if (JSON.stringify(pixels[0]) === JSON.stringify(pixels[1]) || pixels[1][0] < 200 || pixels[1][2] > 100) throw new Error(`PNG 批注标记像素无效：${JSON.stringify(pixels)}`);
  await openFixture(context, '/fixtures/sample-editor-comments.pptx', 'comments-replacement.pptx');
  if (await evaluate("!!document.querySelector('#commentsPanel') || document.querySelector('#commentsTools').getAttribute('aria-expanded') !== 'false'")) throw new Error('换文稿未释放批注面板');
  console.log('  批注面板、中英文、四种导出、PNG 标记与文稿释放通过');
}
