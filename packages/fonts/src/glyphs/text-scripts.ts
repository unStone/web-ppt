import type {FontResult,FontScript} from './types';
import {FontFault} from './fault';

export interface FontTextSegment {
  start: number;
  end: number;
  text: string;
  script: FontScript;
  direction: 'ltr';
  language: string;
}

export function fontCharacterScript(character: string, start: number): FontScript | undefined {
  const code = character.codePointAt(0)!, range = {start,end:start + character.length};
  if (code >= 0xd800 && code <= 0xdfff || /[\u0000-\u001f\u007f-\u009f]/u.test(character)) throw new FontFault('invalid-text',undefined,range);
  if (/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(character)) throw new FontFault('unsupported-direction',undefined,range);
  if (/\p{Script=Latin}/u.test(character)) return 'Latn';
  if (/\p{Script=Han}/u.test(character)) return 'Hani';
  if (!/[\p{Script=Common}\p{Script=Inherited}]/u.test(character)) throw new FontFault('unsupported-script',undefined,range);
}

/** 此处只分脚本；沿用输入原文，断行和字体选择仍由已有布局及宿主负责。 */
export function segmentFontText(text: string, options: {direction:'ltr'; language:string}): FontResult<FontTextSegment[]> {
  if (options.direction !== 'ltr') return {ok:false,reason:'unsupported-direction'};
  if (text.length > 100_000) return {ok:false,reason:'resource-limit'};
  const points: Array<{start:number; script?:FontScript}> = [];
  try {
    let cursor = 0;
    for (const character of text) {
      points.push({start:cursor,script:fontCharacterScript(character,cursor)}); cursor += character.length;
    }
    const segments: FontTextSegment[] = [];
    let start = 0, script = points.find(point => point.script)?.script ?? 'Latn';
    const append = (end: number) => { if (end > start) segments.push({start,end,text:text.slice(start,end),script,...options}); };
    for (const point of points) {
      if (!point.script || point.script === script) continue;
      append(point.start); start = point.start; script = point.script;
    }
    append(text.length);
    return {ok:true,value:segments};
  } catch (error) {
    return error instanceof FontFault ? {ok:false,reason:error.reason,range:error.range} : {ok:false,reason:'invalid-text'};
  }
}
