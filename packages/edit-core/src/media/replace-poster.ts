import type { ImageElement } from '@web-ppt/core';
import { assertDataObject } from '../data-validation';
import { canEditImageContent } from '../image-content';
import { replaceImageResourcePatches } from '../commands/replace-image';
import type { CommandPatches, ExtensionCommand } from '../commands/types';
import type { EditDoc } from '../types';
import { addMediaPatches } from './commands';
import { prepareMediaPoster } from './poster';
import type { MediaCommand } from './types';

export function mediaCommandPatches(doc: EditDoc, extension: ExtensionCommand, origin: string): CommandPatches {
  assertDataObject(extension.payload, ['type', 'id', 'slideId', 'rect', 'source', 'poster'], '媒体命令');
  const command = extension.payload as MediaCommand;
  if (command.type === 'AddMedia') return addMediaPatches(doc, extension, origin);
  assertDataObject(command, ['type', 'id', 'poster'], '海报替换命令');
  if (command.type !== 'ReplaceMediaPoster' || extension.id !== command.id) throw new Error('海报替换命令身份无效');
  if (doc.meta.readonly) throw new Error('只读编辑文档不能替换海报');
  const record = doc.elements[command.id];
  if (!record || !canEditImageContent(record, true) || !record.src.media) {
    throw new Error('海报替换必须指向可编辑的媒体对象');
  }
  if (record.meta.locked) throw new Error('已锁定的媒体不能替换海报');
  assertDataObject(command.poster, ['bytes', 'mime'], '媒体海报');
  return replaceImageResourcePatches(doc, record as typeof record & { src: ImageElement },
    prepareMediaPoster(command.poster, record.src.media.kind), origin);
}
