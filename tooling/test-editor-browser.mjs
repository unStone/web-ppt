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
import { runTrustedModifierSelectionContract } from './lib/editor-multiselect-browser-contract.mjs';
import { runTrustedTabContract } from './lib/editor-tab-browser-contract.mjs';
import { runTrustedMarqueeContract } from './lib/editor-marquee-trusted-contract.mjs';
import { runTrustedSnapContract } from './lib/editor-snap-trusted-contract.mjs';

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
    }, 5000);
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
  const dispatchKey = async (key, code, virtualKeyCode, modifiers = 0) => {
    const params = {
      key, code, modifiers,
      windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode,
    };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  };
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
          tabP95: report.dataset.tabP95,
          multiselectClickP95: report.dataset.multiselectClickP95,
          multiselectMarqueeP95: report.dataset.multiselectMarqueeP95,
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
        await runTrustedTabContract({ evaluate, dispatchKey });
        await runTrustedModifierSelectionContract({ evaluate, trustedClick });
        await evaluate(`(() => {
          const report = document.querySelector('#report');
          report.dataset.trustedDrag = 'pass';
          report.dataset.trustedResize = 'pass';
          report.dataset.trustedRotation = 'pass';
          report.dataset.trustedSnap = 'pass';
          report.dataset.trustedMarquee = 'pass';
          report.dataset.trustedKeyboard = 'pass';
          report.dataset.trustedHistory = 'pass';
          report.dataset.trustedTab = 'pass';
          report.dataset.trustedModifierSelection = 'pass';
          report.textContent += '\\n真实 pointer capture 拖动/缩放/旋转/吸附/框选与真实键盘微移通过';
        })()`);
        return {
          ...result, trustedDrag: 'pass', trustedResize: 'pass', trustedRotation: 'pass', trustedSnap: 'pass',
          trustedMarquee: 'pass', trustedKeyboard: 'pass', trustedTab: 'pass',
          trustedModifierSelection: 'pass', trustedHistory: 'pass',
        };
      }
      await delay(100);
    }
    throw new Error('真实浏览器编辑契约执行超时');
  } finally {
    socket.close();
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
    + ` · Tab60 p95 ${result.tabP95}ms`
    + ` · 修饰点选/框选60 p95 ${result.multiselectClickP95}/${result.multiselectMarqueeP95}ms`
    + ` · pointer capture ${result.trustedDrag}/${result.trustedResize}/${result.trustedRotation}/`
    + `${result.trustedSnap}/${result.trustedMarquee}`
    + ` · trusted keyboard/tab/history ${result.trustedKeyboard}/${result.trustedTab}/${result.trustedHistory}`
    + ` · trusted multiselect ${result.trustedModifierSelection}`
    + ` · ${result.fontFaces} 个嵌入 @font-face`);
} finally {
  if (browserRunning()) {
    child.kill('SIGTERM');
    if (!await waitForBrowserExit(2000) && browserRunning()) {
      child.kill('SIGKILL');
      await waitForBrowserExit(2000);
    }
  }
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  if (browserRunning()) throw new Error(`无法停止 Chrome；为避免破坏仍在使用的目录，保留 ${profile}`);
  if (profile) rmSync(profile, { recursive: true, force: true });
}
