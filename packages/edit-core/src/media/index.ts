import type { Editor } from '../editor';
import { registerEditExtension } from '../extension-runtime';
import { mediaCommandPatches } from './replace-poster';
import { validateMediaResource } from './resource';
import type { MediaCommand } from './types';

export type { AddMediaCommand, ReplaceMediaPosterCommand, MediaCommand, MediaPoster } from './types';
export { MAX_MEDIA_BYTES } from './resource';

let registered = false;

/** 接收恢复/协同数据前显式调用，避免仅副作用导入被打包器移除。 */
export function registerMediaEditing(): void {
  if (registered) return;
  registerEditExtension('media', { command: mediaCommandPatches, validateResource: validateMediaResource });
  registered = true;
}

/** 按需命令只产生现有 Patch，历史、恢复与协同仍共用主编辑器。 */
export function createMediaEditor(editor: Pick<Editor, 'doc' | 'exec'>) {
  registerMediaEditing();
  return {
    exec(command: MediaCommand) {
      const id = command.type === 'AddMedia' ? command.slideId : command.id;
      const result = editor.exec({ type: 'Extension', namespace: 'media', id, payload: command });
      return command.type === 'AddMedia'
        ? result.forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements')!.path[1] : id;
    },
  };
}
