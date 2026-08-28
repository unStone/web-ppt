import { recordPerformanceBudget } from './browser-performance-contract.mjs';

function selectAcross(root) {
  const first = root.querySelector('[data-r="0.0"]')?.firstChild;
  const second = root.querySelector('[data-r="1.0"]')?.firstChild;
  if (!first || !second) throw new Error('段落格式固件缺少真实文本节点');
  const range = document.createRange();
  range.setStart(first, 1);
  range.setEnd(second, Math.min(2, second.textContent.length));
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 真实浏览器验证跨段 Range、外置工具栏、多视图与完整上屏预算。 */
export async function runEditorParagraphBrowserContract({ openEditor, load }) {
  const session = await openEditor(await load('sample-editor-text.pptx'), {
    idPrefix: 'browser-paragraph-format-',
  });
  const mount = document.createElement('div');
  const secondaryMount = document.createElement('div');
  const toolbar = document.createElement('div');
  for (const element of [mount, secondaryMount, toolbar]) {
    element.className = 'contract-offscreen';
    document.body.append(element);
  }
  const view = session.mount(mount, { mode: 'edit' });
  const secondary = session.mount(secondaryMount, { mode: 'view' });
  const unregister = view.registerTextUi(toolbar);
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === '段落格式');
  mount.querySelector(`[data-edit-id="${record.id}"]`).dispatchEvent(
    new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }),
  );
  let editable = mount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  selectAcross(editable);
  editable.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, composed: true, button: 0, isPrimary: true,
  }));
  toolbar.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, composed: true, button: 0, isPrimary: true,
  }));
  const before = view.queryParaProps();
  const secondaryBefore = secondaryMount.querySelector(`[data-edit-id="${record.id}"]`)?.outerHTML;
  const samples = [];
  for (let index = 0; index < 40; index++) {
    const started = performance.now();
    if (!view.setParaProps({ align: index % 2 ? 'left' : 'justify', spaceAfter: index % 2 ? 4 : 9 })) {
      throw new Error('真实浏览器段落格式命令未接受当前 Range');
    }
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  editable = mount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  const selection = getSelection();
  const paragraphs = session.editor.effectiveElement(record.id).text.paragraphs;
  const ok = before?.align.mixed
    && paragraphs[0].align === 'left' && paragraphs[1].align === 'left'
    && paragraphs[2].align === 'right'
    && !!editable && selection?.rangeCount === 1 && !selection.getRangeAt(0).collapsed
    && secondaryMount.querySelector(`[data-edit-id="${record.id}"]`)?.outerHTML !== secondaryBefore;
  view.setMode('view');
  const isolated = view.queryParaProps() === null && !view.setParaProps({ align: 'center' });
  unregister();
  secondary.destroy();
  view.destroy();
  session.dispose();
  mount.remove();
  secondaryMount.remove();
  toolbar.remove();
  if (!ok || !isolated) throw new Error('真实浏览器段落格式的模型、选区或多视图隔离失败');
  recordPerformanceBudget('真实浏览器段落格式 p95', p95, 30);
  return p95;
}
