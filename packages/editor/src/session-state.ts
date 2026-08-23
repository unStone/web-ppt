import type { Presentation } from '@web-ppt/core';
import type { EditorSession } from './session';
import type { SlideEditor } from './slide-editor';

interface SessionState {
  presentation: Presentation;
  views: Set<SlideEditor>;
}

const states = new WeakMap<EditorSession, SessionState>();

export function registerSession(session: EditorSession, presentation: Presentation): void {
  states.set(session, { presentation, views: new Set() });
}

export function sessionState(session: EditorSession): SessionState {
  const state = states.get(session);
  if (!state) throw new Error('编辑会话已经释放');
  return state;
}

export function releaseSession(session: EditorSession): void {
  states.delete(session);
}
