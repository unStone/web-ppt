import nodeAssert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { makePng, makeWav } from './lib/ooxml.mjs';
import { unzipSync, strFromU8 } from 'fflate';
import { recordCount } from './lib/measured.mjs';
import { runMediaInsertionBoundaries, runMediaInsertionCollaboration } from './lib/media-insertion-boundaries.mjs';
let passed = 0;
const assert = new Proxy(nodeAssert, { get: (target, key) => (...args) => {
  const result = target[key](...args); passed++; return result;
} });

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/media-insertion');
mkdirSync(out, { recursive: true });
const aliases = [
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ['@web-ppt/edit-core/media', join(root, 'packages/edit-core/src/media/index.ts')],
  ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
];
const [core, edit, media, collab] = process.argv.includes('--dist') ? await Promise.all([
  import('@web-ppt/core'), import('@web-ppt/edit-core'), import('@web-ppt/edit-core/media'), import('@web-ppt/collab'),
]) : await Promise.all([
  bundleBrowser({ root, entry: join(root, 'packages/core/src/index.ts'), output: join(out, 'core.mjs') }),
  bundleBrowser({ root, entry: join(root, 'packages/edit-core/src/index.ts'), output: join(out, 'edit.mjs'), aliases }),
  bundleBrowser({ root, entry: join(root, 'packages/edit-core/src/media/index.ts'), output: join(out, 'media.mjs'), aliases }),
  bundleBrowser({ root, entry: join(root, 'packages/collab/src/index.ts'), output: join(out, 'collab.mjs'), aliases }),
]);
if (!process.argv.includes('--dist')) await bundleBrowser({ root,
  entry: join(root, 'tooling/lib/media-registration-consumer.mjs'), output: join(out, 'registration.mjs'), aliases });
