import { changeValue, saveAndReopen } from './site-editor-browser-helpers.mjs';

export async function runSiteEditorSlideToolbarContract(context) {
  const { evaluate, waitFor, click } = context;
  await click('#newFile');
  await waitFor(`document.querySelector('#fileName')?.textContent === '未命名演示文稿.pptx'
    && document.querySelector('#slideCount')?.textContent === '1'`, '页面能力空白文稿');
  const layouts = await evaluate("document.querySelector('#slideLayout').options.length");
  if (layouts < 2) throw new Error('生成式空白文稿没有可用于版式切换的第二种版式');
  const layoutBefore = await evaluate("document.querySelector('#slideLayout').value");
  const layoutAfter = await evaluate("document.querySelector('#slideLayout').options[1].value");
  await changeValue(context, '#slideLayout', layoutAfter);
  await waitFor(`document.querySelector('#slideLayout').value === ${JSON.stringify(layoutAfter)}`, '版式切换');
  await click('#undo'); await waitFor(`document.querySelector('#slideLayout').value === ${JSON.stringify(layoutBefore)}`, '版式撤销');
  await click('#redo'); await waitFor(`document.querySelector('#slideLayout').value === ${JSON.stringify(layoutAfter)}`, '版式重做');
  await changeValue(context, '#slideNotes', 'MOVED'); await click('#applyNotes');

  await click('#addSlide'); await click('#addSlide');
  await waitFor("document.querySelector('#slideCount').textContent === '3'", '三页结构');
  await click('#slideList .slide-item:nth-child(1)');
  await waitFor("document.querySelector('#slideNotes').value === 'MOVED'", '返回首张页面');
  await click('#duplicateSlide');
  await waitFor("document.querySelector('#slideCount').textContent === '4'", '复制页面');
  await click('#undo'); await waitFor("document.querySelector('#slideCount').textContent === '3'", '复制页面撤销');
  await click('#redo'); await waitFor("document.querySelector('#slideCount').textContent === '4'", '复制页面重做');

  await click('#slideList .slide-item:nth-child(4)');
  await click('#deleteSlide');
  await waitFor("document.querySelector('#slideCount').textContent === '3'", '删除页面');
  await click('#undo'); await waitFor("document.querySelector('#slideCount').textContent === '4'", '删除页面撤销');
  await click('#redo'); await waitFor("document.querySelector('#slideCount').textContent === '3'", '删除页面重做');

  const orderBefore = await evaluate("[...document.querySelectorAll('#slideList [data-slide-id]')].map((node) => node.dataset.slideId)");
  await evaluate(`(() => {
    const items = [...document.querySelectorAll('#slideList [data-slide-id]')];
    const source = items[0]; const target = items[items.length - 1]; const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    const y = target.getBoundingClientRect().bottom - 1;
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: y }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: y }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
  })()`);
  await waitFor(`document.querySelector('#slideList .slide-item:last-child')?.dataset.slideId === ${JSON.stringify(orderBefore[0])}`, '拖动页面排序');
  await click('#undo');
  await waitFor(`JSON.stringify([...document.querySelectorAll('#slideList [data-slide-id]')].map((node) => node.dataset.slideId)) === ${JSON.stringify(JSON.stringify(orderBefore))}`, '页面排序撤销');
  await click('#redo');
  await waitFor(`document.querySelector('#slideList .slide-item:last-child')?.dataset.slideId === ${JSON.stringify(orderBefore[0])}`, '页面排序重做');

  await saveAndReopen(context, 'slide-tools-reopen.pptx');
  await waitFor("document.querySelector('#slideCount').textContent === '3'", '页面结构重开');
  const notes = [];
  for (let index = 1; index <= 3; index++) {
    await click(`#slideList .slide-item:nth-child(${index})`);
    notes.push(await evaluate("document.querySelector('#slideNotes').value"));
  }
  if (notes.join('|') !== 'MOVED||MOVED') {
    throw new Error(`复制、删除或排序没有保存重开：${notes.join('|')}`);
  }
  const reopenedLayout = await evaluate("document.querySelector('#slideLayout').selectedIndex");
  if (reopenedLayout !== 1) throw new Error(`页面版式没有保存重开：index=${reopenedLayout}`);
}
