import { setFontDecoder } from '@web-ppt/core';
import {
  openEditor,
  type EditorMode,
  type EditorSession,
  type SelectionPane,
  type SlideEditor,
} from '@web-ppt/editor';
import { eotToTtf } from 'mtx-decompressor';

setFontDecoder(eotToTtf);

const $ = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;
const app = $<HTMLElement>('#editorApp');
const toolbar = $<HTMLElement>('#editorToolbar');
const fileInput = $<HTMLInputElement>('#fileInput');
const fileName = $<HTMLElement>('#fileName');
const canvasViewport = $<HTMLElement>('#canvasViewport');
const canvasMount = $<HTMLElement>('#canvasMount');
const canvasState = $<HTMLElement>('#canvasState');
const objectList = $<HTMLElement>('#objectList');
const slideList = $<HTMLElement>('#slideList');
const slideCount = $<HTMLElement>('#slideCount');
const statusText = $<HTMLElement>('#statusText');
const documentKind = $<HTMLElement>('#documentKind');
const pageIndicator = $<HTMLElement>('#pageIndicator');
const zoomLabel = $<HTMLElement>('#zoomLabel');
const dropLayer = $<HTMLElement>('#dropLayer');

const buttons = {
  edit: $<HTMLButtonElement>('#editMode'),
  view: $<HTMLButtonElement>('#viewMode'),
  undo: $<HTMLButtonElement>('#undo'),
  redo: $<HTMLButtonElement>('#redo'),
  addShape: $<HTMLButtonElement>('#addShape'),
  addImage: $<HTMLButtonElement>('#addImage'),
  addTable: $<HTMLButtonElement>('#addTable'),
  play: $<HTMLButtonElement>('#playAnimations'),
  zoomOut: $<HTMLButtonElement>('#zoomOut'),
  fit: $<HTMLButtonElement>('#fitZoom'),
  zoomIn: $<HTMLButtonElement>('#zoomIn'),
  save: $<HTMLButtonElement>('#saveFile'),
  prev: $<HTMLButtonElement>('#prevSlide'),
  next: $<HTMLButtonElement>('#nextSlide'),
};

let session: EditorSession | null = null;
let view: SlideEditor | null = null;
let pane: SelectionPane | null = null;
let unsubscribeEditor: (() => void) | null = null;
let unregisterToolbar: (() => void) | null = null;
let mode: EditorMode = 'edit';
let zoom = 1;
let fitWanted = true;
let activeName = 'showcase.pptx';
let openGeneration = 0;

