import { createMediaEditor, type AddMediaCommand, type MediaPoster } from '@web-ppt/edit-core/media';
import type { Editor, ElementId } from '@web-ppt/edit-core';
import { createMediaEditor as editorMedia } from '@web-ppt/editor/media';
import { createMediaEditor as reactMedia } from '@web-ppt/react/media';
import { createMediaEditor as vueMedia } from '@web-ppt/vue/media';

export function mediaContract(editor: Editor, command: AddMediaCommand): ElementId {
  return createMediaEditor(editor).exec(command);
}

export function mp4Contract(editor: Editor, bytes: Uint8Array, poster: MediaPoster): ElementId {
  return createMediaEditor(editor).exec({
    type: 'AddMedia', slideId: editor.doc.slideOrder[0], rect: { x: 20, y: 30, w: 320, h: 240 },
    source: { kind: 'embedded', bytes, mime: 'video/mp4' }, poster,
  });
}

export function externalContract(editor: Editor, poster: MediaPoster): ElementId {
  const command: AddMediaCommand = {
    type: 'AddMedia', slideId: editor.doc.slideOrder[0], rect: { x: 20, y: 30, w: 80, h: 80 },
    source: { kind: 'external', mediaKind: 'audio', url: 'https://example.test/audio' },
  };
  const id = editorMedia(editor).exec(command);
  reactMedia(editor).exec({ type: 'ReplaceMediaPoster', id, poster });
  return vueMedia(editor).exec({ type: 'ReplaceMediaPoster', id, poster });
}

export function videoNeedsPoster(editor: Editor, bytes: Uint8Array): void {
  // @ts-expect-error 视频不能省略海报，即使媒体采用显式外链。
  createMediaEditor(editor).exec({ type: 'AddMedia', slideId: editor.doc.slideOrder[0],
    rect: { x: 20, y: 30, w: 80, h: 80 }, source: { kind: 'external', mediaKind: 'video', url: 'https://example.test/video' } });
  // @ts-expect-error 本地视频同样要求海报。
  createMediaEditor(editor).exec({ type: 'AddMedia', slideId: editor.doc.slideOrder[0],
    rect: { x: 20, y: 30, w: 80, h: 80 }, source: { kind: 'embedded', bytes, mime: 'video/mp4' } });
}
