import { createCommentEditor } from '@web-ppt/edit-core/comments';
import type { CommentContext } from './comments-tools';
import { setText } from './i18n/runtime';

export function bindCommentEditing(host: HTMLElement, current: () => CommentContext | null) {
  const owner = current()!.owner;
  const form = document.createElement('form'); form.dataset.commentEditor = '';
  form.innerHTML = `<style>[data-comment-editor] label{display:block;margin:10px 0}[data-comment-editor] input,[data-comment-editor] textarea{box-sizing:border-box;width:100%}[data-comment-actions]{display:flex;gap:6px}</style>
<h3></h3><label><span data-author></span><input name="author" required maxlength="1024"></label>
<label><span data-text></span><textarea name="text" required rows="3" maxlength="1000000"></textarea></label>
<button type="submit" data-comment-submit></button><button type="button" data-comment-cancel></button><p role="alert"></p>`;
  setText(form.querySelector('[data-author]')!, '批注作者'); setText(form.querySelector('[data-text]')!, '批注正文');
  setText(form.querySelector('[data-comment-submit]')!, '应用'); setText(form.querySelector('[data-comment-cancel]')!, '取消');
  const author = form.querySelector<HTMLInputElement>('[name=author]')!;
  const text = form.querySelector<HTMLTextAreaElement>('[name=text]')!;
  const error = form.querySelector<HTMLElement>('[role=alert]')!;
  let editingId: string | undefined, parentId: string | undefined, page: string | undefined;
  const reset = () => { editingId = undefined; parentId = undefined; text.value = ''; error.textContent = ''; setText(form.querySelector('h3')!, '新增批注'); };
  form.querySelector<HTMLButtonElement>('[data-comment-cancel]')!.onclick = reset;
  const context = () => {
    const value = current();
    return value?.owner === owner && value.editing?.writable ? value.editing : undefined;
  };
  form.onsubmit = (event) => {
    event.preventDefault(); const target = context(); if (!target) return;
    try {
      const api = createCommentEditor(target.editor);
      if (editingId) api.update(target.slideId, editingId, { author: author.value, text: text.value });
      else {
        const parent = parentId && api.query(target.slideId).find((c) => c.id === parentId);
        api.add(target.slideId, { author: author.value, text: text.value, x: parent ? parent.x : 32,
          y: parent ? parent.y : 32, date: new Date().toISOString(), ...(parentId ? { parentId } : {}) });
      }
      reset();
    } catch (cause) { setText(error, '批注修改失败：{detail}', { detail: cause instanceof Error ? cause.message : String(cause) }); }
  };
  host.querySelector('[data-content]')!.after(form); reset();
  const sync = () => {
    const target = context(); form.hidden = !target;
    if (page !== target?.slideId) { page = target?.slideId; reset(); }
    for (const item of host.querySelectorAll<HTMLElement>('[data-comment-id]')) {
      item.querySelector('[data-comment-actions]')?.remove();
      if (!target) continue;
      const actions = document.createElement('div'); actions.dataset.commentActions = '';
      for (const [action, label] of [['edit', '修改批注'], ['reply', '回复批注'], ['delete', '删除批注']] as const) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.commentAction = action; setText(button, label);
        button.onclick = () => {
          const active = context(); if (!active || active.slideId !== target.slideId) return;
          const api = createCommentEditor(active.editor), id = item.dataset.commentId!;
          const comment = api.query(active.slideId).find((c) => c.id === id); if (!comment) return;
          if (action === 'delete') { api.remove(active.slideId, id); reset(); return; }
          reset();
          if (action === 'edit') { editingId = id; author.value = comment.author; text.value = comment.text; setText(form.querySelector('h3')!, '修改批注'); }
          else { parentId = id; setText(form.querySelector('h3')!, '回复批注'); }
          text.focus();
        };
        actions.append(button);
      }
      item.append(actions);
    }
  };
  sync();
  return { sync, dispose() { form.remove(); } };
}
