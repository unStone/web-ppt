import { openEditor } from '@web-ppt/editor';
import * as adjustments from '@web-ppt/editor/adjustments';
import { createEditorApplication } from '../../packages/site/src/editor-application';

const require = (condition, message) => { if (!condition) throw new Error(message); };
const delay = () => new Promise(resolve => setTimeout(resolve, 50));

export async function checkSubmittedExports(bytes, host, notice) {
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  const originalClick = HTMLAnchorElement.prototype.click;
  try {
    for (const format of ['pdf', 'zip']) {
      const app = await createEditorApplication(host, notice);
      let release, closing, rendered = false;
      const hold = new Promise(resolve => { release = resolve; });
      const downloads = [];
      HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
        rendered = true;
        // 仅延迟浏览器光栅输出，PDF/ZIP 编码与下载仍使用生产实现。
        void hold.then(() => originalToBlob.call(this, callback, ...args));
      };
      HTMLAnchorElement.prototype.click = function () {
        if (!this.download) return originalClick.call(this);
        downloads.push({ name: this.download, bytes: fetch(this.href).then(response => response.arrayBuffer()) });
      };
      try {
        const session = await openEditor(bytes);
        await app.replace(session, {}, { adjustments }, new AbortController().signal);
        const task = format === 'zip' ? app.files.exportImages(session, 'submitted.pptx')
          : app.files.exportDocument(session, 'submitted.pptx');
        if (format === 'pdf') {
          for (let i = 0; i < 100 && !document.querySelector('#documentExportDialog[open]'); i++) await delay();
          require(document.querySelector('#documentExportDialog[open]'), 'PDF 导出窗口已打开');
          document.querySelector('#documentExportDialog [data-export]').click();
        }
        for (let i = 0; i < 100 && !rendered; i++) await delay();
        require(rendered, `${format} 已进入真实光栅化任务`);
        closing = app.dispose();
        let completed = false;
        void closing.then(() => { completed = true; });
        await delay();
        require(!completed && !session.disposed, `退出不能提前释放 ${format} 依赖的文稿`);
        release();
        await closing;
        await task;
        require(session.disposed && downloads.length === 1, `退出仍应交付一次已提交的 ${format}`);
        const saved = new Uint8Array(await downloads[0].bytes);
        require(format === 'pdf' ? new TextDecoder().decode(saved.slice(0, 5)) === '%PDF-'
          : saved[0] === 0x50 && saved[1] === 0x4b, `${format} 下载包含真实编码结果`);
        require(!document.querySelector('#documentExportDialog'), '交付后关闭导出窗口');
      } finally {
        release();
        await closing;
        await app.dispose();
      }
    }
  } finally {
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
    HTMLAnchorElement.prototype.click = originalClick;
  }
}
