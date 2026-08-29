/** jsdom 不含布局与浏览器 SVG 实现；票据的上屏预算必须在真实引擎里取证。 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearPerformanceFailures, runPerformanceAttempts } from './lib/browser-performance-contract.mjs';
import { browserResult } from './lib/editor-browser-devtools-contract.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const browser = candidates.find((candidate) => existsSync(candidate));
if (!browser) throw new Error('找不到 Chrome/Chromium；可通过 CHROME_BIN 指定真实浏览器');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const file = resolve(root, `.${pathname}`);
    if (!file.startsWith(`${resolve(root)}${sep}`) || !statSync(file).isFile()) throw new Error('not found');
    response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  } catch {
    response.writeHead(404).end('Not found');
  }
});

let address;
let profile;
let child;
let diagnostics = '';
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function waitForExternalLoadRelease() {
  if (process.env.WEB_PPT_PERFORMANCE_LOAD_HANDSHAKE !== '1') return;
  if (typeof process.send !== 'function') throw new Error('性能负载复现缺少 IPC 通道');
  await new Promise((resolveRelease, rejectRelease) => {
    const finish = (error) => {
      clearTimeout(timeout);
      process.off('message', onMessage);
      if (error) rejectRelease(error);
      else resolveRelease();
    };
    const onMessage = (message) => {
      if (message?.type !== 'web-ppt-performance-load-stopped') return;
      finish(message.error ? new Error(message.error) : undefined);
    };
    const timeout = setTimeout(() => finish(new Error('等待性能负载释放超时')), 15_000);
    process.on('message', onMessage);
    process.send({ type: 'web-ppt-performance-retry-ready' }, (error) => {
      if (error) finish(error);
    });
  });
}

async function launch(url) {
  return new Promise((resolveLaunch, reject) => {
    child = spawn(browser, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--user-data-dir=${profile}`, '--remote-debugging-port=0', url,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const timeout = setTimeout(() => reject(new Error('Chrome DevTools 启动超时')), 10000);
    child.stderr.on('data', (chunk) => {
      diagnostics += chunk.toString('utf8');
      const match = diagnostics.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (!match) return;
      clearTimeout(timeout);
      resolveLaunch(Number(match[1]));
    });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Chrome 提前退出 ${code}`));
    });
  });
}

async function pageTarget(port, url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const target = targets.find((candidate) => candidate.type === 'page' && candidate.url === url);
      if (target) return target;
    } catch { /* DevTools 端口刚出现时可能还没开始响应。 */ }
    await delay(100);
  }
  throw new Error('Chrome 没有创建编辑契约页面');
}

function browserRunning() {
  return child && child.exitCode === null && child.signalCode === null;
}

async function waitForBrowserExit(milliseconds) {
  if (!browserRunning()) return true;
  return Promise.race([
    new Promise((resolveExit) => child.once('close', () => resolveExit(true))),
    delay(milliseconds).then(() => false),
  ]);
}

async function stopBrowser() {
  if (browserRunning()) {
    child.kill('SIGTERM');
    if (!await waitForBrowserExit(2000) && browserRunning()) {
      child.kill('SIGKILL');
      await waitForBrowserExit(2000);
    }
  }
  // Chrome crashpad 可能继承 stderr；Chrome 本体退出后若不销毁读端，嵌套 npm 脚本仍不会结束。
  child?.stderr?.destroy();
  child?.unref();
  if (browserRunning()) throw new Error(`无法停止 Chrome；为避免破坏仍在使用的目录，保留 ${profile}`);
  if (profile) rmSync(profile, { recursive: true, force: true });
  child = undefined;
  profile = undefined;
}

async function runBrowserAttempt(number, url) {
  clearPerformanceFailures();
  diagnostics = '';
  profile = mkdtempSync(join(tmpdir(), `web-ppt-editor-browser-${number}-`));
  try {
    const attemptUrl = `${url}?attempt=${number}`;
    const port = await launch(attemptUrl);
    const target = await pageTarget(port, attemptUrl);
    const result = await browserResult(target.webSocketDebuggerUrl);
    if (result.status === 'pass') return result;
    return {
      functionalStatus: 'fail', functionalError: result.text,
      performanceFailures: [], environment: { disturbed: false, reasons: [] },
    };
  } catch (error) {
    return {
      functionalStatus: 'fail',
      functionalError: error instanceof Error ? error.stack : String(error),
      performanceFailures: [], environment: { disturbed: false, reasons: [] },
    };
  } finally {
    await stopBrowser();
  }
}

