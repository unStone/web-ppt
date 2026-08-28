import type { MediaInfo } from '@web-ppt/core';
import { base64ToBytes, bytesToBase64, sha256 } from '../clipboard-binary';
import { relativeTarget } from '../clipboard-source';
import { validateStoredImageFormat } from '../commands/image-format';
import { createImageResource } from '../commands/image-resource';
import { sessionAsset } from '../session-assets';
import type {
  EditDoc, ElementInsertionRelationship, ElementInsertionResource, ElementInsertionSource,
  ElementRecord,
} from '../types';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { customGeometryMarkup } from './custom-geometry';

const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MEDIA_EXTENSION: Readonly<Record<string, string>> = {
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

type ImageSource = { readonly src: string; readonly name?: string; readonly id?: number };
export interface GeneratedImageClosure {
  readonly relationship: ElementInsertionRelationship;
  readonly resource: ElementInsertionResource | null;
}

function imageResource(
  doc: EditDoc,
  source: ImageSource,
): Omit<ElementInsertionResource, 'targetPart' | 'created'> | null {
  if (source.src.startsWith('web-ppt-resource:')) {
    const resource = doc.imageResources[source.src.slice('web-ppt-resource:'.length)];
    if (!resource) throw new Error(`图片 ${source.name ?? source.id ?? ''} 缺少会话资源`);
    return {
      hash: resource.hash, mime: resource.mime,
      extension: resource.extension, bytes: resource.bytes,
    };
  }
  const asset = sessionAsset(doc, source.src);
  if (asset) return createImageResource(asset.bytes, asset.mime, '生成图片');
  const data = /^data:([^;,]+)((?:;[^,]*)?),(.*)$/is.exec(source.src);
  if (data) {
    const bytes = /;base64/i.test(data[2])
      ? base64ToBytes(data[3])
      : new TextEncoder().encode(decodeURIComponent(data[3]));
    if (data[1] === 'image/svg+xml') {
      validateStoredImageFormat(bytes, data[1], 'svg', '生成图片', true);
      return {
        hash: sha256(bytes), mime: data[1], extension: 'svg', bytes: bytesToBase64(bytes),
      };
    }
    return createImageResource(bytes, data[1], '生成图片');
  }
  if (/^https?:\/\//i.test(source.src)) return null;
  throw new Error(`图片 ${source.name ?? source.id ?? ''} 缺少可生成的资源字节`);
}

export function imageClosure(
  doc: EditDoc,
  source: ImageSource,
  relationshipId: string,
  part: string,
): GeneratedImageClosure {
  const compact = imageResource(doc, source);
  const resource = compact ? {
    ...compact,
    targetPart: `ppt/media/web-ppt-${compact.hash}.${compact.extension}`,
    created: true,
  } : null;
  return {
    resource,
    relationship: {
      sourceId: relationshipId, targetId: relationshipId, type: IMAGE_REL,
      target: resource ? relativeTarget(part, resource.targetPart) : source.src,
      ...(resource ? {} : { targetMode: 'External' as const }),
    },
  };
}

function mediaClosure(
  doc: EditDoc,
  source: MediaInfo,
  relationshipId: string,
  part: string,
): { relationship?: ElementInsertionRelationship; resource?: ElementInsertionResource } {
  if (!source.src) return {};
  const asset = sessionAsset(doc, source.src);
  const data = /^data:([^;,]+);base64,(.*)$/is.exec(source.src);
  const bytes = asset?.bytes ?? (data ? base64ToBytes(data[2]) : null);
  const mime = asset?.mime ?? data?.[1] ?? source.mime
    ?? (source.kind === 'audio' ? 'audio/mpeg' : 'video/mp4');
  const type = `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${source.kind}`;
  if (!bytes) {
    if (!source.external && !/^https?:\/\//i.test(source.src)) {
      throw new Error(`媒体 ${source.src} 缺少可生成的资源字节`);
    }
    return { relationship: {
      sourceId: relationshipId, targetId: relationshipId, type,
      target: source.src, targetMode: 'External',
    } };
  }
  const hash = sha256(bytes);
  const extension = MEDIA_EXTENSION[mime] ?? (source.kind === 'audio' ? 'mp3' : 'mp4');
  const resource: ElementInsertionResource = {
    hash, mime, extension, bytes: bytesToBase64(bytes), created: true,
    targetPart: `ppt/media/web-ppt-${hash}.${extension}`,
  };
  return {
    resource,
    relationship: {
      sourceId: relationshipId, targetId: relationshipId, type,
      target: relativeTarget(part, resource.targetPart),
    },
  };
}

const esc = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function imageInsertion(
  doc: EditDoc,
  record: ElementRecord,
  spid: number,
  part: string,
): ElementInsertionSource {
  const source = record.src;
  if (source.kind !== 'image') throw new Error(`元素 ${record.id} 不是图片`);
  const image = source.src ? imageClosure(doc, source, `rIdImage${spid}`, part) : null;
  const media = source.media
    ? mediaClosure(doc, source.media, `rIdMedia${spid}`, part) : null;
  const link = image?.resource ? 'embed' : 'link';
  const alpha = source.alpha === undefined ? ''
    : `<a:alphaModFix amt="${Math.round(source.alpha * 100000)}"/>`;
  const name = esc(source.name ?? `图片 ${spid}`);
  const mediaMarkup = source.media
    ? `<a:${source.media.kind}File${media?.relationship ? ` r:link="${media.relationship.targetId}"` : ''}/>`
    : '';
  const blip = image
    ? `<a:blip r:${link}="${image.relationship.targetId}">${alpha}</a:blip>` : '';
  const guides = record.meta.geom
    ? Object.entries(record.meta.geom.adj as Readonly<Record<string, number>>)
      .map(([guideName, value]) => {
        if (!Number.isSafeInteger(Math.round(value))) {
          throw new Error(`图片 ${record.id} 的几何调整值无效`);
        }
        return `<a:gd name="${esc(guideName)}" fmla="val ${Math.round(value)}"/>`;
      }).join('')
    : '';
  const geometry = record.meta.geom
    ? `<a:prstGeom prst="${esc(record.meta.geom.preset)}"><a:avLst>${guides}</a:avLst></a:prstGeom>`
    : source.clipPath
      ? customGeometryMarkup(source.clipPath, source.w, source.h, false)
      : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  const relationships = [image?.relationship, media?.relationship]
    .filter((value): value is ElementInsertionRelationship => !!value);
  const resources = [image?.resource, media?.resource]
    .filter((value): value is ElementInsertionResource => !!value);
  return {
    markup: `<p:pic><p:nvPicPr><p:cNvPr id="${spid}" name="${name}"/><p:cNvPicPr/><p:nvPr>${mediaMarkup}</p:nvPr></p:nvPicPr>
<p:blipFill>${blip}<a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm/>${geometry}</p:spPr></p:pic>`,
    namespaces: {
      'xmlns:a': DRAWINGML_NS, 'xmlns:p': PRESENTATIONML_NS, 'xmlns:r': OFFICE_REL_NS,
    },
    spids: { [String(spid)]: spid },
    ...(relationships.length ? { relationships } : {}),
    ...(resources.length ? { resources } : {}),
  };
}
