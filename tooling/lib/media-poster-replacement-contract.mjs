import { makePng, makeWav } from './ooxml.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeMp4 } from './media-mp4-fixture.mjs';

export async function runMediaPosterReplacementContract({ core, edit, media, source, assert, root, out }) {
  for (const kind of ['audio', 'video']) for (const generated of [false, true]) {
    const presentation = await core.parse(new Uint8Array(readFileSync(join(root, 'fixtures/sample-media.pptx'))),
      { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(presentation), editor = new edit.Editor(doc);
    try {
      // 其余页刻意含断链墨迹，生成保存测试只保留本契约的媒体页。
      for (const id of doc.slideOrder.slice(1)) editor.exec({ type: 'RemoveSlide', id });
      const record = Object.values(doc.elements).find((record) => record.src.media?.kind === kind && !record.src.src);
      assert.ok(record, '导入固件包含原本没有海报的媒体');
      const poster = makePng(16, 12, () => [10, 170, 90]);
      media.createMediaEditor(editor).exec({ type: 'ReplaceMediaPoster', id: record.id,
        poster: { bytes: poster, mime: 'image/png' } });
      if (generated) presentation.dispose();
      const saved = await editor.save();
      writeFileSync(join(out, `poster-imported-${kind}-${generated ? 'generated' : 'patched'}.pptx`), saved);
      const reopened = await core.parse(saved, { keepPackage: true, lazy: false });
      try {
        const audio = reopened.slides[0].elements.find((element) => element.name === record.src.name);
        assert.deepEqual(reopened.package.assets[audio.src].bytes, poster, '无封面媒体补海报后可保存重开');
      } finally { reopened.dispose(); }
    } finally { editor.dispose(); edit.disposeDoc(doc); }
  }
  const samples = [
    ['audio', { kind: 'embedded', bytes: makeWav(0.4), mime: 'audio/wav' }],
    ['video', { kind: 'embedded', bytes: makeMp4(), mime: 'video/mp4' }],
    ...['audio', 'video'].map((kind) => [`external-${kind}`, { kind: 'external', mediaKind: kind,
      url: `https://media.example.test/${kind}` }]),
  ];
  for (const [name, sample] of samples) for (const mode of ['patched', 'generated', 'legacy']) {
    const input = mode === 'legacy' ? new Uint8Array(readFileSync(join(root, 'fixtures/sample.ppt'))) : source;
    const open = async () => {
      const presentation = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
      return { presentation, doc: edit.createDoc(presentation, { idPrefix: 'poster-' }) };
    };
    const { presentation, doc } = await open(), editor = new edit.Editor(doc), frames = [], events = [];
    editor.subscribeRecovery((frame) => frames.push(structuredClone(frame)));
    editor.subscribePatches((event) => events.push(structuredClone(event)));
    try {
      const api = media.createMediaEditor(editor);
      const id = api.exec({ type: 'AddMedia', slideId: doc.slideOrder[0],
        rect: { x: 20, y: 30, w: 80, h: 80 }, source: sample,
        ...(name.endsWith('video') ? { poster: { bytes: makePng(8, 8, () => [40, 80, 120]), mime: 'image/png' } } : {}),
      });
      const before = editor.effectiveElement(id), poster = makePng(16, 12, () => [10, 170, 90]);
      const replacement = { type: 'ReplaceMediaPoster', id, poster: { bytes: poster, mime: 'image/png' } };
      api.exec(replacement);
      assert.deepEqual(editor.effectiveElement(id).media, before.media, '换海报不改音视频源');
      assert.notEqual(editor.effectiveElement(id).src, before.src);
      const history = editor.history.undoCount;
      api.exec(replacement); assert.equal(editor.history.undoCount, history, '重复海报字节不制造历史');
      editor.undo(); assert.equal(editor.effectiveElement(id).src, before.src); editor.redo();
      if (mode !== 'legacy') editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [id]),
        at: { parentId: doc.slideOrder[0], x: 400, y: 200 } });
      else assert.throws(() => edit.copyElements(doc, [id]), /OOXML 来源/, '无原包复制沿用当前公开边界');
      const copy = mode === 'legacy' ? id : editor.selection.ids[0];
      assert.equal(editor.effectiveElement(copy).src, editor.effectiveElement(id).src, '副本采用有效海报');
      const resourceHash = doc.elements[id].meta.imageReplacement.resourceHash;
      assert.throws(() => editor.applyExternalPatches([
        { op: 'del', path: ['imageResources', resourceHash], origin: 'invalid-remote' },
      ]), /资源身份|资源不存在/, '远端不能删除仍被海报引用的资源');
      for (const replay of ['recovery', 'external']) {
        const peer = await open(), remote = new edit.Editor(peer.doc, replay === 'recovery' ? { recoveryFrames: frames } : {});
        try {
          if (replay === 'external') for (const [index, frame] of events.entries()) {
            try { remote.applyExternalPatches(frame.patches); }
            catch (cause) { throw new Error(`${name}/${mode} 外部重放第 ${index} 帧：${JSON.stringify(frame)}`, { cause }); }
          }
          assert.equal(remote.effectiveElement(copy).src, editor.effectiveElement(copy).src);
          if (mode === 'generated') peer.presentation.dispose();
          const recovered = await core.parse(await remote.save(), { keepPackage: true, lazy: false });
          try { for (const item of recovered.slides[0].elements.filter((el) => el.media)) {
            assert.deepEqual(recovered.package.assets[item.src].bytes, poster, `${replay} 保存恢复有效海报`);
          } } finally { recovered.dispose(); }
        } finally { remote.dispose(); edit.disposeDoc(peer.doc); }
      }
      if (mode === 'generated') presentation.dispose();
      const saved = await editor.save();
      writeFileSync(join(out, `poster-${name}-${mode}.pptx`), saved);
      const reopened = await core.parse(saved, { keepPackage: true, lazy: false });
      try { for (const item of reopened.slides[0].elements.filter((el) => el.media)) {
        assert.deepEqual(reopened.package.assets[item.src].bytes, poster);
        if (sample.kind === 'embedded') assert.deepEqual(reopened.package.assets[item.media.src].bytes, sample.bytes);
        else assert.deepEqual(item.media, { kind: sample.mediaKind, src: sample.url, external: true });
      } } finally { reopened.dispose(); }
    } finally { editor.dispose(); edit.disposeDoc(doc); }
  }
}
