import { parse } from '@web-ppt/core';
import type { ParseOptions } from '@web-ppt/core';
import { createDoc, disposeDoc, Editor } from '@web-ppt/edit-core';
import type { CreateDocOptions, EditorOptions } from '@web-ppt/edit-core';
import { registerSession, releaseSession, sessionState } from './session-state';
import { createSlideEditor } from './slide-editor';
import type { SlideEditor, SlideEditorOptions } from './slide-editor-types';

export interface OpenEditorOptions extends CreateDocOptions, EditorOptions {
  password?: ParseOptions['password'];
}

/** 一份源文件只建立一个所有者，DOM 视图与框架适配器共享同一 headless Editor。 */
export interface EditorSession {
  readonly editor: Editor;
  readonly disposed: boolean;
  mount(container: HTMLElement, options?: SlideEditorOptions): SlideEditor;
  dispose(): void;
}

class BrowserEditorSession implements EditorSession {
  readonly editor: Editor;
  private isDisposed = false;

  constructor(editor: Editor, presentation: Awaited<ReturnType<typeof parse>>) {
    this.editor = editor;
    registerSession(this, presentation);
  }

  get disposed(): boolean { return this.isDisposed; }

  mount(container: HTMLElement, options: SlideEditorOptions = {}): SlideEditor {
    if (this.isDisposed) throw new Error('不能挂载已经释放的编辑会话');
    return createSlideEditor(container, this, options);
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    const state = sessionState(this);
    for (const view of [...state.views]) view.destroy();
    disposeDoc(this.editor.doc);
    releaseSession(this);
  }
}

export async function openEditor(
  input: File | Blob | ArrayBuffer | Uint8Array,
  options: OpenEditorOptions = {},
): Promise<EditorSession> {
  const presentation = await parse(input, {
    edit: true,
    keepPackage: true,
    lazy: false,
    ...(options.password === undefined ? {} : { password: options.password }),
  });
  try {
    const doc = createDoc(presentation, { idPrefix: options.idPrefix });
    return new BrowserEditorSession(new Editor(doc, {
      origin: options.origin,
      historyLimit: options.historyLimit,
      historyByteLimit: options.historyByteLimit,
    }), presentation);
  } catch (error) {
    presentation.dispose?.();
    throw error;
  }
}
