/** @web-ppt/collab 的双副本收敛、离线回放、保存与 BroadcastChannel 契约。 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { runCollabSlideIdentityContract } from './lib/collab-slide-identity-contract.mjs';
import { runCollabHardeningContract } from './lib/collab-hardening-contract.mjs';
import { runCollabAtomicContract } from './lib/collab-atomic-contract.mjs';
import { runCollabProtocolContract } from './lib/collab-protocol-contract.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/collab');
mkdirSync(out, { recursive: true });

const bundle = (entry, name, aliases = [], externals = []) => {
  const file = join(out, `${name}.mjs`);
  execFileSync('npx', [
    'esbuild', entry, '--bundle', '--format=esm', '--platform=browser', '--log-level=error',
    ...aliases.map(([from, to]) => `--alias:${from}=${to}`),
    ...externals.map((name) => `--external:${name}`), `--outfile=${file}`,
  ], { cwd: root, stdio: 'inherit' });
  return file;
};

const runtimeFile = bundle(join(root, 'tooling/lib/collab-test-runtime.ts'), 'runtime', [
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
]);
const collabEntry = join(root, 'packages/collab/src/index.ts');
const thinFile = bundle(collabEntry, 'collab-thin', [], ['@web-ppt/edit-core']);
const { core, edit, collab } = await import(`${pathToFileURL(runtimeFile)}?t=${Date.now()}`);

let passed = 0;
const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) passed++;
  else failures.push(`${name}${detail ? `：${detail}` : ''}`);
};

class OfflineHub {
  listeners = new Map();
  queue = [];

  endpoint(id) {
    return {
      send: (message) => {
        for (const peer of this.listeners.keys()) {
          if (peer !== id) this.queue.push({ from: id, to: peer, message: structuredClone(message) });
        }
      },
      subscribe: (listener) => {
        this.listeners.set(id, listener);
        return () => { this.listeners.delete(id); };
      },
    };
  }

  flush(order = (items) => items) {
    const pending = order(this.queue.splice(0));
    for (const item of pending) this.listeners.get(item.to)?.(structuredClone(item.message));
  }

  replay(items) {
    for (const item of items) this.listeners.get(item.to)?.(structuredClone(item.message));
  }
}

const load = (name) => {
  const file = join(root, 'fixtures', name);
  if (!existsSync(file)) throw new Error(`缺少固件：${name}`);
  return new Uint8Array(readFileSync(file));
};

const createPair = async (name, prefix) => {
  const bytes = load(name);
  const [leftPresentation, rightPresentation] = await Promise.all([
    core.parse(bytes, { edit: true, keepPackage: true, lazy: false }),
    core.parse(bytes, { edit: true, keepPackage: true, lazy: false }),
  ]);
  const left = edit.createDoc(leftPresentation, { idPrefix: prefix });
  const right = edit.createDoc(rightPresentation, { idPrefix: prefix });
  return {
    left, right,
    leftEditor: new edit.Editor(left, { origin: 'left-local' }),
    rightEditor: new edit.Editor(right, { origin: 'right-local' }),
  };
};

const canonical = (value) => {
  if (typeof value === 'string' && value.startsWith('blob:')) return '<session-asset>';
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Uint8Array) return [...value];
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};

const semanticDoc = (doc) => JSON.stringify(canonical({
  meta: doc.meta,
  slideOrder: doc.slideOrder,
  slides: doc.slides,
  elements: doc.elements,
  removedElements: doc.removedElements,
  imageResources: doc.imageResources,
}));

const stringDiff = (left, right) => {
  let index = 0;
  while (index < left.length && left[index] === right[index]) index++;
  return `@${index} 左=${left.slice(index, index + 120)} 右=${right.slice(index, index + 120)}`;
};

const seededShuffle = (items, seed) => {
  for (let index = items.length - 1; index > 0; index--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const target = seed % (index + 1);
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
};

const bindPair = (pair, hub, errors = []) => [
  collab.bindCollaboration(pair.leftEditor, {
    documentId: 'deck', replicaId: 'a', replicaSlot: 1, provider: hub.endpoint('a'),
    onError: (error) => errors.push(error),
  }),
  collab.bindCollaboration(pair.rightEditor, {
    documentId: 'deck', replicaId: 'b', replicaSlot: 2, provider: hub.endpoint('b'),
    onError: (error) => errors.push(error),
  }),
];

const editableShapes = (doc) => Object.values(doc.elements)
  .filter((record) => record.src.kind === 'shape' && record.meta.editable === 'full');

const flatText = (record) => record.ovr.text?.kind === 'flat'
  ? record.ovr.text.paragraphs.map((paragraph) => paragraph.text).join('\n') : '';

console.log('\n\x1b[36m▸ 字段级 LWW 与顺序收敛\x1b[0m');
{
  const pair = await createPair('showcase.pptx', 'collab-base-');
  const hub = new OfflineHub();
  const errors = [];
  const bindings = bindPair(pair, hub, errors);
  const shapes = editableShapes(pair.left);
  const textShape = shapes.find((record) => record.src.text);
  const layerShape = shapes.find((record) => record.id !== textShape?.id
    && pair.left.elements[record.id].parent === pair.left.elements[textShape.id].parent);
  const movedSlide = pair.left.slideOrder.at(-1);
  const firstSlide = pair.left.slideOrder[0];

  pair.leftEditor.exec({ type: 'SetXfrm', id: textShape.id, x: textShape.src.x + 17 });
  pair.rightEditor.exec({
    type: 'EditText', id: textShape.id,
    ops: [{ type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: '协同' }],
  });
  pair.leftEditor.exec({ type: 'SetZ', id: layerShape.id, to: 'front' });
  pair.rightEditor.exec({ type: 'MoveSlide', id: movedSlide, at: { after: null } });
  pair.leftEditor.exec({ type: 'MoveSlide', id: firstSlide, at: { after: movedSlide } });

  hub.flush((items) => seededShuffle(items, 0x072c011a));
  check('固定种子乱序投递后两份 EditDoc 语义相同', semanticDoc(pair.left) === semanticDoc(pair.right),
    stringDiff(semanticDoc(pair.left), semanticDoc(pair.right)));
  check('并发变换与文字修改都保留', pair.left.elements[textShape.id].ovr.x === textShape.src.x + 17
    && pair.right.elements[textShape.id].ovr.x === textShape.src.x + 17
    && pair.left.elements[textShape.id].ovr.text?.kind === 'flat'
    && pair.right.elements[textShape.id].ovr.text?.kind === 'flat', JSON.stringify({
      left: pair.left.elements[textShape.id].ovr,
      right: pair.right.elements[textShape.id].ovr,
    }).slice(0, 500));
  check('元素分数序与页面顺序都收敛', pair.left.elements[layerShape.id].order
    === pair.right.elements[layerShape.id].order
    && JSON.stringify(pair.left.slideOrder) === JSON.stringify(pair.right.slideOrder));

  let expectedX = 0;
  let propertySeed = 0x5eed072;
  for (let index = 0; index < 64; index++) {
    propertySeed = (Math.imul(propertySeed, 1103515245) + 12345) >>> 0;
    pair.leftEditor.exec({ type: 'SetXfrm', id: textShape.id, x: propertySeed % 900 });
    propertySeed = (Math.imul(propertySeed, 1103515245) + 12345) >>> 0;
    expectedX = propertySeed % 900;
    pair.rightEditor.exec({ type: 'SetXfrm', id: textShape.id, x: expectedX });
  }
  hub.flush((items) => seededShuffle(items, 0x072f1e1d));
  check('固定种子 128 次同字段并发满足 LWW 收敛性质',
    pair.left.elements[textShape.id].ovr.x === expectedX
    && pair.right.elements[textShape.id].ovr.x === expectedX);
  check('正常并发没有适配错误', errors.length === 0, errors.map(String).join(' / '));
  bindings.forEach((binding) => binding.dispose());
}

console.log('\n\x1b[36m▸ 文字、层级与页序固定种子并发性质\x1b[0m');
{
  const pair = await createPair('showcase.pptx', 'collab-fields-');
  const hub = new OfflineHub();
  const errors = [];
  const bindings = bindPair(pair, hub, errors);
  const textShape = editableShapes(pair.left).find((record) => record.src.text);
  const siblings = Object.values(pair.left.elements)
    .filter((record) => record.parent === textShape.parent && record.id !== textShape.id);
  const layerShape = siblings[Math.floor(siblings.length / 2)];
  const slides = pair.left.slideOrder;

  for (let index = 0; index < 24; index++) {
    pair.leftEditor.exec({
      type: 'EditText', id: textShape.id,
      ops: [{ type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: `甲${index}` }],
    });
    pair.rightEditor.exec({
      type: 'EditText', id: textShape.id,
      ops: [{ type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: `乙${index}` }],
    });
    pair.leftEditor.exec({ type: 'SetZ', id: layerShape.id, to: index % 2 ? 'front' : 'back' });
    pair.rightEditor.exec({ type: 'SetZ', id: layerShape.id, to: index % 2 ? 'back' : 'front' });
    pair.leftEditor.exec({
      type: 'MoveSlide', id: slides[index % slides.length],
      at: { after: slides[(index + 1) % slides.length] },
    });
    const rightSlide = slides[(index + 2) % slides.length];
    const rightAfter = index % 3 ? slides[0] : null;
    pair.rightEditor.exec({
      type: 'MoveSlide', id: rightSlide,
      at: { after: rightAfter === rightSlide ? null : rightAfter },
    });
  }
  hub.flush((items) => seededShuffle(items, 0x72f13e1d));
  check('固定种子文字对文字并发按整段 LWW 收敛', flatText(pair.left.elements[textShape.id])
    === flatText(pair.right.elements[textShape.id]));
  check('固定种子 z 序对 z 序并发收敛', pair.left.elements[layerShape.id].order
    === pair.right.elements[layerShape.id].order);
  check('固定种子页序对页序并发收敛', JSON.stringify(pair.left.slideOrder)
    === JSON.stringify(pair.right.slideOrder));
  check('三类同字段并发最终 EditDoc 收敛', semanticDoc(pair.left) === semanticDoc(pair.right),
    stringDiff(semanticDoc(pair.left), semanticDoc(pair.right)));
  check('属性并发没有适配错误', errors.length === 0, errors.map(String).join(' / '));
  bindings.forEach((binding) => binding.dispose());
}

console.log('\n\x1b[36m▸ 删除冲突、并发插入与身份水位\x1b[0m');
{
  const pair = await createPair('showcase.pptx', 'collab-legacy-');
  const hub = new OfflineHub();
  const errors = [];
  const bindings = bindPair(pair, hub, errors);
  const target = editableShapes(pair.left).find((record) => !record.meta.ph);
  const slideId = pair.left.slideOrder[0];
  const beforeLeft = pair.left.identity.nextElement;
  const beforeRight = pair.right.identity.nextElement;

  pair.leftEditor.exec({ type: 'RemoveElement', id: target.id });
  pair.rightEditor.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + 99 });
  pair.leftEditor.exec({
    type: 'AddShape', slideId, preset: 'rect', rect: { x: 20, y: 20, w: 120, h: 80 },
  });
  pair.rightEditor.exec({
    type: 'AddShape', slideId, preset: 'ellipse', rect: { x: 40, y: 40, w: 120, h: 80 },
  });
  const replay = structuredClone(hub.queue);
  hub.flush((items) => items.reverse());
  const first = semanticDoc(pair.left);
  hub.replay(replay);

  const created = Object.values(pair.left.elements).filter((record) => record.meta.created);
  check('并发删除与编辑采用 remove-wins', !pair.left.elements[target.id] && !pair.right.elements[target.id]);
  check('同页并发插入保留两个唯一元素和唯一分数序', created.length >= 2
    && new Set(created.map((record) => record.id)).size === created.length
    && new Set(created.map((record) => record.order ?? record.z)).size === created.length);
  check('离线消息重复回放幂等', semanticDoc(pair.left) === first
    && semanticDoc(pair.left) === semanticDoc(pair.right),
  stringDiff(semanticDoc(pair.left), semanticDoc(pair.right)));
  check('身份水位从不倒退', pair.left.identity.nextElement >= beforeLeft
    && pair.right.identity.nextElement >= beforeRight);
  check('结构冲突没有适配错误', errors.length === 0, errors.map(String).join(' / '));

  // 协同状态仍是普通 EditDoc；解除 binding 后走与单机完全相同的保存入口。
  bindings[0].dispose();
  const [leftBytes, rightBytes] = await Promise.all([pair.leftEditor.save(), pair.rightEditor.save()]);
  const [leftSaved, rightSaved] = await Promise.all([
    core.parse(leftBytes, { lazy: false }), core.parse(rightBytes, { lazy: false }),
  ]);
  const savedSemantics = (presentation) => JSON.stringify(canonical(presentation.slides));
  check('解除协同后的单机保存与另一副本回读语义相同', savedSemantics(leftSaved)
    === savedSemantics(rightSaved), stringDiff(savedSemantics(leftSaved), savedSemantics(rightSaved)));
  bindings.forEach((binding) => binding.dispose());
}

console.log('\n\x1b[36m▸ 因果乱序、重连续号与结构历史 rebase\x1b[0m');
{
  const pair = await createPair('showcase.pptx', 'collab-causal-');
  const hub = new OfflineHub();
  const bindings = bindPair(pair, hub);
  const slideId = pair.left.slideOrder[0];
  const inserted = pair.leftEditor.exec({
    type: 'AddShape', slideId, preset: 'rect', rect: { x: 10, y: 10, w: 80, h: 60 },
  }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements')?.path[1];
  pair.leftEditor.exec({ type: 'SetXfrm', id: inserted, x: 777 });
  hub.flush((items) => items.sort((left, right) => right.message.sequence - left.message.sequence));
  check('字段补丁先于元素插入到达时会在依赖出现后重放', pair.right.elements[inserted]?.ovr.x === 777);

  bindings[0].dispose();
  const rebound = collab.bindCollaboration(pair.leftEditor, {
    documentId: 'deck', replicaId: 'a', replicaSlot: 1, provider: hub.endpoint('a'),
  });
  pair.leftEditor.exec({ type: 'SetXfrm', id: inserted, x: 888 });
  hub.flush();
  check('同一 Editor 解绑重绑后继续 sequence 而不丢新消息', pair.right.elements[inserted]?.ovr.x === 888);
  rebound.dispose();
  bindings[1].dispose();
}

{
  const pair = await createPair('showcase.pptx', 'collab-history-');
  const hub = new OfflineHub();
  const bindings = bindPair(pair, hub);
  const target = editableShapes(pair.left).find((record) => !record.meta.ph);
  pair.leftEditor.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + 10 });
  hub.flush();
  pair.rightEditor.exec({ type: 'RemoveElement', id: target.id });
  hub.flush();
  let undo = 'threw';
  try { undo = pair.leftEditor.undo(); } catch { /* 失败值保留，断言报告根因。 */ }
  check('远端结构删除会裁掉本地后代字段历史', pair.leftEditor.history.undoCount === 0 && undo === null);
  bindings.forEach((binding) => binding.dispose());
}

