import type {EmbeddedFont} from '@web-ppt/core';
import type {EditorSession} from '@web-ppt/editor';
import type {FontFaceInfo,FontGlyphProvider,FontRequestOptions,FontResult,FontSource} from '@web-ppt/fonts/glyphs';

export interface EmbeddedFontStatus {source: EmbeddedFont; result: FontResult<FontFaceInfo>}
export interface DocumentFontReader {
  readonly signal: AbortSignal;
  readonly provider: Pick<FontGlyphProvider,'resolve'|'embedding'|'shape'>;
}
export interface DocumentFontService {
  initialize(signal?: AbortSignal): Promise<void>;
  provider(signal?: AbortSignal): Promise<FontGlyphProvider>;
  withFonts<T>(signal: AbortSignal | undefined, action: (fonts: DocumentFontReader) => Promise<T>): Promise<T>;
  embedded(options: FontRequestOptions): Promise<EmbeddedFontStatus[]>;
  activate(options: {signal?: AbortSignal}): Promise<EmbeddedFontStatus[]>;
  load(source: Omit<FontSource,'id'>, options: {signal?: AbortSignal}): Promise<FontResult<FontFaceInfo>>;
  activeFaces(): FontFaceInfo[];
  state(): {disposed:boolean; loaded:boolean; workerActive:boolean; retainedFontBytes:number; installedFaces:number; initialIssues:number};
  dispose(): Promise<void>;
}

function waitFor<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve,reject) => {
    const stop = () => { signal.removeEventListener('abort',stop); reject(new DOMException('字体加载已取消','AbortError')); };
    if (signal.aborted) stop(); else signal.addEventListener('abort',stop,{once:true});
    task.then(resolve,reject).finally(() => signal.removeEventListener('abort',stop));
  });
}

