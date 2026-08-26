import { allocateElementId } from '../document';
import { createElementAssetHydrator } from '../session-assets';
import { elementOrder, elementParentChildren } from '../element-order';
import { fractionalIndexBetween, initialFractionalIndex } from '../fractional-index';
import {
  composeSpaceMatrices, elementChildrenToSlideMatrix, invertSpaceMatrix,
} from '../space';
import type { AffineMatrix } from '../space';
import type { EditDoc, ElementId, ElementRecord, SlideId } from '../types';
import type {
  ClipboardElementRecord, CommandPatches, ElementClipboardPayload, ElementTreePatch,
  ElementTreeSnapshot, PasteElementsCommand,
} from './types';
import { prepareInsertionClosures } from './paste-resources';
import { partSpidAllocator } from './spid';
import { assertTableRowAppendEditInfo } from '../table-row-append-validation';
import {
  applyCopiedLinks, assertClipboardPortableLink, assertClipboardTextLinks,
} from '../clipboard-links';
import { assertElementUnlocked } from './element-interaction';

function assertPayload(value: unknown): asserts value is ElementClipboardPayload {
  const payload = value as Partial<ElementClipboardPayload> | null;
  if (!payload || payload.format !== 'web-ppt-elements' || payload.version !== 1
    || !Array.isArray(payload.roots) || !payload.roots.length
    || new Set(payload.roots).size !== payload.roots.length
    || !payload.records || typeof payload.records !== 'object'
    || !payload.ooxml || typeof payload.ooxml.roots !== 'object'
    || !payload.bounds || !Number.isFinite(payload.bounds.left) || !Number.isFinite(payload.bounds.top)
    || !payload.source || !Number.isFinite(payload.source.width) || !Number.isFinite(payload.source.height)
    || typeof payload.source.copyBatchId !== 'string' || !/^[0-9a-f]{32}$/.test(payload.source.copyBatchId)
    || !Array.isArray(payload.resources)) {
    throw new Error('元素剪贴板载荷无效或版本不受支持');
  }
  const reached = new Set<string>();
  const visit = (id: string, parent: string | null): void => {
    if (reached.has(id)) throw new Error(`剪贴板元素树成环或重复：${id}`);
    const record = payload.records![id] as ClipboardElementRecord | undefined;
    if (!record || record.id !== id || record.parent !== parent || !record.src
      || !record.meta || record.meta.copyBatchId !== payload.source!.copyBatchId
      || !['full', 'frame', 'none'].includes(record.meta.editable)
      || typeof record.meta.anchored !== 'boolean'
      || (record.meta.anchored
        ? !Number.isSafeInteger(record.meta.sourceSpid) || record.meta.sourceSpid! < 0
        : record.meta.sourceSpid !== undefined)
      || !Array.isArray(record.children)) {
      throw new Error(`剪贴板元素记录无效：${id}`);
    }
    if (record.src.kind === 'table') assertTableRowAppendEditInfo(record.src, `剪贴板元素 ${id}`);
    if (record.meta.link) assertClipboardPortableLink(record.meta.link, `剪贴板元素 ${id}.meta.link`);
    if (record.meta.textLinks) assertClipboardTextLinks(
      record.meta.textLinks, `剪贴板元素 ${id}.meta.textLinks`,
    );
    reached.add(id);
    for (const child of record.children) visit(child, id);
  };
  for (const root of payload.roots) visit(root, null);
  if (reached.size !== Object.keys(payload.records).length) throw new Error('剪贴板载荷包含孤儿记录');
  if (payload.roots.some((root) => {
    const xml = payload.ooxml!.roots[root];
    const frame = payload.records![root]?.meta.frameToSlide;
    return !xml || typeof xml.markup !== 'string' || !xml.markup
      || !xml.namespaces || typeof xml.namespaces !== 'object'
      || !Array.isArray(xml.hostSpids) || !xml.hostSpids.length
      || (xml.relationships !== undefined && !Array.isArray(xml.relationships))
      || !frame || !Object.values(frame).every(Number.isFinite);
  })) throw new Error('剪贴板载荷缺少 OOXML 根宿主');
  for (const root of payload.roots) {
    const hostSpids = payload.ooxml.roots[root].hostSpids;
    const hostSpidSet = new Set(hostSpids);
    if (hostSpidSet.size !== hostSpids.length
      || hostSpids.some((spid) => !/^\d+$/.test(spid))) {
      throw new Error(`剪贴板根 ${root} 的宿主 spid 无效`);
    }
    const anchored = new Set<number>();
    const visitSpids = (id: string): void => {
      const record = payload.records![id];
      if (record.meta.anchored) {
        const spid = record.meta.sourceSpid!;
        if (anchored.has(spid)) throw new Error(`剪贴板来源 spid 重复：${spid}`);
        if (!hostSpidSet.has(String(spid))) throw new Error(`剪贴板来源 spid 不属于根宿主：${spid}`);
        anchored.add(spid);
      }
      for (const child of record.children) visitSpids(child);
    };
    visitSpids(root);
  }
}

