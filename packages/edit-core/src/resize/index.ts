import type { Effects, SlideElement, Stroke } from '@web-ppt/core';
import { effectiveElement } from '@web-ppt/edit-core';
import type { Editor } from '../editor';
import type { EditDoc, ElementRecord } from '../types';
import type { CommandPatches, Patch, SetSlideSizeCommand } from '../commands/types';
import { inverseTextPatch, setTextPatch, textTargetContext } from '../commands/text-target';
import { setCellPropsPatches } from '../commands/edit-table-grid';
import { registerCommentEditing, queryComments } from '../comments';
import { assertSlideSize } from '../slide-size';
import { assertDataObject } from '../data-validation';
import { scaleText } from './text';
import { own } from '../data-validation';
import { orderedTableColumns, orderedTableRows } from '../table-grid';
import { tableBaseFrameHeight } from '../table-rows';
import { extensionCommandPatches, registerEditExtension } from '../extension-runtime';
import { queryScene3D, registerAppearanceEditing } from '../appearance';

function scaleStroke(stroke: Stroke, factor: number): Stroke {
  return { ...stroke, width: stroke.width * factor };
}

function scaleEffects(effects: Effects, factor: number): Effects {
  return {
    ...effects,
    ...(effects.shadow ? { shadow: { ...effects.shadow, dx: effects.shadow.dx * factor,
      dy: effects.shadow.dy * factor, blur: effects.shadow.blur * factor } } : {}),
    ...(effects.glow ? { glow: { ...effects.glow, radius: effects.glow.radius * factor } } : {}),
    ...(effects.softEdge !== undefined ? { softEdge: effects.softEdge * factor } : {}),
    ...(effects.reflection ? { reflection: { ...effects.reflection, distance: effects.reflection.distance * factor } } : {}),
  };
}

function fit(doc: EditDoc, width: number, height: number, origin: string): CommandPatches {
  const factor = Math.min(width / doc.meta.width, height / doc.meta.height);
  const dx = (width - doc.meta.width * factor) / 2, dy = (height - doc.meta.height * factor) / 2;
  const forward: Patch[] = [], inverse: Patch[] = [];
  const append = (patches: CommandPatches) => { forward.push(...patches.forward); inverse.unshift(...patches.inverse); };
  const set = (record: ElementRecord, field: keyof ElementRecord['ovr'], value: unknown) => {
    if (Object.is(record.ovr[field] ?? record.src[field as keyof SlideElement], value)) return;
    const path = ['elements', record.id, 'ovr', field] as const;
    forward.push({ op: 'set', path, value, origin } as Patch);
    inverse.unshift((own(record.ovr, field)
      ? { op: 'set', path, value: structuredClone(record.ovr[field]), origin }
      : { op: 'del', path, origin }) as Patch);
  };
  const text = (record: ElementRecord, body: import('@web-ppt/core').TextBody, cell?: { r: number; c: number }) => {
    const target = textTargetContext(doc, { id: record.id, cell });
    append({ forward: [setTextPatch(target.patchTarget, scaleText(body, target.before, factor), origin)],
      inverse: [inverseTextPatch(target.patchTarget, target.before, origin)] });
  };
  // 组的 ext 已缩放整棵子树；只处理画布直属对象，避免嵌套内容重复缩放。
  const roots = [...Object.values(doc.masters), ...Object.values(doc.layouts), ...Object.values(doc.slides)]
    .flatMap((canvas) => canvas.children).filter((id) => !doc.elements[id].meta.inherited);
  for (const id of new Set(roots)) {
    const record = doc.elements[id], element = effectiveElement(doc, id);
    if (record.meta.editable === 'none') throw new Error(`页面适配遇到不可变换对象：${id}`);
    set(record, 'x', element.x * factor + dx); set(record, 'y', element.y * factor + dy);
    set(record, 'w', element.w * factor); set(record, 'h', tableBaseFrameHeight(record, element.h * factor));
    if (factor === 1 || record.meta.editable === 'frame' || element.kind === 'group') continue;
    if ((element.kind === 'shape' || element.kind === 'image') && element.stroke) set(record, 'stroke', scaleStroke(element.stroke, factor));
    if (element.effects) set(record, 'effects', scaleEffects(element.effects, factor));
    // 页面适配作用于整稿，锁定只禁止局部编辑；校验使用只读外壳，不修改真实锁定状态。
    const commandDoc = record.meta.locked ? { ...doc, elements: { ...doc.elements,
      [id]: { ...record, meta: { ...record.meta, locked: false } },
    } } : doc;
    if (element.kind === 'shape' && (element.text || record.meta.textTemplate)) {
      text(record, element.text ?? record.meta.textTemplate!);
    }
    if (element.kind === 'shape' && element.scene3d) {
      const scene = queryScene3D(doc, id);
      for (const field of ['extrusion', 'bevelTop', 'bevelBottom', 'bevelTopWidth', 'bevelBottomWidth', 'contourWidth', 'z'] as const) {
        if (scene[field] !== undefined) scene[field] *= factor;
      }
      append(extensionCommandPatches(commandDoc, { type: 'Extension', namespace: 'appearance', id,
        payload: { type: 'SetScene3D', id, scene } }, origin));
    }
    if (element.kind === 'table') {
      element.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
        if (cell.merged) return;
        if (cell.text || cell.editInfo?.textTemplate) text(record, cell.text ?? cell.editInfo!.textTemplate!, { r, c });
        if (cell.margins || cell.borders) append(setCellPropsPatches(commandDoc, { type: 'SetCellProps', id,
          cell: { row: orderedTableRows(record)[r].id, column: orderedTableColumns(record)[c].id }, props: {
            ...(cell.margins ? { margins: cell.margins.map((n) => n * factor) as [number, number, number, number] } : {}),
            ...(cell.borders ? { borders: Object.fromEntries(Object.entries(cell.borders).map(([edge, stroke]) =>
              [edge, stroke ? scaleStroke(stroke, factor) : null])) } : {}),
          } }, origin));
      }));
    }
  }
  for (const id of doc.slideOrder) for (const comment of queryComments(doc, id)) {
    append(extensionCommandPatches(doc, { type: 'Extension', namespace: 'comments', scope: 'slide', id,
      payload: { type: 'UpdateComment', slideId: id, id: comment.id, fields: {
        x: comment.x * factor + dx, y: comment.y * factor + dy,
      } } }, origin));
  }
  return { forward, inverse };
}

export function registerSlideSizeEditing(): void {
  registerAppearanceEditing(); registerCommentEditing();
  registerEditExtension('resize', { command(doc, command, origin) {
    assertDataObject(command.payload, ['w', 'h'], '页面适配');
    const value = command.payload as { w: number; h: number };
    assertSlideSize(value.w, '页面适配.w'); assertSlideSize(value.h, '页面适配.h');
    if (doc.meta.readonly) throw new Error('只读文稿不能适配页面');
    return fit(doc, value.w, value.h, origin);
  } });
}

export function createSlideSizeEditor(editor: Pick<Editor, 'exec'>) {
  registerSlideSizeEditing();
  return { setSize(value: Omit<SetSlideSizeCommand, 'type'>) {
    return editor.exec({ type: 'SetSlideSize', ...value });
  } };
}
