import { openFixture, selectPaneObject, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';
import { withDelayedFileRead } from './file-read-boundary.mjs';

const imageSource = `(() => {
  const id = document.querySelector('[data-pane-element][aria-selected="true"]').dataset.paneElement;
  const image = document.querySelector('[data-edit-id="' + CSS.escape(id) + '"] image');
  return image?.getAttribute('href') || image?.getAttribute('xlink:href');
})()`;

export async function runSiteI18nImageContract(context) {
  const { evaluate, click, waitFor } = context;
  await click('[data-site-locale="en"]');
  await openFixture(context, '/fixtures/sample-editor-image-content.pptx', '<图片 & 原文>.pptx');
  await selectPaneObject(context, 'image-external');
  await click('#startImageCrop');
  await waitFor("document.querySelector('#statusText').textContent === 'Drag the crop frame inside the image, then click “Finish cropping”'", '图片裁剪英文指导');
  await evaluate("globalThis.__cropLanguageOverlay = document.querySelector('[data-edit-crop-id]')");
  await click('[data-site-locale="zh-CN"]');
  if (!await evaluate(`document.querySelector('#statusText').textContent === '拖动图片内的裁剪框，完成后点击“完成裁剪”'
    && !!globalThis.__cropLanguageOverlay && document.querySelector('[data-edit-crop-id]') === globalThis.__cropLanguageOverlay
    && document.querySelector('#undo').disabled`)) throw new Error('语言切换退出图片裁剪或产生历史');
  await click('#finishImageCrop');
  await waitFor("!document.querySelector('[data-edit-crop-id]')", '切语言后正常结束裁剪');
  await click('#cropImageTen');
  await waitFor("document.querySelector('#cropImageTen').getAttribute('aria-pressed') === 'true'", '裁剪真实内容');
  await click('#undo'); await waitFor("document.querySelector('#cropImageTen').getAttribute('aria-pressed') === 'false'", '双语裁剪撤销');
  await click('#redo');
  const before = await evaluate(imageSource);
  await withDelayedFileRead(context, '<新图片 & 原文>.png', async (read) => {
    await upload(context, '/assets/replacement.png', '<新图片 & 原文>.png');
    await read.wait();
    await click('[data-site-locale="en"]');
    if (!await evaluate(`document.querySelector('#replaceImageInput').files[0].name === '<新图片 & 原文>.png'
      && ${imageSource} === ${JSON.stringify(before)}`)) throw new Error('读取中切语言丢失图片选择或提前替换');
    await read.finish();
    await waitFor("document.querySelector('#statusText').textContent === 'Image replaced'", '异步图片结果使用当前英文');
  });
  const after = await evaluate(imageSource);
  if (!after || before === after) throw new Error('双语替换没有更新实际图片');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '图片已替换'", '图片结果切中文');
  await click('#undo'); await waitFor(`${imageSource} === ${JSON.stringify(before)}`, '替换图片撤销');
  await click('#redo'); await waitFor(`${imageSource} === ${JSON.stringify(after)}`, '替换图片重做');
  await upload(context, null, '坏图片.png');
  await waitFor("document.querySelector('#statusText').textContent.startsWith('对象操作失败：')", '真实损坏图片错误');
  const diagnostic = await evaluate("document.querySelector('#statusText').textContent.slice('对象操作失败：'.length)");
  await click('[data-site-locale="en"]');
  await waitFor(`document.querySelector('#statusText').textContent === ${JSON.stringify('Object action failed: ' + diagnostic)}`, '图片错误摘要切语言不改诊断');
  if (!await evaluate(`${imageSource} === ${JSON.stringify(after)}`)) throw new Error('损坏图片改变了画布');
  await click('#undo'); await waitFor(`${imageSource} === ${JSON.stringify(before)}`, '损坏图片不产生历史');
  await click('#redo');
  await captureSaveAndReopen(context, 'image-language-saved.pptx');
  await selectPaneObject(context, 'image-external');
  const saved = await evaluate(`(async () => {
    const digest = async (url) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await fetch(url).then((response) => response.arrayBuffer())))].join(',');
    return { sameBytes: await digest(${imageSource}) === await digest('/assets/replacement.png'),
      crop: document.querySelector('#cropImageTen').getAttribute('aria-pressed'), undo: document.querySelector('#undo').disabled };
  })()`, true);
  if (!saved.sameBytes || saved.crop !== 'true' || !saved.undo) throw new Error(`双语图片与裁剪未保存重开：${JSON.stringify(saved)}`);
  await runAbandonedImageRead(context);
}

async function runAbandonedImageRead(context) {
  const { evaluate, click, waitFor } = context;
  await withDelayedFileRead(context, '迟到图片.png', async (read) => {
    try {
      await upload(context, '/assets/replacement.png', '迟到图片.png');
      await read.wait();
      await evaluate("globalThis.__oldImageRoot = document.querySelector('[data-image-insert-state=\"reading\"]')");
      await evaluate("globalThis.__oldImageErrors = 0; globalThis.__oldImageRoot.addEventListener('webpptimageerror', () => globalThis.__oldImageErrors++)");
      await openFixture(context, '/fixtures/sample-editor-shape-format.pptx', 'after-image-read.pptx');
      await click('[data-site-locale="zh-CN"]');
      const status = await evaluate("document.querySelector('#statusText').textContent");
      await read.finish();
      await waitFor("globalThis.__oldImageRoot.dataset.imageInsertState === 'idle' && !globalThis.__oldImageRoot.hasAttribute('aria-busy')", '旧图片请求取消并释放忙碌状态');
      if (!await evaluate(`document.querySelector('#statusText').textContent === ${JSON.stringify(status)}
        && !globalThis.__oldImageErrors
        && document.querySelector('#fileName').textContent === 'after-image-read.pptx' && document.querySelector('#undo').disabled`)) {
        throw new Error('旧文稿的迟到图片错误覆盖了新文稿状态');
      }
    } finally { await evaluate('delete globalThis.__oldImageRoot; delete globalThis.__oldImageErrors'); }
  });
  await click('[data-site-locale="en"]');
}

async function upload({ evaluate }, url, name) {
  await evaluate(`(async () => {
    const bytes = ${url ? `await fetch(${JSON.stringify(url)}).then((response) => response.arrayBuffer())` : "'invalid'"};
    const files = new DataTransfer(); files.items.add(new File([bytes], ${JSON.stringify(name)}, { type: 'image/png' }));
    const input = document.querySelector('#replaceImageInput'); input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
}
