import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePng } from './ooxml.mjs';

export async function runMediaPosterBoundaries({ core, edit, media, assert, root }) {
  const presentation = await core.parse(new Uint8Array(readFileSync(join(root, 'fixtures/sample-editor-media-compatible.pptx'))),
    { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(presentation), editor = new edit.Editor(doc);
  try {
    const compatible = Object.values(doc.elements).find((record) => record.src.media && record.src.editInfo?.requiresOriginal);
    const ordinary = Object.values(doc.elements).find((record) => record.src.media && !record.src.editInfo?.requiresOriginal);
    assert.ok(compatible, '兼容分支可显示媒体，但必须保留整个原宿主');
    const poster = { bytes: makePng(16, 12, () => [10, 170, 90]), mime: 'image/png' };
    const before = JSON.stringify(doc.identity), history = editor.history.undoCount;
    assert.throws(() => media.createMediaEditor(editor).exec({ type: 'ReplaceMediaPoster', id: compatible.id, poster }), /海报/);
    assert.equal(JSON.stringify(doc.identity), before);
    assert.equal(editor.history.undoCount, history);
    const frames = [];
    editor.subscribeRecovery((frame) => frames.push(structuredClone(frame)));
    media.createMediaEditor(editor).exec({ type: 'ReplaceMediaPoster', id: ordinary.id, poster });
    const replacement = frames.flatMap((frame) => frame.patches).find((patch) => patch.path[3] === 'imageReplacement');
    assert.throws(() => editor.applyExternalPatches([{ ...replacement,
      path: ['elements', compatible.id, 'meta', 'imageReplacement'] }]), /图片内容/);
    const invalid = { ...doc, elements: { ...doc.elements, [compatible.id]: { ...compatible,
      meta: { ...compatible.meta, imageReplacement: replacement.value } } } };
    assert.throws(() => edit.validateEditDoc(invalid), /图片替换/);
    assert.equal(doc.elements[compatible.id].meta.imageReplacement, undefined);
  } finally { editor.dispose(); edit.disposeDoc(doc); }
}
