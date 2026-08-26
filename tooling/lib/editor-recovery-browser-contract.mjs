function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`IndexedDB ${name} 删除被阻塞`));
  });
}

const firstElement = (session) => {
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.meta.editable === 'full');
  if (!record) throw new Error('恢复浏览器契约缺少可编辑元素');
  return record.id;
};

export async function runEditorRecoveryBrowserContract({ lib, load }) {
  if (typeof lib.createIndexedDbRecoveryStore !== 'function') {
    throw new Error('发布入口缺少 IndexedDB 恢复存储');
  }
  const workerResult = await new Promise((resolve, reject) => {
    const worker = new Worker('/tooling/lib/editor-recovery-worker.mjs', { type: 'module' });
    worker.onmessage = (event) => { worker.terminate(); resolve(event.data); };
    worker.onerror = (event) => { worker.terminate(); reject(event.error ?? new Error(event.message)); };
  });
  if (!workerResult.imported || !workerResult.withoutDocument) {
    throw new Error(`editor 在 Worker 导入时访问了 DOM：${JSON.stringify(workerResult)}`);
  }
  const databaseName = 'web-ppt-editor-recovery-contract';
  await deleteDatabase(databaseName);
  let now = 1_000_000_000;
  const retentionMs = 24 * 60 * 60 * 1000;
  const options = {
    databaseName,
    namespace: 'contract',
    compactAfterChunks: 16,
    compactToChunks: 8,
    maxJournals: 2,
    maxBytes: 8 * 1024 * 1024,
    retentionMs,
    now: () => now,
  };
  const source = await load('sample-edit-xfrm.pptx');
  const store = lib.createIndexedDbRecoveryStore(options);
  class CountingBlob extends Blob {
    reads = 0;
    async arrayBuffer() {
      this.reads++;
      return super.arrayBuffer();
    }
  }
  const sourceBlob = new CountingBlob([source]);
  const [bufferIdentity, fileIdentity] = await Promise.all([
    lib.fingerprintSource(source),
    lib.fingerprintSource(new File([source], 'renamed.pptx', { lastModified: 123 })),
  ]);
  if (bufferIdentity.fingerprint !== fileIdentity.fingerprint) {
    throw new Error('File 名称或 lastModified 污染了内容指纹');
  }
  const readProbe = await lib.openEditor(sourceBlob, {
    recovery: { store, decide: () => 'restore' },
  });
  readProbe.dispose();
  if (sourceBlob.reads !== 1) throw new Error(`恢复打开重复读取 Blob：${sourceBlob.reads}`);
  const emptyPrefixStore = lib.createIndexedDbRecoveryStore({
    ...options, namespace: 'empty-prefix-contract',
  });
  const emptyPrefixSession = await lib.openEditor(source, {
    idPrefix: '', recovery: { store: emptyPrefixStore, decide: () => 'discard' },
  });
  const emptyPrefixRecord = await emptyPrefixStore.load(emptyPrefixSession.recovery.source);
  if (emptyPrefixSession.editor.doc.identity.prefix !== '' || emptyPrefixRecord.idPrefix !== '') {
    throw new Error('IndexedDB 恢复存储收窄了空 idPrefix 契约');
  }
  emptyPrefixSession.dispose();
  await emptyPrefixStore.close();
  let fingerprintMs;
  {
    const largeSource = new Uint8Array(50 * 1024 * 1024);
    for (let index = 0; index < largeSource.length; index += 4096) largeSource[index] = index >>> 12;
    const fingerprintStart = performance.now();
    const identity = await lib.fingerprintSource(largeSource);
    fingerprintMs = performance.now() - fingerprintStart;
    if (identity.byteLength !== largeSource.length || fingerprintMs > 500) {
      throw new Error(`50MB 源指纹预算超限：${fingerprintMs.toFixed(1)}ms`);
    }
  }
  let prompted = 0;
  const first = await lib.openEditor(source, {
    recovery: { store, decide: () => { prompted++; return 'restore'; } },
  });
  const elementId = firstElement(first);
  const sourceX = first.editor.effectiveElement(elementId).x;
  const baseline = await lib.openEditor(source.slice(0));
  const baselineId = firstElement(baseline);
  const baselineX = baseline.editor.effectiveElement(baselineId).x;
  const enabledSamples = [];
  const baselineSamples = [];
  const persistStart = performance.now();
  for (let index = 0; index < 1000; index++) {
    let started = performance.now();
    first.editor.exec({ type: 'SetXfrm', id: elementId, x: sourceX + 1 + (index & 1) });
    enabledSamples.push(performance.now() - started);
    started = performance.now();
    baseline.editor.exec({ type: 'SetXfrm', id: baselineId, x: baselineX + 1 + (index & 1) });
    baselineSamples.push(performance.now() - started);
    if (index % 10 === 9) await Promise.resolve();
  }
  await first.recovery.flush();
  const persistMs = performance.now() - persistStart;
  baseline.dispose();
  enabledSamples.sort((left, right) => left - right);
  baselineSamples.sort((left, right) => left - right);
  const enabledP95 = enabledSamples[Math.floor(enabledSamples.length * 0.95)];
  const baselineP95 = baselineSamples[Math.floor(baselineSamples.length * 0.95)];
  const syncOverhead = Math.max(0, enabledP95 - baselineP95);
  const firstStats = await store.stats();
  if (prompted !== 0 || firstStats.frameCount !== 1000 || firstStats.chunkCount > 16) {
    throw new Error(`IndexedDB 追加/压缩错误：${JSON.stringify(firstStats)}`);
  }
  const sourceIdentity = first.recovery.source;
  const beforeInvalid = await store.load(sourceIdentity);
  let duplicateRejected = false;
  try {
    await store.append({
      source: sourceIdentity,
      idPrefix: first.editor.doc.identity.prefix,
      epoch: beforeInvalid.epoch,
      frames: [structuredClone(beforeInvalid.frames[beforeInvalid.frames.length - 1])],
    });
  } catch { duplicateRejected = true; }
  const afterInvalid = await store.load(sourceIdentity);
  if (!duplicateRejected || afterInvalid.frames.length !== 1000
    || afterInvalid.frames[afterInvalid.frames.length - 1].sequence !== 1000) {
    throw new Error('IndexedDB 重复序号没有原子拒绝');
  }
  first.dispose();
  await store.close();

  const reopenedStore = lib.createIndexedDbRecoveryStore(options);
  let candidate;
  const restoreStart = performance.now();
  const restored = await lib.openEditor(source.slice(0), {
    recovery: {
      store: reopenedStore,
      decide: (value) => { candidate = value; return 'restore'; },
    },
  });
  const restoreMs = performance.now() - restoreStart;
  if (candidate?.frameCount !== 1000
    || restored.editor.effectiveElement(elementId).x !== sourceX + 2
    || !restored.editor.isDirty()) {
    throw new Error('IndexedDB 关闭重开后没有恢复同一模型');
  }
  restored.dispose();

  for (const [name, delta] of [
    ['sample-edit-basic.pptx', 3],
    ['sample-editor-add-slide.pptx', 5],
  ]) {
    now += 100;
    const session = await lib.openEditor(await load(name), {
      recovery: { store: reopenedStore, decide: () => 'discard' },
    });
    const id = firstElement(session);
    session.editor.exec({ type: 'SetXfrm', id, x: session.editor.effectiveElement(id).x + delta });
    await session.recovery.flush();
    session.dispose();
  }
  const cleanupStats = await reopenedStore.stats();
  if (cleanupStats.journalCount !== 2) {
    throw new Error(`IndexedDB 清理未限制日志数量：${JSON.stringify(cleanupStats)}`);
  }
  const bytesStore = lib.createIndexedDbRecoveryStore({
    ...options, namespace: 'bytes-contract', maxJournals: 10, maxBytes: 1,
  });
  for (const name of ['sample-edit-xfrm.pptx', 'sample-editor-add-slide.pptx']) {
    now += 100;
    const session = await lib.openEditor(await load(name), {
      recovery: { store: bytesStore, decide: () => 'discard' },
    });
    const id = firstElement(session);
    session.editor.exec({ type: 'SetXfrm', id, x: session.editor.effectiveElement(id).x + 1 });
    await session.recovery.flush();
    session.dispose();
  }
  const byteStats = await bytesStore.stats();
  if (byteStats.journalCount !== 1) {
    throw new Error(`IndexedDB 总字节清理没有保留当前日志：${JSON.stringify(byteStats)}`);
  }
  await bytesStore.close();
  const clockStore = lib.createIndexedDbRecoveryStore({
    ...options, namespace: 'clock-contract', maxJournals: 10,
  });
  const clockSession = await lib.openEditor(source, {
    recovery: { store: clockStore, decide: () => 'discard' },
  });
  const clockId = firstElement(clockSession);
  clockSession.editor.exec({
    type: 'SetXfrm', id: clockId, x: clockSession.editor.effectiveElement(clockId).x + 1,
  });
  await clockSession.recovery.flush();
  const beforeRollback = await clockStore.load(clockSession.recovery.source);
  now -= 10_000;
  clockSession.editor.exec({
    type: 'SetXfrm', id: clockId, x: clockSession.editor.effectiveElement(clockId).x + 1,
  });
  await clockSession.recovery.flush();
  const afterRollback = await clockStore.load(clockSession.recovery.source);
  if (afterRollback.updatedAt < beforeRollback.updatedAt
    || afterRollback.createdAt > afterRollback.updatedAt) {
    throw new Error('系统时钟回拨破坏了恢复日志时间单调性');
  }
  clockSession.dispose();
  await clockStore.close();
  now += 10_000;
  const probeStore = lib.createIndexedDbRecoveryStore({
    ...options, namespace: 'growth-probe', maxJournals: 10,
  });
  const probeSession = await lib.openEditor(source, {
    recovery: { store: probeStore, decide: () => 'discard' },
  });
  const probeId = firstElement(probeSession);
  probeSession.editor.exec({
    type: 'SetXfrm', id: probeId, x: probeSession.editor.effectiveElement(probeId).x + 1,
  });
  await probeSession.recovery.flush();
  const oneFrameBytes = (await probeStore.load(probeSession.recovery.source)).estimatedBytes;
  probeSession.dispose();
  await probeStore.close();
  const growthStore = lib.createIndexedDbRecoveryStore({
    ...options, namespace: 'growth-contract', maxJournals: 10, maxBytes: oneFrameBytes * 3,
  });
  const growthOld = await lib.openEditor(await load('sample-editor-add-slide.pptx'), {
    recovery: { store: growthStore, decide: () => 'discard' },
  });
  const growthOldId = firstElement(growthOld);
  growthOld.editor.exec({
    type: 'SetXfrm', id: growthOldId, x: growthOld.editor.effectiveElement(growthOldId).x + 1,
  });
  await growthOld.recovery.flush();
  growthOld.dispose();
  const growthCurrent = await lib.openEditor(source, {
    recovery: { store: growthStore, decide: () => 'discard' },
  });
  const growthCurrentId = firstElement(growthCurrent);
  growthCurrent.editor.exec({
    type: 'SetXfrm', id: growthCurrentId,
    x: growthCurrent.editor.effectiveElement(growthCurrentId).x + 1,
  });
  await growthCurrent.recovery.flush();
  const beforeGrowth = await growthStore.stats();
  for (let index = 0; index < 10; index++) {
    growthCurrent.editor.exec({
      type: 'SetXfrm', id: growthCurrentId,
      x: growthCurrent.editor.effectiveElement(growthCurrentId).x + (index % 2 ? -1 : 1),
    });
    await Promise.resolve();
  }
  await growthCurrent.recovery.flush();
  const afterGrowth = await growthStore.stats();
  if (beforeGrowth.journalCount !== 2 || afterGrowth.journalCount !== 1) {
    throw new Error(`当前日志增长后没有按总字节淘汰旧日志：${JSON.stringify({ beforeGrowth, afterGrowth })}`);
  }
  growthCurrent.dispose();
  await growthStore.close();
  const metadataStore = lib.createIndexedDbRecoveryStore({
    ...options, namespace: 'metadata-contract', compactAfterChunks: 4, compactToChunks: 2,
  });
  const metadataSession = await lib.openEditor(source, {
    recovery: { store: metadataStore, decide: () => 'restore' },
  });
  const metadataId = firstElement(metadataSession);
  const metadataX = metadataSession.editor.effectiveElement(metadataId).x + 1;
  metadataSession.editor.exec({
    type: 'SetXfrm', id: metadataId, x: metadataX,
  });
  for (let index = 0; index < 21; index++) {
    metadataSession.editor.select(index % 2
      ? { kind: 'none' }
      : { kind: 'elements', ids: [metadataId], enteredGroup: null });
    await Promise.resolve();
  }
  await metadataSession.recovery.flush();
  const compactedMetadata = await metadataStore.load(metadataSession.recovery.source);
  metadataSession.dispose();
  let metadataCandidate;
  const restoredMetadata = await lib.openEditor(source, {
    recovery: {
      store: metadataStore,
      decide: (candidateValue) => { metadataCandidate = candidateValue; return 'restore'; },
    },
  });
  if (compactedMetadata.frames.length > 5
    || metadataCandidate.frameCount !== compactedMetadata.frames.length
    || restoredMetadata.editor.effectiveElement(metadataId).x !== metadataX
    || restoredMetadata.editor.selection.kind !== 'elements'
    || restoredMetadata.editor.selection.ids[0] !== metadataId
    || !restoredMetadata.editor.isDirty()) {
    throw new Error(`IndexedDB 元数据帧压缩不等价：${compactedMetadata.frames.length}`);
  }
  restoredMetadata.dispose();
  await metadataStore.close();
  now += retentionMs + 1;
  const expired = await reopenedStore.cleanup();
  const expiredStats = await reopenedStore.stats();
  if (expired.journalsRemoved !== 2 || expiredStats.journalCount !== 0) {
    throw new Error(`IndexedDB 保留期清理失败：${JSON.stringify({ expired, expiredStats })}`);
  }
  await reopenedStore.close();
  await deleteDatabase(databaseName);
  if (persistMs > 500 || restoreMs > 500 || syncOverhead > 0.5) {
    throw new Error(`IndexedDB 预算超限：写入 ${persistMs.toFixed(1)}ms / 恢复 ${restoreMs.toFixed(1)}ms`);
  }
  return { persistMs, restoreMs, chunks: firstStats.chunkCount, syncOverhead, fingerprintMs };
}
