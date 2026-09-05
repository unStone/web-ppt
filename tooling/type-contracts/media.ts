import { createMediaEditor, type AddMediaCommand } from '@web-ppt/edit-core/media';
import type { Editor, ElementId } from '@web-ppt/edit-core';

export function mediaContract(editor: Editor, command: AddMediaCommand): ElementId {
  return createMediaEditor(editor).exec(command);
}
