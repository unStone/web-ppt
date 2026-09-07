import type { SlideComment } from '@web-ppt/core';
import type { Editor } from '../editor';
import type { EditDoc, SlideId } from '../types';
import type { CommandPatches, ExtensionCommand, ExtensionPatch } from '../commands/types';
import { assertDataObject, own } from '../data-validation';
import { registerEditExtension } from '../extension-runtime';
import { commentState, queryComments, validateCommentPatch } from './state';
import type { CommentFields } from './state';
import { materializeCommentEdits } from './save';

export { queryComments } from './state';
export type { CommentFields } from './state';
export type CommentCommand = { type: 'AddComment'; slideId: SlideId; comment: SlideComment & { id: string } }
  | { type: 'UpdateComment'; slideId: SlideId; id: string; fields: Partial<CommentFields> }
  | { type: 'RemoveComment'; slideId: SlideId; id: string };

function commandPatches(doc: EditDoc, extension: ExtensionCommand, origin: string): CommandPatches {
  const command = extension.payload as CommentCommand;
  assertDataObject(command, ['type', 'slideId', 'id', 'comment', 'fields'], '批注命令');
  if (extension.scope !== 'slide' || extension.id !== command.slideId || !doc.slides[command.slideId]
    || doc.meta.readonly) throw new Error('目标不允许修改批注');
  const comments = queryComments(doc, command.slideId);
  let id: string, fields: Partial<CommentFields> & { deleted?: boolean };
  if (command.type === 'AddComment') {
    assertDataObject(command.comment, ['id', 'author', 'initials', 'date', 'text', 'x', 'y', 'parentId'], '新增批注');
    ({ id, ...fields } = command.comment);
    if (comments.some((c) => c.id === id)) throw new Error('批注身份已存在');
    if (typeof fields.author !== 'string' || typeof fields.text !== 'string'
      || typeof fields.x !== 'number' || typeof fields.y !== 'number') throw new Error('新增批注缺少作者、正文或锚点');
    fields.deleted = false;
  } else {
    id = command.id;
    if (!comments.some((c) => c.id === id)) throw new Error('找不到批注');
    if (command.type === 'RemoveComment') fields = { deleted: true };
    else if (command.type === 'UpdateComment') {
      assertDataObject(command.fields, ['author', 'initials', 'date', 'text', 'x', 'y', 'parentId'], '批注字段');
      fields = command.fields;
    } else throw new Error('批注命令无效');
  }
  if (typeof id !== 'string' || !id) throw new Error('批注身份不能为空');
  if (fields.parentId) {
    const visited = new Set([id]);
    let parent: string | undefined = fields.parentId;
    while (parent) {
      if (visited.has(parent)) throw new Error('批注回复关系不能成环');
      visited.add(parent);
      const target = comments.find((c) => c.id === parent);
      if (!target) throw new Error('回复的父批注不存在');
      parent = target.parentId;
    }
  }
  const before = commentState(doc, command.slideId)[id] ?? {};
  const forward: ExtensionPatch[] = [], inverse: ExtensionPatch[] = [];
  for (const [field, value] of Object.entries(fields)) {
    const path = ['slides', command.slideId, 'ovr', 'extensions', 'comments', id, field] as const;
    const patch: ExtensionPatch = { op: 'set', path, value, origin };
    validateCommentPatch(doc, patch);
    if (own(before, field) && before[field as keyof typeof before] === value) continue;
    forward.push(patch);
    inverse.unshift(own(before, field) ? { op: 'set', path, value: before[field as keyof typeof before], origin }
      : { op: 'del', path, origin });
  }
  return { forward, inverse };
}

let registered = false;
export function registerCommentEditing(): void {
  if (registered) return;
  registerEditExtension('comments', { scope: 'slide', command: commandPatches, validatePatch: validateCommentPatch,
    projectSlide(doc, id, slide) { return { ...slide, comments: queryComments(doc, id) }; },
    materializePackage: materializeCommentEdits,
  });
  registered = true;
}

export function createCommentEditor(editor: Pick<Editor, 'doc' | 'exec'>) {
  registerCommentEditing();
  const exec = (command: CommentCommand) => editor.exec({ type: 'Extension', namespace: 'comments',
    scope: 'slide', id: command.slideId, payload: command });
  return { exec, query: (id: SlideId) => queryComments(editor.doc, id),
    add(slideId: SlideId, comment: CommentFields & { id?: string }) {
      const id = comment.id ?? `new:${globalThis.crypto.randomUUID()}`;
      exec({ type: 'AddComment', slideId, comment: { ...comment, id } }); return id;
    },
    update(slideId: SlideId, id: string, fields: Partial<CommentFields>) { return exec({ type: 'UpdateComment', slideId, id, fields }); },
    remove(slideId: SlideId, id: string) { return exec({ type: 'RemoveComment', slideId, id }); },
    reply(slideId: SlideId, parentId: string, comment: CommentFields & { id?: string }) {
      return this.add(slideId, { ...comment, parentId });
    },
  };
}
