import {
  openFixture, saveAndReopen, selectPaneObject,
} from './site-editor-browser-helpers.mjs';

async function paneId(evaluate, name) {
  return evaluate(`([...document.querySelectorAll('[data-pane-element]')]
    .find((candidate) => candidate.querySelector('[data-pane-name]')?.textContent === ${JSON.stringify(name)}))?.dataset.paneElement`);
}

async function fillAttribute(evaluate, name) {
  return evaluate(`(() => {
    const id = ([...document.querySelectorAll('[data-pane-element]')]
      .find((candidate) => candidate.querySelector('[data-pane-name]')?.textContent === ${JSON.stringify(name)}))?.dataset.paneElement;
    return id ? document.querySelector('[data-edit-id="' + CSS.escape(id) + '"] [fill]')?.getAttribute('fill') : null;
  })()`);
}

export async function runSiteEditorProductToolbarContract(context) {
  const { evaluate, waitFor, click } = context;
  await openFixture(context, '/fixtures/sample-editor-format-painter.pptx', 'format-painter.pptx');
  await selectPaneObject(context, 'format-source');
  const targetId = await paneId(evaluate, 'format-target-local');
  const targetFillBefore = await fillAttribute(evaluate, 'format-target-local');
  await click('#formatPainter');
  await waitFor("document.querySelector('#formatPainter').getAttribute('aria-pressed') === 'true'", '单次格式刷启用');
  await click(`[data-edit-id="${targetId}"]`);
  await waitFor("document.querySelector('#formatPainter').getAttribute('aria-pressed') === 'false'", '单次格式刷应用');
  const targetFillAfter = await fillAttribute(evaluate, 'format-target-local');
  if (targetFillAfter === targetFillBefore) throw new Error('单次格式刷没有改变目标外观');
  await click('#undo');
  await waitFor(`(() => {
    const row = [...document.querySelectorAll('[data-pane-element]')].find((candidate) => candidate.querySelector('[data-pane-name]')?.textContent === 'format-target-local');
    return row && document.querySelector('[data-edit-id="' + CSS.escape(row.dataset.paneElement) + '"] [fill]')?.getAttribute('fill') === ${JSON.stringify(targetFillBefore)};
  })()`, '格式刷撤销');
  await click('#redo');
  await waitFor(`(() => {
    const row = [...document.querySelectorAll('[data-pane-element]')].find((candidate) => candidate.querySelector('[data-pane-name]')?.textContent === 'format-target-local');
    return row && document.querySelector('[data-edit-id="' + CSS.escape(row.dataset.paneElement) + '"] [fill]')?.getAttribute('fill') !== ${JSON.stringify(targetFillBefore)};
  })()`, '格式刷重做');

  await selectPaneObject(context, 'format-source');
  await click('#formatPainterContinuous');
  await waitFor("document.querySelector('#formatPainterContinuous').getAttribute('aria-pressed') === 'true'", '连续格式刷启用');
  const emptyFillBefore = await fillAttribute(evaluate, 'format-empty-source');
  const emptyId = await paneId(evaluate, 'format-empty-source');
  await click(`[data-edit-id="${emptyId}"]`);
  await waitFor("document.querySelector('#formatPainterContinuous').getAttribute('aria-pressed') === 'true'", '连续格式刷保持启用');
  await waitFor(`(() => {
    const row = [...document.querySelectorAll('[data-pane-element]')].find((candidate) => candidate.querySelector('[data-pane-name]')?.textContent === 'format-empty-source');
    return row && document.querySelector('[data-edit-id="' + CSS.escape(row.dataset.paneElement) + '"] [fill]')?.getAttribute('fill') !== ${JSON.stringify(emptyFillBefore)};
  })()`, '连续格式刷应用');
  const emptyFillAfter = await fillAttribute(evaluate, 'format-empty-source');
  if (emptyFillAfter === emptyFillBefore) throw new Error('连续格式刷没有改变目标外观');
  await click('#formatPainterContinuous');
  await waitFor("document.querySelector('#formatPainterContinuous').getAttribute('aria-pressed') === 'false'", '连续格式刷退出');
  await click('#undo'); await click('#redo');

  await saveAndReopen(context, 'format-painter-reopen.pptx');
  const reopenedFill = await fillAttribute(evaluate, 'format-target-local');
  if (!reopenedFill || reopenedFill === targetFillBefore) throw new Error('格式刷没有保存重开');
  const reopenedEmptyFill = await fillAttribute(evaluate, 'format-empty-source');
  if (!reopenedEmptyFill || reopenedEmptyFill === emptyFillBefore) throw new Error('连续格式刷没有保存重开');
}
