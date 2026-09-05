import { makePng, makeWav } from './ooxml.mjs';
import { makeMp4 } from './media-mp4-fixture.mjs';

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
    ['危险外链', (c) => { c.source = { kind: 'external', mediaKind: 'audio', url: 'javascript:alert(1)' }; }],
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
  const cases = [{ kind: 'embedded', bytes: makeWav(0.1), mime: 'audio/wav' },
    { kind: 'embedded', bytes: makeMp4(), mime: 'video/mp4' }, { kind: 'embedded', bytes: makeMp4(true), mime: 'video/mp4' },
    { kind: 'external', mediaKind: 'audio', url: 'https://media.example.test/audio' },
    { kind: 'external', mediaKind: 'video', url: 'https://media.example.test/video' }];
  for (const sample of cases) for (const generated of [false, true]) {
    const peers = await Promise.all(['left', 'right'].map(async (name) => {
      const presentation = await core.parse(source, { edit: true, keepPackage: true, lazy: false });
      const doc = edit.createDoc(presentation, { idPrefix: 'media-collab-' });
      return { name, presentation, doc, editor: new edit.Editor(doc) };
    }));
    const listeners = new Map(), queue = [], errors = [];
    const deliver = () => {
      for (const event of queue.splice(0).reverse()) for (const peer of peers) {
        if (peer.name !== event.from) listeners.get(peer.name)(event.message);
      }
    };
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
        source: sample,
        poster: { bytes: makePng(8, 8, () => [40, 80, 120]), mime: 'image/png' },
      }));
      assert.notEqual(...ids, '并发插入使用副本槽分配不同身份');
      deliver();
      assert.deepEqual(errors, [], '真实协同适配器接收媒体插入');
      assert.deepEqual(peers[0].doc.slides[peers[0].doc.slideOrder[0]].children,
        peers[1].doc.slides[peers[1].doc.slideOrder[0]].children, '并发媒体顺序收敛');
      media.createMediaEditor(peers[0].editor).exec({ type: 'ReplaceMediaPoster', id: ids[0],
        poster: { bytes: makePng(16, 12, () => [80, 90, 210]), mime: 'image/png' } });
      deliver();
      const replaced = peers[0].editor.effectiveElement(ids[0]).src;
      peers[0].editor.undo(); deliver();
      peers[0].editor.redo(); deliver();
      assert.deepEqual(errors, [], '接收端回收海报后仍可接收重做');
      assert.equal(peers[1].editor.effectiveElement(ids[0]).src, replaced);
      for (const [index, peer] of peers.entries()) media.createMediaEditor(peer.editor).exec({
        type: 'ReplaceMediaPoster', id: ids[0],
        poster: { bytes: makePng(16, 12, () => [10 + index * 40, 170, 90]), mime: 'image/png' },
      });
      deliver();
      assert.deepEqual(errors, [], '并发海报替换通过真实协同适配器');
      assert.equal(peers[0].editor.effectiveElement(ids[0]).src, peers[1].editor.effectiveElement(ids[0]).src,
        '同一媒体并发替换海报按字段规则收敛');
      for (const peer of peers) {
        for (const id of ids) {
          const playback = peer.editor.effectiveElement(id).media;
          if (sample.kind === 'embedded') assert.equal(playback.mime, sample.mime);
          else assert.deepEqual(playback, { kind: sample.mediaKind, src: sample.url, external: true });
        }
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
