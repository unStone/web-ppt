import type { Context,Fiber } from 'cordis';
import type { EditorSession, SelectionPane, SlideEditor, SlideEditorOptions } from '@web-ppt/editor';
import type { PresetAdjustmentEditor } from '@web-ppt/editor/adjustments';
import { bindPaneLabels } from './editor-pane-labels';
import { bindViewLabels } from './editor-view-labels';
import type { EditorToolsHost } from './editor-tools-plugin';
import {editorFontsPlugin} from './editor-fonts-plugin';
import type {DocumentFontService} from './editor-document-fonts';

export interface DocumentModules {
  adjustments: typeof import('@web-ppt/editor/adjustments');
  accessibility?: typeof import('@web-ppt/editor/accessibility');
  inputEnhancement?: typeof import('@web-ppt/editor/edit-context');
}

export interface EditorDocument {
  readonly session: EditorSession;
  readonly view: SlideEditor;
  readonly pane: SelectionPane;
  adjustments: PresetAdjustmentEditor | null;
  fonts?: DocumentFontService;
}

export interface EditorHost {
  readonly tools?: EditorToolsHost;
  readonly canvas: HTMLElement;
  readonly objects: HTMLElement;
  readonly textTools: readonly HTMLElement[];
  onChange: Parameters<EditorSession['editor']['subscribe']>[0];
}

interface DocumentConfig {
  session: EditorSession;
  signal: AbortSignal;
  viewOptions: SlideEditorOptions;
  modules: DocumentModules;
}

declare module 'cordis' {
  interface Context {
    editorHost: EditorHost;
    editorDocument: EditorDocument;
  }
}

const documentView = {
  name: 'editor-document-view',
  inject: ['editorHost','editorFonts','editorFiles'],
  apply(ctx: Context, { session, viewOptions }: DocumentConfig) {
    const host = ctx.editorHost;
    ctx.effect(function* () { yield ctx.editorFiles.bindDocument(session,ctx.editorFonts); });
    const view = session.mount(host.canvas, viewOptions);
    const pane = session.mountSelectionPane(host.objects, {
      mode: viewOptions.mode, ariaLabel: '当前页对象', onError: viewOptions.onError,
    });
    ctx.provide('editorDocument', { session, view, pane, adjustments: null, fonts:ctx.editorFonts });
  },
};

const documentTools = {
  name: 'editor-document-tools',
  inject: ['editorHost', 'editorDocument'],
  apply(ctx: Context, { modules, viewOptions }: DocumentConfig) {
    const { session, view, pane } = ctx.editorDocument;
    const host = ctx.editorHost;
    ctx.effect(function* () {
      const adjustments = modules.adjustments.createPresetAdjustmentEditor(session, view, {
        onError: viewOptions.onError,
      });
      ctx.editorDocument.adjustments = adjustments;
      yield () => { adjustments.destroy(); };
      yield bindPaneLabels(session, pane);
      yield bindViewLabels(session, view);
      if (modules.accessibility) yield modules.accessibility.createCanvasAccessibility(session, view).dispose;
      if (modules.inputEnhancement) yield modules.inputEnhancement.enableEditContext(session, view).dispose;
      // 语言入口也属于文字工具，必须在 document 捕获阶段保住文字选择。
      for (const element of host.textTools) yield view.registerTextUi(element);
      yield session.editor.subscribe(host.onChange);
    });
  },
};

export const documentWorkspace = {
  name: 'editor-document-workspace',
  async apply(ctx: Context, config: DocumentConfig) {
    let release = ctx.effect(() => () => { config.session.dispose(); });
    const own = (fiber: Fiber) => {
      const previous = release;
      // Cordis disposer 也是 thenable；async generator 的 yield 会先解包它，导致原 disposer
      // 仍被根作用域并行释放。同步收编原函数，才能按工具、视图、字体、会话的顺序等待清理。
      release = ctx.effect(function* () { yield previous; yield fiber.dispose; });
      return fiber;
    };
    await own(ctx.plugin(editorFontsPlugin,{session:config.session,signal:config.signal}));
    if (ctx.fiber.uid === null || config.signal.aborted) return;
    await own(ctx.plugin(documentView,config));
    if (ctx.fiber.uid === null || config.signal.aborted) return;
    await own(ctx.plugin(documentTools,config));
  },
};
