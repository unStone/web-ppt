import type { Context } from 'cordis';
import { slideToPng, slideToSvgFile } from '@web-ppt/core';
import type { ImageMetadata, TextMeasure } from '@web-ppt/core';
import { AgentSession, AgentToolError, listAgentTools } from '@web-ppt/edit-core/agent';
import type { AgentMutationResult, AgentRenderInput, AgentToolFailure, AgentToolName } from '@web-ppt/edit-core/agent';
import { createSvgContrastSampler } from '@web-ppt/edit-core/lint/sampler';
import { prepareFileSave } from './editor-file-save';
import { download } from './download';

interface ModelContext {
  registerTool(tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  }, options: { signal: AbortSignal }): Promise<void>;
}

type ModelDocument = Document & { modelContext?: ModelContext };

function failure(error: unknown): AgentToolFailure {
  const source = error as Partial<AgentToolError>;
  return { ok: false, error: {
    reason: typeof source?.reason === 'string' ? source.reason : 'tool-failed',
    message: error instanceof Error ? error.message : String(error),
    commandIndex: typeof source?.commandIndex === 'number' ? source.commandIndex : null,
    elementId: typeof source?.elementId === 'string' ? source.elementId : null,
    slideNumber: typeof source?.slideNumber === 'number' ? source.slideNumber : null,
  } };
}

function rootSchema(base: Readonly<Record<string, unknown>>): Record<string, unknown> {
  let resolved = base;
  while (typeof resolved.$ref === 'string') {
    resolved = resolved.$ref.split('/').slice(1).reduce((value, key) => value[key] as Record<string, unknown>, base);
  }
  return { ...resolved, ...(base.definitions ? { definitions: base.definitions } : {}) };
}

function active(signal: AbortSignal): void {
  if (signal.aborted) throw new AgentToolError('aborted', '浏览器 Agent 工具调用已取消');
}

async function waitForFonts(signal: AbortSignal): Promise<void> {
  active(signal);
  if (!document.fonts) return;
  let abort = () => {};
  try {
    await Promise.race([document.fonts.ready, new Promise<never>((_, reject) => {
      abort = () => reject(new AgentToolError('aborted', '字体等待已取消'));
      signal.addEventListener('abort', abort, { once: true });
    })]);
    active(signal);
  } finally { signal.removeEventListener('abort', abort); }
}

function browserMeasurement(): TextMeasure {
  let canvas: HTMLCanvasElement | undefined, context: CanvasRenderingContext2D | null | undefined;
  return (text, run, scale) => {
    if (context === undefined) {
      canvas = document.createElement('canvas');
      context = canvas.getContext('2d');
    }
    if (!context) throw new AgentToolError('canvas-unavailable', '当前浏览器不能提供真实 Canvas 字宽');
    const fonts = run.fonts.length ? [...run.fonts] : ['Helvetica', 'Arial'];
    if (/^(等线|dengxian)$/i.test(fonts[0] ?? '')) {
      fonts.push('WebPPT DengXian Latin', 'Arial', 'Helvetica', 'Arimo', 'Liberation Sans');
    }
    fonts.push('PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei');
    const stack = [...new Set(fonts)].map(font => JSON.stringify(font)).join(',');
    const size = run.size * scale * (run.baseline ? .65 : 1);
    context.font = `${run.i ? 'italic ' : ''}${run.b ? '700 ' : '400 '}${size}px ${stack || 'sans-serif'},sans-serif`;
    return context.measureText(text).width + (run.spacing ?? 0) * text.length;
  };
}

