import { createEditorApplication } from '../../packages/site/src/editor-application';
import { prepareEditorDocument } from '../../packages/site/src/editor-open';
import { createProductTools } from '../../packages/site/src/editor-product-tools';
import { checkImageToolCancellation } from './site-tools-images-browser.mjs';
import { checkPageResourceOwnership, checkPageApplication } from './site-page-shutdown-browser.mjs';

const require = (condition, message) => { if (!condition) throw new Error(message); };
const until = async check => {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('业务工具验收等待超时');
};

export async function runToolsShutdownContract(source) {
  await checkPageResourceOwnership('/fixtures/sample-chart-shared.pptx');
  const bytes = await fetch(source).then(response => response.arrayBuffer());
  const canvas = document.querySelector('#canvasMount'), objects = document.querySelector('#objectList');
  const notice = () => {};
  let app, current = null;
  const snapshot = () => ({ session: current?.session ?? null, view: current?.view ?? null,
    adjustments: current?.adjustments ?? null, writable: !!current, name: 'tools.pptx' });
  const host = { canvas, objects, textTools: [], onChange() { app?.tools?.sync(); } };
  const toolsHost = { snapshot, openInspector() {}, showSlide(id) {
    current.view.setSlide(id); current.pane.setSlide(id);
  } };
  const mount = async () => {
    const prepared = await prepareEditorDocument(bytes.slice(0), app.recovery, new AbortController().signal);
    current = await app.replace(prepared.session, {}, prepared.modules, new AbortController().signal);
    app.tools?.bindSession(); app.tools?.sync();
  };
  try {
    app = await createEditorApplication(host, notice);
    await mount();
    const product = createProductTools(() => ({ ...snapshot(), openInspector() {} }), notice);
    product.bindSession(); product.destroy();
    document.querySelector('#findText').disabled = false;
    document.querySelector('#findText').click();
    require(!current.session.textSearch.snapshot.open, '已销毁的查找工具仍然执行按钮命令');
    await app.dispose(); current = null;

    // 在静态按钮注册一半时失败，真实 Cordis 回滚也必须回收尚未返回的工厂。
    const listen = EventTarget.prototype.addEventListener;
    let injected = false;
    EventTarget.prototype.addEventListener = function (type, ...args) {
      if (!injected && this.id === 'textItalic' && type === 'click') {
        injected = true; throw new Error('验收工具注册失败');
      }
      return listen.call(this, type, ...args);
    };
    let rejected = false;
    try { await createEditorApplication({ ...host, tools: toolsHost }, notice); }
    catch (error) { rejected = String(error).includes('验收工具注册失败'); }
    finally { EventTarget.prototype.addEventListener = listen; }
    require(injected && rejected && !document.querySelectorAll('[data-appearance-tools]').length,
      '注册中途失败没有释放未完成的对象检查器');

    for (let round = 0; round < 2; round++) {
      app = await createEditorApplication({ ...host, tools: toolsHost }, notice);
      require(app.tools, '应用没有注册业务工具服务');
      await mount();
      const session = current.session, count = session.editor.doc.slideOrder.length;
      const add = document.querySelector('#addSlide'); add.disabled = false; add.click();
      require(session.editor.doc.slideOrder.length === count + 1, '应用重建后新增页没有恰好执行一次');
      session.editor.undo();
      require(session.editor.doc.slideOrder.length === count, '一次撤销恢复新增前的页数');
      toolsHost.showSlide(session.editor.doc.slideOrder[0]);
      app.tools.sync();
      require(document.querySelectorAll('[data-appearance-tools]').length === 2,
        '应用重建没有重复插入外观工具');
      const shape = session.editor.doc.slides[current.view.slideId].children.map(id => session.editor.doc.elements[id]).find(record => record.src.kind === 'shape');
      session.editor.select({ kind: 'elements', ids: [shape.id], enteredGroup: null }); app.tools.sync();
      const execute = session.editor.exec.bind(session.editor);
      let formatted = 0;
      session.editor.exec = command => {
        if (command.type === 'SetFill') formatted++;
        return execute(command);
      };
      const fill = document.querySelector('#shapeFillColor'); fill.value = '#336699';
      fill.dispatchEvent(new Event('change'));
      require(formatted === 1, '注册失败或重建后对象工具没有恰好执行一次');
      session.editor.undo();
      const find = document.querySelector('#findText'); find.click();
      require(session.textSearch.snapshot.open, '重建后查找工具仍可打开');
      const language = document.querySelector('#siteLanguage'), home = language.parentElement;
      document.querySelector('#shapeInspector [data-appearance-tools]').click();
      await until(() => document.querySelector('#appearanceDialog[open]'));
      app.tools.reset();
      require(!document.querySelector('#appearanceDialog') && language.parentElement === home,
        '切换文稿关闭外观窗口并归还语言入口');
      document.querySelector('#commentsTools').click();
      await until(() => document.querySelector('#commentsPanel'));
      app.tools.reset();
      require(!document.querySelector('#commentsPanel'), '文稿工具重置关闭批注面板');
      document.querySelector('#slideSizeTools').disabled = false;
      document.querySelector('#slideSizeTools').click();
      await until(() => document.querySelector('#slideSizeDialog[open]'));
      const savedTools = app.tools;
      document.querySelector('#mediaTools').disabled = false;
      document.querySelector('#mediaTools').click();
      if (round === 1) {
        app.tools.reset();
        await checkImageToolCancellation(app, current);
      }
      await app.dispose();
      await new Promise(resolve => setTimeout(resolve, 30));
      require(!document.querySelector('#mediaDialog'), '已卸载的异步媒体加载不能重新打开弹窗');
      require(!document.querySelector('#slideSizeDialog') && language.parentElement === home,
        '卸载关闭尺寸窗口并立即归还语言入口');
      require(!document.querySelectorAll('[data-appearance-tools]').length,
        '卸载移除工具生成的外观入口');
      current = null;
      savedTools.sync(); savedTools.bindSession();
      add.disabled = false; add.click(); find.disabled = false; find.click();
      require(session.disposed && !canvas.children.length, '旧工具服务和监听不再访问已释放会话');
    }
    await checkPageApplication('/fixtures/sample-chart-shared.pptx');
    return { productReleased: true, rebuilt: true, dialogsReleased: true, pageReleased: true };
  } finally { await app?.dispose(); }
}
