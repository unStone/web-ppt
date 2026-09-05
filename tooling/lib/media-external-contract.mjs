import { makePng } from './ooxml.mjs';
import { unzipSync, strFromU8 } from 'fflate';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function runExternalMediaContract({ core, edit, media, source, assert, out }) {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = () => { requests++; throw new Error('编辑与保存不能抓取外链'); };
  try { for (const kind of ['audio', 'video']) for (const generated of [false, true]) {
    const presentation = await core.parse(source, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(presentation, { idPrefix: 'external-media-' }), editor = new edit.Editor(doc);
    const url = 'https://media.example.test/clip?name=a%26b&part=1#t=0.1';
    const frames = [];
    editor.subscribeRecovery((frame) => frames.push(structuredClone(frame)));
    const command = (url) => ({
      type: 'AddMedia', slideId: doc.slideOrder[0], rect: { x: 20, y: 30, w: 320, h: 240 },
      source: { kind: 'external', mediaKind: kind, url },
      ...(kind === 'video' ? { poster: { bytes: makePng(8, 8, () => [40, 80, 120]), mime: 'image/png' } } : {}),
    });
    try {
      const identity = structuredClone(doc.identity), history = editor.history.undoCount;
      for (const invalid of ['javascript:alert(1)', 'data:video/mp4;base64,AA==', 'file:///private/clip.mp4',
        'blob:https://example.test/id', '//example.test/video', '/video.mp4', 'https://',
        'http:example.test/video', ' https://example.test/video', 'https://example.test/\nvideo',
        'https://example.test\\video', 'https://user:secret@example.test/video', 'https://example.test/' + 'a'.repeat(8192), 123]) {
        assert.throws(() => media.createMediaEditor(editor).exec(command(invalid)), /外链/);
        assert.deepEqual(doc.identity, identity, '非法外链不消耗身份');
        assert.equal(editor.history.undoCount, history, '非法外链不污染历史');
      }
      const id = media.createMediaEditor(editor).exec(command(url));
      assert.deepEqual(editor.effectiveElement(id).media, { kind, src: url, external: true });
      assert.deepEqual(editor.selection.ids, [id]);
      editor.undo(); assert.equal(doc.elements[id], undefined);
      editor.redo();
      editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [id]),
        at: { parentId: doc.slideOrder[0], x: 400, y: 200 } });
      const copy = editor.selection.ids[0];
      assert.notEqual(copy, id);
      editor.exec({ type: 'RemoveElement', id: copy }); editor.undo();
      for (const mode of ['recovery', 'external']) {
        const remoteSource = await core.parse(source, { edit: true, keepPackage: true, lazy: false });
        const remoteDoc = edit.createDoc(remoteSource, { idPrefix: 'external-media-' });
        const remote = new edit.Editor(remoteDoc, mode === 'recovery' ? { recoveryFrames: frames } : {});
        try {
          if (mode === 'external') for (const frame of frames) remote.applyExternalPatches(frame.patches);
          assert.deepEqual(remote.effectiveElement(copy).media, { kind, src: url, external: true });
          if (generated) remoteSource.dispose();
          const reopened = await core.parse(await remote.save(), { lazy: false });
          try { assert.equal(reopened.slides[0].elements.filter((el) => el.media?.external).length, 2); }
          finally { reopened.dispose(); }
        } finally { remote.dispose(); edit.disposeDoc(remoteDoc); }
      }
      if (generated) presentation.dispose();
      const saved = await editor.save(), parts = unzipSync(saved);
      writeFileSync(join(out, `external-${kind}-${generated ? 'generated' : 'patched'}.pptx`), saved);
      const xml = strFromU8(parts['ppt/slides/slide1.xml']);
      const rels = strFromU8(parts['ppt/slides/_rels/slide1.xml.rels']);
      assert.ok(xml.includes('<p14:media r:link='), '外链不能写成嵌入媒体');
      assert.equal((rels.match(/TargetMode="External"/g) ?? []).length, 4, '原件与副本的经典和 p14 关系均为外部来源');
      assert.equal(Object.keys(parts).filter((path) => /\.(mp4|wav)$/.test(path)).length, 0);
      const reopened = await core.parse(saved, { lazy: false });
      try {
        const linked = reopened.slides[0].elements.filter((el) => el.media);
        assert.equal(linked.length, 2);
        for (const element of linked) assert.deepEqual(element.media,
          { kind, src: url, external: true }, '离线重开仍明确标识外链');
      } finally { reopened.dispose(); }
    } finally { editor.dispose(); edit.disposeDoc(doc); }
  } } finally { globalThis.fetch = originalFetch; }
  assert.equal(requests, 0, '外链插入、复制、恢复与保存不发送网络请求');
}
