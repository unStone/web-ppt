import { insertionResourceToken } from '../session-assets';
import { readImageMetadata } from '@web-ppt/core';
import type { Fill } from '@web-ppt/core';
import { own } from '../data-validation';
import { assertImageCrop, normalizeImageCrop } from '../image-content';
import { assertVectorFill, normalizeVectorFill } from '../shape-fill';
import type { EditDoc, SlideImageBackground } from '../types';
import { resolveRelationshipTarget } from '../clipboard-source';
import { sourceImageBackground } from '../slide-background-source';
import { createImageResource, MAX_REPLACE_IMAGE_BYTES } from './image-resource';
import {
  prepareExistingSourceClosure, prepareMediaResourceClosure, prepareTrustedSourceClosure,
} from './paste-resources';
import { normalizeSlideImageTilePlacement } from './slide-image';
import { UPLOAD_BACKGROUND_SOURCE_ID } from './slide-property';
import type {
  CommandPatches, ImageResourcePatch, SetBackgroundCommand, SetBackgroundCropCommand, SetBackgroundImageCommand,
  SetHiddenCommand, SlideBackgroundImagePatch, SlideBackgroundPatch, SlideHiddenPatch,
} from './types';

const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

function imageMetadataPatches(
  record: EditDoc['slides'][string],
  id: string,
  value: SlideImageBackground | null,
  origin: string,
): { forward: SlideBackgroundImagePatch[]; inverse: SlideBackgroundImagePatch[] } {
  const path = ['slides', id, 'backgroundImage'] as const;
  const forward: SlideBackgroundImagePatch[] = value
    ? [{ op: 'set', path, value: structuredClone(value), origin }]
    : record.backgroundImage ? [{ op: 'del', path, origin }] : [];
  if (!forward.length) return { forward: [], inverse: [] };
  const inverse: SlideBackgroundImagePatch[] = record.backgroundImage
    ? [{ op: 'set', path, value: structuredClone(record.backgroundImage), origin }]
    : [{ op: 'del', path, origin }];
  return { forward, inverse };
}

export function setBackgroundPatches(
  doc: EditDoc,
  command: SetBackgroundCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改页面背景');
  const record = doc.slides[command.id];
  if (!record) throw new Error(`找不到幻灯片：${String(command.id)}`);
  if (command.fill !== null) assertVectorFill(command.fill, 'SetBackground.fill');
  const path = ['slides', command.id, 'ovr', 'background'] as const;
  const hadOverride = own(record.ovr, 'background');
  const direct: Fill | undefined = hadOverride ? (() => {
    const fill = record.ovr.background;
    if (!fill) throw new Error(`页面 ${command.id} 的背景覆盖无效`);
    return fill;
  })() : undefined;
  if (command.fill === null) {
    const metadata = imageMetadataPatches(record, command.id, null, origin);
    if (!hadOverride && !metadata.forward.length) return { forward: [], inverse: [] };
    return {
      forward: [...(hadOverride ? [{ op: 'del' as const, path, origin }] : []), ...metadata.forward],
      inverse: [...metadata.inverse, ...(hadOverride
        ? [{ op: 'set' as const, path, value: structuredClone(direct!), origin }] : [])],
    };
  }
  const value = normalizeVectorFill(command.fill);
  const metadata = imageMetadataPatches(record, command.id, null, origin);
  // 非 null 是用户要求建立直接值；即使视觉上等于来源，也不能吞掉这次语义选择。
  if (hadOverride && !metadata.forward.length && JSON.stringify(direct) === JSON.stringify(value)) {
    return { forward: [], inverse: [] };
  }
  const forward: SlideBackgroundPatch = {
    op: 'set', path, value: structuredClone(value), origin,
  };
  const inverse: SlideBackgroundPatch = hadOverride
    ? { op: 'set', path, value: structuredClone(direct!), origin }
    : { op: 'del', path, origin };
  return {
    forward: [forward, ...metadata.forward],
    inverse: [...metadata.inverse, inverse],
  };
}

