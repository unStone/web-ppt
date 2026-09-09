import assert from 'node:assert/strict';

export async function runSiteFilesBrowserContract({ evaluate }) {
  const result = await evaluate(`(async () => {
    const frame = document.createElement('iframe'); document.body.append(frame);
    frame.contentDocument.documentElement.lang = 'zh-CN';
    frame.contentDocument.head.innerHTML = '<link rel="canonical" href="' + location.origin + '/editor.html">';
    frame.contentDocument.body.innerHTML = '<nav id="siteLanguage"></nav>'
      + '<input id="recoveryToggle" type="checkbox" checked>'
      + '<section id="recoveryPrompt" hidden><span></span><p id="recoverySummary"></p>'
      + '<button id="restoreRecovery"></button><button id="discardRecovery"></button></section>'
      + '<p id="recoveryState"></p><div id="canvas" style="width:640px;height:360px"></div><div id="objects"></div>';
    try {
      return await frame.contentWindow.eval('import("/files-shutdown.mjs").then(api => api.runFilesShutdownContract("/fixtures/sample-editor-shape-format.pptx"))');
    } finally { frame.remove(); }
  })()`, true);
  assert.deepEqual(result, { pendingSaveDelivered: ['replace', 'dispose'], listenersReleased: true, exportCancelled: true,
    submittedExportsDelivered: ['pdf', 'zip'], openingReleased: true });
  console.log('Cordis 文件服务：切换/退出等待 OPFS 写入、重开、监听卸载、取消未提交导出及等待已提交 PDF/ZIP 交付通过');
}
