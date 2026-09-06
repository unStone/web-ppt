const digestFile = `(async () => {
  const bytes = await globalThis.__savedHandle.getFile().then(file => file.arrayBuffer());
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].join(',');
})()`;

export async function runLocalSaveFailuresContract(context) {
  const { evaluate, click, waitFor } = context;
  await click('#addShape');
  const before = await evaluate(digestFile, true);
  await evaluate(`globalThis.__currentPicker = window.showSaveFilePicker;
    window.showSaveFilePicker = async () => { throw new DOMException('User cancelled', 'AbortError'); };`);
  try {
    await click('#saveAsFile');
    await waitFor("document.querySelector('#statusText').textContent === 'Save cancelled. The presentation is unchanged.'", '取消选择不伪造保存成功');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('#statusText').textContent === '已取消保存，文稿未改变'", '取消状态随语言切换');
    if (!await evaluate("document.querySelector('#fileName').textContent.startsWith('● ') && globalThis.__localDownloads.length === 0 && document.querySelector('#saveToFile').title.includes('local-save.pptx')")) throw new Error('取消必须保留旧目标和 dirty，不偷偷下载');
  } finally { await evaluate('window.showSaveFilePicker = globalThis.__currentPicker; delete globalThis.__currentPicker'); }
  await click('[data-site-locale="en"]');
  await evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    globalThis.__wrongFormat = await root.getFileHandle('do-not-overwrite.ppt', { create: true });
    const writable = await globalThis.__wrongFormat.createWritable();
    await writable.write('original PPT sentinel'); await writable.close();
    globalThis.__currentPicker = window.showSaveFilePicker;
    window.showSaveFilePicker = async () => globalThis.__wrongFormat;
  })()`, true);
  try {
    await click('#saveAsFile');
    await waitFor("document.querySelector('#statusText').textContent === 'Choose a .pptx file. Nothing was written.'", '不能把 PPTX 字节写入旧格式目标');
    if (await evaluate('globalThis.__wrongFormat.getFile().then(file => file.text())', true) !== 'original PPT sentinel') throw new Error('格式拒绝不能覆盖原文件');
    if (!await evaluate("document.querySelector('#fileName').textContent.startsWith('● ') && document.querySelector('#saveToFile').title.includes('local-save.pptx')")) throw new Error('错误格式不能替换保存目标或清除 dirty');
  } finally {
    await evaluate('window.showSaveFilePicker = globalThis.__currentPicker; delete globalThis.__currentPicker; delete globalThis.__wrongFormat');
  }
  await evaluate(`globalThis.__savedHandle.requestPermission = async () => {
    if (!navigator.userActivation.isActive) throw new Error('请求写入权限丢失用户激活');
    return 'denied';
  };`);
  try {
    await click('#saveToFile');
    await waitFor("document.querySelector('#statusText').textContent === 'File write permission was denied. Retry or download a copy.'", '被撤回的写入权限显式拒绝');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('#statusText').textContent === '未获准写入文件；可重试或下载保存副本'", '权限拒绝切中文');
  } finally { await evaluate('delete globalThis.__savedHandle.requestPermission'); }
  for (const stage of ['create', 'write', 'close']) {
    await click('[data-site-locale="en"]');
    await evaluate(`(() => {
      const original = FileSystemFileHandle.prototype.createWritable;
      globalThis.__restoreFileStream = () => { FileSystemFileHandle.prototype.createWritable = original; };
      FileSystemFileHandle.prototype.createWritable = async function (...args) {
        if (this !== globalThis.__savedHandle) return original.apply(this, args);
        const failure = () => { throw new DOMException('<磁盘 ${stage} & 原文>', 'NotReadableError'); };
        if (${JSON.stringify(stage)} === 'create') failure();
        const stream = await original.apply(this, args);
        return {
          async write(bytes) {
            if (${JSON.stringify(stage)} === 'write') {
              // 已写入部分字节再失败，必须由 abort 保住原文件，不能仅在写前抛错。
              await stream.write(bytes.slice(0, 64)); failure();
            }
            await stream.write(bytes);
          },
          async close() { if (${JSON.stringify(stage)} === 'close') failure(); await stream.close(); },
          abort: () => stream.abort(),
        };
      };
    })()`);
    try {
      await click('#saveToFile');
      await waitFor(`document.querySelector('#statusText').textContent === 'Could not save: <磁盘 ${stage} & 原文>'
        && !document.querySelector('#saveToFile').disabled`, `${stage} 失败显示原始诊断并解锁`);
      await click('[data-site-locale="zh-CN"]');
      await waitFor(`document.querySelector('#statusText').textContent === '保存失败：<磁盘 ${stage} & 原文>'`, '写入失败切中文不翻译诊断');
      if (!await evaluate("document.querySelector('#fileName').textContent.startsWith('● ') && !document.querySelector('#undo').disabled && globalThis.__localDownloads.length === 0")) throw new Error(`${stage} 失败不能损伤历史/dirty 或自动下载`);
      if (await evaluate(digestFile, true) !== before) throw new Error(`${stage} 失败覆盖了既有文件`);
    } finally { await evaluate('globalThis.__restoreFileStream(); delete globalThis.__restoreFileStream'); }
  }
  await click('[data-site-locale="en"]');
  await click('#saveToFile');
  await waitFor("document.querySelector('#statusText').textContent === 'Saved to local-save.pptx' && !document.querySelector('#fileName').textContent.startsWith('● ')", '故障后重试写入成功');
  if (await evaluate(digestFile, true) === before) throw new Error('重试成功必须真正更新文件字节');
}
