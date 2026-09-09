import { openEditor } from '@web-ppt/editor';
import * as adjustments from '@web-ppt/editor/adjustments';
import { createEditorApplication } from '../../packages/site/src/editor-application';
import { languageReady } from '../../packages/site/src/i18n/runtime';
import { checkSubmittedExports } from './site-files-export-shutdown-browser.mjs';
import { checkOpeningShutdown } from './site-open-shutdown-browser.mjs';

const require = (condition, message) => { if (!condition) throw new Error(message); };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const delay = () => new Promise(resolve => setTimeout(resolve, 50));

export async function runFilesShutdownContract(sourceUrl) {
  await languageReady;
  const bytes = await fetch(sourceUrl).then(response => response.arrayBuffer());
  const root = await navigator.storage.getDirectory();
  const originalPicker = window.showSaveFilePicker;
  const host = { canvas: document.querySelector('#canvas'), objects: document.querySelector('#objects'),
    textTools: [], onChange() {} };
  const buttons = Object.fromEntries(['save', 'localSave', 'saveAs', 'exportDocument', 'exportImages'].map(name => {
    const button = document.createElement('button'); document.body.append(button); return [name, button];
  }));
  const signal = new AbortController().signal;
  const errors = [];
  let session, callbacks = 0;
  const fileHost = { buttons, sync() { callbacks++; },
    snapshot: () => ({ session, name: 'plugin-save.pptx', writable: true, loading: false, showComments: false }) };
  const notice = (message, kind) => { if (kind === 'error') errors.push(message); };
  try {
    for (const action of ['replace', 'dispose']) {
      const name = `cordis-files-${action}.pptx`;
      const target = await root.getFileHandle(name, { create: true });
      const entered = deferred(), release = deferred();
      let pickerCalls = 0, closing;
      // 只在公开文件句柄边界延迟写入；字节仍经实际序列化、OPFS 写入并重新解析。
      window.showSaveFilePicker = () => {
        pickerCalls++;
        return Promise.resolve({ name, async createWritable() {
          const writable = await target.createWritable();
          return { async write(data) { entered.resolve(); await release.promise; await writable.write(data); },
            close: () => writable.close(), abort: () => writable.abort() };
        } });
      };
      const app = await createEditorApplication(host, notice, fileHost);
      try {
        session = await openEditor(bytes, { idPrefix: 'files-' });
        await app.replace(session, {}, { adjustments }, signal);
        const old = session;
        const id = Object.values(old.editor.doc.elements).find(record => record.meta.editable === 'full')?.id;
        require(id, '固件必须有可编辑元素');
        const expectedX = old.editor.effectiveElement(id).x + 43;
        old.editor.exec({ type: 'SetXfrm', id, x: expectedX });
        buttons.localSave.click();
        require(pickerCalls === 1, '点击必须同步进入选择器，不能先等待插件加载');
        await entered.promise;
        const replacement = action === 'replace' ? await openEditor(bytes) : undefined;
        closing = replacement ? app.replace(replacement, {}, { adjustments }, signal) : app.dispose();
        let completed = false;
        void closing.then(() => { completed = true; });
        await delay();
        require(!completed && !old.disposed, `${action} 必须在文件流结束前保留旧会话`);
        await app.files.saveLocal(old, 'late.pptx', true);
        require(pickerCalls === 1, '切换或退出中的文件服务不能接收新任务');
        release.resolve();
        await closing;
        require(old.disposed, `${action} 在文件任务结束后释放旧会话`);
        const saved = await openEditor(await target.getFile(), { idPrefix: 'files-' });
        try { require(saved.editor.effectiveElement(id).x === expectedX, 'OPFS 重开保留已交付编辑'); }
        finally { saved.dispose(); }
        if (replacement) session = replacement;
        await app.dispose();
        const after = callbacks;
        require(app.files.localTarget(old) === undefined, '卸载释放已保存目标的句柄引用');
        buttons.localSave.click();
        await app.files.saveLocal(old, 'unloaded.pptx', true);
        const key = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true });
        window.dispatchEvent(key);
        require(!key.defaultPrevented && callbacks === after && pickerCalls === 1,
          '卸载必须释放按钮与快捷键监听，旧服务也不能重新启动任务');
      } finally {
        release.resolve();
        await closing;
        await app.dispose();
        await root.removeEntry(name);
      }
    }

    // 未提交的模态导出没有文件交付，退出应取消选择并归还同一语言入口。
    const app = await createEditorApplication(host, notice, fileHost);
    try {
      session = await openEditor(bytes);
      await app.replace(session, {}, { adjustments }, signal);
      const language = document.querySelector('#siteLanguage'), home = language.parentElement;
      const exporting = app.files.exportDocument(session, 'pending-export.pptx');
      for (let i = 0; i < 100 && !document.querySelector('#documentExportDialog[open]'); i++) await delay();
      require(document.querySelector('#documentExportDialog[open]')?.contains(language), '真实导出窗口已经打开');
      await app.dispose();
      await exporting;
      require(!document.querySelector('#documentExportDialog') && language.parentElement === home,
        '退出取消导出选择并归还语言入口');
    } finally { await app.dispose(); }
    await checkSubmittedExports(bytes, host, notice);
    const openingReleased = await checkOpeningShutdown(bytes, host, notice);
    require(errors.length === 0, `文件服务没有错误：${JSON.stringify(errors)}`);
    return { pendingSaveDelivered: ['replace', 'dispose'], listenersReleased: true, exportCancelled: true,
      submittedExportsDelivered: ['pdf', 'zip'], openingReleased };
  } finally {
    window.showSaveFilePicker = originalPicker;
    Object.values(buttons).forEach(button => button.remove());
  }
}
