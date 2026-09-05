import { assertDataObject } from '../data-validation';
import type { ClipboardResource } from '../commands/types';
import type { AddMediaCommand } from './types';
import { createMediaResource } from './resource';

type PreparedMedia = { readonly kind: 'audio' | 'video' } & (
  { readonly resource: ClipboardResource; readonly url?: never }
  | { readonly resource: null; readonly url: string }
);

/** 外链没有可验证字节；只保留显式来源，不能按 URL 后缀假装验证过 MIME。 */
export function prepareMediaSource(source: AddMediaCommand['source']): PreparedMedia {
  assertDataObject(source, ['kind', 'bytes', 'mime', 'mediaKind', 'url'], 'AddMedia.source');
  if (source.kind === 'embedded') {
    assertDataObject(source, ['kind', 'bytes', 'mime'], 'AddMedia.source');
    const resource = createMediaResource(source.bytes, source.mime);
    return { kind: resource.mime === 'video/mp4' ? 'video' : 'audio', resource };
  }
  assertDataObject(source, ['kind', 'mediaKind', 'url'], 'AddMedia.source');
  if (source.kind !== 'external' || !['audio', 'video'].includes(source.mediaKind)) throw new Error('媒体来源无效');
  const value = source.url;
  if (typeof value !== 'string' || value.length > 8192 || value !== value.trim()
    || !/^https?:\/\//i.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)) throw new Error('媒体外链 URL 无效');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('媒体外链 URL 无效'); }
  if (!url.hostname || url.username || url.password) throw new Error('媒体外链不能包含凭据或缺少主机');
  return { kind: source.mediaKind, resource: null, url: url.href };
}
