import assert from 'node:assert/strict';
import { openFixture } from './site-editor-browser-helpers.mjs';

export async function runSiteRecoveryBrowserContract(context) {
  const { evaluate, waitFor, click } = context;
  const source = '/fixtures/sample-editor-add-slide.pptx';
  const other = '/fixtures/sample-editor-preset-shape.pptx';
  const count = () => evaluate("document.querySelectorAll('#slideList [data-slide-id]').length");
  const requestOpen = name => evaluate(`(async () => {
    const bytes = await fetch('${source}').then(response => response.arrayBuffer());
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], '${name}'));
    const input = document.querySelector('#fileInput'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  const ready = name => waitFor(`document.querySelector('#fileName').textContent.replace(/^● /, '') === '${name}'
    && !document.querySelector('#editorApp').dataset.loading`, `${name} 已打开`);
  const recorded = () => waitFor("document.querySelector('#recoveryState').textContent === '恢复记录已写入本机'", '真实 IndexedDB 恢复帧落盘');

  await openFixture(context, source, 'recovery-native-first.pptx', { discardRecovery: true });
  assert.equal(await evaluate("document.querySelector('#recoveryToggle').checked"), true);
  const original = await count();
  await click('#addSlide');
  await recorded();
  await openFixture(context, other, 'recovery-native-away.pptx');
  await evaluate("globalThis.__recoveryLanguageHome = document.querySelector('#siteLanguage').parentElement");
  try {
    await requestOpen('recovery-native-restored.pptx');
    await waitFor("!document.querySelector('#recoveryPrompt').hidden", '实际存储中的未保存记录触发恢复选择');
    assert.equal(await evaluate("document.querySelector('#recoveryPrompt').contains(document.querySelector('#siteLanguage'))"), true);
    await click('#restoreRecovery');
    await ready('recovery-native-restored.pptx');
    assert.equal(await count(), original + 1, '更换文稿后仍恢复未保存的新增页');
    assert.equal(await evaluate("document.querySelector('#siteLanguage').parentElement === globalThis.__recoveryLanguageHome"), true);

    await click('#addSlide');
    await recorded();
    await openFixture(context, other, 'recovery-native-away-again.pptx');
    await requestOpen('recovery-native-pending.pptx');
    await waitFor("!document.querySelector('#recoveryPrompt').hidden", '恢复选择正在等待用户');
    await openFixture(context, other, 'recovery-native-replaced.pptx');
    assert.equal(await evaluate("document.querySelector('#recoveryPrompt').hidden"), true);
    assert.equal(await evaluate("document.querySelector('#siteLanguage').parentElement === globalThis.__recoveryLanguageHome"), true);
    // 清除本契约特意留下的未保存记录，后续契约继续从原始固件打开。
    await requestOpen('recovery-native-discarded.pptx');
    await waitFor("!document.querySelector('#recoveryPrompt').hidden", '新打开取消旧提示后记录仍可选择');
    await click('#discardRecovery');
    await ready('recovery-native-discarded.pptx');
    assert.equal(await count(), original);
  } finally {
    await evaluate('delete globalThis.__recoveryLanguageHome');
  }
  const shutdown = await evaluate(`(async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    frame.contentDocument.documentElement.lang = 'zh-CN';
    frame.contentDocument.head.innerHTML = '<link rel="canonical" href="' + location.origin + '/editor.html">';
    frame.contentDocument.body.innerHTML = '<nav id="siteLanguage"></nav>'
      + '<input id="recoveryToggle" type="checkbox" checked>'
      + '<section id="recoveryPrompt" hidden><span></span><p id="recoverySummary"></p>'
      + '<button id="restoreRecovery"></button><button id="discardRecovery"></button></section>'
      + '<p id="recoveryState"></p><div id="canvas" style="width:640px;height:360px"></div><div id="objects"></div>';
    try {
      return await frame.contentWindow.eval('import("/recovery-shutdown.mjs").then(api => api.runRecoveryShutdownContract("${other}"))');
    } finally { frame.remove(); }
  })()`, true);
  assert.deepEqual(shutdown, { pendingWritesPersisted: true, actions: ['replace', 'dispose'] });
  console.log('官网恢复服务：真实 IndexedDB 落盘、跨文稿恢复、新打开取消悬挂选择及语言入口归还通过');
  console.log('Cordis 应用：关闭下次打开恢复偏好后，切换/退出等待待写帧，关闭存储重开仍可恢复');
}