export function setBackgroundImagePatches(
  doc: EditDoc,
  command: SetBackgroundImageCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改页面背景');
  const record = doc.slides[command.id];
  if (!record) throw new Error(`找不到幻灯片：${String(command.id)}`);
  const part = record.origin?.part;
  if (!part || !doc.package) throw new Error(`幻灯片缺少可写回来源：${command.id}`);
  if (command.crop !== undefined) assertImageCrop(command.crop, 'SetBackgroundImage.crop');
  if (command.alpha !== undefined
    && (typeof command.alpha !== 'number' || !Number.isFinite(command.alpha)
      || command.alpha < 0 || command.alpha > 1)) {
    throw new Error('SetBackgroundImage.alpha 必须是 [0, 1] 内的有限数');
  }
  const placement = normalizeSlideImageTilePlacement(command.tile, 'SetBackgroundImage.tile');
  const resource = createImageResource(
    command.bytes, command.mime, 'SetBackgroundImage', MAX_REPLACE_IMAGE_BYTES,
  );
  const imageInfo = placement ? readImageMetadata(command.bytes) : null;
  if (placement && !imageInfo) throw new Error('SetBackgroundImage.bytes 缺少可用图片尺寸');
  const tile = placement && imageInfo ? {
    ...placement,
    sourceWidth: imageInfo.width * 96 / imageInfo.dpiX,
    sourceHeight: imageInfo.height * 96 / imageInfo.dpiY,
  } : undefined;
  const closure = prepareMediaResourceClosure(
    doc, part, UPLOAD_BACKGROUND_SOURCE_ID, IMAGE_REL, resource,
  );
  const backgroundMetadata: SlideImageBackground = {
    src: insertionResourceToken(resource.hash),
    relationships: closure.relationships,
    resourceHash: resource.hash,
    imageRelationshipId: closure.relationships[0].targetId,
    resourceHashes: [resource.hash],
  };
  const fill = {
    type: 'image' as const,
    src: backgroundMetadata.src,
    ...(command.crop ? { crop: normalizeImageCrop(command.crop) } : {}),
    ...(command.alpha !== undefined
      ? { alpha: Math.round(command.alpha * 100000) / 100000 } : {}),
    ...(tile ? { tile } : {}),
  };
  const same = record.backgroundImage?.resourceHash === resource.hash
    && JSON.stringify(record.ovr.background) === JSON.stringify(fill);
  if (same) return { forward: [], inverse: [] };
  const backgroundPath = ['slides', command.id, 'ovr', 'background'] as const;
  const metadataPatches = imageMetadataPatches(record, command.id, backgroundMetadata, origin);
  const hadBackground = own(record.ovr, 'background');
  const backgroundForward: SlideBackgroundPatch = {
    op: 'set', path: backgroundPath, value: fill, origin,
  };
  const backgroundInverse: SlideBackgroundPatch = hadBackground
    ? { op: 'set', path: backgroundPath, value: structuredClone(record.ovr.background!), origin }
    : { op: 'del', path: backgroundPath, origin };
  const existing = doc.imageResources[resource.hash];
  const resourceForward: ImageResourcePatch[] = existing ? [] : [{
    op: 'set', path: ['imageResources', resource.hash], value: closure.resources[0], origin,
  }];
  const resourceInverse: ImageResourcePatch[] = existing ? [] : [{
    op: 'del', path: ['imageResources', resource.hash], origin,
  }];
  return {
    forward: [...resourceForward, ...metadataPatches.forward, backgroundForward],
    inverse: [backgroundInverse, ...metadataPatches.inverse, ...resourceInverse],
  };
}

