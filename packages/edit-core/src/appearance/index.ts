import type { Shape3D } from '@web-ppt/core';
import type { Editor } from '../editor';
import type { EditDoc, ElementId } from '../types';
import type { CommandPatches, ExtensionCommand, ExtensionPatch } from '../commands/types';
import { assertDataObject } from '../data-validation';
import { registerEditExtension } from '../extension-runtime';
import { effectiveElement } from '@web-ppt/edit-core';
import { materializeAppearance } from './materialize';
import { normalizePicture, normalizeScene, pictureProjection, sceneProjection, sourcePicture, sourceScene } from './values';
import type { AppearanceCommand, AppearanceState, PictureFx } from './types';

export type { AppearanceCommand, SetPictureFxCommand, SetScene3DCommand, PictureFx } from './types';
export { SCENE_MATERIALS } from './values';

const state = (doc: EditDoc, id: ElementId): AppearanceState =>
  doc.elements[id]?.ovr.extensions?.appearance as AppearanceState ?? {};

function validatePatch(doc: EditDoc, patch: ExtensionPatch): void {
  const field = patch.path[5];
  const record = doc.elements[patch.path[1]];
  if (patch.path.length !== 6 || !['picture', 'scene'].includes(field)
    || record.src.kind !== (field === 'picture' ? 'image' : 'shape') || record.src.editInfo?.requiresOriginal) {
    throw new Error('外观补丁目标或字段无效');
  }
  if (patch.op === 'set') {
    if (typeof patch.value !== 'string' || patch.value.length > 4096) throw new Error('外观补丁值无效');
    (field === 'picture' ? normalizePicture : normalizeScene)(JSON.parse(patch.value));
  }
}

function commandPatches(doc: EditDoc, extension: ExtensionCommand, origin: string): CommandPatches {
  const command = extension.payload as AppearanceCommand;
  assertDataObject(command, ['type', 'id', command?.type === 'SetPictureFx' ? 'effects' : 'scene'], '外观命令');
  if (!['SetPictureFx', 'SetScene3D'].includes(command.type) || command.id !== extension.id) throw new Error('外观命令身份无效');
  const record = doc.elements[command.id];
  if (!record || doc.meta.readonly || record.meta.locked || record.meta.editable !== 'full') throw new Error('目标不允许修改外观');
  const field = command.type === 'SetPictureFx' ? 'picture' : 'scene';
  const input = command.type === 'SetPictureFx' ? command.effects : command.scene;
  const path = ['elements', command.id, 'ovr', 'extensions', 'appearance', field] as const;
  const before = state(doc, command.id)[field];
  const value = input === null ? undefined : JSON.stringify(
    command.type === 'SetPictureFx' ? normalizePicture(input) : normalizeScene(input));
  const forward: ExtensionPatch = value === undefined ? { op: 'del', path, origin } : { op: 'set', path, value, origin };
  validatePatch(doc, forward);
  if (value === before) return { forward: [], inverse: [] };
  return { forward: [forward], inverse: [before === undefined
    ? { op: 'del', path, origin } : { op: 'set', path, value: before, origin }] };
}

let registered = false;
export function registerAppearanceEditing(): void {
  if (registered) return;
  registerEditExtension('appearance', {
    command: commandPatches, validatePatch, materialize: materializeAppearance,
    supportsGenerated: (element) => element.kind === 'shape' || element.kind === 'image' &&
      (!element.filter || element.filter === 'grayscale(1)'),
    project(doc, id, element) {
      const value = state(doc, id);
      if (value.picture !== undefined && element.kind === 'image') {
        return pictureProjection(element, normalizePicture(JSON.parse(value.picture)));
      }
      if (value.scene !== undefined && element.kind === 'shape') {
        return { ...element, scene3d: sceneProjection(normalizeScene(JSON.parse(value.scene))) };
      }
      return element;
    },
  });
  registered = true;
}

export function createAppearanceEditor(editor: Pick<Editor, 'doc' | 'exec'>) {
  registerAppearanceEditing();
  return { exec(command: AppearanceCommand) {
    return editor.exec({ type: 'Extension', namespace: 'appearance', id: command.id, payload: command });
  } };
}

export function queryPictureFx(doc: EditDoc, id: ElementId): PictureFx {
  const element = effectiveElement(doc, id);
  if (element.kind !== 'image') throw new Error('图片效果查询需要图片');
  return structuredClone(sourcePicture(element));
}

export function queryScene3D(doc: EditDoc, id: ElementId): Shape3D {
  const element = effectiveElement(doc, id);
  if (element.kind !== 'shape') throw new Error('立体效果查询需要形状');
  return structuredClone(sourceScene(element.scene3d));
}
