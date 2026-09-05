import { makePng, makeWav } from './ooxml.mjs';

/** 接收端没有发送者的撤销历史；重做必须自带已被接收端回收的图片资源。 */
export async function runMediaPosterReplayContract({ core, edit, media, source, assert }) {
  const peers = await Promise.all([0, 1].map(async () => {
    const presentation = await core.parse(source, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(presentation, { idPrefix: 'poster-replay-' });
    return { doc, editor: new edit.Editor(doc) };
  }));
  const [local, remote] = peers, events = [];
  local.editor.subscribePatches((event) => events.push(event));
  const deliver = () => { for (const event of events.splice(0)) remote.editor.applyExternalPatches(event.patches); };
  try {
    const api = media.createMediaEditor(local.editor);
    const id = api.exec({ type: 'AddMedia', slideId: local.doc.slideOrder[0],
      rect: { x: 20, y: 30, w: 80, h: 80 }, source: { kind: 'embedded', bytes: makeWav(), mime: 'audio/wav' } });
    deliver();
    const initial = remote.editor.effectiveElement(id).src;
    api.exec({ type: 'ReplaceMediaPoster', id,
      poster: { bytes: makePng(16, 12, () => [10, 170, 90]), mime: 'image/png' } });
    deliver();
    const replaced = remote.editor.effectiveElement(id).src;
    assert.notEqual(replaced, initial);
    local.editor.undo(); deliver();
    assert.equal(remote.editor.effectiveElement(id).src, initial);
    local.editor.redo(); deliver();
    assert.equal(remote.editor.effectiveElement(id).src, replaced, '无本地历史的接收端仍可重放海报重做');
    local.editor.undo(); deliver();
    const identity = structuredClone(local.doc.identity), history = local.editor.history.undoCount;
    const eventCount = events.length;
    const commands = [{ type: 'Extension', namespace: 'media', id, payload: {
      type: 'ReplaceMediaPoster', id, poster: { bytes: makePng(16, 12, () => [10, 170, 90]), mime: 'image/png' },
    } }, ...Array.from({ length: edit.MAX_PATCHES_PER_TRANSACTION - 1 }, (_, index) =>
      ({ type: 'SetName', id, name: `海报边界 ${index % 2}` }))];
    assert.throws(() => local.editor.exec(...commands), /补丁/, '完整传输闭包超限必须在提交前拒绝');
    assert.deepEqual(local.doc.identity, identity, '拒绝超限事务不推进身份与协同水位');
    assert.equal(local.editor.history.undoCount, history);
    assert.equal(local.editor.effectiveElement(id).src, initial);
    assert.equal(local.editor.effectiveElement(id).name, '音频');
    assert.equal(events.length, eventCount, '失败事务不发出半完整事件');
    const ids = [id, ...[0, 1].map(() => api.exec({ type: 'AddMedia', slideId: local.doc.slideOrder[0],
      rect: { x: 20, y: 30, w: 80, h: 80 }, source: { kind: 'embedded', bytes: makeWav(), mime: 'audio/wav' } }))];
    ids.forEach((target, index) => api.exec({ type: 'ReplaceMediaPoster', id: target,
      poster: { bytes: makePng(8, 8, () => [20 + index, 40, 60]), mime: 'image/png' } }));
    deliver();
    const before = { identity: structuredClone(local.doc.identity), count: local.editor.history.undoCount,
      posters: ids.map((target) => local.editor.effectiveElement(target).src) };
    const sharedPoster = { bytes: makePng(8, 8, () => [210, 30, 70]), mime: 'image/png' };
    const collapse = ids.map((target) => ({ type: 'Extension', namespace: 'media', id: target,
      payload: { type: 'ReplaceMediaPoster', id: target, poster: sharedPoster } }));
    const names = Array.from({ length: edit.MAX_PATCHES_PER_TRANSACTION - 4 }, (_, index) =>
      ({ type: 'SetName', id, name: `撤销边界 ${index % 2}` }));
    assert.throws(() => local.editor.exec(...collapse, ...names), /补丁/,
      '正向 10000 项但逆向资源闭包 10002 项的事务也必须拒绝');
    assert.deepEqual(local.doc.identity, before.identity);
    assert.equal(local.editor.history.undoCount, before.count);
    assert.deepEqual(ids.map((target) => local.editor.effectiveElement(target).src), before.posters);
    assert.equal(local.editor.effectiveElement(id).name, '音频');
    assert.equal(events.length, 0);
    local.editor.exec(...collapse, ...names.slice(2));
    deliver();
    local.editor.undo(); deliver();
    assert.deepEqual(ids.map((target) => remote.editor.effectiveElement(target).src), before.posters,
      '恰好 10000 项的撤销闭包在无本地历史的接收端完整恢复');
    const slideId = local.doc.slideOrder[0], existing = new Set(local.doc.slides[slideId].children);
    local.editor.exec(...Array.from({ length: edit.MAX_PATCHES_PER_TRANSACTION / 5 + 1 }, () => ({
      type: 'AddShape', slideId, preset: 'rect', rect: { x: 10, y: 20, w: 30, h: 40 },
    })));
    deliver();
    const shapes = local.doc.slides[slideId].children.filter((target) => !existing.has(target));
    local.editor.history.clear();
    local.editor.transaction((tx) => tx.exec(...shapes.slice(0, -1).map((target) => ({
      type: 'SetXfrm', id: target, x: 11, y: 21, w: 31, h: 41, rot: 1,
    }))), '合并边界', { mergeKey: 'transport-limit', time: 1000 });
    deliver();
    local.editor.transaction((tx) => tx.exec(
      { type: 'SetXfrm', id: shapes[0], x: 12 },
      { type: 'SetXfrm', id: shapes.at(-1), y: 22 },
    ), '合并边界', { mergeKey: 'transport-limit', time: 1001 });
    deliver();
    assert.equal(local.editor.history.undoCount, 2, '合并后超限时保留两个完整、可重放的撤销单元');
    local.editor.undo(); deliver();
    assert.equal(remote.editor.effectiveElement(shapes[0]).x, 11);
    assert.equal(remote.editor.effectiveElement(shapes.at(-1)).y, 20);
    local.editor.undo(); deliver();
    assert.equal(remote.editor.effectiveElement(shapes[0]).x, 10);
    local.editor.redo(); deliver(); local.editor.redo(); deliver();
    assert.equal(remote.editor.effectiveElement(shapes[0]).x, 12);
    assert.equal(remote.editor.effectiveElement(shapes.at(-1)).y, 22);
  } finally { for (const peer of peers) { peer.editor.dispose(); edit.disposeDoc(peer.doc); } }
}
