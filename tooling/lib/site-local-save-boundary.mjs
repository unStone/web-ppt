/** 选择器只替换宿主边界；返回真实 OPFS 句柄，序列化、写入和读回均不替换。 */
export async function installLocalSaveBoundary({ evaluate }) {
  await evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('local-save.pptx', { create: true });
    globalThis.__savedHandle = handle;
    globalThis.__savePicker = window.showSaveFilePicker;
    globalThis.__saveDownloadClick = HTMLAnchorElement.prototype.click;
    globalThis.__localDownloads = [];
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        const name = this.download;
        void fetch(this.href).then(response => response.arrayBuffer()).then(bytes => {
          globalThis.__localDownloads.push({ name, bytes });
        });
      } else globalThis.__saveDownloadClick.call(this);
    };
    globalThis.__pickerCalls = [];
    window.showSaveFilePicker = async options => {
      if (!navigator.userActivation.isActive) throw new Error('选择器丢失用户激活');
      globalThis.__pickerCalls.push(options);
      return handle;
    };
  })()`, true);
}

export async function restoreLocalSaveBoundary({ evaluate }) {
  await evaluate(`window.showSaveFilePicker = globalThis.__savePicker;
    HTMLAnchorElement.prototype.click = globalThis.__saveDownloadClick;
    delete globalThis.__savePicker; delete globalThis.__savedHandle; delete globalThis.__pickerCalls;
    delete globalThis.__saveDownloadClick; delete globalThis.__localDownloads;`);
}

export async function coldSavePage({ evaluate, request, waitFor, click }, suffix) {
  const url = await evaluate(`new URL('editor.en.html?save-test=${suffix}', location.href).href`);
  await request('Page.navigate', { url });
  const ready = "document.querySelector('#canvasMount')?.firstElementChild && !document.querySelector('#editorApp').dataset.loading";
  await waitFor(`location.href === ${JSON.stringify(url)} && document.querySelector('#recoveryPrompt')
    && (!document.querySelector('#recoveryPrompt').hidden || (${ready}))`, '本机保存冷启动');
  if (await evaluate("!document.querySelector('#recoveryPrompt').hidden")) await click('#discardRecovery');
  await waitFor(ready, '本机保存冷启动文稿就绪');
}