console.log('\n\x1b[36m▸ 同步重入、失败绑定与恶意时钟隔离\x1b[0m');
{
  const pair = await createPair('showcase.pptx', 'collab-reentrant-');
  const target = editableShapes(pair.left)[0];
  let nested = false;
  const stopReentrant = pair.leftEditor.subscribePatches((event) => {
    if (nested || event.source !== 'transaction') return;
    nested = true;
    pair.leftEditor.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + 202 });
  });
  const hub = new OfflineHub();
  const bindings = bindPair(pair, hub);
  pair.leftEditor.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + 101 });
  hub.flush();
  check('同步重入事务仍按提交 FIFO 发号', pair.left.elements[target.id].ovr.x === target.src.x + 202
    && pair.right.elements[target.id].ovr.x === target.src.x + 202);
  stopReentrant();
  let viewNested = false;
  const stopViewReentrant = pair.leftEditor.subscribe((change) => {
    if (viewNested || change.source !== 'transaction') return;
    viewNested = true;
    pair.leftEditor.exec({ type: 'SetXfrm', id: target.id, y: target.src.y + 204 });
  });
  pair.leftEditor.exec({ type: 'SetXfrm', id: target.id, y: target.src.y + 102 });
  hub.flush();
  check('普通视图订阅者同步重入也不反转补丁因果序', pair.left.elements[target.id].ovr.y
    === target.src.y + 204 && pair.right.elements[target.id].ovr.y === target.src.y + 204);
  stopViewReentrant();
  bindings.forEach((binding) => binding.dispose());
}

