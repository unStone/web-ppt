import type { ImageElement } from '@web-ppt/core';
import { insertionResourceToken } from '../session-assets';
import { allocateElementId } from '../document';
import { elementOrder } from '../element-order';
import { fractionalIndexBetween } from '../fractional-index';
import type {
  EditDoc, ElementInsertionResource, ElementInsertionSource, ElementRecord,
} from '../types';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { prepareInsertionClosures } from './paste-resources';
import { removeElementPatches } from './element-tree';
import type {
  AddImageCommand, ClipboardResource, CommandPatches, ElementClipboardPayload, ElementTreePatch,
  ImageResourcePatch,
} from './types';
import { createImageResource } from './image-resource';
import { assertInsertionRect, pxToEmu } from './insertion-rect';
import { allocateElementSpid } from './spid';
import { assertElementUnlocked } from './element-interaction';
import { incrementalInsertionPart } from './insertion-host';

const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SOURCE_RID = 'rIdImage';

function imageResource(command: AddImageCommand): ClipboardResource {
  return createImageResource(command.bytes, command.mime, 'AddImage');
}

function pictureMarkup(spid: number, name: string, rect: AddImageCommand['rect']): string {
  return `<p:pic>
<p:nvPicPr><p:cNvPr id="${spid}" name="${name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="${SOURCE_RID}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${pxToEmu(rect.x)}" y="${pxToEmu(rect.y)}"/><a:ext cx="${pxToEmu(rect.w)}" cy="${pxToEmu(rect.h)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>`;
}

function closurePayload(resource: ClipboardResource, markup: string, spid: number): ElementClipboardPayload {
  const root = 'image';
  return {
    format: 'web-ppt-elements', version: 1,
    source: { width: 1, height: 1, copyBatchId: resource.hash.slice(0, 32) },
    bounds: { left: 0, top: 0 }, roots: [root],
    records: {},
    ooxml: { roots: { [root]: {
      markup,
      namespaces: {
        'xmlns:a': DRAWINGML_NS, 'xmlns:p': PRESENTATIONML_NS, 'xmlns:r': OFFICE_REL_NS,
      },
      hostSpids: [String(spid)],
      relationships: [{ sourceId: SOURCE_RID, type: IMAGE_REL, resourceHash: resource.hash }],
    } } },
    resources: [resource],
  };
}

function sourceImage(
  spid: number | undefined,
  name: string,
  rect: AddImageCommand['rect'],
  resource: ClipboardResource,
): ImageElement {
  return {
    kind: 'image', ...(spid === undefined ? {} : { id: spid }), name,
    x: rect.x, y: rect.y, w: rect.w, h: rect.h, rot: 0, flipH: false, flipV: false,
    src: insertionResourceToken(resource.hash), crop: null, stroke: null,
  };
}

/** 图片与它的关系、媒体闭包共用一个结构 patch，撤销不会留下半张图片或孤儿 part。 */
export function addImagePatches(
  doc: EditDoc,
  command: AddImageCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能新增图片');
  const slide = doc.slides[command.slideId];
  if (!slide) throw new Error(`找不到新增图片目标页：${command.slideId}`);
  const part = incrementalInsertionPart(doc, slide);
  const placeholder = command.placeholderId === undefined
    ? undefined : doc.elements[command.placeholderId];
  const placeholderTextIsEmpty = placeholder?.src.kind === 'shape'
    && (placeholder.ovr.text?.kind === 'empty'
      || (placeholder.ovr.text === undefined && placeholder.src.text === null));
  if (placeholder) assertElementUnlocked(doc, placeholder.id);
  if (command.placeholderId !== undefined && (typeof command.placeholderId !== 'string'
    || !placeholder || placeholder.parent !== slide.id || placeholder.meta.ph?.type !== 'pic'
    || placeholder.meta.editable !== 'full' || placeholder.meta.locked || !placeholderTextIsEmpty)) {
    throw new Error(`AddImage.placeholderId 必须是目标页中的空图片占位符：${String(command.placeholderId)}`);
  }
  assertInsertionRect(command.rect, 'AddImage.rect');
  const resource = imageResource(command);
  const id = allocateElementId(doc);
  const spid = part ? allocateElementSpid(doc, part) : undefined;
  const name = spid === undefined ? '图片' : `图片 ${spid}`;
  let insertion: ElementInsertionSource | undefined;
  if (part && spid !== undefined) {
    const markup = pictureMarkup(spid, name, command.rect);
    const payload = closurePayload(resource, markup, spid);
    // 字节刚在 imageResource 中完成拷贝、容器校验和哈希；避免为 2MB 图片再做一次 Base64 解码与 SHA-256。
    const closure = prepareInsertionClosures(doc, payload, payload.roots, part, {
      preverifiedResourceHashes: new Set([resource.hash]),
    }).get('image')!;
    insertion = {
      markup,
      namespaces: payload.ooxml.roots.image.namespaces,
      spids: { [String(spid)]: spid },
      relationships: closure.relationships,
      resources: closure.resources,
    };
  }
  const siblings = slide.children;
  const previous = siblings.length ? elementOrder(doc.elements[siblings[siblings.length - 1]]) : null;
  const record: ElementRecord = {
    id, parent: slide.id, z: fractionalIndexBetween(previous, null, id),
    src: sourceImage(spid, name, command.rect, resource), ovr: {},
    meta: {
      editable: 'full', created: true,
      ...(part && spid !== undefined ? { origin: { part, spid }, insertion } : {}),
    },
  };
  const value = { root: id, parent: slide.id, records: { [id]: record } };
  const forward: ElementTreePatch = { op: 'insert', path: ['elements', id], value, origin };
  const inverse: ElementTreePatch = { op: 'remove', path: ['elements', id], value, origin };
  const retained = doc.imageResources[resource.hash];
  const generatedResource: ElementInsertionResource = retained ?? {
    ...resource, targetPart: `ppt/media/web-ppt-${resource.hash}.${resource.extension}`, created: true,
  };
  const resourceForward: ImageResourcePatch[] = !part && !retained ? [{
    op: 'set', path: ['imageResources', resource.hash], value: generatedResource, origin,
  }] : [];
  const resourceInverse: ImageResourcePatch[] = !part && !retained ? [{
    op: 'del', path: ['imageResources', resource.hash], origin,
  }] : [];
  if (!placeholder) {
    return {
      forward: [...resourceForward, forward],
      inverse: [inverse, ...resourceInverse],
    };
  }
  const removal = removeElementPatches(doc, { type: 'RemoveElement', id: placeholder.id }, origin);
  return {
    forward: [...resourceForward, ...removal.forward, forward],
    inverse: [inverse, ...removal.inverse, ...resourceInverse],
  };
}
