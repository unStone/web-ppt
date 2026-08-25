import { base64ToBytes, sha256 } from '../clipboard-binary';
import { assertDataObject } from '../data-validation';
import { assertImageCrop, isEditablePicture } from '../image-content';
import type { EditDoc, ElementImageReplacement, ElementInsertionResource } from '../types';
import {
  packageContentType, packageContentTypeOverride, resolveRelationshipTarget,
} from '../clipboard-source';
import type { ElementCropPatch, ElementImageReplacementPatch, ImageResourcePatch, Patch } from './types';
import { validateStoredImageFormat } from './image-format';

const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
interface ValidatedResource {
  readonly targetPart: string;
  readonly hash: string;
  readonly mime: string;
  readonly extension: string;
  readonly bytes: string;
  readonly created: boolean;
  readonly packageSource: boolean;
}
const validatedResources = new WeakMap<object, ValidatedResource>();

/** OPC 信任必须落到精确目标 part；只认相同字节会允许远端 Patch 覆写别的媒体。 */
function assertResourceTargetState(
  doc: EditDoc | undefined,
  resource: ElementInsertionResource,
  label: string,
): boolean {
  const pkg = doc?.package;
  const extension = resource.targetPart.slice(resource.targetPart.lastIndexOf('.') + 1).toLowerCase();
  if (extension !== resource.extension.toLowerCase()) {
    throw new Error(`${label} 的目标 part 后缀与声明格式不一致`);
  }
  if (!pkg) {
    if (!resource.created) throw new Error(`${label} 声明复用 OPC，但文档没有可写包`);
    return false;
  }
  const override = packageContentTypeOverride(pkg, resource.targetPart);
  if (override && override !== resource.mime) {
    throw new Error(`${label} 与目标 OPC Content-Type Override 冲突`);
  }
  const bytes = pkg.parts[resource.targetPart];
  if (!bytes) {
    if (!resource.created) throw new Error(`${label} 的 OPC 目标不存在`);
    return false;
  }
  let mime = '';
  try { mime = packageContentType(pkg, resource.targetPart, extension); } catch {
    throw new Error(`${label} 的 OPC Content-Type 无效`);
  }
  if (extension !== resource.extension.toLowerCase() || mime !== resource.mime
    || sha256(bytes) !== resource.hash) {
    throw new Error(`${label} 与目标 OPC part 的字节或类型不一致`);
  }
  if (resource.created && !doc?.saveState.createdParts.includes(resource.targetPart)) {
    throw new Error(`${label} 不能以新资源身份覆写已有 OPC part`);
  }
  return true;
}

function assertTarget(doc: EditDoc, id: string, index: number): void {
  const record = doc.elements[id];
  if (!record) throw new Error(`Patch 指向不存在的元素：${id}`);
  if (record.src.kind !== 'image' || !isEditablePicture(record.src)
    || record.meta.editable !== 'full') {
    throw new Error(`Patch ${index} 指向不支持图片内容编辑的元素`);
  }
}

export function assertImageReplacement(
  value: unknown,
  sourcePart: string,
  resources: Readonly<Record<string, ElementInsertionResource>>,
  label: string,
): asserts value is ElementImageReplacement {
  assertDataObject(value, ['src', 'relationships', 'resourceHash', 'suppressedRelationshipId'], label);
  const replacement = value as ElementImageReplacement;
  if (!Array.isArray(replacement.relationships) || replacement.relationships.length !== 1) {
    throw new Error(`${label} 必须包含一条图片关系`);
  }
  assertDataObject(replacement.relationships[0], ['sourceId', 'targetId', 'type', 'target', 'targetMode'], `${label}.relationships[0]`);
  const relationship = replacement.relationships[0] as ElementImageReplacement['relationships'][number];
  const resource = resources[replacement.resourceHash];
  if (!relationship.sourceId || !/^rId\d+$/.test(relationship.targetId)
    || relationship.type !== IMAGE_REL || !relationship.target || relationship.targetMode !== undefined
    || !/^[0-9a-f]{64}$/.test(replacement.resourceHash) || !resource
    || !resource.mime.startsWith('image/')
    || resolveRelationshipTarget(sourcePart, relationship.target) !== resource.targetPart
    || replacement.src !== `web-ppt-resource:${resource.hash}`) {
    throw new Error(`${label} 的关系或资源身份无效`);
  }
  if (replacement.suppressedRelationshipId !== undefined
    && (!/^rId\d+$/.test(replacement.suppressedRelationshipId)
      || replacement.suppressedRelationshipId === relationship.targetId)) {
    throw new Error(`${label} 的被替换关系身份无效`);
  }
}

