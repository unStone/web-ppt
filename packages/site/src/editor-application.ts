import { Context, type Fiber } from 'cordis';
import type { EditorSession, SlideEditorOptions } from '@web-ppt/editor';
import { documentWorkspace, type DocumentModules, type EditorDocument, type EditorHost } from './editor-document-plugins';
import { editorRecoveryPlugin } from './editor-recovery-plugin';
import { editorFilesPlugin, type EditorFileHost } from './editor-files-plugin';
import { editorOpenPlugin, type EditorOpenHost } from './editor-open-plugin';
import { editorToolsPlugin } from './editor-tools-plugin';
import { editorPagePlugin } from './editor-page-plugin';
import type { SiteNotice } from './i18n/message';

export interface EditorApplication {
  readonly recovery: Context['editorRecovery'];
  readonly files: Context['editorFiles'];
  readonly opening?: Context['editorOpening'];
  readonly tools?: Context['editorTools'];
  readonly page?: Context['editorPage'];
  replace(session: EditorSession, viewOptions: SlideEditorOptions, modules: DocumentModules,
    signal: AbortSignal): Promise<EditorDocument | undefined>;
  dispose(): Promise<void>;
}

export async function createSiteEditorApplication(): Promise<EditorApplication> {
  const context = new Context();
  try {
    await context.plugin(editorPagePlugin);
    const page = context.editorPage;
    const application = await startApplication(context, page.host, page.notice, page.fileHost, page.openHost);
    try { page.connect(application); }
    catch (error) { await application.dispose(); throw error; }
    return application;
  } catch (error) { await context.fiber.dispose(); throw error; }
}

/** 产品层拥有文稿插件的生命周期；可发布的编辑 SDK 无需认识 Cordis。 */
export async function createEditorApplication(host: EditorHost, notice: SiteNotice, fileHost?: EditorFileHost,
  openHost?: EditorOpenHost): Promise<EditorApplication> {
  return startApplication(new Context(), host, notice, fileHost, openHost);
}

async function startApplication(context: Context, host: EditorHost, notice: SiteNotice, fileHost?: EditorFileHost,
  openHost?: EditorOpenHost): Promise<EditorApplication> {
  context.provide('editorHost', host);
  try {
    if (host.tools) await context.plugin(editorToolsPlugin, { notice, host: host.tools });
    await context.plugin(editorRecoveryPlugin, { notice });
    await context.plugin(editorFilesPlugin, { notice, host: fileHost });
    if (openHost) await context.plugin(editorOpenPlugin, { notice, host: openHost });
  }
  catch (error) { await context.fiber.dispose(); throw error; }
  const recovery = context.editorRecovery;
  const files = context.editorFiles;
  const opening = context.get('editorOpening');
  const tools = context.get('editorTools');
  const page = context.get('editorPage');
  let active: Fiber | undefined;
  let currentSession: EditorSession | undefined;
  let revision = 0;
  let pending: Promise<void> = Promise.resolve();
  let closing: Promise<void> | undefined;
  let disposed = false;
  let initializing: AbortController | undefined;

  return {
    recovery,
    files,
    opening,
    tools,
    page,
    replace(session: EditorSession, viewOptions: SlideEditorOptions, modules: DocumentModules,
      signal: AbortSignal): Promise<EditorDocument | undefined> {
      const owner = ++revision;
      initializing?.abort();
      const stale = () => disposed || owner !== revision || signal.aborted;
      const task = pending.catch(() => {}).then(async () => {
        let adopted = false;
        let installed: Fiber | undefined;
        const resumeFiles = files.pause();
        try {
          if (stale()) return;
          await files.whenIdle();
          if (stale()) return;
          tools?.reset();
          await active?.dispose();
          await recovery.flush(currentSession ?? null);
          active = undefined;
          currentSession = undefined;
          if (stale()) return;
          host.canvas.replaceChildren();
          host.objects.replaceChildren();
          const scope = context.isolate('editorDocument').isolate('editorFonts');
          const loading = new AbortController(), cancel = () => loading.abort();
          initializing = loading;
          signal.addEventListener('abort',cancel,{once:true});
          const workspace = scope.plugin(documentWorkspace, { session, viewOptions, modules,signal:loading.signal });
          active = installed = workspace;
          currentSession = session;
          try { await workspace; }
          finally {
            signal.removeEventListener('abort',cancel);
            if (initializing === loading) initializing = undefined;
          }
          if (!stale()) {
            const document = scope.editorDocument;
            adopted = true;
            return document;
          }
        } finally {
          try {
            // 请求可能在插件开始执行前过期，不能只依赖插件内部尚未注册的清理。
            if (!adopted) {
              await installed?.dispose();
              if (active === installed) { active = undefined; currentSession = undefined; }
              session.dispose();
              await recovery.flush(session);
            }
          } finally { resumeFiles(); }
        }
      });
      pending = task.then(() => {}, () => {});
      return task;
    },
    dispose(): Promise<void> {
      if (closing) return closing;
      disposed = true;
      initializing?.abort();
      revision++;
      page?.stop();
      tools?.dispose();
      recovery.cancelPending();
      const opened = opening?.dispose();
      const saved = files.dispose();
      return closing = Promise.all([pending, opened, saved]).then(async () => {
        await active?.dispose();
        // 会话销毁会排空内存中的恢复帧；落盘完成后才能关闭应用级存储连接。
        await recovery.flush(currentSession ?? null);
        active = undefined;
        currentSession = undefined;
        await context.fiber.dispose();
      });
    },
  };
}