async function pixels(svg: string, width: number, height: number, signal?: AbortSignal): Promise<Uint8ClampedArray> {
  if (signal) active(signal);
  const image = new Image();
  let abort = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => { image.src = ''; reject(new AgentToolError('aborted', '对比度取样已取消')); };
      signal?.addEventListener('abort', abort, { once: true });
      image.onload = () => resolve();
      image.onerror = () => reject(new AgentToolError('contrast-rasterizer-failed', '浏览器无法解码对比度取样 SVG'));
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    if (signal) active(signal);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new AgentToolError('canvas-unavailable', '当前浏览器不能提供对比度取样 Canvas');
      context.drawImage(image, 0, 0, width, height);
      return context.getImageData(0, 0, width, height).data;
    } finally { canvas.width = canvas.height = 0; }
  } finally {
    signal?.removeEventListener('abort', abort);
    image.onload = image.onerror = null;
  }
}

async function imageSize(src: string, signal: AbortSignal): Promise<ImageMetadata> {
  active(signal);
  const image = new Image();
  let abort = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => { image.src = ''; reject(new AgentToolError('aborted', '图片尺寸读取已取消')); };
      signal.addEventListener('abort', abort, { once: true });
      image.onload = () => resolve();
      image.onerror = () => reject(new AgentToolError('image-metadata-unavailable', '浏览器无法读取图片的原始尺寸'));
      image.src = src;
    });
    active(signal);
    // naturalWidth/Height 是浏览器按密度修正后的 CSS 像素，统一以 CSS 的 96dpi 表示。
    return { width: image.naturalWidth, height: image.naturalHeight, dpiX: 96, dpiY: 96 };
  } finally {
    signal.removeEventListener('abort', abort);
    image.onload = image.onerror = null;
  }
}

