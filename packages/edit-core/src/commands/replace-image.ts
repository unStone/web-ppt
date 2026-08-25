import { insertionResourceToken } from '../session-assets';
import type { ImageElement } from '@web-ppt/core';
import { sha256 } from '../clipboard-binary';
import { resolveRelationshipTarget } from '../clipboard-source';
import { isEditablePicture } from '../image-content';
import type { EditDoc, ElementImageReplacement } from '../types';
import { prepareMediaResourceClosure } from './paste-resources';
import type { CommandPatches, ElementImageReplacementPatch, ImageResourcePatch, ReplaceImageCommand } from './types';
import { createImageResource, MAX_REPLACE_IMAGE_BYTES } from './image-resource';

const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const SOURCE_RID = 'rIdImageReplacement';

function insertionImageResource(
  record: EditDoc['elements'][string] & { src: ImageElement },
) {
  return record.meta.insertion?.resources?.find((resource) =>
    record.src.src === `web-ppt-resource:${resource.hash}`
      || record.src.src === `data:${resource.mime};base64,${resource.bytes}`);
}

function sourceImageHash(
  doc: EditDoc,
  record: EditDoc['elements'][string] & { src: ImageElement },
): string | null {
  const { src } = record.src;
  if (src.startsWith('web-ppt-resource:')) return src.slice('web-ppt-resource:'.length);
  const inserted = insertionImageResource(record);
  if (inserted) return inserted.hash;
  const asset = doc.package?.assets?.[src];
  return asset ? sha256(asset.bytes) : null;
}

function insertionImageRelationshipId(
  record: EditDoc['elements'][string] & { src: ImageElement },
): string | undefined {
  if (!record.meta.insertion || !record.meta.origin) return undefined;
  const targetPart = insertionImageResource(record)?.targetPart;
  if (!targetPart) return undefined;
  return record.meta.insertion.relationships?.find((relationship) =>
    relationship.type === IMAGE_REL
      && resolveRelationshipTarget(record.meta.origin!.part, relationship.target) === targetPart)?.targetId;
}

export function replaceImagePatches(
  doc: EditDoc,
  command: ReplaceImageCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能替换图片');
  const record = doc.elements[command.id];
  if (!record) throw new Error(`找不到元素：${command.id}`);
  if (record.src.kind !== 'image' || !isEditablePicture(record.src)
    || record.meta.editable !== 'full') {
    throw new Error(`元素不支持图片替换：${command.id}`);
  }
  if (record.meta.locked) throw new Error(`元素已锁定：${command.id}`);
  const part = record.meta.origin?.part;
  if (!part || !doc.package) throw new Error(`图片缺少可写回来源：${command.id}`);
  const resource = createImageResource(
    command.bytes, command.mime, 'ReplaceImage', MAX_REPLACE_IMAGE_BYTES,
  );
  const currentHash = record.meta.imageReplacement?.resourceHash
    ?? sourceImageHash(doc, record as typeof record & { src: ImageElement });
  if (currentHash === resource.hash) return { forward: [], inverse: [] };
  const closure = prepareMediaResourceClosure(doc, part, SOURCE_RID, IMAGE_REL, resource);
  const suppressedRelationshipId = record.meta.imageReplacement?.suppressedRelationshipId
    ?? insertionImageRelationshipId(record as typeof record & { src: ImageElement });
  const value: ElementImageReplacement = {
    src: insertionResourceToken(resource.hash),
    relationships: closure.relationships,
    resourceHash: resource.hash,
    ...(suppressedRelationshipId ? { suppressedRelationshipId } : {}),
  };
  const path = ['elements', command.id, 'meta', 'imageReplacement'] as const;
  const forward: ElementImageReplacementPatch = {
    op: 'set', path, value: structuredClone(value), origin,
  };
  const inverse: ElementImageReplacementPatch = record.meta.imageReplacement
    ? { op: 'set', path, value: structuredClone(record.meta.imageReplacement), origin }
    : { op: 'del', path, origin };
  const existing = doc.imageResources[resource.hash];
  const resourceForward: ImageResourcePatch[] = existing ? [] : [{
    op: 'set', path: ['imageResources', resource.hash], value: closure.resources[0], origin,
  }];
  const resourceInverse: ImageResourcePatch[] = existing ? [] : [{
    op: 'del', path: ['imageResources', resource.hash], origin,
  }];
  return {
    forward: [...resourceForward, forward],
    inverse: [inverse, ...resourceInverse],
  };
}
