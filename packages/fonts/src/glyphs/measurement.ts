import type {TextMeasure,TextRun} from '@web-ppt/core';
import type {createFontProvider} from './provider';
import type {FontFaceInfo,FontRequestOptions,FontResult,FontScript} from './types';
import {FontFault} from './fault';
import {segmentFontText} from './text-scripts';

export interface FontMeasurementOptions extends FontRequestOptions {
  language: string;
  /** 宿主显式决定当前样式/脚本用哪个已注册 face，不在测量时猜系统字体。 */
  faceForRun(style: Readonly<Pick<TextRun,'fonts'|'b'|'i'>>, script: FontScript): string | null;
  maxQueries?: number;
}
export interface PreparedFontMeasurement<T> {result: T; measureText: TextMeasure; faceIds: string[]}

/** 重放纯同步布局/渲染回调以补齐异步字宽；断行规则始终由回调中的既有排版器决定。 */
export async function withFontMeasurement<T>(provider: ReturnType<typeof createFontProvider>,
  render: (measureText: TextMeasure) => T, options: FontMeasurementOptions): Promise<FontResult<PreparedFontMeasurement<T>>> {
  const cache = new Map<string,number>(), faces = new Set<string>();
  const metadata = new Map<string,FontFaceInfo>();
  const queries = new Map<string,{text:string; style:Pick<TextRun,'fonts'|'b'|'i'>}>();
  const limit = options.maxQueries ?? 8192;
  let collecting = false, characters = 0;
  const measureText: TextMeasure = (text,run,scale) => {
    if (!text) return 0;
    if (run.math?.length) throw new FontFault('unsupported-layout');
    const key = JSON.stringify([text,run.fonts,!!run.b,!!run.i]);
    const em = cache.get(key);
    const size = run.size * scale * (run.baseline ? 0.65 : 1);
    if (em !== undefined) return em * size + (run.spacing ?? 0) * text.length;
    if (!collecting) throw new FontFault('measurement-not-prepared');
    if (!queries.has(key)) {
      characters += text.length;
      if (cache.size + queries.size >= limit || characters > 1_000_000) throw new FontFault('resource-limit');
      queries.set(key,{text,style:{fonts:[...run.fonts],b:run.b,i:run.i}});
    }
    // 初次回调产物不会交付；估算仅用于让排版器枚举它要测量的所有片段。
    return text.length * size;
  };
  try {
    if (!Number.isSafeInteger(limit) || limit < 1) return {ok:false,reason:'invalid-request'};
    for (let pass = 0; pass < 8; pass++) {
      if (provider.state().disposed) return {ok:false,reason:'provider-disposed'};
      if (options.signal?.aborted) return {ok:false,reason:'aborted'};
      queries.clear(); collecting = true;
      let result: T;
      try { result = render(measureText); } finally { collecting = false; }
      if (!queries.size) return {ok:true,value:{result,measureText,faceIds:[...faces]}};
      for (const [key,query] of queries) {
        const segmented = segmentFontText(query.text,{direction:'ltr',language:options.language});
        if (!segmented.ok) return segmented;
        let em = 0;
        for (const part of segmented.value) {
          const id = options.faceForRun(query.style,part.script);
          if (!id) return {ok:false,reason:'face-unavailable'};
          let info = metadata.get(id);
          if (!info) {
            const loaded = await provider.faceInfo(id,options);
            if (!loaded.ok) return loaded;
            info = loaded.value; metadata.set(id,info);
          }
          if (info.weight !== (query.style.b ? 700 : 400) || info.italic !== !!query.style.i) {
            return {ok:false,reason:'face-style-mismatch',faceId:id};
          }
          const shaped = await provider.shape(id,part.text,{purpose:options.purpose,signal:options.signal,
            language:options.language,script:part.script,direction:'ltr'});
          if (!shaped.ok) return shaped;
          em += shaped.value.xAdvance / shaped.value.unitsPerEm; faces.add(id);
        }
        cache.set(key,em);
      }
    }
    return {ok:false,reason:'resource-limit'};
  } catch (error) {
    return error instanceof FontFault ? {ok:false,reason:error.reason,range:error.range} : {ok:false,reason:'layout-failed'};
  }
}