/** 文稿只拥有一个按需 runtime；模块下载完毕时仍要重新检查所有权。 */
export function createDocumentFontService(session: EditorSession): DocumentFontService {
  // 编辑文稿只能使用检查过的字体；源容器继续由 session.embeddedFontSources 持有。
  session.setFontResources([],{browserFontsReady:true});
  const lifetime = new AbortController();
  let initialization: Promise<void> | undefined, initialIssues = 0;
  let provider: FontGlyphProvider | undefined;
  let worker: ReturnType<typeof import('@web-ppt/fonts/glyphs/worker').createWorkerFontShaper> | undefined;
  let loading: Promise<FontGlyphProvider> | undefined, tail: Promise<unknown> = Promise.resolve();
  let browser: ReturnType<typeof import('@web-ppt/fonts/glyphs/browser').createFontFaceScope> | undefined;
  let browserLoading: Promise<NonNullable<typeof browser>> | undefined, serial = 0;
  let bindings: Promise<unknown> = Promise.resolve();
  const readers = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;
  const active = new Map<string,FontFaceInfo>();
  const faceKey = (info: Pick<FontFaceInfo,'family'|'weight'|'italic'>) => JSON.stringify([info.family.toLowerCase(),info.weight,info.italic]);
  const registered = new Map<string,FontResult<FontFaceInfo>>();
  const requireLive = () => { if (lifetime.signal.aborted) throw new DOMException('文稿已关闭','AbortError'); };
  const get = (): Promise<FontGlyphProvider> => {
    requireLive();
    return loading ??= Promise.all([import('@web-ppt/fonts/glyphs'),import('@web-ppt/fonts/glyphs/worker')]).then(([api,workers]) => {
      requireLive();
      worker = workers.createWorkerFontShaper(() => new Worker(new URL('./editor-font-worker.ts',import.meta.url),{type:'module'}));
      provider = api.createFontProvider({loadShaper:async () => worker!,decodeEot:worker.decodeEot});
      return provider;
    }).catch(error => { loading = undefined; throw error; });
  };
  const access = async <T>(signal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    requireLive();
    const controller = new AbortController(), stop = () => controller.abort();
    lifetime.signal.addEventListener('abort',stop,{once:true});
    signal?.addEventListener('abort',stop,{once:true});
    if (signal?.aborted) stop();
    try { return await waitFor(Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new DOMException('字体加载已取消','AbortError');
      return action(controller.signal);
    }),controller.signal); }
    finally { lifetime.signal.removeEventListener('abort',stop); signal?.removeEventListener('abort',stop); }
  };
  const install = async (info: FontFaceInfo, options: FontRequestOptions, replace = true): Promise<FontResult<FontFaceInfo>> => {
    if (!replace && active.has(faceKey(info))) return {ok:true,value:info};
    const scope = await (browserLoading ??= Promise.all([get(),import('@web-ppt/fonts/glyphs/browser')]).then(([fonts,api]) => {
      requireLive();
      session.setFontResources([],{browserFontsReady:true});
      return browser = api.createFontFaceScope(fonts);
    }).catch(error => { browserLoading = undefined; throw error; }));
    const installed = await scope.install(info.id,options);
    if (!installed.ok) return installed;
    if (lifetime.signal.aborted || options.signal?.aborted) {
      if (![...active.values()].some(face => face.id === info.id)) scope.remove(info.id);
      return {ok:false,reason:lifetime.signal.aborted ? 'provider-disposed' : 'aborted',faceId:info.id};
    }
    const key = faceKey(info), previous = active.get(key);
    if (previous && previous.id !== info.id) {
      scope.remove(previous.id);
      if (previous.origin !== 'embedded') provider?.release(previous.id);
    }
    active.set(key,{...info,bbox:[...info.bbox],embedding:{...info.embedding}});
    session.setFontResources(scope.resources(),{browserFontsReady:true});
    return {ok:true,value:info};
  };
  const mutate = <T>(signal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>) => access(signal,joined => {
    const task = bindings.catch(() => {}).then(() => {
      if (joined.aborted) throw new DOMException('字体加载已取消','AbortError');
      return action(joined);
    });
    bindings = task.then(() => {},() => {}); return task;
  });
  const service: DocumentFontService = {
    initialize(signal) {
      return initialization ??= (async () => {
        if (!session.embeddedFontSources?.length) return;
        try {
          const statuses = await service.activate({signal});
          if (!lifetime.signal.aborted) initialIssues = statuses.filter(item => !item.result.ok).length;
        } catch {
          // 字体不可用仍能用系统字体打开文稿，工具入口保留失败状态并允许重试。
          if (!lifetime.signal.aborted) initialIssues = session.embeddedFontSources.length;
        }
      })();
    },
    provider(signal) { return access(signal,() => get()); },
    withFonts(signal,action) {
      requireLive();
      const controller = new AbortController(), stop = () => controller.abort();
      lifetime.signal.addEventListener('abort',stop,{once:true});
      signal?.addEventListener('abort',stop,{once:true});
      if (signal?.aborted) stop();
      let open = true;
      const task = bindings.catch(() => {}).then(async () => {
        if (controller.signal.aborted) throw new DOMException('字体读取已取消','AbortError');
        const fonts = await get();
        await service.embedded({purpose:'view-print',signal:controller.signal});
        if (controller.signal.aborted) throw new DOMException('字体读取已取消','AbortError');
        const selected = new Map(active);
        const readable = () => open && !controller.signal.aborted;
        const provider: DocumentFontReader['provider'] = {
          async resolve(request) {
            if (!readable()) return {ok:false,reason:'aborted'};
            const face = selected.get(faceKey(request));
            const options = {...request,signal:controller.signal};
            // 原始字体仍留在注册表供恢复；导出必须使用文稿明确选中的替换，不能因此产生同名歧义。
            return face ? fonts.faceInfo(face.id,options) : fonts.resolve(options);
          },
          async embedding(id,request) {
            return readable() ? fonts.embedding(id,{...request,signal:controller.signal}) : {ok:false,reason:'aborted'};
          },
          async shape(id,text,request) {
            return readable() ? fonts.shape(id,text,{...request,signal:controller.signal}) : {ok:false,reason:'aborted'};
          },
        };
        const result = await action({provider,signal:controller.signal});
        if (controller.signal.aborted) throw new DOMException('字体读取已取消','AbortError');
        return result;
      }).finally(() => {
        open = false; lifetime.signal.removeEventListener('abort',stop); signal?.removeEventListener('abort',stop);
      });
      // 整个消费过程排入字体绑定队列；取消也要等待回调真实结束，才允许替换释放旧字体。
      bindings = task.then(() => {},() => {}); readers.add(task);
      void task.then(() => readers.delete(task),() => readers.delete(task));
      return task;
    },
    embedded(options) {
      return access(options.signal,signal => {
        const task = tail.catch(() => {}).then(async () => {
          if (signal.aborted) throw new DOMException('字体加载已取消','AbortError');
          const fonts = await get(), sources = session.embeddedFontSources ?? [];
          const result: EmbeddedFontStatus[] = [];
          for (const [index,source] of sources.entries()) {
            if (signal.aborted) throw new DOMException('字体加载已取消','AbortError');
            const id = `embedded-${index}`;
            let status = registered.get(id);
            if (!status) {
              try {
                const response = await fetch(source.src,{signal});
                if (!response.ok) throw new Error('Font source unavailable');
                const bytes = new Uint8Array(await response.arrayBuffer());
                status = await fonts.register({id,family:source.family,origin:'embedded',sourceLabel:source.family,bytes},
                  {purpose:'view-print',signal});
              } catch (error) {
                if (signal.aborted) throw error;
                status = {ok:false,reason:'font-bytes-unavailable',faceId:id};
              }
              if (status.ok || !['aborted','provider-disposed'].includes(status.reason)) registered.set(id,status);
            }
            const checked = status.ok ? await fonts.faceInfo(id,{purpose:options.purpose,signal}) : status;
            result.push({source:{...source},result:checked});
          }
          return result;
        });
        tail = task.then(() => {},() => {}); return task;
      });
    },
    activate(options) {
      return mutate(options.signal,async signal => {
        // 文稿随时可能进入编辑态；预览许可不能通过字体工具进入编辑器的活动字体集。
        const request = {purpose:'edit' as const,signal};
        const statuses = await service.embedded(request);
        for (const item of statuses) if (item.result.ok) item.result = await install(item.result.value,request,false);
        return statuses;
      });
    },
    load(source,options) {
      return mutate(options.signal,async signal => {
        const fonts = await get();
        const request = {purpose:'edit' as const,signal};
        const result = await fonts.register({...source,id:`local-${++serial}`},request);
        if (!result.ok) return result;
        try {
          const installed = await install(result.value,request);
          if (!installed.ok) fonts.release(result.value.id);
          return installed;
        } catch (error) { fonts.release(result.value.id); throw error; }
      });
    },
    activeFaces() { return [...active.values()].map(info => ({...info,bbox:[...info.bbox],embedding:{...info.embedding}})); },
    state() { return {disposed:lifetime.signal.aborted,loaded:!!provider,workerActive:worker?.state().workerActive ?? false,
      retainedFontBytes:(provider?.state().retainedFontBytes ?? 0) + (worker?.state().retainedFontBytes ?? 0) + (browser?.state().sourceBytes ?? 0),
      installedFaces:browser?.state().faces ?? 0,initialIssues}; },
    dispose() {
      if (closing) return closing;
      lifetime.abort();
      worker?.dispose();
      const release = () => {
        if (browser && !session.disposed) session.setFontResources([],{browserFontsReady:true});
        browser?.dispose(); provider?.dispose(); registered.clear(); active.clear();
      };
      return closing = readers.size ? Promise.allSettled([...readers]).then(release) : Promise.resolve(release());
    },
  };
  return service;
}
