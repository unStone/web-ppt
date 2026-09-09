import type {EmbeddedFont} from '@web-ppt/core';
import type {createFontProvider} from './provider';
import type {FontRequestOptions,FontResult} from './types';

interface InstalledFace {id: string; font: FontFace; resource: EmbeddedFont; bytes: number}

function waitForLoad(font: FontFace, lifetime: AbortSignal, request?: AbortSignal): Promise<void> {
  return new Promise((resolve,reject) => {
    const stop = () => { clean(); reject(new DOMException('字体加载已取消','AbortError')); };
    const clean = () => { lifetime.removeEventListener('abort',stop); request?.removeEventListener('abort',stop); };
    lifetime.addEventListener('abort',stop,{once:true}); request?.addEventListener('abort',stop,{once:true});
    if (lifetime.aborted || request?.aborted) { clean(); stop(); return; }
    Promise.resolve().then(() => font.load()).then(() => { clean(); resolve(); },error => { clean(); reject(error); });
  });
}

/** 调用者拥有资源作用域；只撤销自己安装的 FontFace 与对象 URL。 */
export function createFontFaceScope(provider: ReturnType<typeof createFontProvider>, owner: Document = document) {
  const installed = new Map<string,InstalledFace>();
  const pending = new Set<string>();
  const lifetime = new AbortController();
  let disposed = false;
  const failure = (faceId: string, options: FontRequestOptions) => disposed || provider.state().disposed
    ? {ok:false as const,reason:'provider-disposed' as const,faceId}
    : options.signal?.aborted ? {ok:false as const,reason:'aborted' as const,faceId} : undefined;
  return {
    async install(faceId: string, options: FontRequestOptions & {family?: string}): Promise<FontResult<EmbeddedFont>> {
      const stopped = failure(faceId,options); if (stopped) return stopped;
      const source = await provider.embedding(faceId,options);
      if (!source.ok) return source;
      const staleSource = failure(faceId,options); if (staleSource) return staleSource;
      const {info,bytes} = source.value, family = options.family ?? info.family;
      if (![400,700].includes(info.weight)) return {ok:false,reason:'face-style-mismatch',faceId};
      if (!family.trim() || family.length > 256 || /[\u0000-\u001f\u007f]/.test(family)) return {ok:false,reason:'invalid-request',faceId};
      const key = JSON.stringify([faceId,family]);
      const previous = installed.get(key);
      if (previous) return {ok:true,value:{...previous.resource}};
      if (pending.has(key)) return {ok:false,reason:'duplicate-face-id',faceId};
      pending.add(key);
      let font: FontFace | undefined, src: string | undefined;
      try {
        const stale = failure(faceId,options); if (stale) return stale;
        // FontFace 接收家族名称本身；加 CSS 引号会让 Chrome 把引号作为名称的一部分。
        font = new FontFace(family,new Uint8Array(bytes).buffer,{weight:String(info.weight),style:info.italic ? 'italic' : 'normal'});
        await waitForLoad(font,lifetime.signal,options.signal);
        const staleLoad = failure(faceId,options); if (staleLoad) return staleLoad;
        owner.fonts.add(font);
        src = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer],{type:'font/ttf'}));
        const resource = {family,src,bold:info.weight === 700,italic:info.italic};
        installed.set(key,{id:faceId,font,resource,bytes:bytes.length});
        return {ok:true,value:{...resource}};
      } catch {
        if (font) owner.fonts.delete(font);
        if (src) URL.revokeObjectURL(src);
        return failure(faceId,options) ?? {ok:false,reason:'font-install-failed',faceId};
      } finally { pending.delete(key); }
    },
    resources(): EmbeddedFont[] { return [...installed.values()].map(value => ({...value.resource})); },
    remove(faceId: string) {
      for (const [key,item] of installed) if (item.id === faceId) {
        owner.fonts.delete(item.font); URL.revokeObjectURL(item.resource.src); installed.delete(key);
      }
    },
    state() { return {disposed,faces:installed.size,sourceBytes:[...installed.values()].reduce((total,value) => total + value.bytes,0)}; },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      for (const item of installed.values()) { owner.fonts.delete(item.font); URL.revokeObjectURL(item.resource.src); }
      installed.clear();
    },
  };
}
