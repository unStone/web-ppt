import { makeWav } from './ooxml.mjs';

export async function runDefaultMediaPosterContract({ core, edit, media, source, assert }) {
  const presentation = await core.parse(source, { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(presentation), editor = new edit.Editor(doc);
  try {
    const id = media.createMediaEditor(editor).exec({
      type: 'AddMedia', slideId: doc.slideOrder[0], rect: { x: 20, y: 30, w: 80, h: 80 },
      source: { kind: 'embedded', bytes: makeWav(0.1), mime: 'audio/wav' },
    });
    const reopened = await core.parse(await editor.save(), { keepPackage: true, lazy: false });
    try {
      const audio = reopened.slides[0].elements.find((el) => el.media);
      assert.equal(audio.media.kind, 'audio');
      const poster = reopened.package.assets[audio.src];
      assert.equal(poster.mime, 'image/png', '省略海报时保存可移植 PNG 音频图标');
      const metadata = core.readImageMetadata(poster.bytes);
      assert.equal(metadata.width, 128);
      assert.equal(metadata.height, 128);
    } finally { reopened.dispose(); }
  } finally { editor.dispose(); edit.disposeDoc(doc); }
}
