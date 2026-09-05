import { assertDataObject } from '../data-validation';
import { allocateElementId } from '../document';
import { elementOrder } from '../element-order';
import { fractionalIndexBetween } from '../fractional-index';
import { insertionResourceToken } from '../session-assets';
import type { EditDoc, ElementInsertionSource, ElementRecord } from '../types';
import type { CommandPatches, ExtensionCommand } from '../commands/types';
import { assertInsertionRect } from '../commands/insertion-rect';
import { resolveInsertionCanvas } from '../commands/insertion-host';
import { prepareInsertionClosures } from '../commands/paste-resources';
import { allocateElementSpid } from '../commands/spid';
import { prepareMediaSource } from './source';
import { prepareMediaPoster } from './poster';
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
  const media = prepareMediaSource(command.source), { kind } = media;
  const poster = prepareMediaPoster(command.poster, kind);
  const resources = [poster, ...(media.resource ? [media.resource] : [])];
  const id = allocateElementId(doc);
  const part = canvas.part;
  const spid = part ? allocateElementSpid(doc, part) : undefined;
  let insertion: ElementInsertionSource | undefined;
  if (part && spid !== undefined) {
    const markup = mediaMarkup(spid, command.rect, kind, !media.resource);
    const target = media.resource ? { resourceHash: media.resource.hash }
      : { target: media.url, targetMode: 'External' as const };
    const root = { markup, namespaces: MEDIA_NAMESPACES, hostSpids: [String(spid)], relationships: [
      { sourceId: 'rIdPoster', type: `${OFFICE_REL}/image`, resourceHash: poster.hash },
      { sourceId: 'rIdSource', type: `${OFFICE_REL}/${kind}`, ...target },
      { sourceId: 'rIdMedia', type: MEDIA_REL, ...target },
    ] };
    const closure = prepareInsertionClosures(doc, { ooxml: { roots: { media: root } }, resources },
      ['media'], part, { preverifiedResourceHashes: new Set(resources.map((resource) => resource.hash)) }).get('media')!;
    insertion = { markup, namespaces: MEDIA_NAMESPACES, spids: { [String(spid)]: spid }, ...closure };
  }
  const source = (resource: typeof poster): string => insertion ? insertionResourceToken(resource.hash)
    : `data:${resource.mime};base64,${resource.bytes}`;
  const siblings = canvas.children;
  const previous = siblings.length ? elementOrder(doc.elements[siblings[siblings.length - 1]]) : null;
  const record: ElementRecord = {
    id, parent: canvas.id, z: fractionalIndexBetween(previous, null, id), ovr: {},
    src: { kind: 'image', ...(spid === undefined ? {} : { id: spid }), name: kind === 'audio' ? '音频' : '视频', ...command.rect,
      rot: 0, flipH: false, flipV: false, src: source(poster), crop: null, stroke: null,
      media: media.resource ? { kind, src: source(media.resource), mime: media.resource.mime }
        : { kind, src: media.url, external: true } },
    meta: { editable: 'frame', created: true, ...(part && spid !== undefined ? { origin: { part, spid }, insertion } : {}) },
  };
  const value = { root: record.id, parent: canvas.id, records: { [record.id]: record } };
  return {
    selection: { kind: 'elements', ids: [id], enteredGroup: null },
    forward: [{ op: 'insert', path: ['elements', record.id], value, origin }],
    inverse: [{ op: 'remove', path: ['elements', record.id], value, origin }],
  };
}
