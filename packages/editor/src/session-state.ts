import type { Presentation } from '@web-ppt/core';
import type { EditorSession } from './session';
import type { SlideEditor } from './slide-editor';

interface SessionState {
  presentation: Presentation;
  views: Set<SlideEditor>;
  textOwner: TextEditingOwner | null;
}

interface TextEditingOwner { releaseTextEditing(): void }

const states = new WeakMap<EditorSession, SessionState>();

export function registerSession(session: EditorSession, presentation: Presentation): void {
  states.set(session, { presentation, views: new Set(), textOwner: null });
}

export function sessionState(session: EditorSession): SessionState {
  const state = states.get(session);
  if (!state) throw new Error('编辑会话已经释放');
  return state;
}

export function releaseSession(session: EditorSession): void {
  states.delete(session);
}

/** contenteditable 是视图本地资源；同一会话只能有一个 DOM 所有者。 */
export function claimTextEditing(session: EditorSession, owner: TextEditingOwner): void {
  const state = sessionState(session);
  if (state.textOwner === owner) return;
  state.textOwner?.releaseTextEditing();
  state.textOwner = owner;
}

export function releaseTextEditing(session: EditorSession, owner: TextEditingOwner): void {
  const state = sessionState(session);
  if (state.textOwner === owner) state.textOwner = null;
}