{
  const pair = await createPair('showcase.pptx', 'collab-bind-failure-');
  const before = JSON.stringify(pair.left.identity);
  let rejected = false;
  try {
    collab.bindCollaboration(pair.leftEditor, {
      documentId: 'deck', replicaId: 'a', replicaSlot: 1,
      provider: { send() {}, subscribe() { return null; } },
    });
  } catch { rejected = true; }
  check('provider 绑定失败会回滚全部身份分区', rejected
    && JSON.stringify(pair.left.identity) === before);
  const hub = new OfflineHub();
  const binding = collab.bindCollaboration(pair.leftEditor, {
    documentId: 'deck', replicaId: 'a', replicaSlot: 1, provider: hub.endpoint('a'),
  });
  check('失败绑定后仍能用同一身份正常重试', pair.left.identity.prefix === 'collab-bind-failure-'
    && pair.left.identity.allocation?.replicaId === 'a');
  binding.dispose();
}

{
  const pair = await createPair('showcase.pptx', 'collab-clock-');
  const hub = new OfflineHub();
  const errors = [];
  const bindings = bindPair(pair, hub, errors);
  const target = editableShapes(pair.left)[0];
  pair.leftEditor.exec({ type: 'SetXfrm', id: target.id, x: target.src.x + 11 });
  const poisoned = structuredClone(hub.queue[0]);
  hub.queue.length = 0;
  poisoned.message.stamp.clock = Number.MAX_SAFE_INTEGER;
  poisoned.message.identity.allocation.clock = Number.MAX_SAFE_INTEGER;
  hub.replay([poisoned]);
  pair.rightEditor.exec({ type: 'SetXfrm', id: target.id, y: target.src.y + 12 });
  const outgoing = hub.queue.find((item) => item.from === 'b')?.message;
  check('超出协议上限的有效补丁不会毒化本地 Lamport 时钟', outgoing?.stamp.clock === 1);
  check('恶意高时钟通过 onError 隔离', errors.length === 1);
  bindings.forEach((binding) => binding.dispose());
}