const source = new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-add-media.pptx')));
assert.equal(typeof media.registerMediaEditing, 'function', '恢复接收端使用不会被摇树删除的显式注册');
for (const generated of [false, true]) {
  const presentation = await core.parse(source, { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(presentation, { idPrefix: 'media-' });
  const editor = new edit.Editor(doc);
  const frames = [];
  editor.subscribeRecovery((frame) => frames.push(structuredClone(frame)));
  try {
    const bytes = makeWav(0.1);
    runMediaInsertionBoundaries({ editor, media, assert });
    const id = media.createMediaEditor(editor).exec({
      type: 'AddMedia', slideId: doc.slideOrder[0], rect: { x: 20, y: 30, w: 80, h: 80 },
      source: { kind: 'embedded', bytes, mime: 'audio/wav' },
      poster: { bytes: makePng(8, 8, () => [40, 80, 120]), mime: 'image/png' },
    });
    const projection = edit.effectiveElement(doc, id);
    assert.deepEqual(editor.selection, { kind: 'elements', ids: [id], enteredGroup: null }, '新增媒体在同一事务内选中');
    assert.equal(projection.kind, 'image');
    assert.equal(projection.media.kind, 'audio');
    assert.equal(projection.media.external, undefined);
    assert.ok(projection.media.src.startsWith('data:audio/wav;base64,'));
    assert.deepEqual(Buffer.from(projection.media.src.split(',')[1], 'base64'), Buffer.from(bytes));
    assert.equal(doc.elements[id].meta.editable, 'frame', '媒体内容独立于整壳几何，不开放普通图片替换入口');
    editor.undo();
    assert.equal(doc.elements[id], undefined);
    editor.redo();
    assert.equal(edit.effectiveElement(doc, id).media.kind, 'audio');
    const identity = structuredClone(doc.identity);
    assert.throws(() => media.createMediaEditor(editor).exec({
      type: 'AddMedia', slideId: doc.slideOrder[0], rect: { x: 0, y: 0, w: 80, h: 80 },
      source: { kind: 'embedded', bytes: new Uint8Array(44), mime: 'audio/wav' },
      poster: { bytes: makePng(8, 8, () => [40, 80, 120]), mime: 'image/png' },
    }), /PCM WAV/);
    assert.deepEqual(doc.identity, identity, '失败命令不能消耗媒体身份');
    editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [id]),
      at: { parentId: doc.slideOrder[0], x: 180, y: 120 } });
    const copied = editor.selection.ids[0];
    assert.notEqual(copied, id, '副本拥有独立身份');
    assert.equal(edit.effectiveElement(doc, copied).media.src, projection.media.src, '副本包含音频字节');
    editor.exec({ type: 'RemoveElement', id: copied });
    assert.equal(doc.elements[copied], undefined);
    editor.undo();
    assert.equal(edit.effectiveElement(doc, copied).media.src, projection.media.src, '删除撤销恢复音频闭包');
    for (const mode of ['recovery', 'external']) {
      const remotePresentation = await core.parse(source, { edit: true, keepPackage: true, lazy: false });
      const remoteDoc = edit.createDoc(remotePresentation, { idPrefix: 'media-' });
      const remoteEditor = new edit.Editor(remoteDoc, mode === 'recovery' ? { recoveryFrames: frames } : {});
      try {
        if (mode === 'external') for (const frame of frames) if (frame.patches.length) {
          remoteEditor.applyExternalPatches(frame.patches);
        }
        assert.equal(edit.effectiveElement(remoteDoc, copied).media.src, projection.media.src, `${mode} 保留完整媒体源`);
        if (generated) remotePresentation.dispose();
        const parts = unzipSync(await remoteEditor.save());
        assert.equal(Object.keys(parts).filter((part) => part.endsWith('.wav')).length, 1, `${mode} 保存按字节去重`);
      } finally { remoteEditor.dispose(); remotePresentation.dispose(); }
    }
    if (generated) {
      presentation.dispose();
      assert.equal(doc.package.disposed, true, '生成路径的原包已实际释放');
    }
    const saved = await editor.saveDetailed();
    if (!generated && !process.argv.includes('--dist')) {
      writeFileSync(join(out, 'recovery.json'), JSON.stringify(frames));
      const registration = spawnSync(process.execPath, [join(root, 'tooling/lib/media-registration-contract.mjs'),
        out, join(root, 'fixtures/sample-editor-add-media.pptx')], { encoding: 'utf8' });
      assert.equal(registration.status, 0, `独立进程恢复前显式注册：${registration.stderr}`);
    }
    writeFileSync(join(out, generated ? 'generated.pptx' : 'patched.pptx'), saved.bytes);
    const parts = unzipSync(saved.bytes);
    const slide = strFromU8(parts['ppt/slides/slide1.xml']);
    const rels = strFromU8(parts['ppt/slides/_rels/slide1.xml.rels']);
    assert.ok(slide.includes('<p14:media r:embed='), '两条保存路径都写入 Office 2010 媒体扩展');
    assert.ok(rels.includes('office/2007/relationships/media'), 'p14 媒体关系使用规定的命名空间');
    const wavParts = Object.keys(parts).filter((name) => name.endsWith('.wav'));
    assert.equal(wavParts.length, 1);
    assert.deepEqual(parts[wavParts[0]], bytes, '离线文件保留音频原始字节');
    const reopened = await core.parse(saved.bytes, { edit: true, keepPackage: true, lazy: false });
    try {
      const audio = reopened.slides[0].elements.find((element) => element.media);
      assert.equal(audio.media.kind, 'audio');
      assert.equal(audio.media.mime, 'audio/wav');
      assert.equal(audio.media.external, undefined);
      assert.equal(reopened.slides[0].elements.filter((element) => element.media).length, 2, '原件与副本离线重开');
    } finally { reopened.dispose(); }
  } finally {
    editor.dispose();
    edit.disposeDoc(doc);
  }
}
await runMediaInsertionCollaboration({ core, edit, collab, media, source, assert });
const legacy = await core.parse(new Uint8Array(readFileSync(join(root, 'fixtures/sample.ppt'))), { edit: true });
const legacyDoc = edit.createDoc(legacy, { idPrefix: 'media-legacy-' });
const legacyEditor = new edit.Editor(legacyDoc);
try {
  assert.equal(legacyDoc.package, null, '传统 PPT 插入没有 OOXML 原包');
  const wav = makeWav(0.1);
  const id = media.createMediaEditor(legacyEditor).exec({
    type: 'AddMedia', slideId: legacyDoc.slideOrder[0], rect: { x: 20, y: 30, w: 80, h: 80 },
    source: { kind: 'embedded', bytes: wav, mime: 'audio/wav' },
    poster: { bytes: makePng(8, 8, () => [40, 80, 120]), mime: 'image/png' },
  });
  legacyEditor.undo(); legacyEditor.redo();
  assert.deepEqual(Buffer.from(legacyEditor.effectiveElement(id).media.src.split(',')[1], 'base64'), Buffer.from(wav));
  const parts = unzipSync(await legacyEditor.save());
  const audio = Object.keys(parts).filter((part) => part.endsWith('.wav'));
  assert.equal(audio.length, 1, '无原包来源插入仍能生成嵌入资源');
  assert.deepEqual(parts[audio[0]], wav);
} finally { legacyEditor.dispose(); legacy.dispose(); }
const strictXml = spawnSync(process.execPath, [join(root, 'tooling/test-media-dom.mjs')], { encoding: 'utf8' });
assert.equal(strictXml.status, 0, `保存产物兼容严格 XML 解析器：${strictXml.stderr}`);
if (!process.argv.includes('--dist')) recordCount('media', passed);
console.log(`媒体插入公开契约通过：${passed} 项断言`);
