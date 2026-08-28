/** jsdom 不含布局与浏览器 SVG 实现；票据的上屏预算必须在真实引擎里取证。 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { runTrustedKeyboardContract } from './lib/editor-keyboard-trusted-contract.mjs';
import { runTrustedHistoryContract } from './lib/editor-history-browser-contract.mjs';
import { runTrustedDeleteContract } from './lib/editor-delete-browser-contract.mjs';
import { runTrustedLayerContract } from './lib/editor-layer-browser-contract.mjs';
import { runTrustedGroupContract } from './lib/editor-group-browser-contract.mjs';
import { runTrustedModifierSelectionContract } from './lib/editor-multiselect-browser-contract.mjs';
import { runTrustedTabContract } from './lib/editor-tab-browser-contract.mjs';
import { runTrustedMarqueeContract } from './lib/editor-marquee-trusted-contract.mjs';
import { runTrustedSnapContract } from './lib/editor-snap-trusted-contract.mjs';
import { runTrustedClipboardContract } from './lib/editor-clipboard-trusted-contract.mjs';
import { runTrustedTextContract } from './lib/editor-text-trusted-contract.mjs';
import { runTrustedEngineTextContract } from './lib/editor-engine-text-trusted-contract.mjs';
import { runTrustedRichTextClipboardContract } from './lib/editor-rich-text-clipboard-trusted-contract.mjs';
import { runTrustedTableCellTextContract } from './lib/editor-table-cell-text-trusted-contract.mjs';
import { runTrustedShortcutAuditContract } from './lib/editor-shortcut-audit-trusted-contract.mjs';

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

async function browserResult(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.once('open', resolveOpen);
    socket.once('error', reject);
  });
  let serial = 0;
  const pending = new Map();
  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  };
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timeout);
      request.resolve(message);
    }
  });
  socket.on('error', rejectPending);
  socket.on('close', () => rejectPending(new Error('Chrome DevTools 连接提前关闭')));
  const request = (method, params) => new Promise((resolveRequest, rejectRequest) => {
    const id = ++serial;
    const timeout = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`Chrome DevTools ${method} 请求超时`));
    }, 15000);
    pending.set(id, {
      resolve: (message) => message.error
        ? rejectRequest(new Error(`Chrome DevTools ${method}: ${message.error.message}`))
        : resolveRequest(message),
      reject: rejectRequest,
      timeout,
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, awaitPromise = false) => {
    const response = await request('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.exception?.description ?? 'Chrome 页面脚本执行失败');
    }
    return response.result?.result?.value;
  };
  const dispatchTrustedMouse = (type, point, modifiers, buttons) => request('Input.dispatchMouseEvent', {
    type, x: point.x, y: point.y,
    button: type === 'mouseMoved' && buttons === 0 ? 'none' : 'left',
    buttons, ...(type === 'mouseMoved' ? {} : { clickCount: 1 }), modifiers,
  });
  const trustedMouseGesture = async (start, end, duringExpression, committedExpression, modifiers = 0) => {
    await dispatchTrustedMouse('mouseMoved', start, modifiers, 0);
    await dispatchTrustedMouse('mousePressed', start, modifiers, 1);
    let during;
    try {
      await dispatchTrustedMouse('mouseMoved', end, modifiers, 1);
      await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))', true);
      during = await evaluate(duringExpression);
    } finally {
      await dispatchTrustedMouse('mouseReleased', end, modifiers, 0);
    }
    return { during, committed: await evaluate(committedExpression) };
  };
  const trustedClick = async (point, modifiers = 0) => {
    await dispatchTrustedMouse('mouseMoved', point, modifiers, 0);
    await dispatchTrustedMouse('mousePressed', point, modifiers, 1);
    await dispatchTrustedMouse('mouseReleased', point, modifiers, 0);
  };
  const dispatchKey = async (key, code, virtualKeyCode, modifiers = 0, commands = undefined) => {
    const params = {
      key, code, modifiers,
      windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode,
    };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params, ...(commands ? { commands } : {}) });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  };
  let origin = null;
  for (let attempt = 0; attempt < 100; attempt++) {
    origin = await evaluate('location.origin');
    if (typeof origin === 'string' && origin.startsWith('http://127.0.0.1:')) break;
    await delay(50);
  }
  if (typeof origin !== 'string' || !origin.startsWith('http://127.0.0.1:')) {
    throw new Error(`Chrome 测试页没有完成导航：${String(origin)}`);
  }
  await request('Browser.grantPermissions', {
    origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  });
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await evaluate(`(() => {
        const report = document.querySelector('#report');
        return report ? { status: report.dataset.status ?? 'running', p95: report.dataset.p95,
          hitP95: report.dataset.hitP95, selectionP95: report.dataset.selectionP95,
          spaceError: report.dataset.spaceError, handleError: report.dataset.handleError,
          nestedDragError: report.dataset.nestedDragError,
          dragP95: report.dataset.dragP95, resizeError: report.dataset.resizeError,
          resizeHitError: report.dataset.resizeHitError, resizeP95: report.dataset.resizeP95,
          resizeSingularP95: report.dataset.resizeSingularP95,
          rotationNestedError: report.dataset.rotationNestedError,
          rotationMultiError: report.dataset.rotationMultiError,
          rotationP95: report.dataset.rotationP95,
          snapThresholdError: report.dataset.snapThresholdError,
          snapGroupError: report.dataset.snapGroupError,
          snapSpacingError: report.dataset.snapSpacingError,
          snapP95: report.dataset.snapP95,
          marqueeError: report.dataset.marqueeError,
          marqueeFirstFrame: report.dataset.marqueeFirstFrame,
          marqueeP95: report.dataset.marqueeP95,
          keyboardError: report.dataset.keyboardError,
          keyboardP95: report.dataset.keyboardP95,
          historyUndoP95: report.dataset.historyUndoP95,
          historyRedoP95: report.dataset.historyRedoP95,
          deleteP95: report.dataset.deleteP95,
          deleteUndoP95: report.dataset.deleteUndoP95,
          deleteRedoP95: report.dataset.deleteRedoP95,
          layerP95: report.dataset.layerP95,
          layerUndoP95: report.dataset.layerUndoP95,
          layerRedoP95: report.dataset.layerRedoP95,
          groupP95: report.dataset.groupP95,
          ungroupP95: report.dataset.ungroupP95,
          alignError: report.dataset.alignError,
          alignP95: report.dataset.alignP95,
          tabP95: report.dataset.tabP95,
          multiselectClickP95: report.dataset.multiselectClickP95,
          multiselectMarqueeP95: report.dataset.multiselectMarqueeP95,
          clipboardPaste: report.dataset.clipboardPaste,
          clipboardPasteP95: report.dataset.clipboardPasteP95,
          textP95: report.dataset.textP95,
          paragraphP95: report.dataset.paragraphP95,
          richTextPasteP95: report.dataset.richTextPasteP95,
          engineTextP95: report.dataset.engineTextP95,
          engineLineError: report.dataset.engineLineError,
          engineAutoProbe: report.dataset.engineAutoProbe,
          tableCellTextP95: report.dataset.tableCellTextP95,
          tableInsertRowP95: report.dataset.tableInsertRowP95,
          tableCellGeometryError: report.dataset.tableCellGeometryError,
          autofitBrowserP95: report.dataset.autofitBrowserP95,
          autofitEngineP95: report.dataset.autofitEngineP95,
          autofitCellP95: report.dataset.autofitCellP95,
          shapeAutofitBrowserP95: report.dataset.shapeAutofitBrowserP95,
          shapeAutofitEngineP95: report.dataset.shapeAutofitEngineP95,
          shapeAutofitFrameError: report.dataset.shapeAutofitFrameError,
          bodyPropsBrowserP95: report.dataset.bodyPropsBrowserP95,
          bodyPropsEngineP95: report.dataset.bodyPropsEngineP95,
          bodyPropsFrameError: report.dataset.bodyPropsFrameError,
          addShapeError: report.dataset.addShapeError,
          addShapeP95: report.dataset.addShapeP95,
          addImageError: report.dataset.addImageError,
          addImageP95: report.dataset.addImageP95,
          imageCropReport: report.dataset.imageCropReport,
          addSlideError: report.dataset.addSlideError,
          addSlideP95: report.dataset.addSlideP95,
          addSlidePages: report.dataset.addSlidePages,
          moveSlideP95: report.dataset.moveSlideP95,
          moveSlidePages: report.dataset.moveSlidePages,
          changeLayoutP95: report.dataset.changeLayoutP95,
          changeLayoutPages: report.dataset.changeLayoutPages,
          addTableError: report.dataset.addTableError,
          addTableP95: report.dataset.addTableP95,
          hyperlinkCommitP95: report.dataset.hyperlinkCommitP95,
          hyperlinkRouteP95: report.dataset.hyperlinkRouteP95,
          slidePropertiesBatchP95: report.dataset.slidePropertiesBatchP95,
          slidePropertiesRenderP95: report.dataset.slidePropertiesRenderP95,
          slideImageBackgroundP95: report.dataset.slideImageBackgroundP95,
          slideImageBackgroundModelP95: report.dataset.slideImageBackgroundModelP95,
          transitionPreviewP95: report.dataset.transitionPreviewP95,
          transitionBatchP95: report.dataset.transitionBatchP95,
          transitionFeedbackP95: report.dataset.transitionFeedbackP95,
          animationPreviewP95: report.dataset.animationPreviewP95,
          animationBatchP95: report.dataset.animationBatchP95,
          animationFeedbackP95: report.dataset.animationFeedbackP95,
          slideNotesP95: report.dataset.slideNotesP95,
          recoveryPersistMs: report.dataset.recoveryPersistMs,
          recoveryRestoreMs: report.dataset.recoveryRestoreMs,
          recoveryChunks: report.dataset.recoveryChunks,
          recoverySyncOverhead: report.dataset.recoverySyncOverhead,
          recoveryFingerprintMs: report.dataset.recoveryFingerprintMs,
          selectionPaneP95: report.dataset.selectionPaneP95,
          formatPainterP95: report.dataset.formatPainterP95,
          findReplaceBuildMs: report.dataset.findReplaceBuildMs,
          findReplaceQueryP95: report.dataset.findReplaceQueryP95,
          findReplaceIncrementalMs: report.dataset.findReplaceIncrementalMs,
          findReplaceNavigationP95: report.dataset.findReplaceNavigationP95,
          findReplaceReplaceP95: report.dataset.findReplaceReplaceP95,
          fontFaces: report.dataset.fontFaces,
          text: report.textContent } : { status: 'running' };
      })()`);
      if (result?.status === 'fail') return result;
      if (result?.status === 'pass') {
        const start = await evaluate(`(() => {
          const { spaceView, perfSession } = globalThis.editorContract;
          spaceView.destroy();
          const mount = document.querySelector('#mount');
          const view = perfSession.mount(mount, {
            mode: 'edit', textMode: 'svg', zoom: 0.75, snapping: false,
          });
          const [id, siblingId] = perfSession.editor.doc.slides[view.slideId].children;
          perfSession.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
          const target = mount.querySelector('[data-edit-id="' + id + '"]');
          const sibling = mount.querySelector('[data-edit-id="' + siblingId + '"]');
          target.scrollIntoView({ block: 'center', inline: 'center' });
          const rect = target.getBoundingClientRect();
          globalThis.trustedDragContract = {
            view, id, siblingId, target, sibling,
            svg: mount.querySelector('[data-ppt-layer="static"] svg'),
            defs: mount.querySelector('[data-ppt-layer="static"] defs'),
            source: perfSession.editor.effectiveElement(id),
            historyBefore: perfSession.editor.history.undoCount,
          };
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`);
        const end = { x: start.x + 30, y: start.y + 18 };
        const dragResult = await trustedMouseGesture(start, end, `(() => {
          const state = globalThis.trustedDragContract;
          const { perfSession } = globalThis.editorContract;
          const mount = document.querySelector('#mount');
          return {
            captured: state.view.element.hasPointerCapture(1),
            ghost: !!mount.querySelector('[data-edit-drag-ghost]'),
            modelStable: perfSession.editor.effectiveElement(state.id).x === state.source.x,
            targetStable: mount.querySelector('[data-edit-id="' + state.id + '"]') === state.target,
            svgStable: mount.querySelector('[data-ppt-layer="static"] svg') === state.svg,
            defsStable: mount.querySelector('[data-ppt-layer="static"] defs') === state.defs,
          };
        })()`, `(() => {
          const state = globalThis.trustedDragContract;
          const { perfSession } = globalThis.editorContract;
          const mount = document.querySelector('#mount');
          const moved = perfSession.editor.effectiveElement(state.id);
          const result = {
            captureReleased: !state.view.element.hasPointerCapture(1),
            moved: Math.abs(moved.x - state.source.x - 40) < 1e-6
              && Math.abs(moved.y - state.source.y - 24) < 1e-6,
            oneHistory: perfSession.editor.history.undoCount === state.historyBefore + 1,
            ghostGone: !mount.querySelector('[data-edit-drag-ghost]'),
            targetPatched: mount.querySelector('[data-edit-id="' + state.id + '"]') !== state.target,
            siblingStable: mount.querySelector('[data-edit-id="' + state.siblingId + '"]') === state.sibling,
            svgStable: mount.querySelector('[data-ppt-layer="static"] svg') === state.svg,
            defsStable: mount.querySelector('[data-ppt-layer="static"] defs') === state.defs,
          };
          perfSession.editor.undo();
          result.undoRestored = Math.abs(perfSession.editor.effectiveElement(state.id).x - state.source.x) < 1e-6;
          state.view.destroy();
          delete globalThis.trustedDragContract;
          return result;
        })()`);
        const trusted = Object.values(dragResult.during).every(Boolean)
          && Object.values(dragResult.committed).every(Boolean);
        if (!trusted) throw new Error(`真实 pointer capture 拖动失败：${JSON.stringify(dragResult)}`);

        const resizeStart = await evaluate(`(() => {
          const { perfSession } = globalThis.editorContract;
          const mount = document.querySelector('#mount');
          const view = perfSession.mount(mount, {
            mode: 'edit', textMode: 'svg', zoom: 0.75, snapping: false,
          });
          const [id, siblingId] = perfSession.editor.doc.slides[view.slideId].children;
          perfSession.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
          const handle = mount.querySelector('[data-edit-resize-handle="se"]');
          handle.scrollIntoView({ block: 'center', inline: 'center' });
          const rect = handle.getBoundingClientRect();
          globalThis.trustedResizeContract = {
            view, id, siblingId,
            target: mount.querySelector('[data-edit-id="' + id + '"]'),
            sibling: mount.querySelector('[data-edit-id="' + siblingId + '"]'),
            svg: mount.querySelector('[data-ppt-layer="static"] svg'),
            defs: mount.querySelector('[data-ppt-layer="static"] defs'),
            source: perfSession.editor.effectiveElement(id),
            historyBefore: perfSession.editor.history.undoCount,
          };
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`);
        const resizeEnd = { x: resizeStart.x + 30, y: resizeStart.y + 18 };
        const resizeResult = await trustedMouseGesture(resizeStart, resizeEnd, `(() => {
          const state = globalThis.trustedResizeContract;
          const { perfSession } = globalThis.editorContract;
          const mount = document.querySelector('#mount');
          return {
            captured: state.view.element.hasPointerCapture(1),
            ghost: !!mount.querySelector('[data-edit-resize-ghost]'),
            modelStable: perfSession.editor.effectiveElement(state.id).w === state.source.w,
            targetStable: mount.querySelector('[data-edit-id="' + state.id + '"]') === state.target,
            svgStable: mount.querySelector('[data-ppt-layer="static"] svg') === state.svg,
            defsStable: mount.querySelector('[data-ppt-layer="static"] defs') === state.defs,
          };
        })()`, `(() => {
          const state = globalThis.trustedResizeContract;
          const { perfSession } = globalThis.editorContract;
          const mount = document.querySelector('#mount');
          const resized = perfSession.editor.effectiveElement(state.id);
          const result = {
            captureReleased: !state.view.element.hasPointerCapture(1),
            resized: Math.abs(resized.w - state.source.w - 40) < 1e-6
              && Math.abs(resized.h - state.source.h - 24) < 1e-6
              && Math.abs(resized.x - state.source.x) < 1e-6
              && Math.abs(resized.y - state.source.y) < 1e-6,
            oneHistory: perfSession.editor.history.undoCount === state.historyBefore + 1,
            ghostGone: !mount.querySelector('[data-edit-resize-ghost]'),
            targetPatched: mount.querySelector('[data-edit-id="' + state.id + '"]') !== state.target,
            siblingStable: mount.querySelector('[data-edit-id="' + state.siblingId + '"]') === state.sibling,
            svgStable: mount.querySelector('[data-ppt-layer="static"] svg') === state.svg,
            defsStable: mount.querySelector('[data-ppt-layer="static"] defs') === state.defs,
          };
          perfSession.editor.undo();
          result.undoRestored = Math.abs(perfSession.editor.effectiveElement(state.id).w - state.source.w) < 1e-6;
          state.view.destroy();
          delete globalThis.trustedResizeContract;
          return result;
        })()`);
        const trustedResize = Object.values(resizeResult.during).every(Boolean)
          && Object.values(resizeResult.committed).every(Boolean);
        if (!trustedResize) throw new Error(`真实 pointer capture 缩放失败：${JSON.stringify(resizeResult)}`);

        const rotationPoints = await evaluate(`(() => {
          const { perfSession } = globalThis.editorContract;
          const mount = document.querySelector('#mount');
          const view = perfSession.mount(mount, {
            mode: 'edit', textMode: 'svg', zoom: 0.75, snapping: false,
          });
          const ids = perfSession.editor.doc.slides[view.slideId].children;
          const [id, siblingId] = [ids[10], ids[11]];
          perfSession.editor.select({ kind: 'elements', ids: [id], enteredGroup: null });
          const handle = mount.querySelector('[data-edit-rotation-handle]');
          handle.scrollIntoView({ block: 'center', inline: 'center' });
          const handleRect = handle.getBoundingClientRect();
          const frameRect = mount.querySelector('[data-edit-selection-frame]').getBoundingClientRect();
          const start = { x: handleRect.left + handleRect.width / 2, y: handleRect.top + handleRect.height / 2 };
          const center = { x: frameRect.left + frameRect.width / 2, y: frameRect.top + frameRect.height / 2 };
          const vector = { x: start.x - center.x, y: start.y - center.y };
          const end = {
            x: center.x + (vector.x - vector.y) / Math.SQRT2,
            y: center.y + (vector.x + vector.y) / Math.SQRT2,
          };
          globalThis.trustedRotationContract = {
            view, id, siblingId,
            target: mount.querySelector('[data-edit-id="' + id + '"]'),
            sibling: mount.querySelector('[data-edit-id="' + siblingId + '"]'),
            svg: mount.querySelector('[data-ppt-layer="static"] svg'),
            defs: mount.querySelector('[data-ppt-layer="static"] defs'),
            source: perfSession.editor.effectiveElement(id),
            historyBefore: perfSession.editor.history.undoCount,
          };
          return { start, end };
        })()`);
        const rotationResult = await trustedMouseGesture(
          rotationPoints.start, rotationPoints.end,
          `(() => {
            const state = globalThis.trustedRotationContract;
            const { perfSession } = globalThis.editorContract;
            const mount = document.querySelector('#mount');
            return {
              captured: state.view.element.hasPointerCapture(1),
              ghost: !!mount.querySelector('[data-edit-rotation-ghost]'),
              modelStable: perfSession.editor.effectiveElement(state.id).rot === state.source.rot,
              targetStable: mount.querySelector('[data-edit-id="' + state.id + '"]') === state.target,
              svgStable: mount.querySelector('[data-ppt-layer="static"] svg') === state.svg,
              defsStable: mount.querySelector('[data-ppt-layer="static"] defs') === state.defs,
            };
          })()`,
          `(() => {
            const state = globalThis.trustedRotationContract;
            const { perfSession } = globalThis.editorContract;
            const mount = document.querySelector('#mount');
            const rotated = perfSession.editor.effectiveElement(state.id);
            const result = {
              captureReleased: !state.view.element.hasPointerCapture(1),
              rotated: Math.abs(rotated.rot - state.source.rot - 45) < 1e-6,
              oneHistory: perfSession.editor.history.undoCount === state.historyBefore + 1,
              ghostGone: !mount.querySelector('[data-edit-rotation-ghost]'),
              targetPatched: mount.querySelector('[data-edit-id="' + state.id + '"]') !== state.target,
              siblingStable: mount.querySelector('[data-edit-id="' + state.siblingId + '"]') === state.sibling,
              svgStable: mount.querySelector('[data-ppt-layer="static"] svg') === state.svg,
              defsStable: mount.querySelector('[data-ppt-layer="static"] defs') === state.defs,
            };
            perfSession.editor.undo();
            result.undoRestored = Math.abs(perfSession.editor.effectiveElement(state.id).rot - state.source.rot) < 1e-6;
            state.view.destroy();
            delete globalThis.trustedRotationContract;
            return result;
          })()`,
        );
        const trustedRotation = Object.values(rotationResult.during).every(Boolean)
          && Object.values(rotationResult.committed).every(Boolean);
        if (!trustedRotation) {
          throw new Error(`真实 pointer capture 旋转失败：${JSON.stringify(rotationResult)}`);
        }

        await runTrustedSnapContract({ evaluate, trustedMouseGesture });
        await runTrustedMarqueeContract({ evaluate, trustedMouseGesture });
        await runTrustedKeyboardContract({ evaluate, dispatchKey });
        await runTrustedHistoryContract({ evaluate, dispatchKey });
        await runTrustedDeleteContract({ evaluate, dispatchKey });
        await runTrustedLayerContract({ evaluate, dispatchKey });
        await runTrustedGroupContract({ evaluate, dispatchKey });
        await runTrustedTabContract({ evaluate, dispatchKey });
        await runTrustedModifierSelectionContract({ evaluate, trustedClick });
        await runTrustedClipboardContract({ evaluate, dispatchKey });
        await runTrustedRichTextClipboardContract({ evaluate, dispatchKey });
        const trustedTextP95 = await runTrustedTextContract({ evaluate, request });
        await runTrustedEngineTextContract({ evaluate, request });
        await runTrustedTableCellTextContract({ evaluate, request });
        // IME 中投递页面键会让 Chromium 延迟 Process key；放在其他文字契约后隔离输入队列。
        await runTrustedShortcutAuditContract({ evaluate, dispatchKey, request });
        await evaluate(`(() => {
          const report = document.querySelector('#report');
          report.dataset.trustedDrag = 'pass';
          report.dataset.trustedResize = 'pass';
          report.dataset.trustedRotation = 'pass';
          report.dataset.trustedSnap = 'pass';
          report.dataset.trustedMarquee = 'pass';
          report.dataset.trustedKeyboard = 'pass';
          report.dataset.trustedHistory = 'pass';
          report.dataset.trustedDelete = 'pass';
          report.dataset.trustedLayer = 'pass';
          report.dataset.trustedGroup = 'pass';
          report.dataset.trustedTab = 'pass';
          report.dataset.trustedModifierSelection = 'pass';
          report.dataset.trustedClipboard = 'pass';
          report.dataset.trustedRichTextClipboard = 'pass';
          report.dataset.trustedShortcutAudit = 'pass';
          report.dataset.trustedText = 'pass';
          report.dataset.trustedEngineText = 'pass';
          report.dataset.trustedTableCellText = 'pass';
          report.dataset.trustedTextP95 = '${trustedTextP95}';
          report.textContent += '\\n真实 pointer capture 拖动/缩放/旋转/吸附/框选与真实键盘微移通过';
        })()`);
        return {
          ...result, trustedDrag: 'pass', trustedResize: 'pass', trustedRotation: 'pass', trustedSnap: 'pass',
          trustedMarquee: 'pass', trustedKeyboard: 'pass', trustedTab: 'pass',
          trustedModifierSelection: 'pass', trustedHistory: 'pass', trustedDelete: 'pass',
          trustedLayer: 'pass',
          trustedGroup: 'pass',
          trustedClipboard: 'pass',
          trustedRichTextClipboard: 'pass',
          trustedShortcutAudit: 'pass',
          trustedText: 'pass',
          trustedEngineText: 'pass',
          trustedTableCellText: 'pass',
          trustedTextP95,
        };
      }
      await delay(100);
    }
    throw new Error('真实浏览器编辑契约执行超时');
  } finally {
    if (socket.readyState !== WebSocket.CLOSED) {
      const closed = new Promise((resolveClose) => socket.once('close', resolveClose));
      // DevTools 会在 Chrome 退出时留下半关闭连接；测试进程必须先销毁它再回收浏览器。
      socket.terminate();
      await closed;
    }
  }
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

try {
  profile = mkdtempSync(join(tmpdir(), 'web-ppt-editor-browser-'));
  address = await new Promise((resolveAddress, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveAddress(server.address()));
  });
  const url = `http://127.0.0.1:${address.port}/tooling/editor-browser.html`;
  const port = await launch(url);
  const target = await pageTarget(port, url);
  const result = await browserResult(target.webSocketDebuggerUrl);
  if (result.status !== 'pass') throw new Error(`真实浏览器编辑契约未通过：${result.text}`);
  console.log(`  Chrome · 点选反馈 p95 ${result.hitP95}ms · 60 元素提交 p95 ${result.p95}ms`
    + ` · 完整选择框 p95 ${result.selectionP95}ms · OBB/手柄最大偏差`
    + ` ${result.spaceError}/${result.handleError}px`
    + ` · 嵌套拖动偏差 ${result.nestedDragError}px`
    + ` · 拖动帧 p95 ${result.dragP95}ms`
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
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  if (browserRunning()) throw new Error(`无法停止 Chrome；为避免破坏仍在使用的目录，保留 ${profile}`);
  if (profile) rmSync(profile, { recursive: true, force: true });
}
