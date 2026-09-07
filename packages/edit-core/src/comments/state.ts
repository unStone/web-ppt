import type { SlideComment } from '@web-ppt/core';
import type { EditDoc, SlideId } from '../types';
import type { ExtensionPatch } from '../commands/types';

export type CommentFields = Omit<SlideComment, 'id' | 'idx'>;
export type CommentState = Record<string, Partial<CommentFields> & { deleted?: boolean }>;
export const commentState = (doc: EditDoc, id: SlideId): CommentState =>
  doc.slides[id]?.ovr.extensions?.comments as CommentState ?? {};

export function queryComments(doc: EditDoc, slideId: SlideId): SlideComment[] {
  const record = doc.slides[slideId];
  if (!record) throw new Error(`找不到幻灯片：${slideId}`);
  const entries = new Map((record.ovr.comments ?? record.src.comments ?? []).map((c, index) =>
    [c.id ?? `source:${index}`, { ...c, id: c.id ?? `source:${index}` }]));
  for (const [id, value] of Object.entries(commentState(doc, slideId)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (value.deleted) { entries.delete(id); continue; }
    const { deleted: _deleted, ...fields } = value;
    const comment = { ...entries.get(id), ...fields, id };
    // 协同补丁可以分批到达；未具备必填字段的记录不进入可见模型。
    if (typeof comment.author === 'string' && typeof comment.text === 'string'
      && typeof comment.x === 'number' && typeof comment.y === 'number') entries.set(id, comment as SlideComment & { id: string });
  }
  const result = [...entries.values()];
  // 并发删除父批注时保留回复正文，将失效的引用提升为独立批注。
  for (const comment of result) if (!comment.parentId || !entries.has(comment.parentId)) delete comment.parentId;
  for (const comment of [...result].sort((a, b) => a.id < b.id ? -1 : 1)) {
    const visited = new Set<string>();
    let next: typeof comment | undefined = comment;
    while (next?.parentId) {
      if (visited.has(next.id)) { delete next.parentId; break; }
      visited.add(next.id); next = entries.get(next.parentId);
    }
  }
  const threads = new Map<string | undefined, typeof result>();
  for (const comment of result) {
    const siblings = threads.get(comment.parentId) ?? []; siblings.push(comment); threads.set(comment.parentId, siblings);
  }
  const ordered: typeof result = [];
  const pending = [...(threads.get(undefined) ?? [])].reverse();
  while (pending.length) {
    const comment = pending.pop()!; ordered.push(comment); pending.push(...[...(threads.get(comment.id) ?? [])].reverse());
  }
  return ordered;
}

export function validateCommentPatch(_doc: EditDoc, patch: ExtensionPatch): void {
  const field = patch.path[6];
  if (patch.path[0] !== 'slides' || patch.path.length !== 7 || !patch.path[5]
    || !['author', 'initials', 'date', 'text', 'x', 'y', 'parentId', 'deleted'].includes(field)) throw new Error('批注补丁字段无效');
  if (patch.op === 'del') return;
  const value = patch.value;
  if (field === 'deleted' ? typeof value !== 'boolean'
    : field === 'x' || field === 'y' ? typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 22_550_000
    : typeof value !== 'string' || value.length > (field === 'text' ? 1_000_000 : 1024)) throw new Error(`批注 ${field} 无效`);
  if (typeof value === 'string' && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(value)) throw new Error('批注包含 XML 不允许的字符');
  if (field === 'date' && value && (!/^\d{4}-\d{2}-\d{2}T/.test(value as string) || !Number.isFinite(Date.parse(value as string)))) throw new Error('批注日期需要 ISO 8601 字符串');
  if (field === 'parentId' && value === patch.path[5]) throw new Error('批注不能回复自身');
}