console.log('\n\x1b[36m▸ 协同身份恢复与并发粘贴\x1b[0m');
{
  const bytes = load('showcase.pptx');
  const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(presentation, { idPrefix: 'collab-recovery-' });
  const editor = new edit.Editor(doc);
  const frames = [];
  const stopRecovery = editor.subscribeRecovery((frame) => frames.push(frame));
  const firstHub = new OfflineHub();
  firstHub.endpoint('observer').subscribe(() => {});
  const firstBinding = collab.bindCollaboration(editor, {
    documentId: 'recover', replicaId: 'a', replicaSlot: 7, provider: firstHub.endpoint('a'),
  });
  const slideId = doc.slideOrder[0];
  const first = editor.exec({
    type: 'AddShape', slideId, preset: 'rect', rect: { x: 10, y: 10, w: 50, h: 40 },
  }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements')?.path[1];
  const firstSpid = doc.elements[first].meta.origin.spid;
  const checkpoint = firstBinding.checkpoint();
  stopRecovery();
  firstBinding.dispose();

  const restoredPresentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const restoredDoc = edit.createDoc(restoredPresentation, { idPrefix: 'collab-recovery-' });
  const restoredEditor = new edit.Editor(restoredDoc, { recoveryFrames: frames });
  const secondHub = new OfflineHub();
  secondHub.endpoint('observer').subscribe(() => {});
  const secondBinding = collab.bindCollaboration(restoredEditor, {
    documentId: 'recover', replicaId: 'a', replicaSlot: 7,
    provider: secondHub.endpoint('restored'), checkpoint,
  });
  const second = restoredEditor.exec({
    type: 'AddShape', slideId, preset: 'ellipse', rect: { x: 80, y: 10, w: 50, h: 40 },
  }).forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements')?.path[1];
  check('恢复日志保留基准 prefix 与副本身份分区', restoredDoc.identity.prefix === 'collab-recovery-'
    && restoredDoc.identity.allocation?.replicaId === 'a' && !!restoredDoc.elements[first]);
  check('恢复重开后逻辑 id 与 cNvPr 游标都不复用', first !== second
    && restoredDoc.elements[second].meta.origin.spid > firstSpid);
  const resumedMessage = secondHub.queue.find((item) => item.from === 'restored')?.message;
  check('恢复重开后 Lamport 时钟与消息序号继续递增', resumedMessage?.stamp.clock === 2
    && resumedMessage.sequence === 2);
  secondBinding.dispose();
}

{
  const pair = await createPair('showcase.pptx', 'collab-paste-');
  const hub = new OfflineHub();
  const bindings = bindPair(pair, hub);
  const source = editableShapes(pair.left).find((record) => !record.meta.ph);
  const leftPayload = edit.copyElements(pair.left, [source.id]);
  const rightPayload = edit.copyElements(pair.right, [source.id]);
  pair.leftEditor.exec({
    type: 'PasteElements', payload: leftPayload,
    at: { parentId: source.parent, x: source.src.x + 20, y: source.src.y + 20 },
  });
  pair.rightEditor.exec({
    type: 'PasteElements', payload: rightPayload,
    at: { parentId: source.parent, x: source.src.x + 40, y: source.src.y + 40 },
  });
  hub.flush((items) => items.reverse());
  const pasted = Object.values(pair.left.elements).filter((record) => record.meta.created);
  check('并发 PasteElements 的逻辑 id、spid 与分数序互不复用', pasted.length >= 2
    && new Set(pasted.map((record) => record.id)).size === pasted.length
    && new Set(pasted.map((record) => record.meta.origin?.spid)).size === pasted.length
    && new Set(pasted.map((record) => record.order ?? record.z)).size === pasted.length,
  JSON.stringify(pasted.map((record) => ({
    id: record.id, spid: record.meta.origin?.spid, order: record.order ?? record.z, parent: record.parent,
  }))));
  check('并发 PasteElements 乱序投递后收敛', semanticDoc(pair.left) === semanticDoc(pair.right),
    stringDiff(semanticDoc(pair.left), semanticDoc(pair.right)));
  bindings.forEach((binding) => binding.dispose());
}

await runCollabSlideIdentityContract({
  bindPair, canonical, check, collab, core, createPair, edit, OfflineHub, semanticDoc, stringDiff,
});

await runCollabHardeningContract({
  bindPair, check, collab, core, createPair, edit, editableShapes, load, OfflineHub,
  semanticDoc, stringDiff,
});

await runCollabProtocolContract({
  bindPair, check, collab, core, createPair, edit, editableShapes, load, OfflineHub,
  semanticDoc, stringDiff,
});

await runCollabAtomicContract({
  bindPair, check, collab, core, createPair, edit, editableShapes, load, OfflineHub, semanticDoc,
});

console.log('\n\x1b[36m▸ BroadcastChannel 双标签页 provider\x1b[0m');
{
  const channels = new Map();
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      const peers = channels.get(name) ?? new Set();
      peers.add(this);
      channels.set(name, peers);
    }
    addEventListener(type, listener) { if (type === 'message') this.listener = listener; }
    removeEventListener(type, listener) { if (type === 'message' && this.listener === listener) this.listener = null; }
    postMessage(data) {
      for (const peer of channels.get(this.name) ?? []) {
        if (peer !== this) peer.listener?.({ data: structuredClone(data) });
      }
    }
    close() { channels.get(this.name)?.delete(this); }
  }
  const pair = await createPair('showcase.pptx', 'collab-tabs-');
  const leftProvider = new collab.BroadcastChannelCollabProvider('web-ppt-demo', FakeBroadcastChannel);
  const rightProvider = new collab.BroadcastChannelCollabProvider('web-ppt-demo', FakeBroadcastChannel);
  const left = collab.bindCollaboration(pair.leftEditor, {
    documentId: 'tabs', replicaId: 'tab-a', replicaSlot: 3, provider: leftProvider,
  });
  const right = collab.bindCollaboration(pair.rightEditor, {
    documentId: 'tabs', replicaId: 'tab-b', replicaSlot: 4, provider: rightProvider,
  });
  const target = editableShapes(pair.left)[0];
  pair.leftEditor.exec({ type: 'SetXfrm', id: target.id, y: target.src.y + 23 });
  check('BroadcastChannel provider 实时同步两个标签页', semanticDoc(pair.left) === semanticDoc(pair.right),
    stringDiff(semanticDoc(pair.left), semanticDoc(pair.right)));
  check('远端补丁不进入接收方本地历史', pair.rightEditor.history.undoCount === 0
    && pair.rightEditor.history.redoCount === 0);
  left.dispose();
  right.dispose();
  leftProvider.dispose();
  rightProvider.dispose();
}

const thinGzip = gzipSync(readFileSync(thinFile)).length;
const editorSource = readFileSync(join(root, 'packages/editor/src/index.ts'), 'utf8');
// 结构冲突重基与有界重放元数据是正确性成本；12KB 仍保持为独立按需薄包。
check('协同包排除 peer 后小于 12KB gzip', thinGzip < 12 * 1024, `${thinGzip} bytes`);
check('单机 editor 入口没有协同依赖', !editorSource.includes('@web-ppt/collab'));

if (failures.length) {
  console.error(`\n\x1b[31m✗ ${failures.length} 项协同验收失败\x1b[0m`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}
console.log(`\n\x1b[32m✓ 协同适配包 ${passed} 项断言通过（${thinGzip}B gzip，不含 peer）\x1b[0m`);
