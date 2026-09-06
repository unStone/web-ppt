import { openFixture } from './site-editor-browser-helpers.mjs';
import { runLocalSaveFailuresContract } from './site-local-save-failures-contract.mjs';
import { runLocalSaveAsyncContract, runLocalSaveFallbackContract, saveKey } from './site-local-save-async-contract.mjs';
import { runLocalSaveLifecycleContract } from './site-local-save-lifecycle-contract.mjs';
import { installLocalSaveBoundary, restoreLocalSaveBoundary } from './site-local-save-boundary.mjs';
import { runLocalSaveRaceContract } from './site-local-save-race-contract.mjs';
import { runLocalSaveRecoveryContract } from './site-local-save-recovery-contract.mjs';
import { runLocalSaveDestinationContract } from './site-local-save-destination-contract.mjs';

export async function runSiteLocalSaveContract(context) {
  const { evaluate, click, waitFor } = context;
  await openFixture(context, '/fixtures/sample-editor-shape-format.pptx', '<本机 & 原文>.pptx');
  await click('[data-site-locale="en"]');
  await installLocalSaveBoundary(context);
  try {
    await click('#addShape');
    await waitFor("document.querySelector('#saveToFile') && !document.querySelector('#saveToFile').hidden", '支持浏览器提供保存到文件入口');
    await click('#saveToFile');
    await waitFor("document.querySelector('#statusText').textContent === 'Saved to local-save.pptx' && !document.querySelector('#fileName').textContent.startsWith('● ')", '真实本机文件写入成功后才清除未保存状态');
    const saved = await evaluate(`(async () => {
      const file = await globalThis.__savedHandle.getFile();
      return { magic: [...new Uint8Array(await file.arrayBuffer()).slice(0, 2)], size: file.size,
        options: globalThis.__pickerCalls[0], count: globalThis.__pickerCalls.length };
    })()`, true);
    if (saved.magic.join(',') !== '80,75' || saved.size < 1000 || saved.count !== 1
      || saved.options.suggestedName !== '<本机 & 原文>-edited.pptx') throw new Error(`本机保存内容或选择器选项错误：${JSON.stringify(saved)}`);
    await click('#addShape');
    await click('#saveToFile');
    await waitFor("!document.querySelector('#fileName').textContent.startsWith('● ')", '重复保存同一文件');
    if (await evaluate('globalThis.__pickerCalls.length !== 1')) throw new Error('重复保存必须复用当前文稿文件句柄');
    const count = await evaluate("document.querySelectorAll('[data-pane-element]').length");
    await evaluate(`(async () => {
      const transfer = new DataTransfer(); transfer.items.add(await globalThis.__savedHandle.getFile());
      const input = document.querySelector('#fileInput'); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, true);
    await waitFor(`document.querySelector('#fileName').textContent === 'local-save.pptx'
      && !document.querySelector('#editorApp').dataset.loading
      && document.querySelectorAll('[data-pane-element]').length === ${count}`, '真实保存文件通过产品入口重新打开');
    await downloadFailure(context);
    await saveKeys(context);
    await runLocalSaveFailuresContract(context);
    await runLocalSaveAsyncContract(context);
    await runLocalSaveFallbackContract(context);
    await runLocalSaveLifecycleContract(context);
    await runLocalSaveDestinationContract(context);
  } finally {
    await restoreLocalSaveBoundary(context);
  }
  await runLocalSaveRaceContract(context);
  await runLocalSaveRecoveryContract(context);
}

async function saveKeys(context) {
  const { evaluate, click, waitFor } = context;
  await saveKey(context);
  await waitFor("globalThis.__pickerCalls.length === 2 && document.querySelector('#statusText').textContent === 'Saved to local-save.pptx'", 'Ctrl/Cmd+S 在新会话重新选择目标');
  await click('#addShape');
  await saveKey(context);
  await waitFor("!document.querySelector('#fileName').textContent.startsWith('● ')", '原生快捷键保存复用目标');
  if (await evaluate('globalThis.__pickerCalls.length !== 2 || globalThis.__localDownloads.length !== 0')) throw new Error('保存快捷键不能重复选择或偷偷下载');
  await saveKey(context, true);
  await waitFor('globalThis.__pickerCalls.length === 3', 'Ctrl/Cmd+Shift+S 更换保存位置');
  await waitFor("document.querySelector('#saveAsFile') && !document.querySelector('#saveAsFile').hidden && !document.querySelector('#saveAsFile').disabled", '已选择目标时提供更换位置按钮');
  await click('#saveAsFile');
  await waitFor('globalThis.__pickerCalls.length === 4', '按钮和快捷键共用另存入口');
  await waitFor("!document.querySelector('#saveToFile').disabled", '另存为结束后解锁');
}

async function downloadFailure({ evaluate, click, waitFor }) {
  await click('#addShape');
  await evaluate(`globalThis.__saveObjectURL = URL.createObjectURL;
    URL.createObjectURL = () => { throw new Error('<下载失败 & 原文>'); };`);
  try {
    await click('#saveFile');
    await waitFor("document.querySelector('#statusText').textContent === 'Could not save: <下载失败 & 原文>' && !document.querySelector('#saveFile').disabled", '下载失败交付错误');
    if (!await evaluate("document.querySelector('#fileName').textContent.startsWith('● ')")) {
      throw new Error('下载失败不能清除尚未交付的编辑状态');
    }
  } finally { await evaluate('URL.createObjectURL = globalThis.__saveObjectURL; delete globalThis.__saveObjectURL'); }
}
