import assert from 'node:assert/strict';

export async function runSiteToolsBrowserContract({ evaluate }) {
  const result = await evaluate(`(async () => {
    const frame = document.createElement('iframe');
    frame.src = '/tools-shell.html';
    const loaded = new Promise(resolve => { frame.onload = resolve; });
    document.body.append(frame); await loaded;
    try {
      return await frame.contentWindow.eval('import("/tools-shutdown.mjs").then(api => api.runToolsShutdownContract("/fixtures/sample-editor-shape-format.pptx"))');
    } finally { frame.remove(); }
  })()`, true);
  assert.deepEqual(result, { productReleased: true, rebuilt: true, dialogsReleased: true, pageReleased: true });
  console.log('Cordis 业务工具：卸载命令监听、应用重建单次命令、弹窗关闭和语言入口归还通过');
  console.log('Cordis 页面服务：初始化回滚、导航/缩放/历史单次处理、卸载资源、等待文件交付及迟到动画隔离通过');
}
