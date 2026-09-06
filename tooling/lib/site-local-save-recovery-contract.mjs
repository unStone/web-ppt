import { coldSavePage, installLocalSaveBoundary, restoreLocalSaveBoundary } from './site-local-save-boundary.mjs';
import { saveKey } from './site-local-save-async-contract.mjs';
import { reopenLocalFile } from './site-local-save-lifecycle-contract.mjs';

export async function runLocalSaveRecoveryContract(context) {
  const { evaluate, request, click, waitFor } = context;
  await coldSavePage(context, 'recovery');
  const count = await evaluate("document.querySelectorAll('[data-pane-element]').length");
  await installLocalSaveBoundary(context);
  try {
    await saveKey(context);
    await waitFor("document.querySelector('#statusText').textContent === 'Saved to local-save.pptx' && !document.querySelector('#saveAsFile').hidden", '刷新前会话已持有保存目标');
    await click('#addShape');
    await waitFor("document.querySelector('#recoveryState').textContent === 'Recovery records saved on this device'", '未保存编辑已经写入真实恢复存储');
  } finally { await restoreLocalSaveBoundary(context); }
  await request('Page.reload');
  await waitFor("document.querySelector('#recoveryPrompt') && !document.querySelector('#recoveryPrompt').hidden", '本机文件保存后的未保存编辑触发冷恢复');
  await installLocalSaveBoundary(context);
  try {
    await click('#restoreRecovery');
    await waitFor(`document.querySelector('#recoveryPrompt').hidden && !document.querySelector('#editorApp').dataset.loading
      && document.querySelectorAll('[data-pane-element]').length === ${count + 1}`, '从原始输入恢复未保存编辑');
    if (!await evaluate("document.querySelector('#saveAsFile').hidden && document.querySelector('#saveToFile').title === 'Save destination: Choose a destination' && document.querySelector('#fileName').textContent.startsWith('● ')")) {
      throw new Error('冷恢复不得继承旧句柄或清除未保存状态');
    }
    await saveKey(context);
    await waitFor("globalThis.__pickerCalls.length === 1 && document.querySelector('#statusText').textContent === 'Saved to local-save.pptx' && !document.querySelector('#fileName').textContent.startsWith('● ')", '恢复后保存必须重新授权目标');
    await waitFor("document.querySelector('#recoveryState').textContent === 'Recovery records saved on this device'", '恢复后交付确认已落存储');
    await reopenLocalFile(context, count + 1);
  } finally { await restoreLocalSaveBoundary(context); }
}
