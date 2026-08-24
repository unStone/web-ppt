import { isKnownPreset, resolveGeomPath } from '@web-ppt/core/geometry';
import type { ShapeCreationDefaults, ShapeElement } from '@web-ppt/core';
import { allocateElementId } from '../document';
import { assertDataObject } from '../data-validation';
import { elementOrder } from '../element-order';
import { fractionalIndexBetween } from '../fractional-index';
import type { EditDoc, ElementInsertionSource, ElementRecord } from '../types';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import type { AddShapeCommand, CommandPatches, ElementTreePatch } from './types';
import { allocateElementSpid } from './spid';

const EMU_PER_PX = 9525;
// ECMA-376 的 long 范围更宽，但 PowerPoint 实际只接受 32 位 signed/positive coordinate。
const MIN_COORDINATE_EMU = -2147483648;
const MAX_COORDINATE_EMU = 2147483647;

const pxToEmu = (value: number): number => Math.round(value * EMU_PER_PX);
const isCoordinate = (value: number): boolean => {
  const emu = pxToEmu(value);
  return Number.isSafeInteger(emu) && emu >= MIN_COORDINATE_EMU && emu <= MAX_COORDINATE_EMU;
};
const isPositiveCoordinate = (value: number): boolean => {
  const emu = pxToEmu(value);
  return Number.isSafeInteger(emu) && emu > 0 && emu <= MAX_COORDINATE_EMU;
};

function shapeMarkup(
  spid: number,
  name: string,
  preset: string,
  rect: AddShapeCommand['rect'],
  defaults: ShapeCreationDefaults,
): string {
  return `<p:sp>
<p:nvSpPr><p:cNvPr id="${spid}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${pxToEmu(rect.x)}" y="${pxToEmu(rect.y)}"/><a:ext cx="${pxToEmu(rect.w)}" cy="${pxToEmu(rect.h)}"/></a:xfrm>
<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom></p:spPr>
${defaults.styleMarkup}
${defaults.textBodyMarkup}
</p:sp>`;
}

function insertionSource(
  spid: number,
  name: string,
  preset: string,
  rect: AddShapeCommand['rect'],
  defaults: ShapeCreationDefaults,
): ElementInsertionSource {
  return {
    markup: shapeMarkup(spid, name, preset, rect, defaults),
    namespaces: { 'xmlns:a': DRAWINGML_NS, 'xmlns:p': PRESENTATIONML_NS },
    spids: { [String(spid)]: spid },
  };
}

function sourceShape(
  spid: number,
  name: string,
  preset: string,
  rect: AddShapeCommand['rect'],
  defaults: ShapeCreationDefaults,
): ShapeElement {
  const geom = resolveGeomPath({ preset, adj: {} }, rect.w, rect.h);
  return {
    kind: 'shape', id: spid, name,
    x: rect.x, y: rect.y, w: rect.w, h: rect.h, rot: 0, flipH: false, flipV: false,
    path: geom.d, ...(geom.open ? { openGeom: true } : {}),
    fill: geom.open ? { type: 'none' } : structuredClone(defaults.fill),
    stroke: structuredClone(defaults.stroke),
    text: null,
  };
}

function assertCommand(doc: EditDoc, command: AddShapeCommand) {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能新增形状');
  const slide = doc.slides[command.slideId];
  if (!slide?.origin || !doc.package?.parts[slide.origin.part]) {
    throw new Error(`新增形状目标页不可写回：${command.slideId}`);
  }
  if (!slide.defaultShape) throw new Error(`新增形状目标页缺少主题默认值：${command.slideId}`);
  if (typeof command.preset !== 'string' || !isKnownPreset(command.preset)) {
    throw new Error(`未知预设形状：${String(command.preset)}`);
  }
  const rect = command.rect;
  assertDataObject(rect, ['x', 'y', 'w', 'h'], 'AddShape.rect');
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !isCoordinate(rect.x) || !isCoordinate(rect.y)
    || !Number.isFinite(rect.w) || rect.w <= 0 || !isPositiveCoordinate(rect.w)
    || !Number.isFinite(rect.h) || rect.h <= 0 || !isPositiveCoordinate(rect.h)) {
    throw new Error('AddShape.rect 必须是 PowerPoint 可表示的有限坐标与有限正尺寸');
  }
  return slide;
}

/** 新形状和 OOXML 宿主由同一组默认值构造，再走既有结构 patch 与保存主干。 */
export function addShapePatches(
  doc: EditDoc,
  command: AddShapeCommand,
  origin: string,
): CommandPatches {
  const slide = assertCommand(doc, command);
  const id = allocateElementId(doc);
  const spid = allocateElementSpid(doc, slide.origin!.part);
  const name = `形状 ${spid}`;
  const siblings = slide.children;
  const previous = siblings.length ? elementOrder(doc.elements[siblings[siblings.length - 1]]) : null;
  const record: ElementRecord = {
    id, parent: slide.id, z: fractionalIndexBetween(previous, null, id),
    src: sourceShape(spid, name, command.preset, command.rect, slide.defaultShape!), ovr: {},
    meta: {
      editable: 'full', created: true, textTemplate: structuredClone(slide.defaultShape!.textTemplate),
      geom: { preset: command.preset, adj: {} },
      origin: { part: slide.origin!.part, spid },
      insertion: insertionSource(spid, name, command.preset, command.rect, slide.defaultShape!),
    },
  };
  const value = { root: id, parent: slide.id, records: { [id]: record } };
  const forward: ElementTreePatch = { op: 'insert', path: ['elements', id], value, origin };
  const inverse: ElementTreePatch = { op: 'remove', path: ['elements', id], value, origin };
  return { forward: [forward], inverse: [inverse] };
}
