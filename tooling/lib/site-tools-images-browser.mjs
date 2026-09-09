const require = (condition, message) => { if (!condition) throw new Error(message); };

export async function checkImageToolCancellation(app, current) {
  const png = await fetch('/fixtures/sample-editor-audio-icon.png').then(response => response.arrayBuffer());
  const { session, view } = current;
  const bitmap = globalThis.createImageBitmap;
  let id;
  try {
    globalThis.createImageBitmap = undefined;
    id = await view.insertImage(new File([png], 'original.png', { type: 'image/png' }));
  } finally { globalThis.createImageBitmap = bitmap; }
  session.editor.select({ kind: 'elements', ids: [id], enteredGroup: null }); app.tools.sync();
  const execute = session.editor.exec.bind(session.editor);
  let writes = 0;
  session.editor.exec = command => {
    if (command.type === 'AddImage' || command.type === 'ReplaceImage') writes++;
    return execute(command);
  };
  const click = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () { if (this.type !== 'file') click.call(this); };
  try {
    const add = document.querySelector('#addImage'); add.disabled = false; add.click();
    require(view.element.querySelector('[data-web-ppt-image-input]'), '实际打开 SDK 图片选择器');
    app.tools.reset();
    require(!view.element.querySelector('[data-web-ppt-image-input]'), '文稿重置取消尚未选择的图片入口');
    for (const action of ['insert', 'replace']) {
      let release;
      const held = new Promise(resolve => { release = resolve; });
      const file = new File([png], 'held.png', { type: 'image/png' });
      let reading = false;
      const originalRead = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = async function () {
        if (this.name === 'held.png') { reading = true; await held; }
        return originalRead.call(this);
      };
      try {
        if (action === 'insert') add.click();
        const input = action === 'insert' ? view.element.querySelector('[data-web-ppt-image-input]')
          : document.querySelector('#replaceImageInput');
        const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
        input.dispatchEvent(new Event('change'));
        require(reading, '图片读取确实进入等待');
        if (action === 'replace') app.tools.dispose(); else app.tools.reset();
        require(!session.disposed, '模拟应用等待文件交付，旧会话仍存活');
        release();
        for (let i = 0; i < 100 && view.element.dataset.imageInsertState === 'reading'; i++) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        require(view.element.dataset.imageInsertState !== 'reading' && writes === 0,
          '重置或卸载后，延迟图片读取不能提交 AddImage/ReplaceImage');
      } finally { release(); Blob.prototype.arrayBuffer = originalRead; }
    }
    return true;
  } finally { HTMLInputElement.prototype.click = click; }
}
