/** 只从发布入口与 DOM 观察编辑器，避免框架适配层依赖内部装配细节。 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomEnv } from './lib/dom-env.mjs';
import { runEditorSpaceContract } from './lib/editor-space-contract.mjs';
import { runElementAlignEditorContract } from './lib/element-align-editor-contract.mjs';
import { runHistoryShortcutContract } from './lib/history-shortcut-contract.mjs';
import { runDeleteKeyboardContract } from './lib/delete-keyboard-contract.mjs';
import { runKeyboardNudgeContract } from './lib/keyboard-nudge-contract.mjs';
import { runLayerKeyboardContract } from './lib/layer-keyboard-contract.mjs';
import { runMarqueeGestureContract } from './lib/marquee-gesture-contract.mjs';
import { runModifierSelectionContract } from './lib/modifier-selection-contract.mjs';
import { runMoveGestureContract } from './lib/move-gesture-contract.mjs';
import { runNativeHitContract } from './lib/native-hit-contract.mjs';
import { runResizeGestureContract } from './lib/resize-gesture-contract.mjs';
import { runRotationGestureContract } from './lib/rotation-gesture-contract.mjs';
import { runSnapGestureContract } from './lib/snap-gesture-contract.mjs';
import { runTabSelectionContract } from './lib/tab-selection-contract.mjs';
import { runTextEditorContract } from './lib/text-editor-contract.mjs';
import { runRunFormatEditorContract } from './lib/run-format-editor-contract.mjs';
import { runParagraphFormatEditorContract } from './lib/paragraph-format-editor-contract.mjs';
import { runRichTextClipboardEditorContract } from './lib/rich-text-clipboard-editor-contract.mjs';
import { runEngineTextEditorContract } from './lib/engine-text-editor-contract.mjs';
import { runTableCellTextEditorContract } from './lib/table-cell-text-editor-contract.mjs';
import { runAutofitTextEditorContract } from './lib/autofit-text-editor-contract.mjs';
import { runShapeAutofitEditorContract } from './lib/shape-autofit-editor-contract.mjs';
import { runBodyPropsEditorContract } from './lib/body-props-editor-contract.mjs';
import { runAddShapeEditorContract } from './lib/add-shape-editor-contract.mjs';
import { runAddSlideEditorContract } from './lib/add-slide-editor-contract.mjs';
import { runMoveSlideEditorContract } from './lib/move-slide-editor-contract.mjs';
import { runRemoveSlideEditorContract } from './lib/remove-slide-editor-contract.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/editor');
mkdirSync(out, { recursive: true });
const domEnvironment = installDomEnv();

const bundle = join(out, 'editor.mjs');
execFileSync('npx', [
  'esbuild', join(root, 'packages/editor/src/index.ts'), '--bundle', '--format=esm',
  '--platform=browser', '--log-level=error',
  `--alias:@web-ppt/core/geometry=${join(root, 'packages/core/src/geometry/index.ts')}`,
  `--alias:@web-ppt/core=${join(root, 'packages/core/src/index.ts')}`,
  `--alias:@web-ppt/edit-core=${join(root, 'packages/edit-core/src/index.ts')}`,
  `--alias:@web-ppt/viewer-core=${join(root, 'packages/viewer-core/src/index.ts')}`,
  `--outfile=${bundle}`,
], { cwd: root, stdio: 'inherit' });
const coreBundle = join(out, 'core.mjs');
execFileSync('npx', [
  'esbuild', join(root, 'packages/core/src/index.ts'), '--bundle', '--format=esm',
  '--platform=browser', '--log-level=error', `--outfile=${coreBundle}`,
], { cwd: root, stdio: 'inherit' });
const lib = await import(`file://${bundle}?run=${Date.now()}`);
const core = await import(`file://${coreBundle}?run=${Date.now()}`);

let passed = 0;
const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) passed++;
  else failures.push(`${name}${detail ? `：${detail}` : ''}`);
  return condition;
};
const elementIds = (doc, slideId) => {
  const ids = [];
  const walk = (children) => {
    for (const id of children) {
      ids.push(id);
      if (doc.elements[id].children) walk(doc.elements[id].children);
    }
  };
  walk(doc.slides[slideId].children);
  return ids;
};

console.log('\n\x1b[36m▸ 编辑会话资源所有权\x1b[0m');
{
  check('发布入口只暴露工厂，不泄漏依赖内部注册状态的构造器',
    lib.EditorSession === undefined && lib.SlideEditor === undefined);
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-xfrm.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-session-' });
  const pkg = session.editor.doc.package;
  check('openEditor 一步建立可写 headless Editor', session.editor.doc.meta.readonly === false
    && session.editor.doc.slideOrder.length === 1 && !!pkg && !pkg.disposed);
  session.dispose();
  session.dispose();
  check('会话释放幂等并释放原包', session.disposed === true && pkg.disposed === true);
}

console.log('\n\x1b[36m▸ 三层静态视图生命周期\x1b[0m');
{
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-basic.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-view-' });
  const container = document.createElement('div');
  let invalidMountRejected = false;
  try { session.mount(container, { zoom: 0 }); } catch { invalidMountRejected = true; }
  let invalidMarginsRejected = false;
  try {
    session.mount(container, { snapMargins: { left: -1, right: 0, top: 0, bottom: 0 } });
  } catch { invalidMarginsRejected = true; }
  check('挂载校验失败不会遗留 DOM 或污染会话内视图集合',
    invalidMountRejected && invalidMarginsRejected
    && container.childElementCount === 0 && !session.disposed);
  const view = session.mount(container, { mode: 'view', zoom: 1.25 });
  const rootElement = container.querySelector('[data-web-ppt-editor]');
  const stage = container.querySelector('[data-ppt-stage]');
  const staticLayer = container.querySelector('[data-ppt-layer="static"]');
  const interactionLayer = container.querySelector('[data-ppt-layer="interaction"]');
  const textLayer = container.querySelector('[data-ppt-layer="text"]');
  const beforeModeChange = staticLayer?.innerHTML;
  check('mount 建立可缩放的静态、交互、文本三层并渲染首屏', !!rootElement && !!stage
    && !!staticLayer?.querySelector('svg') && !!interactionLayer && !!textLayer
    && stage.style.transform === 'scale(1.25)'
    && rootElement.getAttribute('data-mode') === 'view'
    && interactionLayer.style.display === 'none' && textLayer.style.display === 'none'
    && interactionLayer.style.pointerEvents === 'none' && textLayer.style.pointerEvents === 'none');
  view.setMode('edit');
  check('查看与编辑模式复用同一静态预览 DOM', rootElement.getAttribute('data-mode') === 'edit'
    && staticLayer.innerHTML === beforeModeChange && !interactionLayer.hasAttribute('hidden')
    && interactionLayer.style.display === '' && textLayer.style.display === '');
  const stableIds = elementIds(session.editor.doc, view.slideId);
  const renderedNodes = [...staticLayer.querySelectorAll('[data-edit-id]')];
  check('顶层与嵌套组节点都映射到稳定 EditDoc 身份', renderedNodes.length === stableIds.length
    && renderedNodes.every((node, index) => node.getAttribute('data-edit-id') === stableIds[index]
      && Number(node.getAttribute('data-el')) === session.editor.doc.elements[stableIds[index]].src.id));
  const nestedId = stableIds.find((id) => session.editor.doc.elements[session.editor.doc.elements[id].parent]);
  const nestedRecord = session.editor.doc.elements[nestedId];
  let groupId = nestedRecord.parent;
  while (session.editor.doc.elements[session.editor.doc.elements[groupId]?.parent]) {
    groupId = session.editor.doc.elements[groupId].parent;
  }
  const nestedBefore = staticLayer.querySelector(`[data-edit-id="${nestedId}"]`);
  const groupBefore = staticLayer.querySelector(`[data-edit-id="${groupId}"]`);
  const outsideGroupId = session.editor.doc.slides[view.slideId].children.find((id) => id !== groupId);
  const outsideGroupBefore = staticLayer.querySelector(`[data-edit-id="${outsideGroupId}"]`);
  const nestedSvgBefore = staticLayer.querySelector('svg');
  session.editor.exec({ type: 'SetXfrm', id: nestedId, x: nestedRecord.src.x + 3 });
  check('嵌套组内单元素提交只替换自身，保留组容器、外部兄弟与整页 DOM',
    staticLayer.querySelector(`[data-edit-id="${nestedId}"]`) !== nestedBefore
    && staticLayer.querySelector(`[data-edit-id="${groupId}"]`) === groupBefore
    && staticLayer.querySelector(`[data-edit-id="${outsideGroupId}"]`) === outsideGroupBefore
    && staticLayer.querySelector('svg') === nestedSvgBefore,
  `nested=${nestedId} group=${groupId} replaced=${staticLayer.querySelector(`[data-edit-id="${nestedId}"]`) !== nestedBefore}`
    + ` groupStable=${staticLayer.querySelector(`[data-edit-id="${groupId}"]`) === groupBefore}`
    + ` siblingStable=${staticLayer.querySelector(`[data-edit-id="${outsideGroupId}"]`) === outsideGroupBefore}`
    + ` pageStable=${staticLayer.querySelector('svg') === nestedSvgBefore}`);
  const [targetId, siblingId] = session.editor.doc.slides[view.slideId].children;
  const targetBefore = staticLayer.querySelector(`[data-edit-id="${targetId}"]`);
  const siblingBefore = staticLayer.querySelector(`[data-edit-id="${siblingId}"]`);
  const svgBefore = staticLayer.querySelector('svg');
  session.editor.exec({
    type: 'SetXfrm', id: targetId, x: session.editor.doc.elements[targetId].src.x + 17,
  });
  const targetAfter = staticLayer.querySelector(`[data-edit-id="${targetId}"]`);
  check('单元素事务只替换目标 markup/defs 分区', targetAfter !== targetBefore
    && staticLayer.querySelector(`[data-edit-id="${siblingId}"]`) === siblingBefore
    && staticLayer.querySelector('svg') === svgBefore);
  const beforePageFallback = staticLayer.querySelector('svg');
  session.editor.transaction((transaction) => {
    for (const id of [targetId, siblingId]) {
      transaction.exec({ type: 'SetXfrm', id, x: session.editor.effectiveElement(id).x + 1 });
    }
  }, '小页面少量提交');
  check('小页面少量脏元素不因比例失真而重建整页 SVG',
    staticLayer.querySelector('svg') === beforePageFallback
    && staticLayer.querySelectorAll('[data-edit-id]').length === stableIds.length);
  const firstSvg = staticLayer.querySelector('svg');
  session.editor.select({ kind: 'elements', ids: [targetId], enteredGroup: null });
  const selectedFrame = interactionLayer.querySelector('[data-edit-selection-frame]');
  const secondSlide = session.editor.doc.slideOrder[1];
  view.setSlide(secondSlide);
  check('切页只替换静态内容并保留三层视图实例', view.slideId === secondSlide
    && staticLayer.querySelector('svg') !== firstSvg
    && container.querySelector('[data-ppt-stage]') === stage
    && !interactionLayer.querySelector('[data-edit-selection-frame]'));
  view.setSlide(session.editor.doc.slideOrder[0]);
  check('切回选中元素所在页会以当前视图自己的 DOM 恢复选择框',
    interactionLayer.querySelector('[data-edit-selection-frame]') !== selectedFrame
    && interactionLayer.querySelector('[data-edit-selection-id]')?.getAttribute('data-edit-selection-id') === targetId);
  view.destroy();
  check('销毁视图只移除自己的 DOM，不释放共享会话', container.childElementCount === 0
    && session.disposed === false && session.editor.doc.package?.disposed === false
    && domEnvironment.blobs.size > 0);
  session.dispose();
  check('销毁会话释放视图仍在使用的图片 blob URL', domEnvironment.blobs.size === 0);
}

console.log('\n\x1b[36m▸ 多视图共享会话\x1b[0m');
{
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-xfrm.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-shared-' });
  const pkg = session.editor.doc.package;
  const firstContainer = document.createElement('div');
  const secondContainer = document.createElement('div');
  const first = session.mount(firstContainer, { mode: 'view' });
  const second = session.mount(secondContainer, { mode: 'edit' });
  session.dispose();
  check('销毁共享会话会退订并移除全部视图', first.destroyed && second.destroyed
    && firstContainer.childElementCount === 0 && secondContainer.childElementCount === 0
    && pkg.disposed === true);
}

await runNativeHitContract({ check, lib, root });
await runModifierSelectionContract({ check, lib, root });
await runMarqueeGestureContract({ check, lib, root });
await runHistoryShortcutContract({ check, lib, root });
await runDeleteKeyboardContract({ check, lib, root });
await runLayerKeyboardContract({ check, lib, root });
await runKeyboardNudgeContract({ check, lib, root });
await runTabSelectionContract({ check, lib, root });
await runTextEditorContract({ check, lib, root, window: domEnvironment.window });
await runRunFormatEditorContract({ check, lib, root, window: domEnvironment.window });
await runParagraphFormatEditorContract({ check, lib, root, window: domEnvironment.window });
await runRichTextClipboardEditorContract({ check, lib, root, window: domEnvironment.window });
await runEngineTextEditorContract({ check, lib, root, window: domEnvironment.window });
await runTableCellTextEditorContract({ check, lib, root, window: domEnvironment.window });
await runAutofitTextEditorContract({ check, core, lib, root, window: domEnvironment.window });
await runShapeAutofitEditorContract({ check, edit: lib, lib, root, window: domEnvironment.window });
await runBodyPropsEditorContract({ check, lib, root, window: domEnvironment.window });
await runAddShapeEditorContract({ check, lib, root, window: domEnvironment.window });
await runAddSlideEditorContract({ check, lib, root, window: domEnvironment.window });
await runMoveSlideEditorContract({ check, lib, root });
await runRemoveSlideEditorContract({ check, lib, root, window: domEnvironment.window });
await runEditorSpaceContract({ check, lib, root });
await runElementAlignEditorContract({ check, lib, root });
await runMoveGestureContract({ check, lib, root });
await runResizeGestureContract({ check, lib, root });
await runRotationGestureContract({ check, lib, root });
await runSnapGestureContract({ check, lib, root });

console.log('\n\x1b[36m▸ Safari 安全文本路径\x1b[0m');
{
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-basic.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-text-mode-' });
  const container = document.createElement('div');
  const view = session.mount(container, { textMode: 'svg' });
  const targetId = session.editor.doc.slides[view.slideId].children[0];
  const staticLayer = container.querySelector('[data-ppt-layer="static"]');
  const portableBefore = !staticLayer.querySelector('foreignObject') && !!staticLayer.querySelector('text');
  session.editor.exec({
    type: 'SetXfrm', id: targetId, x: session.editor.doc.elements[targetId].src.x + 1,
  });
  check('显式原生文本模式在整页与增量更新中都不产生 foreignObject', portableBefore
    && !staticLayer.querySelector('foreignObject') && !!staticLayer.querySelector('text'));
  session.dispose();
}

console.log('\n\x1b[36m▸ SVG 定义分区原子替换\x1b[0m');
{
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-effects.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-defs-' });
  const container = document.createElement('div');
  const view = session.mount(container, { slideId: session.editor.doc.slideOrder[1] });
  const roots = session.editor.doc.slides[view.slideId].children;
  const targetId = roots.find((id) => !!session.editor.doc.elements[id].src.effects?.reflection);
  const siblingId = roots.find((id) => id !== targetId);
  const staticLayer = container.querySelector('[data-ppt-layer="static"]');
  const sibling = staticLayer.querySelector(`[data-edit-id="${siblingId}"]`);
  const target = staticLayer.querySelector(`[data-edit-id="${targetId}"]`);
  const defs = staticLayer.querySelector('defs');
  const maskId = target.querySelector('[mask]')?.getAttribute('mask')?.match(/^url\(#(.+)\)$/)?.[1];
  const originalMask = [...defs.querySelectorAll('[id]')].find((node) => node.id === maskId);
  const gradientId = originalMask?.querySelector('[fill^="url(#"]')?.getAttribute('fill')
    ?.match(/^url\(#(.+)\)$/)?.[1];
  const originalGradient = [...defs.querySelectorAll('[id]')].find((node) => node.id === gradientId);
  const originalDefCount = defs.children.length;
  const move = (delta) => session.editor.exec({
    type: 'SetXfrm', id: targetId,
    x: session.editor.doc.elements[targetId].src.x + delta,
  });
  move(1);
  const firstDefs = [...staticLayer.querySelectorAll(`[data-edit-defs="${targetId}"]`)];
  const firstDefCount = defs.children.length;
  move(2);
  const secondDefs = [...staticLayer.querySelectorAll(`[data-edit-defs="${targetId}"]`)];
  check('倒影元素从首次更新起递归换代 mask/gradient defs 而不累积或重建兄弟', firstDefs.length > 0
    && !!originalMask && !originalMask.isConnected && !!originalGradient && !originalGradient.isConnected
    && firstDefCount === originalDefCount && defs.children.length === originalDefCount
    && secondDefs.length === firstDefs.length && secondDefs[0] !== firstDefs[0]
    && staticLayer.querySelector(`[data-edit-id="${siblingId}"]`) === sibling);
  session.dispose();
}

console.log('\n\x1b[36m▸ 单元素 DOM 提交性能\x1b[0m');
{
  const bytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-60.pptx')));
  const session = await lib.openEditor(bytes, { idPrefix: 'editor-perf-' });
  const container = document.createElement('div');
  const view = session.mount(container);
  const roots = session.editor.doc.slides[view.slideId].children;
  const [targetId, siblingId] = roots;
  const staticLayer = container.querySelector('[data-ppt-layer="static"]');
  const sibling = staticLayer.querySelector(`[data-edit-id="${siblingId}"]`);
  const sourceX = session.editor.doc.elements[targetId].src.x;
  const samples = [];
  for (let index = 0; index < 80; index++) {
    const started = performance.now();
    session.editor.exec({ type: 'SetXfrm', id: targetId, x: sourceX + index % 2 + 1 });
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  check('60 元素页单元素提交到 DOM 的 p95 不超过 16ms', roots.length === 60 && p95 <= 16
    && staticLayer.querySelector(`[data-edit-id="${siblingId}"]`) === sibling,
  `p95=${p95.toFixed(3)}ms`);
  console.log(`  60 元素 · 单元素提交 p95 ${p95.toFixed(3)}ms`);

  const hitTargets = [targetId, siblingId]
    .map((id) => staticLayer.querySelector(`[data-edit-id="${id}"]`));
  const hitSvgBefore = staticLayer.querySelector('svg');
  const hitSamples = [];
  for (let index = 0; index < 80; index++) {
    const started = performance.now();
    const target = hitTargets[index % 2];
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    target.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, composed: true }));
    hitSamples.push(performance.now() - started);
  }
  hitSamples.sort((left, right) => left - right);
  const hitP95 = hitSamples[Math.floor(hitSamples.length * 0.95)];
  check('点选事件到完整选择框与 9 个手柄上屏的 p95 不超过 8ms', hitP95 <= 8
    && staticLayer.querySelector('svg') === hitSvgBefore
    && !!container.querySelector(`[data-edit-selection-id="${siblingId}"]`)
    && container.querySelectorAll('[data-edit-handle]').length === 9
    && !!container.querySelector('[data-edit-selection-frame]'),
  `p95=${hitP95.toFixed(3)}ms`);
  console.log(`  60 元素 · 完整选择框反馈 p95 ${hitP95.toFixed(3)}ms`);

  const beforeBatch = staticLayer.querySelector('svg');
  session.editor.transaction((transaction) => {
    for (const id of roots.slice(0, 20)) {
      transaction.exec({ type: 'SetXfrm', id, x: session.editor.effectiveElement(id).x + 1 });
    }
  }, '真实批量提交');
  check('绝对数量和占比都超过阈值时只做一次整页重绘',
    staticLayer.querySelector('svg') !== beforeBatch
      && staticLayer.querySelectorAll('[data-edit-id]').length === roots.length);
  session.dispose();
}

console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.error(`\x1b[31m✗ ${failures.length} 项 editor 验收失败\x1b[0m`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\x1b[32m✓ 全部 ${passed} 项 editor 断言通过\x1b[0m`);
}