function resolvePasteDestination(doc: EditDoc, parentId: string): { parent: SlideId | ElementId; part: string } {
  const slide = doc.slides[parentId];
  if (slide) {
    if (!slide.origin) throw new Error('目标幻灯片不可写回');
    return { parent: parentId, part: slide.origin.part };
  }
  const group = doc.elements[parentId];
  if (!group || group.src.kind !== 'group' || group.meta.editable !== 'full') {
    throw new Error('粘贴目标必须是可写幻灯片或组合');
  }
  assertElementUnlocked(doc, parentId);
  if (!group.meta.origin) throw new Error('粘贴目标组合缺少写回锚点');
  return { parent: parentId, part: group.meta.origin.part };
}

function translated(matrix: AffineMatrix, dx: number, dy: number): AffineMatrix {
  return { ...matrix, e: matrix.e + dx, f: matrix.f + dy };
}

function decomposePlacement(matrix: AffineMatrix, width: number, height: number) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const reflectH = determinant < 0;
  const normalized = reflectH ? composeSpaceMatrices(matrix, {
    a: -1, b: 0, c: 0, d: 1, e: width, f: 0,
  }) : matrix;
  const scaleX = Math.hypot(normalized.a, normalized.b);
  const normalizedDeterminant = normalized.a * normalized.d - normalized.b * normalized.c;
  const scaleY = normalizedDeterminant / scaleX;
  const magnitude = Math.max(
    1, Math.abs(normalized.a), Math.abs(normalized.b), Math.abs(normalized.c), Math.abs(normalized.d),
  );
  const orthogonality = normalized.a * normalized.c + normalized.b * normalized.d;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 1e-12 || scaleY <= 1e-12
    || Math.abs(orthogonality) > 1e-8 * magnitude * magnitude) {
    throw new Error('来源与目标组合坐标系会产生 PPTX 无法表达的斜切');
  }
  const radians = Math.atan2(normalized.b, normalized.a);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const w = width * scaleX;
  const h = height * scaleY;
  return {
    x: normalized.e - w / 2 * (1 - cos) - h / 2 * sin,
    y: normalized.f + w / 2 * sin - h / 2 * (1 - cos),
    w, h, rot: radians * 180 / Math.PI, reflectH,
  };
}

function sparsePlacement(
  source: ClipboardElementRecord,
  placement: ReturnType<typeof decomposePlacement>,
) {
  if (source.meta.editable === 'frame' && Math.abs(placement.rot - source.src.rot) > 1e-8) {
    throw new Error('框架对象无法无损粘贴到需要改变旋转角度的组合坐标系');
  }
  return {
    ...(Math.abs(placement.x - source.src.x) > 1e-8 ? { x: placement.x } : {}),
    ...(Math.abs(placement.y - source.src.y) > 1e-8 ? { y: placement.y } : {}),
    ...(Math.abs(placement.w - source.src.w) > 1e-8 ? { w: placement.w } : {}),
    ...(Math.abs(placement.h - source.src.h) > 1e-8 ? { h: placement.h } : {}),
    ...(source.meta.editable === 'full' && Math.abs(placement.rot - source.src.rot) > 1e-8
      ? { rot: placement.rot } : {}),
    ...(placement.reflectH ? { flipH: !source.src.flipH } : {}),
  };
}

