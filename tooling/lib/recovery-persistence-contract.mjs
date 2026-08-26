import { createMemoryRecoveryStore } from './recovery-memory-store.mjs';

const firstElement = (session) => session.editor.doc.slides[
  session.editor.doc.slideOrder[0]
].children[0];

/** 指纹、会话日志与恢复决策只通过发布入口和可替换 store 验收。 */
export async function runRecoveryPersistenceContract({ lib, load, check }) {
  console.log('\n\x1b[36m▸ 恢复持久化与源身份\x1b[0m');
  if (!check('发布入口公开内容指纹', typeof lib.fingerprintSource === 'function')) return;
  const source = load('sample-edit-xfrm.pptx');
  const expected = 'sha256:29dc367fcb09afeeff5dde8bf4e33d0b430c266e7280f2682b1bd328c3de3a2c';
  const copiedBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const identities = await Promise.all([
    lib.fingerprintSource(source),
    lib.fingerprintSource(copiedBuffer),
    lib.fingerprintSource(new Blob([source])),
  ]);
  check('同字节的三种输入使用已知 SHA-256 命中同一源身份',
    identities.every((identity) => identity.fingerprint === expected
      && identity.byteLength === source.byteLength));
  const changed = source.slice();
  changed[changed.length - 1] ^= 1;
  const changedIdentity = await lib.fingerprintSource(changed);
  check('同大小不同内容不会串用恢复日志',
    changedIdentity.byteLength === source.byteLength && changedIdentity.fingerprint !== expected);

  const { records, store } = createMemoryRecoveryStore();
  let decisions = 0;
  const first = await lib.openEditor(source, {
    recovery: { store, decide: () => { decisions++; return 'restore'; } },
  });
  const firstPrefix = first.editor.doc.identity.prefix;
  const elementId = firstElement(first);
  const recoveredX = first.editor.effectiveElement(elementId).x + 23;
  first.editor.exec({ type: 'SetXfrm', id: elementId, x: recoveredX });
  await first.recovery.flush();
  const persisted = records.get(expected);
  check('首次打开不提示，事务异步追加并可由 session flush 确认',
    decisions === 0 && first.recovery.source.fingerprint === expected
      && persisted.idPrefix === firstPrefix && persisted.frames.length === 1
      && persisted.frames[0].dirty);
  first.dispose();

  const emptyPrefix = await lib.openEditor(load('sample-editor-add-slide.pptx'), {
    idPrefix: '', recovery: { store, decide: () => 'discard' },
  });
  check('恢复持久化不收窄既有空 idPrefix 契约',
    emptyPrefix.editor.doc.identity.prefix === ''
      && records.get(emptyPrefix.recovery.source.fingerprint).idPrefix === '');
  emptyPrefix.dispose();

  let releaseMutableDecision;
  let reportMutableCandidate;
  const mutableCandidate = new Promise((resolve) => { reportMutableCandidate = resolve; });
  const mutableSource = source.slice().buffer;
  const mutableOpen = lib.openEditor(mutableSource, {
    recovery: {
      store,
      decide: () => {
        reportMutableCandidate();
        return new Promise((resolve) => { releaseMutableDecision = resolve; });
      },
    },
  });
  await mutableCandidate;
  structuredClone(mutableSource, { transfer: [mutableSource] });
  releaseMutableDecision('restore');
  const immutableSnapshot = await mutableOpen;
  check('恢复打开先复制可变源，决策期间 transfer 不会分裂指纹与解析内容',
    mutableSource.byteLength === 0
      && immutableSnapshot.editor.effectiveElement(elementId).x === recoveredX);
  immutableSnapshot.dispose();

  let candidate;
  const restored = await lib.openEditor(source.slice().buffer, {
    recovery: { store, decide: (value) => { decisions++; candidate = value; return 'restore'; } },
  });
  check('同内容重开先给出轻量候选，并在任何视图可见前恢复',
    decisions === 1 && candidate.fingerprint === expected && candidate.frameCount === 1
      && candidate.idPrefix === firstPrefix
      && restored.editor.doc.identity.prefix === firstPrefix
      && restored.editor.effectiveElement(elementId).x === recoveredX
      && restored.editor.isDirty());
  let cancelled;
  try {
    await lib.openEditor(source, { recovery: { store, decide: () => 'cancel' } });
  } catch (error) { cancelled = error; }
  check('取消恢复返回可识别错误且不删除旧日志',
    cancelled instanceof lib.RecoveryOpenCancelledError
      && cancelled.candidate.fingerprint === expected && records.has(expected));

  restored.editor.markSaved();
  const afterSaveX = restored.editor.effectiveElement(elementId).x;
  restored.editor.exec({ type: 'SetXfrm', id: elementId, x: afterSaveX + 11 });
  await restored.recovery.flush();
  restored.dispose();
  const afterSave = await lib.openEditor(source, {
    recovery: { store, decide: () => 'restore' },
  });
  check('保存点后继续编辑仍保留从原始源可完整回放的链',
    records.get(expected).frames.some((frame) => frame.source === 'savepoint')
      && afterSave.editor.effectiveElement(elementId).x === afterSaveX + 11
      && afterSave.editor.isDirty());
  afterSave.editor.markSaved();
  await afterSave.recovery.flush();
  afterSave.dispose();

  const beforeCleanEpoch = records.get(expected).epoch;
  const decisionsBeforeClean = decisions;
  const clean = await lib.openEditor(source, {
    recovery: { store, decide: () => { decisions++; return 'restore'; } },
  });
  check('clean 尾帧自动换代且不提示、不把旧保存结果套到原始源',
    decisions === decisionsBeforeClean && records.get(expected).frames.length === 0
      && records.get(expected).epoch !== beforeCleanEpoch
      && clean.editor.effectiveElement(firstElement(clean)).x !== afterSaveX + 11
      && !clean.editor.isDirty());
  clean.dispose();

  const discardSeed = await lib.openEditor(source, {
    recovery: { store, decide: () => 'restore' },
  });
  const discardElement = firstElement(discardSeed);
  const discardSourceX = discardSeed.editor.effectiveElement(discardElement).x;
  discardSeed.editor.exec({ type: 'SetXfrm', id: discardElement, x: discardSourceX + 37 });
  await discardSeed.recovery.flush();
  const discardedPrefix = discardSeed.editor.doc.identity.prefix;
  const discardedEpoch = records.get(expected).epoch;
  const discarded = await lib.openEditor(source, {
    recovery: { store, decide: () => 'discard' },
  });
  const discardedElement = firstElement(discarded);
  const discardedRecord = records.get(expected);
  discardSeed.editor.exec({ type: 'SetXfrm', id: discardElement, x: discardSourceX + 38 });
  let staleAppendError;
  try { await discardSeed.recovery.flush(); } catch (error) { staleAppendError = error; }
  check('放弃恢复原子换代，新身份打开原始内容且旧会话不能复活日志',
    discardedRecord.frames.length === 0 && discardedRecord.epoch !== discardedEpoch
      && discarded.editor.doc.identity.prefix !== discardedPrefix && !discarded.editor.isDirty()
      && discarded.editor.effectiveElement(discardedElement).x === discardSourceX
      && discardedElement !== discardElement && staleAppendError instanceof Error
      && records.get(expected).epoch === discardedRecord.epoch);
  discardSeed.dispose();
  discarded.editor.exec({ type: 'SetXfrm', id: discardedElement, x: discardSourceX + 1 });
  await discarded.recovery.flush();
  check('换代后的新会话仍可正常持久化',
    records.get(expected).idPrefix === discarded.editor.doc.identity.prefix
      && records.get(expected).frames.length === 1);
  discarded.dispose();

  const diskError = new Error('模拟 quota 失败');
  let appendAttempts = 0;
  let reportedErrors = 0;
  const failingStore = {
    async load() { return null; }, async reset() {},
    async append() { appendAttempts++; throw diskError; }, async remove() {},
  };
  const failing = await lib.openEditor(source, {
    recovery: {
      store: failingStore,
      onError: (error) => { if (error === diskError) reportedErrors++; },
    },
  });
  const failingElement = firstElement(failing);
  const committedX = failing.editor.effectiveElement(failingElement).x + 7;
  let commitThrew = false;
  try { failing.editor.exec({ type: 'SetXfrm', id: failingElement, x: committedX }); } catch {
    commitThrew = true;
  }
  let flushError;
  try { await failing.recovery.flush(); } catch (error) { flushError = error; }
  failing.editor.exec({ type: 'SetXfrm', id: failingElement, x: committedX + 1 });
  await Promise.resolve();
  check('持久化失败不回滚编辑、不重复尝试，并由控制器与回调显式报告',
    !commitThrew && failing.editor.effectiveElement(failingElement).x === committedX + 1
      && failing.recovery.error === diskError && flushError === diskError
      && appendAttempts === 1 && reportedErrors === 1);
  failing.dispose();

  const compactRecords = new Map();
  const compactStore = {
    async load(identity) { return structuredClone(compactRecords.get(identity.fingerprint) ?? null); },
    async reset(request) {
      const time = Date.now();
      compactRecords.set(request.source.fingerprint, {
        version: 1, source: structuredClone(request.source), idPrefix: request.idPrefix,
        epoch: request.epoch, createdAt: time, updatedAt: time, estimatedBytes: 0, frames: [],
      });
    },
    async append(request) {
      const current = compactRecords.get(request.source.fingerprint);
      if (!current || current.epoch !== request.epoch) throw new Error('恢复日志代际冲突');
      const frames = [];
      for (const frame of [...current.frames, ...structuredClone(request.frames)]) {
        const previous = frames[frames.length - 1];
        if (previous && !previous.patches.length && !frame.patches.length) frames[frames.length - 1] = frame;
        else frames.push(frame);
      }
      compactRecords.set(request.source.fingerprint, {
        ...current, updatedAt: Math.max(current.updatedAt, request.frames.at(-1).time),
        estimatedBytes: JSON.stringify(frames).length, frames,
      });
    },
    async remove(identity) { compactRecords.delete(identity.fingerprint); },
  };
  const compactSeed = await lib.openEditor(source, {
    recovery: { store: compactStore, decide: () => 'restore' },
  });
  const compactElement = firstElement(compactSeed);
  const compactX = compactSeed.editor.effectiveElement(compactElement).x + 13;
  compactSeed.editor.exec({ type: 'SetXfrm', id: compactElement, x: compactX });
  for (let index = 0; index < 20; index++) {
    compactSeed.editor.select(index % 2
      ? { kind: 'none' }
      : { kind: 'elements', ids: [compactElement], enteredGroup: null });
  }
  await compactSeed.recovery.flush();
  const compacted = compactRecords.get(expected);
  compactSeed.dispose();
  let compactCandidate;
  const compactRestored = await lib.openEditor(source, {
    recovery: {
      store: compactStore,
      decide: (value) => { compactCandidate = value; return 'restore'; },
    },
  });
  check('确定性内存 store 压缩后保持模型、最终选区与 dirty 等价',
    compacted.frames.length === 2 && compactCandidate.frameCount === 2
      && compactRestored.editor.effectiveElement(compactElement).x === compactX
      && compactRestored.editor.selection.kind === 'none' && compactRestored.editor.isDirty());
  compactRestored.dispose();
}
