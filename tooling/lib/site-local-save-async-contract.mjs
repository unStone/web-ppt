export async function saveKey({ request, evaluate }, shift = false) {
  const modifier = await evaluate("/Mac/.test(navigator.platform) ? 4 : 2");
  for (const type of ['rawKeyDown', 'keyUp']) await request('Input.dispatchKeyEvent', {
    type, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: modifier | (shift ? 8 : 0),
  });
}

export async function runLocalSaveAsyncContract(context) {
  const { evaluate, click, waitFor, request } = context;
  await click('#addShape');
  await evaluate(`(() => {
    const original = FileSystemFileHandle.prototype.createWritable;
    globalThis.__restoreFileStream = () => { FileSystemFileHandle.prototype.createWritable = original; };
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      const stream = await original.apply(this, args);
      if (this !== globalThis.__savedHandle) return stream;
      return {
        write: bytes => stream.write(bytes),
        async close() {
          await new Promise(resolve => { globalThis.__releaseFileClose = resolve; });
          await stream.close();
        },
        abort: () => stream.abort(),
      };
    };
  })()`);
  try {
    await click('#saveToFile');
    await waitFor("!!globalThis.__releaseFileClose && document.querySelector('#statusText').textContent === 'Writing to local-save.pptx…'", '磁盘关闭前仍处于写入中');
    if (!await evaluate("document.querySelector('#fileName').textContent.startsWith('● ') && document.querySelector('#newFile').disabled && document.querySelector('#saveFile').disabled && document.querySelector('#saveToFile').disabled")) throw new Error('未关闭文件前不能标记已保存或解除文件任务锁');
    await saveKey(context, true);
    if (await evaluate('globalThis.__pickerCalls.length !== 4')) throw new Error('写入中快捷键绕过任务锁');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('#statusText').textContent === '正在写入 local-save.pptx…'", '写入任务中切语言');
    await evaluate(`(() => {
      const transfer = new DataTransfer(); transfer.items.add(new File(['ignored'], 'blocked.pptx'));
      const input = document.querySelector('#fileInput'); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor("document.querySelector('#statusText').textContent === '文件任务完成前不能切换文稿'", '原生文件边界不能替换正在写入的会话');
    await evaluate(`(async () => {
      const id = document.querySelector('[data-pane-element][aria-selected=true]').dataset.paneElement;
      globalThis.__writingSelector = '[data-edit-id="' + CSS.escape(id) + '"]';
      document.querySelector('#canvasMount > div').focus();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      globalThis.__writingLeft = document.querySelector(globalThis.__writingSelector).getBoundingClientRect().left;
    })()`, true);
    for (const type of ['rawKeyDown', 'keyUp']) await request('Input.dispatchKeyEvent', {
      type, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39,
    });
    await waitFor("document.querySelector(globalThis.__writingSelector).getBoundingClientRect().left > globalThis.__writingLeft + 0.01", '文件写入期间产生真实画布编辑');
  } finally {
    await evaluate(`globalThis.__restoreFileStream(); globalThis.__releaseFileClose?.();
      delete globalThis.__restoreFileStream; delete globalThis.__releaseFileClose;`);
  }
  await waitFor("document.querySelector('#statusText').textContent === '已写入 local-save.pptx；请再次保存最新编辑' && !document.querySelector('#saveToFile').disabled", '已交付版本不能清除写入期间的新编辑');
  if (!await evaluate("document.querySelector('#fileName').textContent.startsWith('● ')")) throw new Error('迟到的落盘成功清除了新编辑');
  await click('[data-site-locale="en"]');
  await click('#saveToFile');
  await waitFor("document.querySelector('#statusText').textContent === 'Saved to local-save.pptx' && !document.querySelector('#fileName').textContent.startsWith('● ')", '再次保存包含最新编辑');
  await evaluate('delete globalThis.__writingSelector; delete globalThis.__writingLeft');
  await undoDuringSave(context);
}

async function undoDuringSave(context) {
  const { evaluate, click, waitFor, request } = context;
  const count = await evaluate("document.querySelectorAll('[data-pane-element]').length");
  await click('#addShape');
  await evaluate(`(() => {
    const original = FileSystemFileHandle.prototype.createWritable;
    globalThis.__restoreFileStream = () => { FileSystemFileHandle.prototype.createWritable = original; };
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      const stream = await original.apply(this, args);
      return { write: bytes => stream.write(bytes), abort: () => stream.abort(),
        async close() {
          await new Promise(resolve => { globalThis.__releaseFileClose = resolve; });
          await stream.close();
        } };
    };
  })()`);
  const modifier = await evaluate("/Mac/.test(navigator.platform) ? 4 : 2");
  const historyKey = async shift => {
    await evaluate("document.querySelector('#canvasMount > div').focus()");
    for (const type of ['rawKeyDown', 'keyUp']) await request('Input.dispatchKeyEvent', {
      type, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: modifier | (shift ? 8 : 0),
    });
  };
  try {
    await click('#saveToFile');
    await waitFor('!!globalThis.__releaseFileClose', '撤销竞态等待真实文件关闭');
    await historyKey(false);
    await waitFor(`document.querySelectorAll('[data-pane-element]').length === ${count}
      && !document.querySelector('#fileName').textContent.startsWith('● ')`, '写入中原生撤销回到旧保存版本');
  } finally {
    await evaluate(`globalThis.__restoreFileStream(); globalThis.__releaseFileClose?.();
      delete globalThis.__restoreFileStream; delete globalThis.__releaseFileClose;`);
  }
  await waitFor("!document.querySelector('#saveToFile').disabled", '撤销竞态的文件写入结束');
  if (!await evaluate("document.querySelector('#fileName').textContent.startsWith('● ')")) {
    throw new Error('磁盘已经写入新版本，撤销回旧保存点的当前文稿必须重新变脏');
  }
  await historyKey(true);
  await waitFor(`document.querySelectorAll('[data-pane-element]').length === ${count + 1}
    && !document.querySelector('#fileName').textContent.startsWith('● ')`, '重做回到真正落盘的版本才恢复干净');
}

export async function runLocalSaveFallbackContract(context) {
  const { evaluate, click, waitFor } = context;
  await evaluate('globalThis.__supportedPicker = window.showSaveFilePicker; window.showSaveFilePicker = undefined');
  try {
    await click('#addShape');
    if (!await evaluate("document.querySelector('#saveToFile').hidden && getComputedStyle(document.querySelector('#saveToFile')).display === 'none' && document.querySelector('#saveAsFile').hidden")) throw new Error('不支持 FSA 时不能显示不可用的文件入口');
    await saveKey(context);
    await waitFor("globalThis.__localDownloads.length === 1 && !document.querySelector('#fileName').textContent.startsWith('● ')", '不支持 FSA 的保存快捷键回退真实下载');
    const copy = await evaluate(`(() => {
      const file = globalThis.__localDownloads[0];
      return { name: file.name, size: file.bytes.byteLength, magic: [...new Uint8Array(file.bytes).slice(0, 2)] };
    })()`);
    if (copy.name !== 'local-save-edited.pptx' || copy.size < 1000 || copy.magic.join(',') !== '80,75') throw new Error(`下载回退不是完整 PPTX：${JSON.stringify(copy)}`);
    await evaluate(`(() => {
      const copy = globalThis.__localDownloads[0];
      const transfer = new DataTransfer(); transfer.items.add(new File([copy.bytes], copy.name));
      const input = document.querySelector('#fileInput'); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor("document.querySelector('#fileName').textContent === 'local-save-edited.pptx' && !document.querySelector('#editorApp').dataset.loading", '回退下载可通过产品入口重新打开');
  } finally { await evaluate('window.showSaveFilePicker = globalThis.__supportedPicker; delete globalThis.__supportedPicker'); }
}
