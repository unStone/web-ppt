import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const clipboardEvent = (type, data) => {
  const event = new ClipboardEvent(type, { bubbles: true, composed: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: data });
  return event;
};

function selectFirstCharacter(root) {
  const marker = root.querySelector('[data-r]');
  const text = marker?.firstChild;
  if (!text || !text.textContent.length) throw new Error('富文本粘贴固件缺少首字符');
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 1);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  root.focus({ preventScroll: true });
}

export async function runEditorRichTextClipboardBrowserContract({ openEditor, load }) {
  const session = await openEditor(await load('sample-editor-rich-clipboard.pptx'), {
    idPrefix: 'browser-rich-paste-',
  });
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const view = session.mount(mount, { mode: 'edit', zoom: 1 });
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === '富文本剪贴板');
  mount.querySelector(`[data-edit-id="${record.id}"]`).dispatchEvent(
    new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }),
  );
  const chunks = Array.from({ length: 200 }, (_, index) => String(index % 10).repeat(10));
  const plain = chunks.join('');
  const html = chunks.map((chunk, index) => index % 2
    ? `<i style="font-family:Arial;font-size:18px">${chunk}</i>`
    : `<b style="font-family:Calibri;font-size:20px">${chunk}</b>`).join('');
  const samples = [];
  for (let index = 0; index < 20; index++) {
    const editable = mount.querySelector(`[data-ppt-text-editor="${record.id}"]`);
    selectFirstCharacter(editable);
    const data = new DataTransfer();
    data.setData('text/plain', plain);
    data.setData('text/html', html);
    const started = performance.now();
    const accepted = editable.dispatchEvent(clipboardEvent('paste', data));
    mount.querySelector(`[data-ppt-text-editor="${record.id}"]`)?.getBoundingClientRect();
    samples.push(performance.now() - started);
    const runs = session.editor.effectiveElement(record.id).text.paragraphs[0].runs;
    if (accepted || runs.map((run) => run.text).join('').length !== plain.length + 2
      || !runs.some((run) => run.b && run.fonts[0] === 'Calibri')
      || !runs.some((run) => run.i && run.fonts[0] === 'Arial')) {
      throw new Error('真实浏览器富文本粘贴没有保留白名单格式');
    }
    session.editor.undo();
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  if (session.editor.history.undoCount !== 0) throw new Error('2,000 字符富文本粘贴撤销后历史不一致');
  recordPerformanceBudget('2,000 字符富文本粘贴完整上屏 p95', p95, 30);
  return { session, view, mount, id: record.id, p95 };
}
