import { openEditor } from '@web-ppt/editor';
import * as adjustments from '@web-ppt/editor/adjustments';
import { createEditorApplication } from '../../packages/site/src/editor-application';

const require = (condition, message) => { if (!condition) throw new Error(message); };
const delay = () => new Promise(resolve => setTimeout(resolve, 50));

export async function checkSubmittedExports(bytes, host, notice) {
  const imageSource = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  const originalClick = HTMLAnchorElement.prototype.click;
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  const originalConvertToBlob = OffscreenCanvas.prototype.convertToBlob;
  // Chromium 把这两种异步 PNG 编码排进主线程空闲任务，拿不到空闲周期时单页可拖到 5 秒以上。
  let deferredEncodes = 0;
  HTMLCanvasElement.prototype.toBlob = function (...args) { deferredEncodes++; return originalToBlob.apply(this, args); };
  OffscreenCanvas.prototype.convertToBlob = function (...args) {
    deferredEncodes++;
    return originalConvertToBlob.apply(this, args);
  };
  try {
    for (const format of ['pdf', 'zip']) {
      const app = await createEditorApplication(host, notice);
      let release, closing, rendered = false;
      const hold = new Promise(resolve => { release = resolve; });
      const downloads = [];
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        get: imageSource.get,
        set(value) {
          if (String(value).startsWith('data:image/svg+xml')) {
            rendered = true;
            // 仅延迟光栅化页面的 SVG 加载回调；PNG 编码同步进行，PDF/ZIP 编码与下载仍使用生产实现。
            const loaded = this.onload;
            this.onload = event => { void hold.then(() => loaded?.call(this, event)); };
          }
          imageSource.set.call(this, value);
        },
      });
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
        require(deferredEncodes === 0, `${format} 光栅化不能经过空闲调度的异步 PNG 编码`);
      } finally {
        release();
        await closing;
        await app.dispose();
      }
    }
  } finally {
    Object.defineProperty(HTMLImageElement.prototype, 'src', imageSource);
    HTMLAnchorElement.prototype.click = originalClick;
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
    OffscreenCanvas.prototype.convertToBlob = originalConvertToBlob;
  }
}
