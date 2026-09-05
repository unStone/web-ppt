import { makeMp4 } from './media-mp4-fixture.mjs';
import { makePng } from './ooxml.mjs';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { runMp4Boundaries } from './media-mp4-boundaries.mjs';
import { makeRepeatedSampleMp4, makeZeroDurationMp4 } from './media-mp4-reference-fixture.mjs';

export async function runMp4InsertionContract({ core, edit, media, source, assert, root, out }) {
  const presentation = await core.parse(source, { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(presentation), editor = new edit.Editor(doc);
  const bytes = makeMp4();
  const command = (bytes) => ({
    type: 'AddMedia', slideId: doc.slideOrder[0], rect: { x: 20, y: 30, w: 320, h: 240 },
    source: { kind: 'embedded', bytes, mime: 'video/mp4' },
    poster: { bytes: makePng(8, 8, () => [40, 80, 120]), mime: 'image/png' },
  });
  try {
    const repeated = makeRepeatedSampleMp4();
    const started = performance.now();
    media.createMediaEditor(editor).exec(command(repeated));
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 500, `24 万字节重复分片引用不能按 4 亿个声明样本循环（${elapsed.toFixed(1)}ms）`);
    editor.undo();
    for (const fragmented of [false, true]) {
      const zero = makeZeroDurationMp4(fragmented);
      const id = media.createMediaEditor(editor).exec(command(zero));
      assert.equal(editor.effectiveElement(id).media.kind, 'video', '合法零时长样本不能被误拒绝');
      editor.undo();
    }
    runMp4Boundaries({ editor, media, command, assert });
    const external = bytes.slice();
    const url = Buffer.from(external).indexOf('url ');
    assert.ok(url > 0, '真实 MP4 固件含自包含数据引用');
    external[url + 7] = 0;
    assert.throws(() => media.createMediaEditor(editor).exec(command(external)), /MP4/, '外部数据引用不能冒充离线嵌入');
    const brokenOffset = bytes.slice();
    const stco = Buffer.from(brokenOffset).indexOf('stco');
    new DataView(brokenOffset.buffer).setUint32(stco + 12, 0);
    assert.throws(() => media.createMediaEditor(editor).exec(command(brokenOffset)), /MP4/, '采样不能指向媒体数据块外');
    const fragmentOffset = makeMp4(true);
    const trun = Buffer.from(fragmentOffset).indexOf('trun');
    new DataView(fragmentOffset.buffer).setInt32(trun + 12, -1);
    assert.throws(() => media.createMediaEditor(editor).exec(command(fragmentOffset)), /MP4/, '分片采样不能指向媒体数据块外');
    const noClock = bytes.slice();
    new DataView(noClock.buffer).setUint32(Buffer.from(noClock).indexOf('mdhd') + 16, 0);
    assert.throws(() => media.createMediaEditor(editor).exec(command(noClock)), /MP4/, '轨道必须提供有效时间基准');
    const id = media.createMediaEditor(editor).exec(command(bytes));
    assert.equal(editor.effectiveElement(id).media.kind, 'video');
    const reopened = await core.parse(await editor.save(), { keepPackage: true, lazy: false });
    try {
      const video = reopened.slides[0].elements.find((element) => element.media);
      assert.equal(video.media.mime, 'video/mp4');
      assert.deepEqual(reopened.package.assets[video.media.src].bytes, bytes, '视频保存重开保留原始码流');
    } finally { reopened.dispose(); }
    const fragmentId = media.createMediaEditor(editor).exec(command(makeMp4(true)));
    assert.equal(editor.effectiveElement(fragmentId).media.kind, 'video', '完整分片 MP4 可以嵌入');
  } finally { editor.dispose(); edit.disposeDoc(doc); }
  await runSaveJourneys({ core, edit, media, source, assert, root, out });
}

async function runSaveJourneys({ core, edit, media, source, assert, root, out }) {
  for (const fragmented of [false, true]) for (const generated of [false, true]) {
    const name = `${fragmented ? 'fmp4' : 'mp4'}-${generated ? 'generated' : 'patched'}`;
    const presentation = await core.parse(source, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(presentation, { idPrefix: 'media-' }), editor = new edit.Editor(doc);
    const bytes = makeMp4(fragmented), poster = makePng(8, 8, () => [40, 80, 120]);
    const frames = [];
    editor.subscribeRecovery((frame) => frames.push(structuredClone(frame)));
    try {
      const id = media.createMediaEditor(editor).exec({
        type: 'AddMedia', slideId: doc.slideOrder[0], rect: { x: 20, y: 30, w: 320, h: 240 },
        source: { kind: 'embedded', bytes, mime: 'video/mp4' }, poster: { bytes: poster, mime: 'image/png' },
      });
      assert.deepEqual(editor.selection.ids, [id], `${name} 插入原子选中`);
      editor.undo(); assert.equal(doc.elements[id], undefined);
      editor.redo(); assert.equal(editor.effectiveElement(id).media.kind, 'video');
      editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [id]),
        at: { parentId: doc.slideOrder[0], x: 400, y: 200 } });
      const copy = editor.selection.ids[0];
      assert.notEqual(copy, id);
      editor.exec({ type: 'RemoveElement', id: copy });
      editor.undo();
      assert.equal(editor.effectiveElement(copy).media.src, editor.effectiveElement(id).media.src);
      for (const mode of ['recovery', 'external']) {
        const remoteSource = await core.parse(source, { edit: true, keepPackage: true, lazy: false });
        const remoteDoc = edit.createDoc(remoteSource, { idPrefix: 'media-' });
        const remote = new edit.Editor(remoteDoc, mode === 'recovery' ? { recoveryFrames: frames } : {});
        try {
          if (mode === 'external') for (const frame of frames) if (frame.patches.length) remote.applyExternalPatches(frame.patches);
          assert.equal(remote.effectiveElement(copy).media.src, editor.effectiveElement(id).media.src);
          if (generated) remoteSource.dispose();
          const reopened = await core.parse(await remote.save(), { lazy: false });
          try { assert.equal(reopened.slides[0].elements.filter((el) => el.media?.kind === 'video').length, 2); }
          finally { reopened.dispose(); }
        } finally { remote.dispose(); edit.disposeDoc(remoteDoc); }
      }
      if (!generated && !process.argv.includes('--dist')) {
        const recoveryFile = `${name}-recovery.json`;
        writeFileSync(join(out, recoveryFile), JSON.stringify(frames));
        const registered = spawnSync(process.execPath, [join(root, 'tooling/lib/media-registration-contract.mjs'),
          out, join(root, 'fixtures/sample-editor-add-media.pptx'), recoveryFile], { encoding: 'utf8' });
        assert.equal(registered.status, 0, `${name} 新接收端独立注册：${registered.stderr}`);
      }
      if (generated) { presentation.dispose(); assert.equal(doc.package.disposed, true); }
      const saved = await editor.save();
      writeFileSync(join(out, `${name}.pptx`), saved);
      const parts = unzipSync(saved), paths = Object.keys(parts).filter((path) => path.endsWith('.mp4'));
      assert.equal(paths.length, 1, `${name} 原件与副本按内容去重`);
      assert.deepEqual(parts[paths[0]], bytes);
      const rels = strFromU8(parts['ppt/slides/_rels/slide1.xml.rels']);
      assert.ok(rels.includes('officeDocument/2006/relationships/video'));
      assert.ok(rels.includes('office/2007/relationships/media'));
      const reopened = await core.parse(saved, { keepPackage: true, lazy: false });
      try {
        const videos = reopened.slides[0].elements.filter((el) => el.media?.kind === 'video');
        assert.equal(videos.length, 2);
        for (const video of videos) {
          assert.deepEqual(reopened.package.assets[video.media.src].bytes, bytes);
          assert.deepEqual(reopened.package.assets[video.src].bytes, poster, `${name} 视频与海报是不同资源`);
        }
      } finally { reopened.dispose(); }
    } finally { editor.dispose(); edit.disposeDoc(doc); }
  }
}
