export async function runLocalSaveDestinationContract({ evaluate, click, waitFor, request }) {
  await click('#saveToFile');
  await waitFor("!document.querySelector('#saveAsFile').hidden && !document.querySelector('#saveAsFile').disabled", '先建立当前文稿的保存目标');
  await click('#addShape');
  const count = await evaluate("document.querySelectorAll('[data-pane-element]').length");
  await evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('<另存 & 原文>.pptx', { create: true });
    const stream = await handle.createWritable(); await stream.write('destination sentinel'); await stream.close();
    globalThis.__otherSaveHandle = handle;
    globalThis.__destinationPicker = window.showSaveFilePicker;
    globalThis.__destinationWritable = FileSystemFileHandle.prototype.createWritable;
    globalThis.__previousFile = await (await globalThis.__savedHandle.getFile()).arrayBuffer();
    window.showSaveFilePicker = async () => {
      if (!navigator.userActivation.isActive) throw new Error('另存为丢失用户激活');
      return handle;
    };
    FileSystemFileHandle.prototype.createWritable = function (...args) {
      if (this === handle) return Promise.reject(new DOMException('new target denied', 'NotAllowedError'));
      return globalThis.__destinationWritable.apply(this, args);
    };
  })()`, true);
  try {
    await click('#saveAsFile');
    await waitFor("document.querySelector('#statusText').textContent === 'Could not save: new target denied' && !document.querySelector('#saveAsFile').disabled", '合法新目标写入失败');
    if (!await evaluate(`(async () => document.querySelector('#saveToFile').title === 'Save destination: local-save.pptx'
      && document.querySelector('#fileName').textContent.startsWith('● ')
      && await (await globalThis.__otherSaveHandle.getFile()).text() === 'destination sentinel')()`, true)) {
      throw new Error('新目标交付失败不能替换旧目标或清除未保存状态');
    }
    await evaluate('FileSystemFileHandle.prototype.createWritable = globalThis.__destinationWritable');
    await evaluate("document.querySelector('#saveToFile').focus()");
    for (const type of ['rawKeyDown', 'keyUp']) await request('Input.dispatchKeyEvent', {
      type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9,
    });
    await waitFor("document.activeElement === document.querySelector('#saveAsFile')", '原生 Tab 可达另存为');
    const tree = await request('Accessibility.getFullAXTree');
    for (const name of ['Save to file', 'Save as', 'Save a copy']) {
      if (!tree.result.nodes.some(node => !node.ignored && node.role?.value === 'button' && node.name?.value === name)) {
        throw new Error(`保存入口的真实可访问树缺少 ${name}`);
      }
    }
    for (const type of ['keyDown', 'keyUp']) await request('Input.dispatchKeyEvent', {
      type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
      ...(type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}),
    });
    await waitFor("document.querySelector('#statusText').textContent === 'Saved to <另存 & 原文>.pptx' && !document.querySelector('#fileName').textContent.startsWith('● ')", '原生 Enter 保存到不同目标');
    await click('[data-site-locale="zh-CN"]');
    await waitFor("document.querySelector('#statusText').textContent === '已保存到 <另存 & 原文>.pptx' && document.querySelector('#saveToFile').title === '保存目标：<另存 & 原文>.pptx'", '另存目标原文不参与翻译或 HTML 解释');
    if (!await evaluate(`(async () => {
      const current = new Uint8Array(await (await globalThis.__savedHandle.getFile()).arrayBuffer());
      const before = new Uint8Array(globalThis.__previousFile);
      return current.length === before.length && current.every((value, index) => value === before[index]);
    })()`, true)) throw new Error('另存为不能修改此前已保存的文件');
    await evaluate(`(async () => {
      const transfer = new DataTransfer(); transfer.items.add(await globalThis.__otherSaveHandle.getFile());
      const input = document.querySelector('#fileInput'); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await waitFor(`document.querySelector('#fileName').textContent === '<另存 & 原文>.pptx'
      && !document.querySelector('#editorApp').dataset.loading
      && document.querySelectorAll('[data-pane-element]').length === ${count}`, '不同目标文件真实重开');
    await click('[data-site-locale="en"]');
  } finally {
    await evaluate(`window.showSaveFilePicker = globalThis.__destinationPicker;
      FileSystemFileHandle.prototype.createWritable = globalThis.__destinationWritable;
      delete globalThis.__destinationPicker; delete globalThis.__destinationWritable;
      delete globalThis.__previousFile; delete globalThis.__otherSaveHandle;`);
  }
}
