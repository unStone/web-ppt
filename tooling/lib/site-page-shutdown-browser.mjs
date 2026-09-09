import { prepareEditorDocument } from '../../packages/site/src/editor-open';
import { renderSlideNavigation } from '../../packages/site/src/editor-slide-reorder';
import { createEditorFeedback } from '../../packages/site/src/editor-feedback';
import { createSiteEditorApplication } from '../../packages/site/src/editor-application';
import { languageReady } from '../../packages/site/src/i18n/runtime';
import { openEditor } from '@web-ppt/editor';

const require = (condition, message) => { if (!condition) throw new Error(message); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

export async function checkPageResourceOwnership(source) {
  const prepared = await prepareEditorDocument(await fetch(source).then(response => response.arrayBuffer()),
    { openOptions: () => ({}) }, new AbortController().signal);
  const session = prepared.session, list = document.querySelector('#slideList');
  let navigated = 0;
  const context = () => ({ session, writable: true, showSlide() { navigated++; }, onError(error) { throw error; } });
  try {
    renderSlideNavigation(list, context);
    const old = list.firstElementChild;
    const transfer = new DataTransfer();
    old.dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer }));
    renderSlideNavigation(list, context);
    old.click();
    require(navigated === 0, '已替换的导航节点仍然操作当前文稿');
    const before = session.editor.history.undoCount;
    list.lastElementChild.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer }));
    require(session.editor.history.undoCount === before, '重新渲染后残留拖页状态仍产生移动命令');
  } finally { session.dispose(); list.replaceChildren(); }

  const controller = new AbortController();
  const status = document.querySelector('#statusText');
  const feedback = createEditorFeedback(status, controller.signal);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const playing = feedback.previewAnimations({ previewAnimations: () => pending });
  controller.abort();
  const before = status.textContent;
  release(true); await playing;
  require(status.textContent === before, '已卸载页面的迟到动画回调仍然更新状态栏');
}

export async function checkPageApplication(source) {
  await languageReady;
  const bytes = await fetch(source).then(response => response.arrayBuffer());
  const preference = localStorage.getItem('web-ppt:site:recovery-enabled');
  // 这些会话验证页面资源，不共享前面恢复专项的日志。
  localStorage.setItem('web-ppt:site:recovery-enabled', 'false');
  const OriginalObserver = window.ResizeObserver, observed = [];
  window.ResizeObserver = class extends OriginalObserver {
    constructor(callback) { super(callback); this.deliver = () => callback([], this); }
    observe(target, options) { if (target.id === 'canvasViewport') observed.push(this); return super.observe(target, options); }
    disconnect() { this.released = true; return super.disconnect(); }
  };
  let application, oldPage, oldAnimation;
  const listen = EventTarget.prototype.addEventListener;
  try {
    let injected = false, rejected = false;
    EventTarget.prototype.addEventListener = function (type, ...args) {
      if (!injected && this.id === 'zoomIn' && type === 'click') { injected = true; throw new Error('验收页面初始化失败'); }
      return listen.call(this, type, ...args);
    };
    try { await createSiteEditorApplication(); }
    catch (error) { rejected = String(error).includes('验收页面初始化失败'); }
    finally { EventTarget.prototype.addEventListener = listen; }
    require(injected && rejected && observed.length === 1 && observed.every(observer => observer.released),
      '页面注册中途失败未释放视口观察器');

    for (let round = 0; round < 2; round++) {
      application = await createSiteEditorApplication();
      require(application.page && !application.page.current, '产品应用必须提供独立的初始页面状态');
      require(document.querySelector('#undo').disabled && !document.querySelector('#newFile').disabled, '空应用只开放文稿入口');
      await application.opening.open(bytes.slice(0), `page-${round}.pptx`);
      await frame();
      const page = application.page, current = page.current;
      require(current?.session.editor.doc.slideOrder.length >= 2, '页面固件必须有多页以验证导航');
      if (oldPage) {
        oldPage.stop(); oldPage.host.onChange({}); oldPage.notice('旧页面消息');
        oldAnimation.resolve(true); await frame();
        require(document.querySelector('#fileName').textContent === `page-${round}.pptx`
          && !document.querySelector('#newFile').disabled && document.querySelector('#statusText').textContent !== '旧页面消息',
        '旧页面或迟到动画回调改变了新应用');
      }
      const { session, view } = current, sourceSlide = view.slideId;
      const setZoom = view.setZoom.bind(view), setSlide = view.setSlide.bind(view), undo = session.editor.undo.bind(session.editor);
      let zooms = 0, navigations = 0, undos = 0;
      view.setZoom = value => { zooms++; return setZoom(value); };
      view.setSlide = id => { navigations++; return setSlide(id); };
      session.editor.undo = () => { undos++; return undo(); };
      document.querySelector('#zoomIn').click(); require(zooms === 1, '重建后缩放按钮必须只处理一次');
      document.querySelector('#nextSlide').click(); require(navigations === 1 && view.slideId !== sourceSlide, '下一页按钮必须只处理一次');
      document.querySelector('#prevSlide').click(); require(navigations === 2 && view.slideId === sourceSlide, '上一页回到原页');
      document.querySelector('#viewMode').click();
      require(document.querySelector('#viewMode').getAttribute('aria-pressed') === 'true' && document.querySelector('#addShape').disabled,
        '页面服务持有查看模式与编辑权限');
      document.querySelector('#editMode').click();
      document.querySelector('#addShape').click();
      require(session.editor.history.undoCount === 1, '新增形状只有一条历史');
      document.querySelector('#undo').click(); require(undos === 1 && !session.editor.history.undoCount, '历史按钮必须只撤销一次');
      document.querySelector('#redo').click(); require(session.editor.history.undoCount === 1, '重做仍可执行');
      document.querySelector('#undo').click();
      document.querySelector('#fitZoom').click();
      document.querySelector('#inspectorToggle').click();
      require(document.querySelector('#editorApp').dataset.inspectorOpen === 'true', '页面服务持有检查器开关');
      oldAnimation = deferred(); view.previewAnimations = () => oldAnimation.promise;
      document.querySelector('#playAnimations').click();
      const observer = observed.at(-1);
      if (round === 0) {
        await checkPageSaveShutdown(application, current, observer, () => {
          const snapshot = { zooms, navigations, undos }, history = session.editor.history.undoCount;
          for (const selector of ['#zoomIn', '#nextSlide', '#undo']) {
            const button = document.querySelector(selector); button.disabled = false; button.click();
          }
          view.element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', ctrlKey: true }));
          view.element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', ctrlKey: true, shiftKey: true }));
          current.pane.element.querySelector('[data-pane-element]')?.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true, cancelable: true, key: 'Delete',
          }));
          observer.deliver();
          require(JSON.stringify({ zooms, navigations, undos }) === JSON.stringify(snapshot) && history === session.editor.history.undoCount,
            '等待文件交付期间仍有页面命令、画布/面板编辑或观察器运行');
        });
      } else await application.dispose();
      require(!page.current && session.disposed && observer.released, '应用卸载必须释放文稿状态与视口观察器');
      require(!document.querySelector('#slideList').children.length && !document.querySelector('#canvasMount').children.length
        && document.querySelector('#editorApp').dataset.inspectorOpen === 'false', '卸载归还导航、画布与面板展示状态');
      oldPage = page;
    }
    oldAnimation.resolve(true); await frame();
    require(document.querySelector('#fileName').textContent === '', '最终卸载不保留旧文稿名称');
    require(observed.every(observer => observer.released), '成功与失败应用的所有页面观察器均已释放');
  } finally {
    oldAnimation?.resolve(true); await application?.dispose();
    window.ResizeObserver = OriginalObserver; EventTarget.prototype.addEventListener = listen;
    if (preference === null) localStorage.removeItem('web-ppt:site:recovery-enabled');
    else localStorage.setItem('web-ppt:site:recovery-enabled', preference);
  }
}

