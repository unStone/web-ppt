import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function selectMarkers(window, first, firstOffset, last = first, lastOffset = firstOffset) {
  const range = window.document.createRange();
  range.setStart(first.firstChild, firstOffset);
  range.setEnd(last.firstChild, lastOffset);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 从发布挂载入口验证段落工具栏只消费公开 Range seam。 */
export async function runParagraphFormatEditorContract({ check, lib, root, window }) {
  console.log('\n\x1b[36m▸ DOM 文字段落格式\x1b[0m');
  const session = await lib.openEditor(
    new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-text.pptx'))),
    { idPrefix: 'editor-paragraph-format-' },
  );
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === '段落格式');
  const container = document.createElement('div');
  const secondaryContainer = document.createElement('div');
  const toolbar = document.createElement('div');
  document.body.append(container, secondaryContainer, toolbar);
  const view = session.mount(container, { mode: 'edit' });
  const secondary = session.mount(secondaryContainer, { mode: 'view' });
  const unregister = view.registerTextUi(toolbar);
  container.querySelector(`[data-edit-id="${record.id}"]`)
    .dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, composed: true }));

  let editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const first = editable.querySelector('[data-r="0.0"]');
  const second = editable.querySelector('[data-r="1.0"]');
  selectMarkers(window, first, 1, second, 2);
  second.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, composed: true, button: 0 }));
  toolbar.dispatchEvent(new window.PointerEvent('pointerdown', {
    bubbles: true, composed: true, button: 0, isPrimary: true,
  }));
  const secondaryBefore = secondaryContainer.querySelector(`[data-edit-id="${record.id}"]`)?.outerHTML;
  const before = view.queryParaProps();
  const applied = view.setParaProps({ align: 'justify', spaceBefore: 16 });
  editable = container.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const selection = window.getSelection();
  const paragraphs = session.editor.effectiveElement(record.id).text.paragraphs;
  check('外置工具栏按真实跨段 Range 查询并设置段落格式',
    before?.align.mixed && applied
      && paragraphs[0].align === 'justify' && paragraphs[1].align === 'justify'
      && paragraphs[0].spaceBefore === 16 && paragraphs[1].spaceBefore === 16
      && paragraphs[2].align === 'right'
      && !!editable && selection?.rangeCount === 1 && !selection.getRangeAt(0).collapsed);
  check('段落格式事务同步刷新同会话其它挂载视图',
    secondaryContainer.querySelector(`[data-edit-id="${record.id}"]`)?.outerHTML !== secondaryBefore);

  const marker = editable.querySelector('[data-r="0.0"]');
  selectMarkers(window, marker, 2);
  const collapsed = view.setParaProps({ lineHeight: 1.8, indent: -8 });
  check('折叠 DOM 光标立即格式化当前段并形成一个历史单元',
    collapsed && session.editor.effectiveElement(record.id).text.paragraphs[0].lineHeight === 1.8
      && session.editor.effectiveElement(record.id).text.paragraphs[0].indent === -8
      && session.editor.history.undoCount === 2);

  view.setMode('view');
  check('view 模式关闭段落查询与命令入口',
    view.queryParaProps() === null && view.setParaProps({ align: 'left' }) === false);
  unregister();
  secondary.destroy();
  view.destroy();
  session.dispose();
  container.remove();
  secondaryContainer.remove();
  toolbar.remove();
}
