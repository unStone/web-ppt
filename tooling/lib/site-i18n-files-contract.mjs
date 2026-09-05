export async function runSiteI18nFilesContract({ evaluate, click, waitFor }) {
  await click('[data-site-locale="en"]');
  await waitFor("document.documentElement.lang === 'en'", '文件流程使用英文');
  await waitFor("document.querySelector('#statusText').textContent === 'showcase.pptx is ready. Select, drag or double-click text to edit.'", '已打开文稿的状态随语言切换');
  const name = '<备份 & 客户>.pptx';
  await evaluate(`(async () => {
    const bytes = await fetch('/fixtures/sample-editor-shape-format.pptx').then((response) => response.arrayBuffer());
    const files = new DataTransfer();
    files.items.add(new File([bytes], ${JSON.stringify(name)}));
    const input = document.querySelector('#fileInput');
    input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor(`document.querySelector('#fileName').textContent === ${JSON.stringify(name)}
    && !document.querySelector('#editorApp').dataset.loading
    && document.querySelector('#statusText').textContent === ${JSON.stringify(name + ' is ready. Select, drag or double-click text to edit.')}`, '英文打开状态保留原始文件名');
  await evaluate(`(() => {
    globalThis.__languageDownload = null;
    globalThis.__languageDownloadClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download) return globalThis.__languageDownloadClick.call(this);
      const name = this.download;
      void fetch(this.href).then((response) => response.arrayBuffer()).then((bytes) => {
        globalThis.__languageDownload = { name, size: bytes.byteLength, magic: [...new Uint8Array(bytes).slice(0, 2)] };
      });
    };
  })()`);
  try {
    await click('#saveFile');
    await waitFor("document.querySelector('#statusText').textContent === 'An editable PPTX copy is ready'", '英文保存完成状态');
    await waitFor("globalThis.__languageDownload?.size > 1000", '真实 PPTX 下载产物');
    const download = await evaluate('globalThis.__languageDownload');
    if (download.name !== '<备份 & 客户>-edited.pptx' || download.magic.join(',') !== '80,75') {
      throw new Error(`语言不能改变下载命名或产物：${JSON.stringify(download)}`);
    }
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('#statusText').textContent === '已生成可继续编辑的 PPTX 副本'", '已完成文件任务的提示随语言切换');
    await runImageZipLanguageContract({ evaluate, click, waitFor });
    await runSaveFailureLanguageContract({ evaluate, click, waitFor });
  } finally { await evaluate('HTMLAnchorElement.prototype.click = globalThis.__languageDownloadClick'); }
  if (!await evaluate(`document.querySelector('#fileName').textContent === ${JSON.stringify(name)}
    && document.title === ${JSON.stringify(name + ' · Web-PPT 编辑器')}`)) throw new Error('界面语言不能改写文件名或将文件名解析为 HTML');
}

async function runImageZipLanguageContract({ evaluate, click, waitFor }) {
  await click('[data-site-locale="en"]');
  // 在浏览器编码边界暂缓回调；仍产出真实 PNG，避免依赖机器速度恰好撞上导出中状态。
  await evaluate(`(() => {
    globalThis.__languageDownload = null;
    globalThis.__languagePngCallbacks = [];
    globalThis.__languageToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      globalThis.__languagePngCallbacks.push(() => globalThis.__languageToBlob.call(this, callback, ...args));
    };
  })()`);
  try {
    await click('#exportImages');
    await waitFor('globalThis.__languagePngCallbacks.length > 0', '图片 ZIP 正在异步编码');
    await waitFor("document.querySelector('#statusText').textContent.startsWith('Exporting ')", '英文导出进度');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('#statusText').textContent.startsWith('正在导出') && document.querySelector('#saveFile').disabled", '导出中切中文保留任务锁');
    await evaluate(`(() => {
      const files = new DataTransfer(); files.items.add(new File(['ignored'], '不应打开.pptx'));
      const input = document.querySelector('#fileInput');
      input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await click('[data-site-locale="en"]');
    await waitFor("document.querySelector('#statusText').textContent === 'Wait for the file task to finish before opening another presentation'", '文件任务忙碌拒绝随语言切换');
    await click('[data-site-locale="zh-CN"]');
  } finally {
    await evaluate(`HTMLCanvasElement.prototype.toBlob = globalThis.__languageToBlob;
      globalThis.__languagePngCallbacks.splice(0).forEach((callback) => callback());`);
  }
  await waitFor("document.querySelector('#statusText').textContent === '已导出当前编辑态的图片 ZIP' && globalThis.__languageDownload?.size > 1000", '语言切换后完成真实 ZIP');
  const download = await evaluate('globalThis.__languageDownload');
  if (download.name !== '<备份 & 客户>-edited-images.zip' || download.magic.join(',') !== '80,75') throw new Error('切换语言改变了图片 ZIP 的文件名或产物');
  await click('[data-site-locale="en"]');
  await waitFor("document.querySelector('#statusText').textContent === 'An image ZIP of the current edits is ready'", 'ZIP 完成状态切回英文');
  await evaluate(`(() => {
    globalThis.__languageToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = () => { throw new Error('<编码器失败>'); };
  })()`);
  try {
    await click('#exportImages');
    await waitFor("document.querySelector('#statusText').textContent.startsWith('Could not export: ') && !document.querySelector('#saveFile').disabled", '英文导出失败摘要与任务解锁');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('#statusText').textContent.startsWith('导出失败：') && document.querySelector('#statusText').textContent.includes('<编码器失败>')", '导出错误保留原始诊断并随语言切换');
  } finally { await evaluate('HTMLCanvasElement.prototype.toBlob = globalThis.__languageToBlob'); }
  await click('[data-site-locale="zh-CN"]');
}

async function runSaveFailureLanguageContract({ evaluate, click, waitFor }) {
  await click('[data-site-locale="en"]');
  await evaluate(`(() => {
    globalThis.__languageObjectUrl = URL.createObjectURL;
    URL.createObjectURL = () => { throw new Error('<下载失败>'); };
  })()`);
  try {
    await click('#saveFile');
    await waitFor("document.querySelector('#statusText').textContent === 'Could not save: <下载失败>' && !document.querySelector('#saveFile').disabled", '保存失败摘要与解锁');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('#statusText').textContent === '保存失败：<下载失败>'", '保存错误随语言切换并保留诊断');
  } finally { await evaluate('URL.createObjectURL = globalThis.__languageObjectUrl'); }
}