export function assertImageResource(
  value: unknown,
  label: string,
  doc?: EditDoc,
): asserts value is ElementInsertionResource {
  assertDataObject(value, ['targetPart', 'hash', 'mime', 'extension', 'bytes', 'created'], label);
  const resource = value as ElementInsertionResource;
  if (!/^ppt\/media\/[A-Za-z0-9_.-]+$/.test(resource.targetPart)
    || !/^[0-9a-f]{64}$/.test(resource.hash)
    || typeof resource.mime !== 'string' || !resource.mime
    || typeof resource.extension !== 'string' || !/^[a-z0-9]+$/.test(resource.extension)
    || typeof resource.bytes !== 'string' || typeof resource.created !== 'boolean') {
    throw new Error(`${label} 的媒体身份无效`);
  }
  const packageBound = assertResourceTargetState(doc, resource, label);
  const cached = validatedResources.get(resource);
  if (cached?.targetPart === resource.targetPart && cached.hash === resource.hash
    && cached.mime === resource.mime && cached.extension === resource.extension
    && cached.bytes === resource.bytes && cached.created === resource.created) {
    if (!cached.packageSource || packageBound) return;
    throw new Error(`${label} 的扩展媒体格式不是当前文档的 OPC 来源`);
  }
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(resource.bytes); } catch { throw new Error(`${label} 不是有效 Base64`); }
  if (sha256(bytes) !== resource.hash) throw new Error(`${label} 的哈希不匹配`);
  let packageSource = false;
  if (resource.mime.startsWith('image/')) {
    try {
      validateStoredImageFormat(bytes, resource.mime, resource.extension, label, false);
    } catch (uploadError) {
      if (!packageBound || resource.created) throw uploadError;
      packageSource = validateStoredImageFormat(
        bytes, resource.mime, resource.extension, label, true,
      );
    }
  } else {
    if (!packageBound || resource.created) {
      throw new Error(`${label} 的非图片媒体不是当前文档的 OPC 来源`);
    }
    packageSource = true;
  }
  validatedResources.set(resource, {
    targetPart: resource.targetPart, hash: resource.hash, mime: resource.mime,
    extension: resource.extension, bytes: resource.bytes, created: resource.created, packageSource,
  });
}

/** 无来源溯源的背景只能是公开上传白名单，不能把包内扩展格式伪装成上传。 */
export function assertUploadImageResource(resource: ElementInsertionResource, label: string): void {
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(resource.bytes); } catch { throw new Error(`${label} 不是有效 Base64`); }
  validateStoredImageFormat(bytes, resource.mime, resource.extension, label, false);
}

/** 一批远端资源不能把不同字节分配给同一目标；相同内容复用同一 part 是合法去重。 */
export function assertImageResourceTargets(
  doc: EditDoc,
  resources: Readonly<Record<string, ElementInsertionResource>>,
): void {
  const targets = new Map<string, ElementInsertionResource>();
  const claim = (resource: ElementInsertionResource): void => {
    const previous = targets.get(resource.targetPart);
    if (previous && (previous.hash !== resource.hash || previous.mime !== resource.mime
      || previous.extension !== resource.extension || previous.bytes !== resource.bytes)) {
      throw new Error(`多个媒体资源争用目标 part：${resource.targetPart}`);
    }
    targets.set(resource.targetPart, resource);
  };
  for (const record of Object.values(doc.elements)) {
    for (const resource of record.meta.insertion?.resources ?? []) {
      assertImageResource(resource, `元素 ${record.id} 的内嵌媒体资源`, doc);
      claim(resource);
    }
  }
  for (const resource of Object.values(resources)) claim(resource);
}

function cloneValidatedImageResource(resource: ElementInsertionResource): ElementInsertionResource {
  const clone = structuredClone(resource);
  const cached = validatedResources.get(resource);
  if (cached) validatedResources.set(clone, { ...cached, bytes: clone.bytes });
  return clone;
}

export function isElementCropPatch(patch: Patch): patch is ElementCropPatch {
  return patch.path.length === 4 && patch.path[0] === 'elements'
    && patch.path[2] === 'ovr' && patch.path[3] === 'crop';
}

export function isElementImageReplacementPatch(patch: Patch): patch is ElementImageReplacementPatch {
  return patch.path.length === 4 && patch.path[0] === 'elements'
    && patch.path[2] === 'meta' && patch.path[3] === 'imageReplacement';
}

export function isImageResourcePatch(patch: Patch): patch is ImageResourcePatch {
  return patch.path.length === 2 && patch.path[0] === 'imageResources';
}

export function validateElementCropPatch(doc: EditDoc, patch: ElementCropPatch, index: number): void {
  assertTarget(doc, patch.path[1], index);
  if (patch.op === 'set') assertImageCrop(patch.value, `Patch ${index} 的 crop`);
}

export function validateElementImageReplacementPatch(
  doc: EditDoc,
  patch: ElementImageReplacementPatch,
  index: number,
  resources: Readonly<Record<string, ElementInsertionResource>> = doc.imageResources,
): void {
  assertTarget(doc, patch.path[1], index);
  if (patch.op !== 'set') return;
  const part = doc.elements[patch.path[1]].meta.origin?.part;
  if (!part) throw new Error(`Patch ${index} 的图片缺少来源 part`);
  assertImageReplacement(patch.value, part, resources, `Patch ${index} 的 imageReplacement`);
}

export function validateImageResourcePatch(doc: EditDoc, patch: ImageResourcePatch, index: number): void {
  if (!/^[0-9a-f]{64}$/.test(patch.path[1])) throw new Error(`Patch ${index} 的图片资源路径无效`);
  if (patch.op === 'set') {
    assertImageResource(patch.value, `Patch ${index} 的图片资源`, doc);
    if (patch.value.hash !== patch.path[1]) throw new Error(`Patch ${index} 的图片资源 key 与哈希不一致`);
  }
}

export function applyElementCropPatch(doc: EditDoc, patch: ElementCropPatch): void {
  const record = doc.elements[patch.path[1]];
  if (patch.op === 'set') record.ovr.crop = structuredClone(patch.value);
  else delete record.ovr.crop;
}

export function applyElementImageReplacementPatch(
  doc: EditDoc,
  patch: ElementImageReplacementPatch,
): void {
  const record = doc.elements[patch.path[1]];
  if (patch.op === 'set') record.meta.imageReplacement = structuredClone(patch.value);
  else delete record.meta.imageReplacement;
}

export function applyImageResourcePatch(doc: EditDoc, patch: ImageResourcePatch): void {
  if (patch.op === 'set') doc.imageResources[patch.path[1]] = cloneValidatedImageResource(patch.value);
  else delete doc.imageResources[patch.path[1]];
}
