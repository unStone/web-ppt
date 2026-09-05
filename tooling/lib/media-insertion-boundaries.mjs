import { makePng, makeWav } from './ooxml.mjs';

export function runMediaInsertionBoundaries({ editor, media, assert }) {
  const wav = makeWav(0.1), poster = makePng(8, 8, () => [40, 80, 120]);
  const base = () => ({ type: 'AddMedia', slideId: editor.doc.slideOrder[0],
    rect: { x: 20, y: 30, w: 80, h: 80 },
    source: { kind: 'embedded', bytes: wav.slice(), mime: 'audio/wav' },
    poster: { bytes: poster.slice(), mime: 'image/png' } });
  const cases = [
    ['伪造 MIME', (c) => { c.source.mime = 'video/mp4'; }],
    ['不完整 WAV', (c) => { c.source.bytes = wav.subarray(0, wav.length - 1); }],
    ['RIFF 长度谎报', (c) => { c.source.bytes[4] ^= 1; }],
    ['未知编解码', (c) => { c.source.bytes[20] = 99; }],
    ['PCM 帧尺寸不一致', (c) => { c.source.bytes[32] = 7; }],
    ['空采样率', (c) => { c.source.bytes.fill(0, 24, 28); }],
    ['不可播放的超大采样率', (c) => { c.source.bytes.fill(255, 24, 32); }],
    ['缺少数据块', (c) => { c.source.bytes[36] = 0; }],
    ['块长越界', (c) => { c.source.bytes.fill(255, 40, 44); }],
    ['超限资源', (c) => { c.source.bytes = new Uint8Array(media.MAX_MEDIA_BYTES + 1); }],
    ['非字节来源', (c) => { c.source.bytes = [...wav]; }],
    ['失效画布', (c) => { c.slideId = 'missing'; }],
    ['无效几何', (c) => { c.rect.w = -1; }],
    ['海报类型伪造', (c) => { c.poster.mime = 'image/jpeg'; }],
    ['海报签名伪造', (c) => { c.poster.bytes = wav; }],
    ['额外命令字段', (c) => { c.extra = true; }],
    ['外链尚未启用', (c) => { c.source = { kind: 'external', url: 'javascript:alert(1)' }; }],
  ];
  const identity = structuredClone(editor.doc.identity), history = editor.history.undoCount;
  for (const [label, mutate] of cases) {
    const command = base(); mutate(command);
    assert.throws(() => media.createMediaEditor(editor).exec(command), undefined, label);
    assert.deepEqual(editor.doc.identity, identity, `${label} 不改变身份分配`);
    assert.equal(editor.history.undoCount, history, `${label} 不改变历史`);
  }
}

export async function runMediaInsertionCollaboration({ core, edit, collab, media, source, assert }) {
  for (const generated of [false, true]) {
    const peers = await Promise.all(['left', 'right'].map(async (name) => {
      const presentation = await core.parse(source, { edit: true, keepPackage: true, lazy: false });
      const doc = edit.createDoc(presentation, { idPrefix: 'media-collab-' });
      return { name, presentation, doc, editor: new edit.Editor(doc) };
    }));
    const listeners = new Map(), queue = [], errors = [];
    const bindings = peers.map((peer, index) => collab.bindCollaboration(peer.editor, {
      documentId: 'media', replicaId: peer.name, replicaSlot: index + 1,
      onError: (error) => errors.push(error), provider: {
        send: (message) => queue.push({ from: peer.name, message: structuredClone(message) }),
        subscribe: (listener) => { listeners.set(peer.name, listener); return () => listeners.delete(peer.name); },
      },
    }));
    try {
      const ids = peers.map(({ doc, editor }) => media.createMediaEditor(editor).exec({
        type: 'AddMedia', slideId: doc.slideOrder[0], rect: { x: 20, y: 30, w: 80, h: 80 },
        source: { kind: 'embedded', bytes: makeWav(0.1), mime: 'audio/wav' },
        poster: { bytes: makePng(8, 8, () => [40, 80, 120]), mime: 'image/png' },
      }));
      assert.notEqual(...ids, '并发插入使用副本槽分配不同身份');
      for (const event of queue.splice(0).reverse()) for (const peer of peers) {
        if (peer.name !== event.from) listeners.get(peer.name)(event.message);
      }
      assert.deepEqual(errors, [], '真实协同适配器接收媒体插入');
      assert.deepEqual(peers[0].doc.slides[peers[0].doc.slideOrder[0]].children,
        peers[1].doc.slides[peers[1].doc.slideOrder[0]].children, '并发媒体顺序收敛');
      for (const peer of peers) {
        for (const id of ids) assert.equal(peer.editor.effectiveElement(id).media.mime, 'audio/wav');
        if (generated) peer.presentation.dispose();
        const reopened = await core.parse(await peer.editor.save(), { lazy: false });
        try { assert.equal(reopened.slides[0].elements.filter((el) => el.media).length, 2); }
        finally { reopened.dispose(); }
      }
    } finally {
      bindings.forEach((binding) => binding.dispose());
      peers.forEach((peer) => { peer.editor.dispose(); peer.presentation.dispose(); });
    }
  }
}
