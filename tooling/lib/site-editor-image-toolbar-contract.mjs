import {
  openFixture, saveAndReopen, selectPaneObject,
} from './site-editor-browser-helpers.mjs';

async function selectedImageHref(evaluate) {
  return evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-pane-element]')]
      .find((candidate) => candidate.getAttribute('aria-selected') === 'true');
    const id = row?.dataset.paneElement;
    const image = id && document.querySelector('[data-edit-id="' + CSS.escape(id) + '"] image');
    return image?.getAttribute('href') || image?.getAttribute('xlink:href') || '';
  })()`);
}

export async function runSiteEditorImageToolbarContract(context) {
  const { evaluate, waitFor, click } = context;
  await openFixture(context, '/fixtures/sample-editor-image-content.pptx', 'image-content.pptx');
  await selectPaneObject(context, 'image-external');
  await waitFor("!document.querySelector('#imageInspector').hidden", '图片上下文面板');

  await click('#startImageCrop');
  await waitFor("!!document.querySelector('[data-edit-crop-id]')", '裁剪手势入口');
  await click('#finishImageCrop');
  await waitFor("!document.querySelector('[data-edit-crop-id]')", '结束裁剪手势');

  const cropBefore = await evaluate("document.querySelector('#cropImageTen').getAttribute('aria-pressed')");
  await click('#cropImageTen');
  await waitFor("document.querySelector('#cropImageTen').getAttribute('aria-pressed') === 'true'", '图片裁剪写入');
  await click('#undo');
  await waitFor(`document.querySelector('#cropImageTen').getAttribute('aria-pressed') === ${JSON.stringify(cropBefore)}`, '图片裁剪撤销');
  await click('#redo');
  await waitFor("document.querySelector('#cropImageTen').getAttribute('aria-pressed') === 'true'", '图片裁剪重做');

  const hrefBefore = await selectedImageHref(evaluate);
  await evaluate(`(async () => {
    const bytes = await fetch('/assets/replacement.png').then((response) => response.arrayBuffer());
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'replacement.png', { type: 'image/png' }));
    const input = document.querySelector('#replaceImageInput'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor("document.querySelector('#statusText').textContent === '图片已替换'", '图片替换写入');
  const hrefAfter = await selectedImageHref(evaluate);
  if (!hrefAfter || hrefAfter === hrefBefore) throw new Error('替换图片没有更新真实画布图片源');
  await click('#undo');
  await waitFor(`(() => {
    const row = [...document.querySelectorAll('[data-pane-element]')].find((node) => node.getAttribute('aria-selected') === 'true');
    const image = row && document.querySelector('[data-edit-id="' + CSS.escape(row.dataset.paneElement) + '"] image');
    return (image?.getAttribute('href') || image?.getAttribute('xlink:href') || '') === ${JSON.stringify(hrefBefore)};
  })()`, '图片替换撤销');
  await click('#redo');
  await waitFor(`(() => {
    const row = [...document.querySelectorAll('[data-pane-element]')].find((node) => node.getAttribute('aria-selected') === 'true');
    const image = row && document.querySelector('[data-edit-id="' + CSS.escape(row.dataset.paneElement) + '"] image');
    return (image?.getAttribute('href') || image?.getAttribute('xlink:href') || '') !== ${JSON.stringify(hrefBefore)};
  })()`, '图片替换重做');

  await saveAndReopen(context, 'image-content-reopen.pptx');
  await selectPaneObject(context, 'image-external');
  await waitFor("document.querySelector('#cropImageTen').getAttribute('aria-pressed') === 'true'", '图片裁剪重开验证');
  const reopenedHref = await selectedImageHref(evaluate);
  if (!reopenedHref || reopenedHref === hrefBefore) throw new Error('替换图片没有保存重开');
}
