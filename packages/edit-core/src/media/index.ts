import type { Editor } from '../editor';
import { registerEditExtension } from '../extension-runtime';
import { addMediaPatches } from './commands';
import { validateMediaResource } from './resource';
import type { AddMediaCommand } from './types';

export type { AddMediaCommand } from './types';
export { MAX_MEDIA_BYTES } from './resource';

let registered = false;

/** 接收恢复/协同数据前显式调用，避免仅副作用导入被打包器移除。 */
export function registerMediaEditing(): void {
  if (registered) return;
  registerEditExtension('media', { command: addMediaPatches, validateResource: validateMediaResource });
  registered = true;
}

/** 按需命令只产生现有结构 Patch，历史、恢复与协同仍共用主编辑器。 */
export function createMediaEditor(editor: Pick<Editor, 'doc' | 'exec'>) {
  registerMediaEditing();
  return {
    exec(command: AddMediaCommand) {
      const result = editor.exec({ type: 'Extension', namespace: 'media', id: command.slideId, payload: command });
      return result.forward.find((patch) => patch.op === 'insert' && patch.path[0] === 'elements')!.path[1];
    },
  };
}
