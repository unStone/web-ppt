import { base64ToBytes } from '../clipboard-binary';
import { insertionResourceToken, sessionAsset } from '../session-assets';
import type {
  EditDoc, ElementImageReplacement, ElementInsertionResource,
} from '../types';
import type { ImageResourcePatch } from './types';
import { createImageResource, imageResourcePatches } from './image-resource';
import { prepareMediaResourceClosure } from './paste-resources';

const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
type CompactImageResource = Omit<ElementInsertionResource, 'targetPart' | 'created'> & {
  readonly sourcePart?: string;
};

export function resolveBulletImageResource(
  doc: EditDoc,
  src: string,
  label: string,
): CompactImageResource {
  const tokenHash = /^web-ppt-resource:([0-9a-f]{64})$/.exec(src)?.[1];
  const retained = tokenHash ? doc.imageResources[tokenHash] : undefined;
  if (retained) return retained;
  const asset = sessionAsset(doc, src);
  if (asset) return {
    ...createImageResource(asset.bytes, asset.mime, label),
    ...(asset.sourcePart ? { sourcePart: asset.sourcePart } : {}),
  };
  const data = /^data:([^;,]+);base64,(.*)$/is.exec(src);
  return createImageResource(
    data ? base64ToBytes(data[2]) : null, data?.[1], label,
  );
}

export function prepareBulletImageResource(
  doc: EditDoc,
  part: string,
  sourceRid: string,
  resource: CompactImageResource,
  origin: string,
): {
  readonly image: ElementImageReplacement;
  readonly resourcePatch?: ImageResourcePatch;
} {
  if (!doc.package) throw new Error('图片项目符号缺少可写回包');
  const closure = prepareMediaResourceClosure(doc, part, sourceRid, IMAGE_REL, resource);
  const image = {
    src: insertionResourceToken(resource.hash),
    relationships: closure.relationships,
    resourceHash: resource.hash,
  };
  const resourcePatch = imageResourcePatches(doc, closure.resources, origin).forward[0];
  return { image, ...(resourcePatch ? { resourcePatch } : {}) };
}
