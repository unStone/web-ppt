import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const percentile95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

/** 普通 textarea、同页双编辑视图与查看视图共同守住备注的零画布重绘边界。 */
export async function runEditorSlideNotesBrowserContract({ openEditor, load }) {
  const mounts = [document.createElement('div'), document.createElement('div'), document.createElement('div')];
  for (const mount of mounts) {
    mount.className = 'contract-offscreen';
    document.body.append(mount);
  }
  const textarea = document.createElement('textarea');
  textarea.className = 'contract-offscreen';
  document.body.append(textarea);
  const session = await openEditor(await load('sample-editor-notes.pptx'), {
    idPrefix: 'browser-slide-notes-',
  });
  const slideId = session.editor.doc.slideOrder[0];
  const first = session.mount(mounts[0], { slideId, mode: 'edit', textMode: 'svg' });
  const second = session.mount(mounts[1], { slideId, mode: 'edit', textMode: 'svg' });
  const view = session.mount(mounts[2], { slideId, mode: 'view', textMode: 'svg' });
  const staticSlides = mounts.map((mount) =>
    mount.querySelector('[data-ppt-layer="static"] svg'));
  const source = first.queryNotes();
  if (source.value !== '来源第一段\n\n来源第三段\n' || source.direct
    || second.queryNotes().value !== source.value || view.queryNotes().value !== source.value) {
    throw new Error('Chrome 多视图备注初始查询不一致');
  }
  if (view.setNotes('查看模式越权') || first.queryNotes().value !== source.value) {
    throw new Error('Chrome 查看模式修改了演讲者备注');
  }
  let notesEvents = 0;
  const unsubscribe = session.editor.subscribe((change) => {
    if (change.notesSlides.has(slideId)) notesEvents++;
  });
  textarea.addEventListener('input', () => { first.setNotes(textarea.value); });
  const samples = [];
  for (let index = 0; index < 40; index++) {
    textarea.value = (index % 2 ? '甲' : '乙').repeat(2000);
    const started = performance.now();
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    samples.push(performance.now() - started);
  }
  const p95 = percentile95(samples);
  const value = textarea.value;
  if (value.length !== 2000 || first.queryNotes().value !== value
    || second.queryNotes().value !== value || view.queryNotes().value !== value
    || !first.queryNotes().direct || notesEvents !== 40
    || mounts.some((mount, index) =>
      mount.querySelector('[data-ppt-layer="static"] svg') !== staticSlides[index])) {
    throw new Error('Chrome 备注 textarea、多视图同步或零画布重绘边界失败');
  }
  recordPerformanceBudget('Chrome 2,000 字符备注提交 p95', p95, 16);
  unsubscribe();
  session.dispose();
  textarea.remove();
  mounts.forEach((mount) => mount.remove());
  console.info(`2,000 字符备注提交 p95 ${p95.toFixed(3)}ms`);
  return { p95 };
}
