import type { TableCell, TableCreationDefaults, TableElement, TableRow } from '@web-ppt/core';
import { allocateElementId } from '../document';
import { elementOrder } from '../element-order';
import { fractionalIndexBetween } from '../fractional-index';
import { directTableCellMarkup } from '../table-direct-markup';
import { assertTableDimension, isEmptyContentPlaceholder } from '../table-insertion-policy';
import type { EditDoc, ElementInsertionSource, ElementRecord } from '../types';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { removeElementPatches } from './element-tree';
import type { AddTableCommand, CommandPatches, ElementTreePatch } from './types';
import { assertInsertionRect, EMU_PER_PX, pxToEmu } from './insertion-rect';
import { allocateElementSpid } from './spid';

const TABLE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/table';

/** 每格至少一个 EMU，余数从前向后稳定分配，任何规模都不会积累浮点误差。 */
function distributeEmu(total: number, count: number, label: string): number[] {
  if (total < count) throw new Error(`${label} 太小，无法为每格分配正尺寸`);
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function cloneCell(source: TableCell): TableCell {
  if (!source.editInfo?.textTemplate) throw new Error('新增表格默认单元格缺少文字模板');
  // src 与编辑默认值都是不可变来源；每格只需独立外壳，视觉和空文字模板按行型共享，
  // 否则 20×10 创建会无意义地深克隆 200 份完整字体、边框和段落树。
  return {
    ...source, colSpan: 1, rowSpan: 1, merged: false, text: null,
    editInfo: { textTemplate: source.editInfo.textTemplate },
  };
}

function rowAt(defaults: TableCreationDefaults, index: number, columns: number, height: number): TableRow {
  const template = index === 0 ? defaults.firstRow : defaults.bandRows[(index - 1) % 2];
  return { height, cells: Array.from({ length: columns }, () => cloneCell(template)) };
}

function sourceTable(
  spid: number,
  name: string,
  command: AddTableCommand,
  defaults: TableCreationDefaults,
  columnEmu: readonly number[],
  rowEmu: readonly number[],
): TableElement {
  // 只在文档默认值与新元素之间深克隆一次；表内同一行型按不可变值共享。
  const localDefaults = structuredClone(defaults);
  const rows = rowEmu.map((height, index) =>
    rowAt(localDefaults, index, command.cols, height / EMU_PER_PX));
  const appendHeight = rows[rows.length - 1].height;
  const regular = [
    rowAt(localDefaults, command.rows, command.cols, appendHeight),
    rowAt(localDefaults, command.rows + 1, command.cols, appendHeight),
  ] as const;
  return {
    kind: 'table', id: spid, name,
    x: command.rect.x, y: command.rect.y, w: command.rect.w, h: command.rect.h,
    rot: 0, flipH: false, flipV: false,
    colWidths: columnEmu.map((width) => width / EMU_PER_PX), rows,
    editInfo: {
      tableRowAppend: {
        ...(command.rows === 1 ? { previousLast: rows[0] } : {}),
        regular,
        last: regular,
      },
    },
  };
}

function xmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tableMarkup(
  spid: number,
  name: string,
  command: AddTableCommand,
  defaults: TableCreationDefaults,
  source: TableElement,
  columnEmu: readonly number[],
  rowEmu: readonly number[],
): string {
  const style = defaults.styleId
    ? `<a:tableStyleId>${xmlText(defaults.styleId)}</a:tableStyleId>` : '';
  const row = (height: number, index: number) => {
    const cell = directTableCellMarkup(source.rows[index].cells[0]);
    return `<a:tr h="${height}">${cell.repeat(command.cols)}</a:tr>`;
  };
  return `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="${spid}" name="${name}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${pxToEmu(command.rect.x)}" y="${pxToEmu(command.rect.y)}"/><a:ext cx="${pxToEmu(command.rect.w)}" cy="${pxToEmu(command.rect.h)}"/></p:xfrm>
<a:graphic><a:graphicData uri="${TABLE_URI}"><a:tbl>
<a:tblPr firstRow="1" bandRow="1">${style}</a:tblPr>
<a:tblGrid>${columnEmu.map((width) => `<a:gridCol w="${width}"/>`).join('')}</a:tblGrid>
${rowEmu.map(row).join('\n')}
</a:tbl></a:graphicData></a:graphic>
</p:graphicFrame>`;
}

function assertCommand(doc: EditDoc, command: AddTableCommand) {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能新增表格');
  const slide = doc.slides[command.slideId];
  if (!slide?.origin || !doc.package
    || (!doc.package.parts[slide.origin.part] && !slide.creation)) {
    throw new Error(`新增表格目标页不可写回：${command.slideId}`);
  }
  if (!slide.defaultTable) throw new Error(`新增表格目标页缺少主题默认值：${command.slideId}`);
  assertTableDimension(command.rows, 'AddTable.rows');
  assertTableDimension(command.cols, 'AddTable.cols');
  assertInsertionRect(command.rect, 'AddTable.rect');
  const placeholder = command.placeholderId === undefined
    ? undefined : doc.elements[command.placeholderId];
  if (command.placeholderId !== undefined
    && !isEmptyContentPlaceholder(doc, slide.id, command.placeholderId)) {
    throw new Error(`AddTable.placeholderId 必须是目标页中的空内容占位符：${String(command.placeholderId)}`);
  }
  const frameEmu = {
    x: pxToEmu(command.rect.x), y: pxToEmu(command.rect.y),
    w: pxToEmu(command.rect.w), h: pxToEmu(command.rect.h),
  };
  const normalized: AddTableCommand = {
    ...command,
    rect: {
      x: frameEmu.x / EMU_PER_PX, y: frameEmu.y / EMU_PER_PX,
      w: frameEmu.w / EMU_PER_PX, h: frameEmu.h / EMU_PER_PX,
    },
  };
  const columns = distributeEmu(frameEmu.w, command.cols, 'AddTable.rect.w');
  const rows = distributeEmu(frameEmu.h, command.rows, 'AddTable.rect.h');
  return { slide, placeholder, columns, rows, normalized };
}

/** 表格视觉默认值、即时模型和 OOXML 宿主共用一个来源，再交给既有结构历史与保存主干。 */
export function addTablePatches(
  doc: EditDoc,
  command: AddTableCommand,
  origin: string,
): CommandPatches {
  const { slide, placeholder, columns, rows, normalized } = assertCommand(doc, command);
  const id = allocateElementId(doc);
  const spid = allocateElementSpid(doc, slide.origin!.part);
  const name = `表格 ${spid}`;
  const source = sourceTable(spid, name, normalized, slide.defaultTable!, columns, rows);
  const markup = tableMarkup(spid, name, normalized, slide.defaultTable!, source, columns, rows);
  const insertion: ElementInsertionSource = {
    markup, namespaces: { 'xmlns:a': DRAWINGML_NS, 'xmlns:p': PRESENTATIONML_NS },
    spids: { [String(spid)]: spid },
  };
  const siblings = slide.children;
  const previous = siblings.length ? elementOrder(doc.elements[siblings[siblings.length - 1]]) : null;
  const record: ElementRecord = {
    id, parent: slide.id,
    z: placeholder ? elementOrder(placeholder) : fractionalIndexBetween(previous, null, id),
    ...(placeholder ? { order: elementOrder(placeholder) } : {}),
    src: source, ovr: {},
    meta: {
      editable: 'full', created: true,
      origin: { part: slide.origin!.part, spid }, insertion,
    },
  };
  const value = { root: id, parent: slide.id, records: { [id]: record } };
  const forward: ElementTreePatch = { op: 'insert', path: ['elements', id], value, origin };
  const inverse: ElementTreePatch = { op: 'remove', path: ['elements', id], value, origin };
  if (!placeholder) return { forward: [forward], inverse: [inverse] };
  const removal = removeElementPatches(doc, { type: 'RemoveElement', id: placeholder.id }, origin);
  return { forward: [...removal.forward, forward], inverse: [inverse, ...removal.inverse] };
}
