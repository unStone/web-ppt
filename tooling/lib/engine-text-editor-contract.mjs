import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const paragraphText = (element, paragraph = 0) => element.text.paragraphs[paragraph].runs
  .map((run) => run.text).join('');

function firstText(node) {
  const walker = node.ownerDocument.createTreeWalker(node, 4);
  return walker.nextNode();
}

/** 发布挂载入口必须让 svg 文本模式的 Range 消费 engine 分段。 */
export async function runEngineTextEditorContract({ check, lib, root, window }) {
  console.log('\n\x1b[36m▸ DOM engine 行盒文字编辑\x1b[0m');
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-engine-text.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-engine-text-' });
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === 'Engine 跨行基准');
  const container = document.createElement('div');
  document.body.append(container);
  const view = session.mount(container, { mode: 'edit', textMode: 'svg' });
  container.querySelector(`[data-edit-id="${record.id}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  let editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const engineRoot = editable?.querySelector('[data-layout="engine"]');
  if (!check('svg 文本模式进入编辑后使用 engine 行盒',
    !!engineRoot && engineRoot.querySelectorAll('[data-engine-line]').length >= 4)) {
    view.destroy(); session.dispose(); container.remove(); return;
  }

  let split = [...engineRoot.querySelectorAll('[data-r="0.0"][data-from]')];
  let marker = split[1];
  let text = marker && firstText(marker);
  let range = window.document.createRange();
  range.setStart(text, 1); range.collapse(true);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  const paragraphCaret = Number(marker.dataset.from) + 1;
  const paragraphApplied = view.setParaProps({ spaceBefore: 8 });
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  let caretSelection = window.getSelection();
  let caretRange = window.document.createRange();
  caretRange.setStart(editable, 0);
  caretRange.setEnd(caretSelection.anchorNode, caretSelection.anchorOffset);
  check('仅改段落格式后仍把光标恢复到跨行 run 的目标视觉分段',
    paragraphApplied && caretSelection.isCollapsed
      && caretRange.cloneContents().textContent.length === paragraphCaret,
  `actual=${caretRange.cloneContents().textContent.length} expected=${paragraphCaret}`);
  session.editor.undo();

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const surrogateMarker = [...editable.querySelectorAll('[data-r="0.3"][data-from]')]
    .find((candidate) => candidate.textContent.includes('😀'));
  const surrogateText = firstText(surrogateMarker);
  const surrogateOffset = surrogateText.textContent.indexOf('😀') + 2;
  range = window.document.createRange();
  range.setStart(surrogateText, surrogateOffset); range.collapse(true);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  const insertAfterSurrogate = new window.InputEvent('beforeinput', {
    inputType: 'insertText', data: 'S', bubbles: true, composed: true, cancelable: true,
  });
  editable.dispatchEvent(insertAfterSurrogate);
  check('engine Range 以 UTF-16 偏移越过完整代理项且不拆坏字符',
    insertAfterSurrogate.defaultPrevented
      && paragraphText(session.editor.effectiveElement(record.id)).includes('😀S'));
  session.editor.undo();

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const rtlMarker = editable.querySelector('[data-r="2.0"][data-from]');
  const rtlText = firstText(rtlMarker);
  const rtlBefore = paragraphText(session.editor.effectiveElement(record.id), 2);
  const rtlAt = Number(rtlMarker.dataset.from) + 1;
  range = window.document.createRange();
  range.setStart(rtlText, 1); range.collapse(true);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  const insertRtl = new window.InputEvent('beforeinput', {
    inputType: 'insertText', data: 'R', bubbles: true, composed: true, cancelable: true,
  });
  editable.dispatchEvent(insertRtl);
  check('RTL 物理反向行盒仍按源 UTF-16 顺序映射输入',
    insertRtl.defaultPrevented
      && paragraphText(session.editor.effectiveElement(record.id), 2)
        === rtlBefore.slice(0, rtlAt) + 'R' + rtlBefore.slice(rtlAt));
  session.editor.undo();

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  split = [...editable.querySelectorAll('[data-r="0.0"][data-from]')];
  marker = split[1];
  text = marker && firstText(marker);
  const source = paragraphText(session.editor.effectiveElement(record.id));
  const insertion = Number(marker?.dataset.from) + 1;
  range = window.document.createRange();
  range.setStart(text, 1); range.collapse(true);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  const input = new window.InputEvent('beforeinput', {
    inputType: 'insertText', data: 'X', bubbles: true, composed: true, cancelable: true,
  });
  editable.dispatchEvent(input);
  check('跨视觉行的重复 data-r Range 精确映射回源 run 偏移',
    input.defaultPrevented
      && paragraphText(session.editor.effectiveElement(record.id))
        === source.slice(0, insertion) + 'X' + source.slice(insertion)
      && session.editor.history.undoCount === 1);

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  check('模型提交后 engine 行盒重算且仍关闭浏览器断行',
    editable.querySelector('[data-layout="engine"]')?.style.whiteSpace === 'pre'
      && editable.querySelectorAll('[data-engine-line]').length >= 4);
  caretSelection = window.getSelection();
  caretRange = window.document.createRange();
  caretRange.setStart(editable, 0);
  caretRange.setEnd(caretSelection.anchorNode, caretSelection.anchorOffset);
  check('重渲后光标恢复到跨行 run 的目标分段而非第一个同名标记末尾',
    caretSelection.isCollapsed && caretRange.cloneContents().textContent.length === insertion + 1,
  `actual=${caretRange.cloneContents().textContent.length} expected=${insertion + 1}`);

  session.editor.undo();
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const breakMarker = editable.querySelector('[data-r="0.2"]');
  range = window.document.createRange();
  range.setStart(breakMarker, 0); range.setEnd(breakMarker, breakMarker.childNodes.length);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  const deleteBreak = new window.InputEvent('beforeinput', {
    inputType: 'deleteContentBackward', bubbles: true, composed: true, cancelable: true,
  });
  editable.dispatchEvent(deleteBreak);
  check('engine DOM 中不可见的 a:br 语义锚点可作为一个字符整块删除',
    deleteBreak.defaultPrevented
      && !paragraphText(session.editor.effectiveElement(record.id)).includes('\n')
      && session.editor.history.undoCount === 1);
  session.editor.undo();

  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const emptyMarker = editable.querySelector('[data-p="1"] [data-empty="true"]');
  const emptyText = firstText(emptyMarker);
  range = window.document.createRange();
  range.setStart(emptyText, 0); range.collapse(true);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  const fillEmpty = new window.InputEvent('beforeinput', {
    inputType: 'insertText', data: '空', bubbles: true, composed: true, cancelable: true,
  });
  editable.dispatchEvent(fillEmpty);
  check('engine 空段保留零宽定位语义并可直接输入',
    fillEmpty.defaultPrevented
      && paragraphText(session.editor.effectiveElement(record.id), 1) === '空'
      && session.editor.history.undoCount === 1);
  session.editor.undo();

  const formulaRecord = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === 'Engine 公式基准');
  container.querySelector(`[data-edit-id="${formulaRecord.id}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  editable = container.querySelector(`[data-ppt-text-editor="${formulaRecord.id}"]`);
  const formula = editable.querySelector('svg[data-r="0.1"][data-from="0"][data-to="1"]');
  const formulaParent = formula.parentNode;
  const formulaIndex = [...formulaParent.childNodes].indexOf(formula);
  range = window.document.createRange();
  range.setStart(formulaParent, formulaIndex); range.setEnd(formulaParent, formulaIndex + 1);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  const deleteFormula = new window.InputEvent('beforeinput', {
    inputType: 'deleteContentBackward', bubbles: true, composed: true, cancelable: true,
  });
  editable.dispatchEvent(deleteFormula);
  check('engine 公式仍只暴露两侧 Range 并可整原子删除',
    deleteFormula.defaultPrevented
      && !session.editor.effectiveElement(formulaRecord.id).text.paragraphs[0].runs
        .some((run) => run.math?.length));
  session.editor.undo();

  const verticalRecord = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === 'Engine 竖排基准');
  container.querySelector(`[data-edit-id="${verticalRecord.id}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  editable = container.querySelector(`[data-ppt-text-editor="${verticalRecord.id}"]`);
  const verticalRoot = editable.querySelector('[data-layout="engine"]');
  check('竖排编辑面复用 engine 局部仿射而不建立另一套输入 DOM',
    verticalRoot.style.transform.replace(/\s/g, '').startsWith('matrix(0,1,-1,0,'));
  const verticalMarker = editable.querySelector('[data-r="0.0"][data-from]');
  const verticalText = firstText(verticalMarker);
  range = window.document.createRange();
  range.setStart(verticalText, 1); range.collapse(true);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  const insertVertical = new window.InputEvent('beforeinput', {
    inputType: 'insertText', data: 'V', bubbles: true, composed: true, cancelable: true,
  });
  editable.dispatchEvent(insertVertical);
  check('竖排行盒输入仍按未旋转模型顺序提交',
    insertVertical.defaultPrevented
      && paragraphText(session.editor.effectiveElement(verticalRecord.id)).startsWith('竖V'));
  session.editor.undo();
  view.destroy(); session.dispose(); container.remove();

  const browserSession = await lib.openEditor(bytes, { idPrefix: 'editor-browser-text-' });
  const browserRecord = Object.values(browserSession.editor.doc.elements)
    .find((candidate) => candidate.src.name === 'Engine 跨行基准');
  const browserContainer = document.createElement('div');
  document.body.append(browserContainer);
  const browserView = browserSession.mount(browserContainer, { mode: 'edit', textMode: 'html' });
  browserContainer.querySelector(`[data-edit-id="${browserRecord.id}"]`).dispatchEvent(
    new window.MouseEvent('dblclick', { bubbles: true, composed: true }),
  );
  check('html 文本模式保持 browser 行盒且不生成 engine 私有分段',
    !browserContainer.querySelector('[data-layout="engine"]')
      && !browserContainer.querySelector('[data-engine-line]'));
  browserView.destroy(); browserSession.dispose(); browserContainer.remove();
}
