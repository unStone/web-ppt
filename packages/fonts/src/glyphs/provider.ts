import type {FontEmbedding, FontFaceInfo, FontFailure, FontProviderOptions, FontRequest, FontRequestOptions, FontResult, FontSource} from './types';
import {inspectSfnt} from './sfnt';
import {embeddingProblem,intersectRights} from './permissions';
import {validateGlyphStorage} from './validate-glyphs';
import {FontFault} from './fault';
import {validateCmap} from './validate-cmap';
import {abortable,createShaping} from './shaping';
import {fontLimits,validationPause} from './validation-budget';
import {inspectEot,isEot,unpackPlainEot} from './eot-container';

export function createFontProvider(options: FontProviderOptions = {}) {
  let disposed = false, reservedBytes = 0;
  const lifetime = new AbortController(), decodeEot = options.decodeEot;
  const limits = fontLimits(options.limits), registering = new Set<string>();
  const retired = new Set<string>();
  const faces = new Map<string, {info: FontFaceInfo; bytes: Uint8Array}>();
  const copyInfo = (info: FontFaceInfo): FontFaceInfo => ({...info, bbox:[...info.bbox], embedding:{...info.embedding}});
  const inactive = (options: FontRequestOptions, faceId?: string): FontFailure | undefined =>
    disposed ? {ok:false, reason:'provider-disposed', faceId} : options.signal?.aborted ? {ok:false, reason:'aborted', faceId} : undefined;
  const resource = async (faceId: string, options: FontRequestOptions): Promise<FontResult<FontEmbedding>> => {
    const stopped = inactive(options, faceId);
    if (stopped) return stopped;
    const face = faces.get(faceId);
    const permission = face && embeddingProblem(face.info.embedding,options.purpose);
    if (permission) return {ok:false, reason:permission, faceId};
    return face ? {ok:true, value:{bytes:face.bytes, info:copyInfo(face.info)}} : {ok:false, reason:'face-unavailable', faceId};
  };
  const shaping = createShaping({...options,limits},resource);
  return {
    async register(source: FontSource, options: FontRequestOptions): Promise<FontResult<FontFaceInfo>> {
      source = {...source,restrictions:source.restrictions && {...source.restrictions}}; options = {...options};
      const stopped = inactive(options, source.id);
      if (stopped) return stopped;
      const fail = (reason: FontFailure['reason']): FontFailure => ({ok:false, reason, faceId:source.id});
      if (!source.bytes?.length) return fail('font-bytes-unavailable');
      if (!source.id || source.id.length > 256) return fail('invalid-font');
      if (!['explicit','embedded','substitute'].includes(source.origin) || !['edit','view-print'].includes(options.purpose) ||
          source.family !== undefined && (!source.family.trim() || source.family.length > 256 || /[\u0000-\u001f\u007f]/.test(source.family))) return fail('invalid-request');
      if (faces.has(source.id) || registering.has(source.id) || retired.has(source.id)) return fail('duplicate-face-id');
      const size = source.bytes.length, reservation = size + (isEot(source.bytes) ? limits.maxFontBytes : 0);
      const held = [...faces.values()].reduce((total,face) => total + face.bytes.length,0);
      if (size > limits.maxFontBytes || held + reservedBytes + reservation > limits.maxTotalFontBytes ||
          faces.size + registering.size >= limits.maxFaces) return fail('resource-limit');
      registering.add(source.id); reservedBytes += reservation;
      const controller = new AbortController(), stop = () => controller.abort();
      lifetime.signal.addEventListener('abort',stop,{once:true});
      options.signal?.addEventListener('abort',stop,{once:true});
      try {
        // Buffer.slice 仍共享调用者存储，必须在注册边界建立独立所有权。
        let bytes: Uint8Array = new Uint8Array(source.bytes);
        const pause = validationPause(() => { const stopped = inactive(options); if (stopped) throw new FontFault(stopped.reason); });
        await pause();
        const eot = isEot(bytes) ? inspectEot(bytes) : undefined;
        if (eot) {
          const blocked = embeddingProblem(eot.rights,options.purpose);
          if (blocked) return fail(blocked);
          if (eot.flags & 4) {
            if (!decodeEot) return fail('decoder-unavailable');
            let decoded: Uint8Array | null;
            try { decoded = await abortable(Promise.resolve().then(() => {
              if (controller.signal.aborted) throw new FontFault('aborted');
              return decodeEot(bytes,{signal:controller.signal,maxOutputBytes:limits.maxFontBytes});
            }),controller.signal); }
            catch (error) { return fail(disposed ? 'provider-disposed' : controller.signal.aborted ? 'aborted' :
              error instanceof FontFault ? error.reason : 'decode-failed'); }
            if (!decoded?.length) return fail('decode-failed');
            if (decoded.length > limits.maxFontBytes) return fail('resource-limit');
            bytes = new Uint8Array(decoded);
          } else bytes = unpackPlainEot(bytes,eot);
        }
        const font = inspectSfnt(bytes);
        font.info.embedding = intersectRights(intersectRights(font.info.embedding,eot?.rights),source.restrictions);
        if (eot && eot.flags & 1 && !font.info.embedding.subsetAllowed) return fail('subset-not-permitted');
        if (font.info.glyphCount > limits.maxGlyphs) return fail('resource-limit');
        const permission = embeddingProblem(font.info.embedding, options.purpose);
        if (permission) return fail(permission);
        await validateGlyphStorage(bytes,font,pause);
        await validateCmap(bytes,font,pause);
        const stopped = inactive(options,source.id); if (stopped) return stopped;
        const info: FontFaceInfo = {...font.info, id:source.id, family:source.family ?? font.info.sourceFamily, origin:source.origin,
          sourceLabel:source.sourceLabel,embeddingEvidence:source.embeddingEvidence};
        faces.set(source.id, {info, bytes});
        return {ok:true, value:copyInfo(info)};
      } catch (error) { return fail(error instanceof FontFault ? error.reason : 'invalid-font'); }
      finally {
        registering.delete(source.id); reservedBytes -= reservation;
        lifetime.signal.removeEventListener('abort',stop); options.signal?.removeEventListener('abort',stop);
      }
    },
    async resolve(request: FontRequest): Promise<FontResult<FontFaceInfo>> {
      const stopped = inactive(request);
      if (stopped) return stopped;
      const matches = [...faces.values()].filter(({info}) => info.family.toLowerCase() === request.family.toLowerCase() &&
        info.weight === request.weight && info.italic === request.italic);
      const permission = matches.length === 1 ? embeddingProblem(matches[0].info.embedding,request.purpose) : undefined;
      if (permission) return {ok:false, reason:permission, faceId:matches[0].info.id};
      return matches.length === 1 ? {ok:true, value:copyInfo(matches[0].info)} :
        {ok:false, reason:matches.length ? 'ambiguous-face' : 'face-unavailable'};
    },
    async embedding(faceId: string, request: FontRequestOptions): Promise<FontResult<FontEmbedding>> {
      const result = await resource(faceId,request);
      return result.ok ? {ok:true,value:{info:result.value.info,bytes:result.value.bytes.slice()}} : result;
    },
    async faceInfo(faceId: string, request: FontRequestOptions): Promise<FontResult<FontFaceInfo>> {
      const result = await resource(faceId,request);
      return result.ok ? {ok:true,value:result.value.info} : result;
    },
    shape:shaping.shape,
    outline:shaping.outline,
    /** 释放已注册 face；同一文稿内身份不可复用，避免迟到请求混用新旧字节。 */
    release(faceId: string): boolean {
      if (!faces.delete(faceId)) return false;
      retired.add(faceId); shaping.release(faceId); return true;
    },
    state() { return {disposed, retainedFontBytes:[...faces.values()].reduce((size,f) => size + f.bytes.length, 0),
      reservedFontBytes:reservedBytes,pendingRegistrations:registering.size,faces:faces.size}; },
    dispose() { disposed = true; shaping.dispose(); lifetime.abort(); faces.clear(); retired.clear(); },
  };
}
