import {createFontProvider} from './provider';
import type {FontProviderOptions} from './types';
import {FONT_WORKER_PROTOCOL} from './worker-protocol';
import type {FontWorkerEndpoint,FontWorkerRequest,FontWorkerResponse} from './worker-protocol';
import {FontFault} from './fault';
import {fontLimits} from './validation-budget';

/** 在专属 Worker 内安装；入口及 WASM URL 由宿主构建工具决定。 */
export function serveFontWorker(endpoint: FontWorkerEndpoint, options: FontProviderOptions): () => void {
  const provider = createFontProvider(options);
  const lifetime = new AbortController(), limits = fontLimits(options.limits);
  let closed = false, queue = Promise.resolve();
  const receive = (event: MessageEvent) => {
    const request = event.data as FontWorkerRequest;
    if (closed || !request || request.protocol !== FONT_WORKER_PROTOCOL || !Number.isSafeInteger(request.id)) return;
    queue = queue.then(async () => {
      if (closed) return;
      let result: FontWorkerResponse['result'];
      try {
        if (request.operation === 'register') result = await provider.register({
          id:request.face.id,family:request.face.family,origin:request.face.origin,bytes:request.bytes,restrictions:request.face.embedding,
        },{purpose:'view-print'});
        else if (request.operation === 'shape') result = await provider.shape(request.faceId,request.text,request.options);
        else if (request.operation === 'outline') result = await provider.outline(request.faceId,request.glyphId,{purpose:request.purpose});
        else if (request.operation === 'decode') {
          if (!options.decodeEot) result = {ok:false,reason:'decoder-unavailable'};
          else if (!(request.bytes instanceof Uint8Array) || request.bytes.length > limits.maxFontBytes ||
              !Number.isSafeInteger(request.maxOutputBytes) || request.maxOutputBytes < 1) result = {ok:false,reason:'resource-limit'};
          else {
            const maxOutputBytes = Math.min(request.maxOutputBytes,limits.maxFontBytes);
            const decoded = await options.decodeEot(request.bytes,{signal:lifetime.signal,maxOutputBytes});
            result = !decoded?.length ? {ok:false,reason:'decode-failed'} : decoded.length > maxOutputBytes ?
              {ok:false,reason:'resource-limit'} : {ok:true,value:new Uint8Array(decoded)};
          }
        }
        else result = {ok:false,reason:'shaper-failed'};
      } catch (error) { result = {ok:false,reason:error instanceof FontFault ? error.reason :
        request.operation === 'decode' ? 'decode-failed' : 'shaper-failed'}; }
      if (!closed) endpoint.postMessage({protocol:FONT_WORKER_PROTOCOL,id:request.id,result} satisfies FontWorkerResponse,
        result.ok && result.value instanceof Uint8Array ? [result.value.buffer as ArrayBuffer] : []);
    }).catch(() => {});
  };
  endpoint.addEventListener('message',receive);
  return () => {
    if (closed) return;
    closed = true; lifetime.abort(); endpoint.removeEventListener('message',receive); provider.dispose();
  };
}
