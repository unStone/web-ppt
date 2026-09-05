import { runSiteLanguageInputContract } from './site-language-input-contract.mjs';

export async function runSiteI18nRecoveryContract(context) {
  const { evaluate, request, click, waitFor } = context;
  const url = await evaluate("new URL('editor.en.html', location.href).href");
  await request('Page.navigate', { url });
  await waitFor(`location.href === ${JSON.stringify(url)} && document.querySelector('#canvasMount')?.firstElementChild
    && !document.querySelector('#editorApp').dataset.loading`, '英文恢复测试文稿');
  const count = await evaluate("document.querySelectorAll('[data-pane-element]').length");
  await click('#addShape');
  await waitFor("document.querySelector('#recoveryState').textContent === 'Recovery records saved on this device'", '英文恢复落盘状态');
  await request('Page.reload');
  await waitFor("document.querySelector('#recoveryPrompt') && !document.querySelector('#recoveryPrompt').hidden", '英文冷启动恢复提示');
  await waitFor("document.querySelector('#recoverySummary').textContent.startsWith('Updated ')", '英文恢复摘要与日期');
  if (await evaluate("/\\p{Script=Han}/u.test(document.querySelector('#recoverySummary').textContent)")) throw new Error('英文恢复摘要不能依赖浏览器默认日期语言');
  await evaluate("globalThis.__languageRecoveryPrompt = document.querySelector('#recoveryPrompt')");
  await click('#recoveryPrompt [data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#recoverySummary').textContent.startsWith('记录于 ')", '等待恢复决策时切中文');
  if (!await evaluate("globalThis.__languageRecoveryPrompt === document.querySelector('#recoveryPrompt') && !document.querySelector('#recoveryPrompt').hidden")) throw new Error('切换语言不能提交或取消恢复决策');
  await click('#recoveryPrompt [data-site-locale="en"]');
  await waitFor("document.querySelector('#recoverySummary').textContent.startsWith('Updated ')", '恢复提示切回英文');
  await runSiteLanguageInputContract(context, '恢复提示');
  await click('#restoreRecovery');
  await waitFor("!document.querySelector('#editorApp').dataset.loading && document.querySelector('#recoveryPrompt').hidden", '换语言后恢复文稿');
  const restored = await evaluate("({ count: document.querySelectorAll('[data-pane-element]').length, dirty: document.querySelector('#fileName').textContent.startsWith('● ') })");
  if (restored.count !== count + 1 || !restored.dirty) throw new Error(`恢复内容不符：原有 ${count}，恢复后 ${JSON.stringify(restored)}`);
  if (!await evaluate("!!document.querySelector('.app-header #siteLanguage')")) throw new Error('恢复结束后语言控件未归还');
  // 恢复帧还原文稿与选区，不重建旧撤销栈；验证的是恢复后继续编辑的历史。
  await click('#addShape');
  await click('[data-site-locale="zh-CN"]');
  await click('#undo');
  await waitFor(`document.querySelectorAll('[data-pane-element]').length === ${count + 1}`, '恢复后切换语言再撤销新增操作');
  await waitFor("document.querySelector('#recoveryState').textContent === '恢复记录已写入本机'", '恢复后操作落盘');
  await request('Page.reload');
  await waitFor("document.querySelector('#recoveryPrompt') && !document.querySelector('#recoveryPrompt').hidden", '恢复记录再次冷启动');
  await click('#recoveryPrompt [data-site-locale="en"]');
  await click('#discardRecovery');
  await waitFor(`document.querySelectorAll('[data-pane-element]').length === ${count}
    && document.querySelector('#fileName').textContent === 'showcase.pptx'
    && !document.querySelector('#editorApp').dataset.loading`, '切换语言后放弃恢复记录');
  if (!await evaluate("!!document.querySelector('.app-header #siteLanguage')")) throw new Error('放弃恢复后语言入口未归还');
  await click('[data-site-locale="zh-CN"]');
}