async function checkPageSaveShutdown(application, current, observer, stopped) {
  const root = await navigator.storage.getDirectory(), name = 'cordis-page-shutdown.pptx';
  const target = await root.getFileHandle(name, { create: true });
  const picker = window.showSaveFilePicker, entered = deferred(), release = deferred();
  let closing;
  window.showSaveFilePicker = async () => ({ name, async createWritable() {
    const stream = await target.createWritable();
    return { async write(data) { entered.resolve(); await release.promise; await stream.write(data); },
      close: () => stream.close(), abort: () => stream.abort() };
  } });
  try {
    const saving = application.files.saveLocal(current.session, name, true);
    await entered.promise;
    await checkBusyViewport(current, observer);
    closing = application.dispose();
    await frame();
    require(!current.session.disposed, '页面退出必须等待已经提交的文件交付');
    stopped(); release.resolve(); await saving; await closing;
    const saved = await openEditor(await target.getFile());
    try { require(saved.editor.doc.slideOrder.length === current.session.editor.doc.slideOrder.length, '页面退出期间完成的文件可独立重开'); }
    finally { saved.dispose(); }
  } finally { release.resolve(); await closing; window.showSaveFilePicker = picker; await root.removeEntry(name); }
}

async function checkBusyViewport({ session, view }, observer) {
  const viewport = document.querySelector('#canvasViewport'), style = viewport.style.cssText;
  try {
    viewport.style.width = '900px'; viewport.style.height = '600px';
    observer.deliver();
    const { width, height } = session.editor.doc.meta;
    const expected = Math.max(.15, Math.min(1.5,
      Math.max(100, viewport.clientWidth - 56) / width, Math.max(100, viewport.clientHeight - 56) / height));
    require(Math.abs(view.zoom - expected) < .001, '文件忙碌期间窗口尺寸变化未自动适配');
    const stage = view.element.querySelector('[data-ppt-stage]'), rect = stage.getBoundingClientRect();
    const start = view.zoom;
    const pointer = (type, id, x) => view.element.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: rect.left + x, clientY: rect.top + 60,
    }));
    pointer('pointerdown', 1, 100); pointer('pointerdown', 2, 300);
    pointer('pointermove', 1, 50); pointer('pointermove', 2, 350);
    pointer('pointerup', 2, 350); pointer('pointerup', 1, 50);
    await frame();
    require(view.zoom > start && document.querySelector('#zoomLabel').textContent === `${Math.round(view.zoom * 100)}%`
      && Math.abs(parseFloat(view.element.style.width) - width * view.zoom) < .001,
    '保存期间 SDK 触控缩放与宿主外框、标签不一致');
  } finally { viewport.style.cssText = style; }
}
