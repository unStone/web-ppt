import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const textOf = (element) => element.text?.paragraphs
  .map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n') ?? '';

function caretAtEnd(root) {
  const markers = [...root.querySelectorAll('[data-r]')];
  const marker = markers.at(-1);
  const walker = document.createTreeWalker(marker, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let last = node;
  while (node) { last = node; node = walker.nextNode(); }
  const range = document.createRange();
  range.setStart(last ?? marker, last?.textContent.length ?? marker.childNodes.length);
  range.collapse(true);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 真实排版引擎里的输入上屏预算与 IME 节点稳定性。 */
export async function runEditorTextBrowserContract({ openEditor, load }) {
  const session = await openEditor(await load('sample-editor-text.pptx'), { idPrefix: 'browser-text-' });
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const view = session.mount(mount, { mode: 'edit', zoom: 1 });
  const record = Object.values(session.editor.doc.elements).find((candidate) => candidate.src.name === '旋转文本');
  const partition = mount.querySelector(`[data-edit-id="${record.id}"]`);
  partition.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }));
  let editable = mount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  if (!editable) throw new Error('旋转文本没有进入 contenteditable 编辑面');
  const transform = new DOMMatrix(editable.style.transform);
  if (Math.abs(transform.b) < 0.01 || session.editor.selection.kind !== 'text') {
    throw new Error('旋转文本没有进入仿射 contenteditable 编辑面');
  }

  const samples = [];
  let prevented = 0;
  for (let index = 0; index < 80; index++) {
    editable = mount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
    caretAtEnd(editable);
    const started = performance.now();
    const input = new InputEvent('beforeinput', {
      bubbles: true, composed: true, cancelable: true, inputType: 'insertText', data: String(index % 10),
    });
    const accepted = editable.dispatchEvent(input);
    if (!accepted) prevented++;
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const editedText = textOf(session.editor.effectiveElement(record.id));
  if (prevented !== 80 || !editedText.endsWith('0123456789')) {
    throw new Error(`文字按键提交失败：${prevented}/80`);
  }
  recordPerformanceBudget('文字按键到上屏 p95', p95, 30);
  if (mount.querySelector(`[data-edit-id="${record.id}"]`) !== partition) {
    throw new Error('文字输入热路径重绘了被遮挡的静态 SVG 分区');
  }

  editable = mount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
  caretAtEnd(editable);
  const identity = editable;
  editable.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, composed: true }));
  editable.dispatchEvent(new InputEvent('input', {
    bubbles: true, composed: true, inputType: 'insertCompositionText', data: '组', isComposing: true,
  }));
  if (mount.querySelector(`[data-ppt-text-editor="${record.id}"]`) !== identity) {
    throw new Error('IME 组词期间替换了 contenteditable 节点');
  }
  // 合成事件只验证生命周期；可信 IME 契约随后由 DevTools 输入域提交真实文字。
  editable.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, composed: true, data: '' }));
  return { session, view, mount, id: record.id, p95 };
}