/** 所有身份、树记录与位置先在内存中构造完毕，再作为一组结构 patch 原子落模。 */
export function pasteElementsPatches(
  doc: EditDoc,
  command: PasteElementsCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能粘贴元素');
  assertPayload(command.payload);
  if (!command.at || typeof command.at.parentId !== 'string' || !command.at.parentId
    || !Number.isFinite(command.at.x) || !Number.isFinite(command.at.y)) {
    throw new Error('PasteElements.at 必须包含目标父级与有限坐标');
  }
  const destination = resolvePasteDestination(doc, command.at.parentId);
  const payload = command.payload;
  const closures = prepareInsertionClosures(doc, payload, payload.roots, destination.part);
  const hydrateElementAssets = createElementAssetHydrator(payload.resources);
  const dx = command.at.x - payload.bounds.left;
  const dy = command.at.y - payload.bounds.top;
  const destinationMatrix: AffineMatrix = doc.slides[destination.parent]
    ? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    : elementChildrenToSlideMatrix(doc, destination.parent);
  const placements = new Map(payload.roots.map((root) => {
    const source = payload.records[root];
    const local = composeSpaceMatrices(
      invertSpaceMatrix(destinationMatrix),
      translated(source.meta.frameToSlide!, dx, dy),
    );
    return [root, sparsePlacement(source, decomposePlacement(local, source.src.w, source.src.h))] as const;
  }));
  const idMap = new Map<string, ElementId>();
  for (const id of Object.keys(payload.records)) idMap.set(id, allocateElementId(doc));
  const allocateSpid = partSpidAllocator(doc, destination.part);
  const siblings = elementParentChildren(doc, destination.parent);
  let previousOrder = siblings.length ? elementOrder(doc.elements[siblings[siblings.length - 1]]) : null;

  const snapshots: ElementTreeSnapshot[] = [];
  for (const rootId of payload.roots) {
    const records: Record<ElementId, ElementRecord> = Object.create(null);
    const spids: Record<string, number> = Object.create(null);
    const hostSpids = new Set(payload.ooxml.roots[rootId].hostSpids);
    const visit = (clipboardId: string, parent: SlideId | ElementId, root: boolean, index: number): ElementId => {
      const copied = payload.records[clipboardId];
      const id = idMap.get(clipboardId)!;
      const spid = copied.meta.anchored && copied.meta.sourceSpid !== undefined
        && hostSpids.has(String(copied.meta.sourceSpid)) ? allocateSpid() : undefined;
      if (spid !== undefined && copied.meta.sourceSpid !== undefined) {
        if (Object.prototype.hasOwnProperty.call(spids, String(copied.meta.sourceSpid))) {
          throw new Error(`剪贴板来源 spid 重复：${copied.meta.sourceSpid}`);
        }
        spids[String(copied.meta.sourceSpid)] = spid;
      }
      let src = hydrateElementAssets(copied.src);
      const links = applyCopiedLinks(doc, src, copied.meta);
      src = links.element;
      if (spid !== undefined) src.id = spid;
      const children = copied.children.map((child, childIndex) => visit(child, id, false, childIndex));
      const z = root
        ? (previousOrder = fractionalIndexBetween(previousOrder, null))
        : initialFractionalIndex(index);
      records[id] = {
        id, parent, z, src,
        ovr: { ...(root ? placements.get(rootId)! : {}), ...links.overrides },
        meta: {
          editable: copied.meta.editable,
          ...(copied.meta.geom ? { geom: structuredClone(copied.meta.geom) } : {}),
          ...(spid === undefined ? {} : { origin: { part: destination.part, spid } }),
          created: true,
          ...(links.sourceLinkReadonly ? { sourceLinkReadonly: true } : {}),
          ...(root ? {
            insertion: {
              markup: payload.ooxml.roots[rootId].markup,
              namespaces: structuredClone(payload.ooxml.roots[rootId].namespaces),
              spids,
              relationships: structuredClone(closures.get(rootId)!.relationships),
              resources: structuredClone(closures.get(rootId)!.resources),
            },
          } : {}),
        },
        ...(src.kind === 'group' ? { children } : {}),
      };
      return id;
    };
    const root = visit(rootId, destination.parent, true, 0);
    snapshots.push({ root, parent: destination.parent, records });
  }
  const forward: ElementTreePatch[] = snapshots.map((value) => ({
    op: 'insert', path: ['elements', value.root], value, origin,
  }));
  const inverse: ElementTreePatch[] = [...snapshots].reverse().map((value) => ({
    op: 'remove', path: ['elements', value.root], value, origin,
  }));
  return { forward, inverse };
}