function explain(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notice(message: string, tone: 'normal' | 'success' | 'error' = 'normal'): void {
  statusText.textContent = message;
  statusText.dataset.tone = tone;
}

function setLoading(message: string): void {
  canvasState.hidden = false;
  canvasState.querySelector('strong')!.textContent = message;
  canvasState.querySelector('small')!.textContent = '解析和渲染完全在浏览器中进行';
  canvasState.querySelector('.spinner')?.removeAttribute('hidden');
  app.dataset.loading = 'true';
  syncControls();
}

function hideLoading(): void {
  canvasState.hidden = true;
  delete app.dataset.loading;
  syncControls();
}

function currentIndex(): number {
  if (!session || !view) return -1;
  return session.editor.doc.slideOrder.indexOf(view.slideId);
}

function canEditDocument(): boolean {
  const doc = session?.editor.doc;
  return !!doc && !doc.meta.readonly && doc.meta.source === 'pptx';
}

function syncControls(): void {
  const editor = session?.editor;
  const ready = !!editor && !app.dataset.loading;
  const writable = ready && canEditDocument();
  const index = currentIndex();
  buttons.undo.disabled = !writable || mode !== 'edit' || !editor!.history.undoCount;
  buttons.redo.disabled = !writable || mode !== 'edit' || !editor!.history.redoCount;
  buttons.save.disabled = !writable;
  buttons.addShape.disabled = !writable || mode !== 'edit';
  buttons.addImage.disabled = !writable || mode !== 'edit';
  buttons.addTable.disabled = !writable || mode !== 'edit';
  buttons.play.disabled = !ready;
  buttons.edit.disabled = !writable;
  buttons.view.disabled = !ready;
  buttons.zoomOut.disabled = !ready;
  buttons.fit.disabled = !ready;
  buttons.zoomIn.disabled = !ready;
  buttons.prev.disabled = !ready || index <= 0;
  buttons.next.disabled = !ready || index < 0 || index >= editor!.doc.slideOrder.length - 1;
  buttons.edit.setAttribute('aria-pressed', String(mode === 'edit'));
  buttons.view.setAttribute('aria-pressed', String(mode === 'view'));
  const total = editor?.doc.slideOrder.length ?? 0;
  pageIndicator.textContent = index < 0 ? '— / —' : `${index + 1} / ${total}`;
  slideCount.textContent = String(total);
  documentKind.textContent = !editor ? 'PPTX · 可编辑' : canEditDocument()
    ? 'PPTX · 可编辑'
    : `${editor.doc.meta.source.toUpperCase()} · 只读预览`;
  const dirty = editor?.isDirty() ?? false;
  fileName.textContent = `${dirty ? '● ' : ''}${activeName}`;
  document.title = `${dirty ? '● ' : ''}${activeName} · Web-PPT 编辑器`;
  syncSlideSelection();
}

function syncSlideSelection(): void {
  const selected = view?.slideId;
  for (const item of slideList.querySelectorAll<HTMLButtonElement>('[data-slide-id]')) {
    item.setAttribute('aria-current', String(item.dataset.slideId === selected));
  }
}

function renderSlideList(): void {
  slideList.replaceChildren();
  const ids = session?.editor.doc.slideOrder ?? [];
  ids.forEach((id, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slide-item';
    button.dataset.slideId = id;
    button.setAttribute('aria-label', `打开第 ${index + 1} 页`);
    const number = document.createElement('span');
    number.className = 'slide-number';
    number.textContent = String(index + 1);
    const mini = document.createElement('span');
    mini.className = 'slide-mini';
    mini.textContent = `P${index + 1}`;
    button.append(number, mini);
    button.addEventListener('click', () => showSlide(id));
    slideList.append(button);
  });
  syncControls();
}

function showSlide(id: string): void {
  if (!session || !view || !session.editor.doc.slides[id]) return;
  view.setSlide(id);
  pane?.setSlide(id);
  syncControls();
  slideList.querySelector<HTMLElement>(`[data-slide-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

function setMode(next: EditorMode): void {
  if (!session || !view || next === 'edit' && !canEditDocument()) return;
  mode = next;
  view.setMode(next);
  pane?.setMode(next);
  syncControls();
  notice(next === 'edit' ? '编辑模式：双击文字，拖动或缩放元素' : '预览模式：点击链接并播放动画');
}

function applyZoom(next: number): void {
  if (!session || !view) return;
  zoom = Math.min(2.5, Math.max(.15, next));
  view.setZoom(zoom);
  view.element.style.width = `${session.editor.doc.meta.width * zoom}px`;
  view.element.style.height = `${session.editor.doc.meta.height * zoom}px`;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function fitView(): void {
  if (!session || !view) return;
  const { width, height } = session.editor.doc.meta;
  const availableWidth = Math.max(100, canvasViewport.clientWidth - 56);
  const availableHeight = Math.max(100, canvasViewport.clientHeight - 56);
  applyZoom(Math.min(1.5, availableWidth / width, availableHeight / height));
}

function disposeCurrent(): void {
  unsubscribeEditor?.();
  unregisterToolbar?.();
  unsubscribeEditor = null;
  unregisterToolbar = null;
  session?.dispose();
  session = null;
  view = null;
  pane = null;
  canvasMount.replaceChildren();
  objectList.replaceChildren();
  slideList.replaceChildren();
}

async function openDocument(source: File | Blob | ArrayBuffer | Uint8Array, name: string): Promise<void> {
  const generation = ++openGeneration;
  setLoading(`正在打开 ${name}`);
  notice(`正在解析 ${name}…`);
  try {
    const next = await openEditor(source);
    if (generation !== openGeneration) {
      next.dispose();
      return;
    }
    disposeCurrent();
    session = next;
    activeName = name;
    mode = canEditDocument() ? 'edit' : 'view';
    view = next.mount(canvasMount, { mode, zoom: 1, snapping: true, onError: reportError });
    pane = next.mountSelectionPane(objectList, { mode, ariaLabel: '当前页对象', onError: reportError });
    unregisterToolbar = view.registerTextUi(toolbar);
    unsubscribeEditor = next.editor.subscribe((change) => {
      if (change.createdSlides.size || change.removedSlides.size || change.movedSlides.size) renderSlideList();
      else syncControls();
    });
    renderSlideList();
    fitWanted = true;
    requestAnimationFrame(fitView);
    hideLoading();
    const message = next.editor.doc.meta.source === 'ppt'
      ? `${name} 已打开；当前版本尚未实现生成式 PPTX 保存，因此只提供安全预览`
      : next.editor.doc.meta.readonly
        ? `${name} 已打开；当前文件缺少安全写回上下文，只能预览`
        : `${name} 已就绪，可直接选择、拖动或双击编辑文字`;
    notice(message, canEditDocument() ? 'success' : 'normal');
    view.element.focus();
  } catch (error) {
    if (generation !== openGeneration) return;
    const failure = new Error(`打开失败：${explain(error)}`);
    if (session) {
      hideLoading();
      reportError(failure);
      view?.element.focus();
    } else {
      showOpenFailure(failure);
    }
  }
}

function reportError(error: unknown): void {
  notice(explain(error), 'error');
}

function showOpenFailure(error: unknown): void {
  canvasState.hidden = false;
  canvasState.querySelector('.spinner')?.setAttribute('hidden', '');
  canvasState.querySelector('strong')!.textContent = '演示文稿打开失败';
  canvasState.querySelector('small')!.textContent = explain(error);
  delete app.dataset.loading;
  reportError(error);
  syncControls();
}

function confirmReplacement(): boolean {
  return !session?.editor.isDirty() || window.confirm('当前修改还没有保存，仍然打开另一份文件吗？');
}

function tryOpenLocalFile(file: File | undefined): void {
  if (file && confirmReplacement()) void openDocument(file, file.name);
}

async function saveCopy(): Promise<void> {
  if (!session || !canEditDocument()) return;
  buttons.save.disabled = true;
  notice('正在生成 PPTX 副本…');
  try {
    const bytes = await session.editor.save();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }));
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: activeName.replace(/\.(pptx?|potx?|ppsx?)$/i, '') + '-edited.pptx',
    });
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice('已生成可继续编辑的 PPTX 副本', 'success');
  } catch (error) {
    reportError(error);
  } finally {
    syncControls();
  }
}

async function run(action: () => void | Promise<void>): Promise<void> {
  try { await action(); } catch (error) { reportError(error); }
}

buttons.edit.addEventListener('click', () => setMode('edit'));
buttons.view.addEventListener('click', () => setMode('view'));
buttons.undo.addEventListener('click', () => {
  if (session?.editor.undo()) notice('已撤销上一步');
  syncControls();
});
buttons.redo.addEventListener('click', () => {
  if (session?.editor.redo()) notice('已重做上一步');
  syncControls();
});
buttons.prev.addEventListener('click', () => {
  const index = currentIndex();
  const id = index > 0 ? session?.editor.doc.slideOrder[index - 1] : undefined;
  if (id) showSlide(id);
});
buttons.next.addEventListener('click', () => {
  const index = currentIndex();
  const id = index >= 0 ? session?.editor.doc.slideOrder[index + 1] : undefined;
  if (id) showSlide(id);
});
buttons.addShape.addEventListener('click', () => void run(() => {
  if (!session || !view) return;
  const { width, height } = session.editor.doc.meta;
  session.editor.exec({
    type: 'AddShape', slideId: view.slideId, preset: 'roundRect',
    rect: { x: width * .35, y: height * .34, w: width * .3, h: height * .22 },
  });
  view.element.focus();
  notice('已插入圆角矩形；拖动可移动，双击可输入文字', 'success');
}));
buttons.addImage.addEventListener('click', () => void run(async () => {
  if (!view) return;
  const id = await view.chooseImage();
  if (id) notice('图片已插入', 'success');
}));
buttons.addTable.addEventListener('click', () => void run(() => {
  if (!session || !view) return;
  const { width, height } = session.editor.doc.meta;
  view.insertTable(3, 3, { rect: { x: width * .2, y: height * .25, w: width * .6, h: height * .42 } });
  notice('已插入 3 × 3 表格；双击单元格即可输入', 'success');
}));
buttons.play.addEventListener('click', () => void run(async () => {
  if (!view) return;
  const played = await view.previewAnimations();
  notice(played ? '正在播放当前页元素动画' : '当前页没有可播放的元素动画');
}));
buttons.zoomOut.addEventListener('click', () => { fitWanted = false; applyZoom(zoom - .1); });
buttons.zoomIn.addEventListener('click', () => { fitWanted = false; applyZoom(zoom + .1); });
buttons.fit.addEventListener('click', () => { fitWanted = true; fitView(); });
buttons.save.addEventListener('click', () => void saveCopy());

fileInput.addEventListener('change', () => {
  tryOpenLocalFile(fileInput.files?.[0]);
  fileInput.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  dragDepth++;
  dropLayer.hidden = false;
});
window.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; dropLayer.hidden = true; }
});
window.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropLayer.hidden = true;
  tryOpenLocalFile(event.dataTransfer?.files[0]);
});

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && canEditDocument()) {
    event.preventDefault();
    void saveCopy();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (!session?.editor.isDirty()) return;
  event.preventDefault();
  event.returnValue = '';
});
new ResizeObserver(() => { if (fitWanted) fitView(); }).observe(canvasViewport);

void fetch(new URL('./demo/showcase.pptx', document.baseURI))
  .then((response) => {
    if (!response.ok) throw new Error(`示例下载失败（HTTP ${response.status}）`);
    return response.arrayBuffer();
  })
  // 用户可能在示例下载完成前已经选择了本地文件；迟到的示例不能覆盖用户意图。
  .then((bytes) => openGeneration ? undefined : openDocument(bytes, 'showcase.pptx'))
  .catch((error) => { if (!openGeneration) showOpenFailure(error); });
