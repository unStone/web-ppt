import { createEditorApplication } from '../../packages/site/src/editor-application';
import { prepareEditorDocument } from '../../packages/site/src/editor-open';

const require = (condition, message) => { if (!condition) throw new Error(message); };
const until = async check => {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('打开插件验收等待超时');
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

export async function checkOpeningShutdown(bytes, host, notice) {
  const input = document.createElement('input'), dropLayer = document.createElement('div');
  input.type = 'file'; dropLayer.hidden = true;
  const newFile = document.createElement('button');
  document.body.append(input, dropLayer, newFile);
  const language = document.querySelector('#siteLanguage'), home = language.parentElement;
  let app, calls = 0, pause, current, signal;
  const openHost = { input, dropLayer, newFile, confirmReplacement: () => true,
    failed(error) { throw new Error(JSON.stringify(error)); }, cancelled() {},
    async open(source, name, options, request) {
      calls++; signal = request;
      if (pause) await pause.promise;
      if (request.aborted) return;
      const prepared = await prepareEditorDocument(source, app.recovery, request);
      const mounted = await app.replace(prepared.session, {}, prepared.modules, request);
      if (mounted) current = mounted.session;
    } };
  try {
    app = await createEditorApplication(host, notice, undefined, openHost);
    const choosing = app.opening.create();
    await until(() => document.querySelector('#templateDialog[open]'));
    await app.dispose(); await choosing;
    require(!document.querySelector('#templateDialog[open]') && language.parentElement === home,
      '应用卸载取消待选模板，归还语言入口');
    newFile.click();
    await app.opening.open(bytes, 'disposed.pptx');
    const drag = new DragEvent('dragenter', { dataTransfer: new DataTransfer(), cancelable: true });
    drag.dataTransfer.items.add(new File([bytes], 'disposed.pptx'));
    window.dispatchEvent(drag);
    require(calls === 0 && !drag.defaultPrevented && dropLayer.hidden,
      '卸载解除新建、文件和拖放入口，旧服务不再接受打开');

    app = await createEditorApplication(host, notice, undefined, openHost);
    newFile.click();
    await until(() => document.querySelector('#templateDialog[open]'));
    document.querySelector('[data-template-id="blank"]').click();
    await until(() => current);
    require(calls === 1 && current.editor.doc.slideOrder.length === 1,
      '重建后一次新建只有一个真实空白文稿');
    const first = current;
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'reopened.pptx'));
    input.files = transfer.files; input.dispatchEvent(new Event('change'));
    await until(() => first.disposed && current !== first);
    require(calls === 2 && input.value === '' && host.canvas.children.length === 1,
      '重建后文件监听只有一次，真实文稿成功替换');

    pause = deferred();
    const opening = app.opening.open(bytes, 'cancelled.pptx');
    const closing = app.dispose();
    let complete = false; void closing.then(() => { complete = true; });
    require(signal.aborted, '退出立即取消解析链路');
    await new Promise(resolve => setTimeout(resolve, 30));
    require(!complete, '退出等待已经进入宿主的打开任务结束');
    pause.resolve(); await opening; await closing;
    require(current.disposed && !host.canvas.children.length, '过期任务不能留下画布或会话');
    return true;
  } finally {
    pause?.resolve();
    await app?.dispose();
    input.remove(); dropLayer.remove(); newFile.remove();
  }
}
