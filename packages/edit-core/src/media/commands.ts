import { assertDataObject } from '../data-validation';
import { allocateElementId } from '../document';
import { elementOrder } from '../element-order';
import { fractionalIndexBetween } from '../fractional-index';
import { insertionResourceToken } from '../session-assets';
import type { EditDoc, ElementInsertionSource, ElementRecord } from '../types';
import type { CommandPatches, ExtensionCommand } from '../commands/types';
import { createImageResource } from '../commands/image-resource';
import { assertInsertionRect } from '../commands/insertion-rect';
import { resolveInsertionCanvas } from '../commands/insertion-host';
import { prepareInsertionClosures } from '../commands/paste-resources';
import { allocateElementSpid } from '../commands/spid';
import { createMediaResource } from './resource';
import { MEDIA_NAMESPACES, MEDIA_REL, OFFICE_REL, mediaMarkup } from './markup';
import type { AddMediaCommand } from './types';

export function addMediaPatches(doc: EditDoc, extension: ExtensionCommand, origin: string): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能新增媒体');
  assertDataObject(extension.payload, ['type', 'slideId', 'rect', 'source', 'poster'], '媒体命令');
  const command = extension.payload as AddMediaCommand;
  if (command.type !== 'AddMedia') throw new Error('不支持的媒体命令');
  if (extension.id !== command.slideId) throw new Error('媒体命令的画布身份不一致');
  assertInsertionRect(command.rect, 'AddMedia.rect');
  const canvas = resolveInsertionCanvas(doc, command, '新增媒体');
  assertDataObject(command.source, ['kind', 'bytes', 'mime'], 'AddMedia.source');
  if (command.source.kind !== 'embedded') throw new Error('媒体来源无效');
  assertDataObject(command.poster, ['bytes', 'mime'], 'AddMedia.poster');
  const media = createMediaResource(command.source.bytes, command.source.mime);
  const poster = createImageResource(command.poster.bytes, command.poster.mime, 'AddMedia.poster', 5 * 1024 * 1024);
  const id = allocateElementId(doc);
  const part = canvas.part;
  const spid = part ? allocateElementSpid(doc, part) : undefined;
  let insertion: ElementInsertionSource | undefined;
  if (part && spid !== undefined) {
    const markup = mediaMarkup(spid, command.rect);
    const root = { markup, namespaces: MEDIA_NAMESPACES, hostSpids: [String(spid)], relationships: [
      { sourceId: 'rIdPoster', type: `${OFFICE_REL}/image`, resourceHash: poster.hash },
      { sourceId: 'rIdAudio', type: `${OFFICE_REL}/audio`, resourceHash: media.hash },
      { sourceId: 'rIdMedia', type: MEDIA_REL, resourceHash: media.hash },
    ] };
    const closure = prepareInsertionClosures(doc, { ooxml: { roots: { media: root } }, resources: [poster, media] },
      ['media'], part, { preverifiedResourceHashes: new Set([poster.hash, media.hash]) }).get('media')!;
    insertion = { markup, namespaces: MEDIA_NAMESPACES, spids: { [String(spid)]: spid }, ...closure };
  }
  const source = (resource: typeof media): string => insertion ? insertionResourceToken(resource.hash)
    : `data:${resource.mime};base64,${resource.bytes}`;
  const siblings = canvas.children;
  const previous = siblings.length ? elementOrder(doc.elements[siblings[siblings.length - 1]]) : null;
  const record: ElementRecord = {
    id, parent: canvas.id, z: fractionalIndexBetween(previous, null, id), ovr: {},
    src: { kind: 'image', ...(spid === undefined ? {} : { id: spid }), name: '音频', ...command.rect,
      rot: 0, flipH: false, flipV: false, src: source(poster), crop: null, stroke: null,
      media: { kind: 'audio', src: source(media), mime: media.mime } },
    meta: { editable: 'frame', created: true, ...(part && spid !== undefined ? { origin: { part, spid }, insertion } : {}) },
  };
  const value = { root: record.id, parent: canvas.id, records: { [record.id]: record } };
  return {
    selection: { kind: 'elements', ids: [id], enteredGroup: null },
    forward: [{ op: 'insert', path: ['elements', record.id], value, origin }],
    inverse: [{ op: 'remove', path: ['elements', record.id], value, origin }],
  };
}