try {
  address = await new Promise((resolveAddress, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveAddress(server.address()));
  });
  const url = `http://127.0.0.1:${address.port}/tooling/editor-browser.html`;
  const attempts = await runPerformanceAttempts({
    attempt: (number) => runBrowserAttempt(number, url),
    onRetry: async (result) => {
      console.warn('  Chrome · 环境受扰，自动重测性能契约（1/1）：'
        + result.environment.reasons.join('；'));
      await waitForExternalLoadRelease();
    },
  });
  const { result } = attempts;
  if (process.env.WEB_PPT_PERFORMANCE_DEBUG === '1') {
    console.warn(`  Chrome · 性能环境采样 ${JSON.stringify(result.environment)}`);
  }
  if (result.functionalStatus !== 'pass') {
    throw new Error(`真实浏览器编辑功能契约未通过：${result.functionalError}`);
  }
  if (result.performanceFailures.length > 0) {
    const failures = result.performanceFailures
      .map((failure) => `${failure.name} ${failure.actual.toFixed(3)}ms > ${failure.budget}ms`).join('；');
    const baseline = [['测前', result.environment.before], ['测中', result.environment.during]]
      .map(([phase, sample]) => `${phase} rAF ${sample.p95.toFixed(1)}/${sample.max.toFixed(1)}ms，`
        + `固定计算 ${sample.computeP50.toFixed(1)}ms`).join('；');
    const environment = result.environment.disturbed
      ? `受扰（${result.environment.reasons.join('；')}；${baseline}）`
      : `安静（${baseline}）`;
    throw new Error(`真实浏览器性能契约未通过：${failures}\n环境自检：${environment}`);
  }
  console.log(`  Chrome · 点选反馈 p95 ${result.hitP95}ms · 60 元素提交 p95 ${result.p95}ms`
    + ` · 完整选择框 p95 ${result.selectionP95}ms · OBB/手柄最大偏差`
    + ` ${result.spaceError}/${result.handleError}px`
    + ` · 嵌套拖动偏差 ${result.nestedDragError}px`
    + ` · 拖动帧 p95 ${result.dragP95}ms`
    + ` · 顶点偏差/p95 ${result.vertexError}px/${result.vertexP95}ms`
    + ` · 对齐偏差/p95 ${result.alignError}px/${result.alignP95}ms`
    + ` · 缩放/命中偏差 ${result.resizeError}/${result.resizeHitError}px`
    + ` · 缩放帧 p95 ${result.resizeP95}ms`
    + ` · 45°×60 p95 ${result.resizeSingularP95}ms`
    + ` · 旋转嵌套/多选偏差 ${result.rotationNestedError}/${result.rotationMultiError}px`
    + ` · 旋转60 p95 ${result.rotationP95}ms`
    + ` · 吸附阈值/组内/等距偏差 ${result.snapThresholdError}/${result.snapGroupError}/${result.snapSpacingError}px`
    + ` · 吸附60 p95 ${result.snapP95}ms`
    + ` · 框选偏差 ${result.marqueeError}px · 框选60 首帧/p95 `
    + `${result.marqueeFirstFrame}/${result.marqueeP95}ms`
    + ` · 键盘微移偏差 ${result.keyboardError}px · 键盘60 p95 ${result.keyboardP95}ms`
    + ` · 撤销/重做60 p95 ${result.historyUndoP95}/${result.historyRedoP95}ms`
    + ` · 删除/撤销/重做60 p95 ${result.deleteP95}/${result.deleteUndoP95}/${result.deleteRedoP95}ms`
    + ` · 层级/撤销/重做60 p95 ${result.layerP95}/${result.layerUndoP95}/${result.layerRedoP95}ms`
    + ` · 组合/解组60 p95 ${result.groupP95}/${result.ungroupP95}ms`
    + ` · Tab60 p95 ${result.tabP95}ms`
    + ` · 修饰点选/框选60 p95 ${result.multiselectClickP95}/${result.multiselectMarqueeP95}ms`
    + ` · 剪贴板60 p95 ${result.clipboardPasteP95}ms`
    + ` · 文字输入 p95 ${result.textP95}ms`
    + ` · 段落格式 p95 ${result.paragraphP95}ms`
    + ` · 富文本2000 p95 ${result.richTextPasteP95}ms`
    + ` · engine2000 p95 ${result.engineTextP95}ms/行盒偏差 ${result.engineLineError}px`
    + ` · auto engine ${result.engineAutoProbe}`
    + ` · table20×10 ${result.tableCellTextP95}ms/末格追加 ${result.tableInsertRowP95}ms`
    + `/贴合偏差 ${result.tableCellGeometryError}px`
    + ` · autofit browser/engine/cell ${result.autofitBrowserP95}/${result.autofitEngineP95}/${result.autofitCellP95}ms`
    + ` · spAutoFit browser/engine ${result.shapeAutofitBrowserP95}/${result.shapeAutofitEngineP95}ms`
    + `/frame ${result.shapeAutofitFrameError}px`
    + ` · bodyProps browser/engine ${result.bodyPropsBrowserP95}/${result.bodyPropsEngineP95}ms`
    + `/frame ${result.bodyPropsFrameError}px`
    + ` · 新增形状偏差/p95 ${result.addShapeError}px/${result.addShapeP95}ms`
    + ` · 新增图片偏差/p95 ${result.addImageError}px/${result.addImageP95}ms`
    + ` · ${result.imageCropReport}`
    + ` · 新增页${result.addSlidePages}页偏差/p95 ${result.addSlideError}px/${result.addSlideP95}ms`
    + ` · 重排页${result.moveSlidePages}页 p95 ${result.moveSlideP95}ms`
    + ` · 换版式${result.changeLayoutPages}页单页完整上屏 p95 ${result.changeLayoutP95}ms`
    + ` · 新增20×10表格偏差/p95 ${result.addTableError}px/${result.addTableP95}ms`
    + ` · 超链接提交/路由 p95 ${result.hyperlinkCommitP95}/${result.hyperlinkRouteP95}ms`
    + ` · 页面属性200页批量/单页上屏 p95 ${result.slidePropertiesBatchP95}/${result.slidePropertiesRenderP95}ms`
    + ` · 页面图片背景200页模型/完整上屏 p95 `
    + `${result.slideImageBackgroundModelP95}/${result.slideImageBackgroundP95}ms`
    + ` · 40种切换启动/200页批量/单页反馈 p95 ${result.transitionPreviewP95}/`
    + `${result.transitionBatchP95}/${result.transitionFeedbackP95}ms`
    + ` · 60元素动画启动/200页批量/单页反馈 p95 ${result.animationPreviewP95}/`
    + `${result.animationBatchP95}/${result.animationFeedbackP95}ms`
    + ` · 备注2000 p95 ${result.slideNotesP95}ms`
    + ` · IndexedDB恢复1000帧 写入/恢复 ${result.recoveryPersistMs}/${result.recoveryRestoreMs}ms`
    + `/分块 ${result.recoveryChunks}/同步增量 ${result.recoverySyncOverhead}ms`
    + `/50MB指纹 ${result.recoveryFingerprintMs}ms`
    + ` · 选择窗格60锁定往返 p95 ${result.selectionPaneP95}ms`
    + ` · 格式刷60完整反馈 p95 ${result.formatPainterP95}ms`
    + ` · 查找替换200页索引/查询/增量 ${result.findReplaceBuildMs}/`
    + `${result.findReplaceQueryP95}/${result.findReplaceIncrementalMs}ms`
    + ` · 查找替换60导航/替换 p95 ${result.findReplaceNavigationP95}/`
    + `${result.findReplaceReplaceP95}ms`
    + ` · 可信文字输入 p95 ${Number(result.trustedTextP95).toFixed(3)}ms`
    + ` · pointer capture ${result.trustedDrag}/${result.trustedResize}/${result.trustedRotation}/`
    + `${result.trustedSnap}/${result.trustedMarquee}`
    + ` · trusted keyboard/tab/history/delete ${result.trustedKeyboard}/${result.trustedTab}/`
    + `${result.trustedHistory}/${result.trustedDelete}/${result.trustedLayer}/${result.trustedGroup}`
    + ` · trusted multiselect ${result.trustedModifierSelection}`
    + ` · trusted clipboard ${result.trustedClipboard}`
    + ` · trusted rich clipboard ${result.trustedRichTextClipboard}`
    + ` · trusted appendix B ${result.trustedShortcutAudit}`
    + ` · trusted text/IME ${result.trustedText}`
    + ` · trusted engine text/IME ${result.trustedEngineText}`
    + ` · trusted table cell text/IME ${result.trustedTableCellText}`
    + ` · ${result.fontFaces} 个嵌入 @font-face`);
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  throw error;
} finally {
  await stopBrowser();
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}