/** 工具借用文稿的 Editor；注册和调用结束前，文稿资源必须继续由其原作用域持有。 */
export const editorWebMcpPlugin = {
  name: 'editor-document-webmcp',
  inject: ['editorHost', 'editorDocument', 'editorFiles', 'editorRecovery'],
  async apply(ctx: Context, config: { signal?: AbortSignal } = {}) {
    const modelContext = (document as ModelDocument).modelContext;
    if (typeof modelContext?.registerTool !== 'function') return;
    const documentScope = ctx.editorDocument;
    const { session } = documentScope;
    const lifetime = new AbortController();
    const cancel = () => lifetime.abort();
    config.signal?.addEventListener('abort', cancel, { once: true });
    if (config.signal?.aborted) lifetime.abort();
    let closed = false, revision = 0;
    const stop = () => { closed = true; lifetime.abort(); };
    documentScope.stopAgentTools = stop;
    let pending: Promise<void> = Promise.resolve();
    const measureText = browserMeasurement();
    const unsubscribe = session.editor.subscribe(change => { if (change.source !== 'selection') revision++; });
    ctx.effect(() => () => {
      stop();
      if (documentScope.stopAgentTools === stop) delete documentScope.stopAgentTools;
      config.signal?.removeEventListener('abort', cancel);
      unsubscribe();
      return pending;
    });
    const current = (signal: AbortSignal, writable = false) => {
      active(signal);
      const snapshot = ctx.editorHost.tools?.snapshot();
      if (closed || session.disposed || snapshot?.session !== session) {
        throw new AgentToolError('document-unavailable', '工具绑定的文稿已经关闭、切换或尚未就绪');
      }
      if (writable && !snapshot.writable) {
        throw new AgentToolError('document-not-writable', '当前文稿未开放编辑：请确认编辑模式、格式转换及文件任务状态');
      }
      return snapshot;
    };

    const run = async (name: AgentToolName, input: unknown, signal: AbortSignal): Promise<unknown> => {
      const writing = name === 'edit' || name === 'undo' || name === 'redo' || name === 'save';
      const snapshot = current(signal, writing);
      if (ctx.editorFiles.busy) throw new AgentToolError('document-busy', '当前文稿正在完成文件任务');
      if (name === 'save') {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) {
          throw new AgentToolError('invalid-input', 'ppt_save 参数必须是空对象');
        }
        const fileName = `${snapshot.name.replace(/\.(pptx?|potx?|ppsx?)$/i, '')}-edited.pptx`;
        return ctx.editorFiles.withDocumentTask(session, async () => {
          current(signal);
          const prepared = await prepareFileSave(session);
          try {
            current(signal);
            if (prepared.changed) throw new AgentToolError('document-changed', '文稿在生成期间已变化，请重新保存');
            download(new Blob([new Uint8Array(prepared.bytes)], {
              type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            }), fileName);
            prepared.confirm();
            await ctx.editorRecovery.flush(session);
            return { ok: true, value: { fileName, bytes: prepared.bytes.byteLength } };
          } finally { prepared.release(); }
        });
      }
      if (name === 'edit' || name === 'undo' || name === 'redo' || name === 'lint' || name === 'render') {
        await waitForFonts(signal);
        current(signal, writing);
      }
      const presentation = session.toPresentation();
      const agent = new AgentSession(session.editor, {
        measureText, presentation,
        lint: {
          signal, measureText,
          resolveContrast: createSvgContrastSampler({ rasterize: pixels, embeddedFonts: presentation.embeddedFonts }),
          resolveImageMetadata: context => context.element.kind === 'image' ? imageSize(context.element.src, signal) : undefined,
        },
        rasterize: async () => {
          const render = input as AgentRenderInput;
          const slide = presentation.slides[render.slideNumber - 1];
          const fonts = await import('./export-fonts').then(({ exportFontOptions }) => exportFontOptions([slide]));
          const blob = await slideToPng(presentation, slide, render.scale,
            { strictResources: true, ...(fonts ? { fonts } : {}) });
          active(signal);
          return new Uint8Array(await blob.arrayBuffer());
        },
      });
      const call = () => agent.call(name, input as never);
      if (writing) {
        const task = call();
        const committedRevision = revision;
        const result = await task;
        if (result.ok && (signal.aborted || revision !== committedRevision)) {
          const value = result.value as AgentMutationResult;
          return { ok: true, value: { ...value, lint: { status: 'failed', slideNumbers: value.lint.slideNumbers,
            reason: signal.aborted ? 'aborted' : 'document-changed',
            message: '命令已提交；提交后的布局观察因取消或后续编辑而失效',
          } } };
        }
        return result;
      }
      const read = async () => {
        current(signal);
        const version = revision;
        let result = await call();
        if (result.ok && name === 'render' && (input as AgentRenderInput).format === 'svg') {
          const render = input as AgentRenderInput;
          const slide = presentation.slides[render.slideNumber - 1];
          // 使用既有资源内联路径，返回值不依赖当前文稿的 blob URL。
          const fonts = await import('./export-fonts').then(({ exportFontOptions }) => exportFontOptions([slide]));
          const data = await slideToSvgFile(presentation, slide, undefined, fonts ? { fonts } : {});
          result = { ok: true, value: { slideNumber: render.slideNumber, format: 'svg', data } };
        }
        current(signal);
        if (revision !== version) throw new AgentToolError('document-changed', '文稿在读取期间已变化，请重新调用工具');
        return result;
      };
      return name === 'lint' || name === 'render' ? ctx.editorFiles.withDocumentTask(session, read) : read();
    };

    try {
      for (const tool of listAgentTools()) {
        active(lifetime.signal);
        await modelContext.registerTool({
          name: `ppt_${tool.name}`, description: tool.description, inputSchema: rootSchema(tool.inputSchema),
          execute(input, options = {}) {
            const request = new AbortController();
            const abort = () => request.abort();
            lifetime.signal.addEventListener('abort', abort, { once: true });
            options.signal?.addEventListener('abort', abort, { once: true });
            if (lifetime.signal.aborted || options.signal?.aborted) request.abort();
            const task = pending.then(() => run(tool.name, input, request.signal)).catch(failure).finally(() => {
              lifetime.signal.removeEventListener('abort', abort);
              options.signal?.removeEventListener('abort', abort);
            });
            pending = task.then(() => {});
            return task;
          },
        }, { signal: lifetime.signal });
      }
    } catch (error) {
      const cancelled = lifetime.signal.aborted;
      stop();
      await pending;
      if (!cancelled) throw error;
    }
  },
};
