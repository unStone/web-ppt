import { createMediaEditor, type AddMediaCommand } from '@web-ppt/edit-core/media';
import type { Editor, ElementId } from '@web-ppt/edit-core';

export function mediaContract(editor: Editor, command: AddMediaCommand): ElementId {
  return createMediaEditor(editor).exec(command);
}

export function mp4Contract(editor: Editor, bytes: Uint8Array, poster: AddMediaCommand['poster']): ElementId {
  return createMediaEditor(editor).exec({
    type: 'AddMedia', slideId: editor.doc.slideOrder[0], rect: { x: 20, y: 30, w: 320, h: 240 },
    source: { kind: 'embedded', bytes, mime: 'video/mp4' }, poster,
  });
}
