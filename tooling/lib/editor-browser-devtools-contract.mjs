import WebSocket from 'ws';
import { runTrustedKeyboardContract } from './editor-keyboard-trusted-contract.mjs';
import { runTrustedHistoryContract } from './editor-history-browser-contract.mjs';
import { runTrustedDeleteContract } from './editor-delete-browser-contract.mjs';
import { runTrustedLayerContract } from './editor-layer-browser-contract.mjs';
import { runTrustedGroupContract } from './editor-group-browser-contract.mjs';
import { runTrustedModifierSelectionContract } from './editor-multiselect-browser-contract.mjs';
import { runTrustedTabContract } from './editor-tab-browser-contract.mjs';
import { runTrustedMarqueeContract } from './editor-marquee-trusted-contract.mjs';
import { runTrustedSnapContract } from './editor-snap-trusted-contract.mjs';
import { runTrustedClipboardContract } from './editor-clipboard-trusted-contract.mjs';
import { runTrustedTextContract } from './editor-text-trusted-contract.mjs';
import { runTrustedEngineTextContract } from './editor-engine-text-trusted-contract.mjs';
import { runTrustedRichTextClipboardContract } from './editor-rich-text-clipboard-trusted-contract.mjs';
import { runTrustedTableCellTextContract } from './editor-table-cell-text-trusted-contract.mjs';
import { runTrustedShortcutAuditContract } from './editor-shortcut-audit-trusted-contract.mjs';
import { readPerformanceFailures } from './browser-performance-contract.mjs';

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

export async function browserResult(webSocketDebuggerUrl) {
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
    for (let attempt = 0; attempt < 600; attempt++) {
      const result = await evaluate(`(() => {
        const report = document.querySelector('#report');
        return report ? { status: report.dataset.status ?? 'running', p95: report.dataset.p95,
          hitP95: report.dataset.hitP95, selectionP95: report.dataset.selectionP95,
          spaceError: report.dataset.spaceError, handleError: report.dataset.handleError,
          nestedDragError: report.dataset.nestedDragError,
          dragP95: report.dataset.dragP95, resizeError: report.dataset.resizeError,
          vertexP95: report.dataset.vertexP95, vertexError: report.dataset.vertexError,
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
          tableStructureP95: report.dataset.tableStructureP95,
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
          failureKind: report.dataset.failureKind,
          performanceFailures: report.dataset.performanceFailures,
          performanceEnvironment: report.dataset.performanceEnvironment,
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
          functionalStatus: 'pass',
          performanceFailures: [
            ...JSON.parse(result.performanceFailures ?? '[]'),
            ...readPerformanceFailures(),
          ],
          environment: JSON.parse(result.performanceEnvironment),
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
