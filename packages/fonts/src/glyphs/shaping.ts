import type {FontEmbedding,FontProviderOptions,FontRequestOptions,FontResult,FontShapeOptions,
  FontShaper,FontShaperFace,GlyphRun} from './types';
import {FontFault} from './fault';
import {checkShapeText,makeGlyphRun} from './shape-run';

export function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve,reject) => {
    const stop = () => { signal.removeEventListener('abort',stop); reject(new FontFault('aborted')); };
    if (signal.aborted) stop();
    else signal.addEventListener('abort',stop,{once:true});
    pending.then(resolve,reject).finally(() => signal.removeEventListener('abort',stop));
  });
}

export function createShaping(options: FontProviderOptions, embedding: (id: string, options: FontRequestOptions) => Promise<FontResult<FontEmbedding>>) {
  interface OpenFace {pending:Promise<FontShaperFace>;controller:AbortController;face?:FontShaperFace}
  const lifetime = new AbortController(), opened = new Map<string,OpenFace>();
  const retired = new Set<string>(), requests = new Map<string,Set<AbortController>>();
  let loader: Promise<FontShaper> | undefined, engine: FontShaper | undefined;
  const shaper = (): Promise<FontShaper> => {
    if (!options.loadShaper) return Promise.reject(new FontFault('shaper-unavailable'));
    return loader ??= Promise.resolve().then(() => {
      if (lifetime.signal.aborted) throw new FontFault('provider-disposed');
      return options.loadShaper!(lifetime.signal);
    }).then(value => {
      if (lifetime.signal.aborted) { value.dispose(); throw new FontFault('provider-disposed'); }
      engine = value; return value;
    }).catch(error => { loader = undefined; throw error; });
  };
  const operation = async <T>(id: string, request: FontRequestOptions,
      validate: (font: FontEmbedding) => void,
      task: (face: FontShaperFace, font: FontEmbedding, signal: AbortSignal) => Promise<FontResult<T>>): Promise<FontResult<T>> => {
    if (lifetime.signal.aborted) return {ok:false,reason:'provider-disposed',faceId:id};
    const controller = new AbortController(), stop = () => controller.abort();
    if (!requests.has(id)) requests.set(id,new Set());
    requests.get(id)!.add(controller);
    lifetime.signal.addEventListener('abort',stop,{once:true});
    request.signal?.addEventListener('abort',stop,{once:true});
    if (request.signal?.aborted) stop();
    try {
      if (controller.signal.aborted) throw new FontFault('aborted');
      const resource = await embedding(id,request);
      if (!resource.ok) return resource;
      if (retired.has(id)) throw new FontFault('face-unavailable');
      if (controller.signal.aborted) throw new FontFault('aborted');
      validate(resource.value);
      let entry = opened.get(id);
      if (!entry) {
        const controller = new AbortController();
        let created: OpenFace;
        const pending = abortable(shaper(),controller.signal).then(value => {
          if (retired.has(id)) throw new FontFault('face-unavailable');
          return value.open({...resource.value,bytes:resource.value.bytes.slice()},controller.signal);
        }).then(value => {
          if (lifetime.signal.aborted || retired.has(id)) {
            value.dispose(); throw new FontFault(lifetime.signal.aborted ? 'provider-disposed' : 'face-unavailable');
          }
          created.face = value; return value;
        }).catch(error => { opened.delete(id); throw error; });
        created = {pending,controller}; opened.set(id,created); entry = created;
      }
      const live = await abortable(entry.pending,controller.signal);
      return await abortable(Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new FontFault('aborted');
        return task(live,resource.value,controller.signal);
      }),controller.signal);
    } catch (error) {
      return {ok:false,faceId:id,reason:lifetime.signal.aborted ? 'provider-disposed' :
        retired.has(id) ? 'face-unavailable' : controller.signal.aborted ? 'aborted' : error instanceof FontFault ? error.reason : 'shaper-failed',
        ...(error instanceof FontFault && error.missing ? {missing:error.missing} : {}),
        ...(error instanceof FontFault && error.range ? {range:error.range} : {})};
    } finally {
      lifetime.signal.removeEventListener('abort',stop);
      request.signal?.removeEventListener('abort',stop);
      requests.get(id)?.delete(controller);
      if (!requests.get(id)?.size) requests.delete(id);
    }
  };
  return {
    release(id: string) {
      retired.add(id);
      const entry = opened.get(id); opened.delete(id);
      entry?.face?.dispose();
      entry?.controller.abort();
      for (const controller of requests.get(id) ?? []) controller.abort();
    },
    shape(id: string, text: string, request: FontShapeOptions): Promise<FontResult<GlyphRun>> {
      return operation(id,request,() => checkShapeText(text,request,options.limits?.maxTextLength ?? 100_000),async (face,font,signal) => {
        const glyphs = text ? await face.shape(text,{...request,signal}) : [];
        return makeGlyphRun(font.info,text,request,glyphs);
      });
    },
    outline(id: string, glyphId: number, request: FontRequestOptions): Promise<FontResult<string>> {
      return operation(id,request,font => {
        if (!Number.isInteger(glyphId) || glyphId < 0 || glyphId >= font.info.glyphCount) throw new FontFault('invalid-glyph-id');
      },async (face,_font,signal) => {
        const path = await face.outline(glyphId,{...request,signal});
        if (path.length > 4_000_000) throw new FontFault('resource-limit');
        if (!/^[MmLlHhVvCcSsQqTtAaZz\d\s.,+eE-]*$/.test(path)) throw new FontFault('shaper-failed');
        return {ok:true,value:path};
      });
    },
    dispose() {
      if (lifetime.signal.aborted) return;
      // 先关闭队列，再广播各请求的取消；否则取消活跃请求会启动下一个排队任务。
      engine?.dispose(); engine = undefined;
      lifetime.abort();
      for (const entry of opened.values()) {
        entry.controller.abort();
        void entry.pending.then(value => value.dispose(),() => {});
      }
      opened.clear();
    },
  };
}