export function setBackgroundCropPatches(
  doc: EditDoc,
  command: SetBackgroundCropCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能裁剪页面背景');
  const record = doc.slides[command.id];
  if (!record) throw new Error(`找不到幻灯片：${String(command.id)}`);
  if (command.crop !== null) assertImageCrop(command.crop, 'SetBackgroundCrop.crop');
  const current = own(record.ovr, 'background') ? record.ovr.background : record.src.background;
  if (current?.type !== 'image') throw new Error(`幻灯片不是可裁剪的图片背景：${command.id}`);
  if (!record.backgroundImage) {
    const part = record.origin?.part;
    const source = sourceImageBackground(doc, record);
    if (!part || !doc.package || !source) {
      throw new Error(`幻灯片图片背景缺少可写来源：${command.id}`);
    }
    const directSource = source.part === part;
    const closure = directSource
      ? prepareExistingSourceClosure(source.package, source.closure, part)
      : prepareTrustedSourceClosure(doc, source.package, source.closure, source.part, part);
    const imageRelationship = closure.relationships.find((relationship) =>
      relationship.sourceId === source.imageRelationshipId);
    const targetPart = imageRelationship && !imageRelationship.targetMode
      ? resolveRelationshipTarget(part, imageRelationship.target) : null;
    const resource = targetPart
      ? closure.resources.find((candidate) => candidate.targetPart === targetPart) : null;
    if (!imageRelationship || imageRelationship.type !== IMAGE_REL || !resource) {
      throw new Error(`幻灯片图片背景的主图片关系不完整：${command.id}`);
    }
    const metadata: SlideImageBackground = {
      src: insertionResourceToken(resource.hash), relationships: closure.relationships,
      resourceHash: resource.hash,
      imageRelationshipId: imageRelationship.targetId,
      resourceHashes: closure.resources.map((candidate) => candidate.hash),
      sourcePart: source.part,
    };
    const value = {
      ...current,
      src: metadata.src,
      ...(command.crop === null
        ? { crop: undefined }
        : { crop: normalizeImageCrop(command.crop) }),
    };
    const path = ['slides', command.id, 'ovr', 'background'] as const;
    const metadataPatches = imageMetadataPatches(record, command.id, metadata, origin);
    const createdResources = closure.resources.filter((candidate) => !doc.imageResources[candidate.hash]);
    const resourceForward: ImageResourcePatch[] = createdResources.map((candidate) => ({
      op: 'set', path: ['imageResources', candidate.hash], value: candidate, origin,
    }));
    const resourceInverse: ImageResourcePatch[] = createdResources.map((candidate) => ({
      op: 'del', path: ['imageResources', candidate.hash], origin,
    }));
    return {
      forward: [...resourceForward, ...metadataPatches.forward, { op: 'set', path, value, origin }],
      inverse: [{ op: 'del', path, origin }, ...metadataPatches.inverse, ...resourceInverse],
    };
  }
  if (record.ovr.background?.type !== 'image') {
    throw new Error(`幻灯片图片背景覆盖无效：${command.id}`);
  }
  const value = {
    ...record.ovr.background,
    ...(command.crop === null
      ? { crop: undefined }
      : { crop: normalizeImageCrop(command.crop) }),
  };
  if (JSON.stringify(value) === JSON.stringify(record.ovr.background)) {
    return { forward: [], inverse: [] };
  }
  const path = ['slides', command.id, 'ovr', 'background'] as const;
  return {
    forward: [{ op: 'set', path, value, origin }],
    inverse: [{ op: 'set', path, value: structuredClone(record.ovr.background), origin }],
  };
}

export function setHiddenPatches(
  doc: EditDoc,
  command: SetHiddenCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改页面隐藏状态');
  const record = doc.slides[command.id];
  if (!record) throw new Error(`找不到幻灯片：${String(command.id)}`);
  if (command.v !== null && typeof command.v !== 'boolean') {
    throw new Error('SetHidden.v 必须是布尔值或 null');
  }
  const path = ['slides', command.id, 'ovr', 'hidden'] as const;
  const hadOverride = own(record.ovr, 'hidden');
  if (command.v === null) {
    if (!hadOverride) return { forward: [], inverse: [] };
    return {
      forward: [{ op: 'del', path, origin }],
      inverse: [{ op: 'set', path, value: record.ovr.hidden!, origin }],
    };
  }
  // false 同样是直接值；来源本来可见时也要保留用户明确覆盖。
  if (hadOverride && record.ovr.hidden === command.v) return { forward: [], inverse: [] };
  const forward: SlideHiddenPatch = { op: 'set', path, value: command.v, origin };
  const inverse: SlideHiddenPatch = hadOverride
    ? { op: 'set', path, value: record.ovr.hidden!, origin }
    : { op: 'del', path, origin };
  return { forward: [forward], inverse: [inverse] };
}
