import type {TextRun} from '@web-ppt/core';
import {segmentFontText} from '@web-ppt/fonts/glyphs';
import type {FontFailure,FontTextSegment} from '@web-ppt/fonts/glyphs';

/** 大写展开和布局分隔符不属于缺字；报告仍指向用户输入的 UTF-16 区间。 */
export function diagnosticFontText(run: TextRun) {
  let text = '';
  const starts: number[] = [], ends: number[] = [];
  for (let from = 0; from < run.text.length;) {
    const source = String.fromCodePoint(run.text.codePointAt(from)!), to = from + source.length;
    const display = run.caps === 'all' ? source.toUpperCase() : source;
    for (let index = 0; index < display.length; index++) { starts.push(from); ends.push(to); }
    text += display; from = to;
  }
  const range = (value: {start:number;end:number}, offset: number) => ({
    start:starts[value.start + offset] ?? run.text.length,
    end:ends[value.end + offset - 1] ?? run.text.length,
  });
  const failure = (value: FontFailure, offset = 0): FontFailure => ({...value,
    range:value.range && range(value.range,offset),
    missing:value.missing && [...new Map(value.missing.map(item => {
      const position = range(item,offset);
      return [`${position.start}:${position.end}`,{...position,text:run.text.slice(position.start,position.end)}] as const;
    })).values()],
  });
  const segments: FontTextSegment[] = [];
  for (const match of text.matchAll(/[^\r\n\t]+/g)) {
    const result = segmentFontText(match[0],{direction:'ltr',language:'und'});
    if (!result.ok) return {segments,failure,problem:failure(result,match.index)};
    for (const item of result.value) segments.push({...item,start:item.start + match.index,end:item.end + match.index});
  }
  return {segments,failure};
}
