import type { Context } from 'cordis';
import { bindEditorFileOpen } from './editor-file-actions';
import { whyFailed } from './fetch-bytes';
import { message, type SiteMessage, type SiteNotice } from './i18n/message';

type Source = File | Blob | ArrayBuffer | Uint8Array;
export interface EditorOpenHost {
  readonly input: HTMLInputElement;
  readonly dropLayer: HTMLElement;
  readonly newFile: HTMLButtonElement;
  confirmReplacement(): boolean;
  open(source: Source, name: string, options: { newDocument?: boolean }, signal: AbortSignal): Promise<void>;
  failed(error: SiteMessage): void;
  cancelled(): void;
}

export interface EditorOpening {
  readonly generation: number;
  open(source: Source, name: string): Promise<void>;
  create(): Promise<void>;
  loadExample(url: URL, name: string): Promise<void>;
  dispose(): Promise<void>;
}

declare module 'cordis' {
  interface Context { editorOpening: EditorOpening }
}

/** 打开意图跨解析、恢复和模板选择持续存在；应用卸载必须取消整条链路。 */
export const editorOpenPlugin = {
  name: 'editor-open',
  inject: ['editorRecovery', 'editorFiles'],
  apply(ctx: Context, { host, notice }: { host: EditorOpenHost; notice: SiteNotice }) {
    ctx.effect(function* () {
      const lifetime = new AbortController(), tasks = new Set<Promise<void>>();
      let generation = 0, disposed = false, request: AbortController | undefined;
      let example: AbortController | undefined;
      let closing: Promise<void> | undefined;
      const track = (action: () => Promise<void>) => {
        if (disposed) return Promise.resolve();
        let resolve!: () => void, reject!: (error: unknown) => void;
        const task = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
        tasks.add(task);
        void task.then(() => tasks.delete(task), () => tasks.delete(task));
        try { void action().then(resolve, reject); }
        catch (error) { reject(error); }
        return task;
      };
      const begin = () => {
        generation++;
        request?.abort();
        example?.abort();
        ctx.editorRecovery.cancelPending();
        request = new AbortController();
        return request.signal;
      };
      const allowed = (creating: boolean) => {
        if (disposed) return false;
        if (ctx.editorFiles.busy) {
          notice(message(creating ? '文件任务完成前不能新建文稿' : '文件任务完成前不能切换文稿'));
          return false;
        }
        return host.confirmReplacement();
      };
      const service: EditorOpening = {
        get generation() { return generation; },
        open(source, name) {
          return track(() => host.open(source, name, {}, begin()));
        },
        create() {
          if (!allowed(true)) return Promise.resolve();
          return track(async () => {
            const signal = begin();
            try {
              const { chooseNewDocument } = await import('./editor-template-picker');
              if (signal.aborted) return;
              const created = await chooseNewDocument(signal);
              if (signal.aborted) return;
              if (!created) { host.cancelled(); return; }
              await host.open(created.bytes, created.fileName, { newDocument: true }, signal);
            } catch (error) {
              if (signal.aborted) return;
              host.cancelled();
              notice(message('新建失败：{detail}', { detail: error instanceof Error ? error.message : String(error) }), 'error');
            }
          });
        },
        loadExample(url, name) {
          if (generation) return Promise.resolve();
          return track(async () => {
            example?.abort();
            const controller = example = new AbortController();
            try {
              const response = await fetch(url, { signal: controller.signal });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              const bytes = await response.arrayBuffer();
              // 示例下载不代表用户意图，迟到的结果不能覆盖本地打开或模板选择。
              if (!controller.signal.aborted && !generation) await service.open(bytes, name);
            } catch (error) {
              if (!controller.signal.aborted && !generation) host.failed(message(
                '示例下载失败：{detail}。仍可打开本地文件或新建文稿。', { detail: whyFailed(error) }));
            }
          });
        },
        dispose() {
          if (closing) return closing;
          disposed = true;
          generation++;
          lifetime.abort();
          request?.abort();
          example?.abort();
          ctx.editorRecovery.cancelPending();
          return closing = Promise.allSettled([...tasks]).then(() => {});
        },
      };
      yield () => service.dispose();
      yield ctx.provide('editorOpening', service);
      host.newFile.addEventListener('click', () => { void service.create(); }, { signal: lifetime.signal });
      bindEditorFileOpen(host.input, host.dropLayer, file => {
        if (file && allowed(false)) void service.open(file, file.name);
      }, lifetime.signal);
    });
  },
};
