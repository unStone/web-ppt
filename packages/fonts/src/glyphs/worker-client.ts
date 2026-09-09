import type {FontEmbedding,FontProviderOptions,FontShaper,FontShapeOptions,GlyphRun} from './types';
import {FontFault} from './fault';
import {workerGlyphs} from './worker-result';
import {FONT_WORKER_PROTOCOL} from './worker-protocol';
import type {FontWorker,FontWorkerRequest,FontWorkerResponse} from './worker-protocol';

type Action = {operation:'shape'; text:string; options:Omit<FontShapeOptions,'signal'>} |
  {operation:'outline'; glyphId:number; purpose:'edit'|'view-print'} |
  {operation:'decode'; bytes:Uint8Array; maxOutputBytes:number};
type WorkerValue = GlyphRun | string | Uint8Array;
interface Job {
  font?: FontEmbedding;
  action: Action;
  cost: number;
  signal?: AbortSignal;
  cancel: () => void;
  resolve: (value: WorkerValue) => void;
  reject: (error: FontFault) => void;
}
export interface FontWorkerOptions { maxQueuedRequests?: number; maxPendingBytes?: number; requestTimeoutMs?: number }

/** 活跃请求取消时结束整个 WASM 实例；未取消请求在新 Worker 按需重建字体。 */
export function createWorkerFontShaper(factory: () => FontWorker, options: FontWorkerOptions = {}): FontShaper & {
  decodeEot: NonNullable<FontProviderOptions['decodeEot']>;
  state(): {disposed:boolean; retainedFontBytes:number; pendingRequests:number; pendingBytes:number; workerActive:boolean};
} {
  const limit = options.maxQueuedRequests ?? 64, timeout = options.requestTimeoutMs ?? 30_000;
  const byteLimit = options.maxPendingBytes ?? 64 * 1024 * 1024;
  if (!Number.isInteger(limit) || limit < 1 || !Number.isSafeInteger(byteLimit) || byteLimit < 1 ||
      !Number.isFinite(timeout) || timeout < 1) throw new RangeError('Invalid font worker budget');
  const fonts = new Map<string,FontEmbedding>(), queue: Job[] = [], loaded = new Set<string>();
  const identities = new Set<string>();
  const releaseFaces = new Set<() => void>();
  let closed = false, worker: FontWorker | undefined, active: Job | undefined, id = 0, waiting = 0, pendingBytes = 0;
  let phase: 'register' | 'action' = 'action', timer: ReturnType<typeof setTimeout> | undefined;
  let removeListeners: (() => void) | undefined;
  const endWorker = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined; removeListeners?.(); removeListeners = undefined;
    worker?.terminate(); worker = undefined; loaded.clear();
  };
  const finish = (job: Job, value?: WorkerValue, error?: FontFault) => {
    pendingBytes -= job.cost;
    job.signal?.removeEventListener('abort',job.cancel);
    if (job === active) {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined; active = undefined;
    }
    if (error) job.reject(error); else job.resolve(value!);
  };
  const failWorker = () => {
    endWorker();
    if (active) finish(active,undefined,new FontFault('shaper-failed'));
    for (const job of queue.splice(0)) finish(job,undefined,new FontFault('shaper-failed'));
  };
  const send = () => {
    if (!active || !worker) return;
    const font = active.font;
    phase = !font || loaded.has(font.info.id) ? 'action' : 'register';
    waiting = ++id;
    const common = {protocol:FONT_WORKER_PROTOCOL,id:waiting} as const;
    if (phase === 'register' && font) {
      const bytes = font.bytes.slice();
      worker.postMessage({...common,operation:'register',face:font.info,bytes} satisfies FontWorkerRequest,[bytes.buffer]);
    } else if (active.action.operation === 'decode') {
      const bytes = active.action.bytes.slice();
      worker.postMessage({...common,...active.action,bytes} satisfies FontWorkerRequest,[bytes.buffer]);
    } else if (font) worker.postMessage({...common,...active.action,faceId:font.info.id} satisfies FontWorkerRequest);
  };
  const pump = () => {
    if (active || closed || !queue.length) return;
    active = queue.shift()!;
    try {
      if (!worker) {
        const instance = factory(); worker = instance;
        const receive = (event: MessageEvent) => {
          if (worker !== instance || !active) return;
          const message = event.data as FontWorkerResponse;
          if (!message || message.protocol !== FONT_WORKER_PROTOCOL || message.id !== waiting) return;
          if (!message.result || typeof message.result.ok !== 'boolean') { failWorker(); return; }
          if (!message.result.ok) {
            finish(active,undefined,new FontFault(message.result.reason,message.result.missing,message.result.range)); pump(); return;
          }
          if (phase === 'register') {
            loaded.add(active.font!.info.id);
            try { send(); } catch { failWorker(); }
          } else { finish(active,message.result.value as WorkerValue); pump(); }
        };
        const failed = () => { if (worker === instance) failWorker(); };
        instance.addEventListener('message',receive);
        instance.addEventListener('error',failed);
        instance.addEventListener('messageerror',failed);
        removeListeners = () => {
          instance.removeEventListener('message',receive);
          instance.removeEventListener('error',failed);
          instance.removeEventListener('messageerror',failed);
        };
      }
      timer = setTimeout(failWorker,timeout); send();
    } catch { failWorker(); }
  };
  const request = (font: FontEmbedding | undefined, action: Action, signal?: AbortSignal): Promise<WorkerValue> => new Promise((resolve,reject) => {
    if (closed) { reject(new FontFault('provider-disposed')); return; }
    if (signal?.aborted) { reject(new FontFault('aborted')); return; }
    const cost = action.operation === 'decode' ? action.bytes.length : action.operation === 'shape' ? action.text.length * 2 : 0;
    if (queue.length + (active ? 1 : 0) >= limit || pendingBytes + cost > byteLimit) { reject(new FontFault('resource-limit')); return; }
    if (action.operation === 'decode') action = {...action,bytes:new Uint8Array(action.bytes)};
    pendingBytes += cost;
    const job: Job = {font,action,cost,signal,resolve,reject,cancel:() => {
      if (active === job) { endWorker(); finish(job,undefined,new FontFault('aborted')); }
      else {
        const index = queue.indexOf(job);
        if (index < 0) return;
        queue.splice(index,1); finish(job,undefined,new FontFault('aborted'));
      }
      pump();
    }};
    signal?.addEventListener('abort',job.cancel,{once:true});
    queue.push(job); pump();
  });
  return {
    async decodeEot(bytes,options) {
      return await request(undefined,{operation:'decode',bytes,maxOutputBytes:options.maxOutputBytes},options.signal) as Uint8Array;
    },
    async open(font,signal) {
      if (closed || signal.aborted) throw new FontFault(closed ? 'provider-disposed' : 'aborted');
      if (identities.has(font.info.id)) throw new FontFault('duplicate-face-id');
      identities.add(font.info.id);
      let source: FontEmbedding | undefined = {info:{...font.info,bbox:[...font.info.bbox] as typeof font.info.bbox,embedding:{...font.info.embedding}},bytes:new Uint8Array(font.bytes)};
      fonts.set(source.info.id,source);
      const faceId = source.info.id;
      const dispose = () => {
        if (!source) return;
        const released = source;
        source = undefined; fonts.delete(faceId); releaseFaces.delete(dispose);
        if (closed) return;
        for (let index = queue.length - 1; index >= 0; index--) if (queue[index].font === released) {
          finish(queue.splice(index,1)[0],undefined,new FontFault('face-unavailable'));
        }
        if (active?.font === released) finish(active,undefined,new FontFault('face-unavailable'));
        else if (active) { queue.unshift(active); active = undefined; }
        // 无逐 face 的立即 WASM 析构；终止实例并重放其他只读请求，才能释放旧字体。
        endWorker(); pump();
      };
      releaseFaces.add(dispose);
      const ready = (): FontEmbedding => { if (!source || closed) throw new FontFault('provider-disposed'); return source; };
      return {
        async shape(text,options) {
          const live = ready();
          const plain = {purpose:options.purpose,script:options.script,direction:options.direction,language:options.language};
          const run = await request(live,{operation:'shape',text,options:plain},options.signal);
          return workerGlyphs(run,live.info,text,options);
        },
        async outline(glyphId,options) {
          return await request(ready(),{operation:'outline',glyphId,purpose:options.purpose},options.signal) as string;
        },
        dispose,
      };
    },
    state() { return {disposed:closed,retainedFontBytes:[...fonts.values()].reduce((total,font) => total + font.bytes.length,0),
      pendingRequests:queue.length + (active ? 1 : 0),pendingBytes,workerActive:!!worker}; },
    dispose() {
      if (closed) return;
      closed = true; endWorker();
      if (active) finish(active,undefined,new FontFault('provider-disposed'));
      for (const job of queue.splice(0)) finish(job,undefined,new FontFault('provider-disposed'));
      for (const dispose of [...releaseFaces]) dispose();
      fonts.clear(); identities.clear();
    },
  };
}
