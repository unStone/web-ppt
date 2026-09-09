import type { Context } from 'cordis';
import type { EditorSession, SlideEditor } from '@web-ppt/editor';
import type { PresetAdjustmentEditor } from '@web-ppt/editor/adjustments';
import type { ChartInspector } from './editor-chart-inspector';
import { bindCommentsTools } from './comments-tools';
import { bindContentTools } from './editor-content-tools';
import { createProductTools } from './editor-product-tools';
import { createEditorInspector } from './editor-inspector';
import { createSlideInspector } from './editor-slide-inspector';
import { editorButtons, editorElements } from './editor-elements';
import { message, type SiteNotice } from './i18n/message';
import type {DocumentFontService} from './editor-document-fonts';

export interface EditorToolsHost {
  snapshot(): { session: EditorSession | null; view: SlideEditor | null;
    fonts?: DocumentFontService;
    adjustments: PresetAdjustmentEditor | null; writable: boolean; name: string };
  showSlide(id: string): void;
  openInspector(): void;
}

export interface EditorTools {
  readonly showComments: boolean;
  sync(): void;
  reset(): void;
  bindSession(): void;
  dispose(): void;
}

declare module 'cordis' {
  interface Context { editorTools: EditorTools }
}

/** 工具跨文稿复用，入口属于应用；异步选择与弹窗则必须随当前文稿失效。 */
export const editorToolsPlugin = {
  name: 'editor-tools',
  apply(ctx: Context, { host, notice }: { host: EditorToolsHost; notice: SiteNotice }) {
    ctx.effect(function* () {
      const controller = new AbortController(), { signal } = controller;
      yield () => controller.abort();
      let generation = 0;
      let requests = new AbortController();
      yield () => requests.abort();
      let chart: ChartInspector | undefined, chartLoading: Promise<void> | undefined;
      let closeMedia: (() => void) | undefined, closeSize: (() => void) | undefined;
      let closeFonts: (() => void) | undefined, fontsLoading = false;
      const context = () => ({ ...host.snapshot(), requestSignal: requests.signal,
        showSlide: host.showSlide, openInspector: host.openInspector });
      const product = createProductTools(context, notice, signal);
      yield () => product.destroy();
      const content = bindContentTools(context, notice, signal);
      yield content;
      const comments = bindCommentsTools(document.querySelector<HTMLButtonElement>('#commentsTools')!, () => {
        const { session, view, writable, name } = host.snapshot();
        return session && view ? { owner: session, editing: { editor: session.editor, slideId: view.slideId, writable },
          slide: session.editor.toSlide(view.slideId), presentation: () => session.toPresentation(), name } : null;
      }, signal);
      yield () => comments.destroy();
      const inspector = createEditorInspector(editorElements.inspectorElement, context, notice, signal);
      yield () => inspector.destroy();
      const slides = createSlideInspector(editorElements.inspectorElement, context, notice, signal);
      yield () => slides.destroy();
      const reset = () => {
        generation++;
        requests.abort();
        if (!signal.aborted) requests = new AbortController();
        closeMedia?.(); closeMedia = undefined;
        closeSize?.(); closeSize = undefined;
        closeFonts?.(); closeFonts = undefined; fontsLoading = false;
        comments.reset(); inspector.reset();
        chart?.destroy(); chart = undefined; chartLoading = undefined;
      };
      yield reset;
      const syncChart = () => {
        if (chart) { chart.sync(); return; }
        const { session } = host.snapshot(), selection = session?.editor.selection;
        const id = selection?.kind === 'elements' && selection.ids.length === 1 ? selection.ids[0] : null;
        const record = id && session?.editor.doc.elements[id];
        // 同一检查器还承载以图片框架呈现的 OLE，不能用渲染形状判断内部编辑能力。
        if (!record || record.meta.editable !== 'frame' || chartLoading) return;
        const attempt = generation;
        const pending = import('./editor-chart-inspector').then(({ createChartInspector }) => {
          if (signal.aborted || attempt !== generation || host.snapshot().session !== session) return;
          chart = createChartInspector(editorElements.inspectorElement.querySelector<HTMLElement>('#chartInspector')!, context, notice);
          chart.sync();
        }).catch(error => {
          const current = host.snapshot().session?.editor.selection;
          if (!signal.aborted && attempt === generation && host.snapshot().session === session
            && current?.kind === 'elements' && current.ids.length === 1 && current.ids[0] === id) {
            notice(message('无法加载图表工具：{detail}', { detail: error instanceof Error ? error.message : String(error) }), 'error');
          }
        }).finally(() => { if (chartLoading === pending) chartLoading = undefined; });
        chartLoading = pending;
      };
      const run = async (action: (valid: () => boolean) => Promise<void>) => {
        const attempt = generation, session = host.snapshot().session;
        const valid = () => !signal.aborted && attempt === generation && host.snapshot().session === session
          && host.snapshot().writable;
        if (!session || !valid()) return;
        try { await action(valid); } catch (error) {
          if (valid()) notice(message('对象操作失败：{detail}', { detail: error instanceof Error ? error.message : String(error) }), 'error');
        }
      };
      editorButtons.media.addEventListener('click', () => void run(async valid => {
        const { showMediaTools } = await import('./editor-media-tools');
        if (!valid()) return;
        const close = showMediaTools(context, notice, () => { if (closeMedia === close) closeMedia = undefined; });
        closeMedia = close ?? closeMedia;
      }), { signal });
      editorButtons.fonts?.addEventListener('click', () => {
        const attempt = generation, session = host.snapshot().session;
        if (!session || !host.snapshot().fonts || fontsLoading || closeFonts) return;
        fontsLoading = true;
        void import('./editor-font-tools').then(({showFontTools}) => {
          if (signal.aborted || attempt !== generation || host.snapshot().session !== session) return;
          closeFonts = showFontTools(context,() => { closeFonts = undefined; });
        }).catch(error => {
          if (!signal.aborted && attempt === generation) notice(message('字体检查失败：{detail}',{detail:String(error)}),'error');
        }).finally(() => { if (attempt === generation) fontsLoading = false; });
      }, { signal });
      document.querySelector<HTMLButtonElement>('#slideSizeTools')!.addEventListener('click', () => void run(async valid => {
        const { showSlideSizeTools } = await import('./editor-resize-tools');
        if (!valid()) return;
        closeSize?.(); closeSize = showSlideSizeTools(host.snapshot().session!, () => host.snapshot().session);
      }), { signal });
      const tools: EditorTools = {
        get showComments() { return comments.showComments; },
        reset,
        bindSession() { if (!signal.aborted) { reset(); product.bindSession(); } },
        sync() {
          if (signal.aborted) return;
          product.sync(); comments.sync(); inspector.sync(); slides.sync(); syncChart();
        },
        dispose() {
          if (signal.aborted) return;
          controller.abort(); reset(); content(); product.destroy(); comments.destroy(); inspector.destroy(); slides.destroy();
        },
      };
      yield ctx.provide('editorTools', tools);
    });
  },
};
