import type {FontFaceInfo,FontResult,FontShapeOptions,GlyphCluster,GlyphRun,ShaperGlyph} from './types';
import {FontFault} from './fault';
import {fontCharacterScript} from './text-scripts';

export function checkShapeText(text: string, options: FontShapeOptions, maxLength: number): void {
  if (options.direction !== 'ltr') throw new FontFault('unsupported-direction');
  if (!['Latn','Hani'].includes(options.script)) throw new FontFault('unsupported-script');
  if (text.length > maxLength) throw new FontFault('resource-limit');
  if (typeof options.language !== 'string' || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(options.language)) {
    throw new FontFault('invalid-text');
  }
  let start = 0;
  for (const character of text) {
    const script = fontCharacterScript(character,start);
    if (script && script !== options.script) throw new FontFault('script-mismatch',undefined,{start,end:start + character.length});
    start += character.length;
  }
}

export function makeGlyphRun(info: FontFaceInfo, text: string, options: FontShapeOptions, raw: ShaperGlyph[]): FontResult<GlyphRun> {
  const bad = (): never => { throw new FontFault('shaper-failed'); };
  if (raw.length > Math.max(256,text.length * 32)) throw new FontFault('resource-limit');
  if (text.length && !raw.length || !text.length && raw.length) bad();
  const clusters: GlyphCluster[] = [];
  let previous = -1, xAdvance = 0, yAdvance = 0;
  const glyphs = raw.map((item,index) => {
    const {id,cluster,xOffset,yOffset} = item;
    if (!Number.isInteger(id) || id < 0 || id >= info.glyphCount || !Number.isInteger(cluster) ||
        cluster < previous || cluster >= text.length || index === 0 && cluster !== 0 ||
        cluster > 0 && /[\udc00-\udfff]/u.test(text[cluster]) ||
        ![item.xAdvance,item.yAdvance,xOffset,yOffset].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) bad();
    if (cluster !== previous) {
      const last = clusters[clusters.length - 1];
      if (last) { last.end = cluster; last.text = text.slice(last.start,cluster); last.glyphEnd = index; }
      clusters.push({start:cluster,end:text.length,text:'',glyphStart:index,glyphEnd:raw.length});
      previous = cluster;
    }
    xAdvance += item.xAdvance; yAdvance += item.yAdvance;
    return {id,xAdvance:item.xAdvance,yAdvance:item.yAdvance,xOffset,yOffset};
  });
  const last = clusters[clusters.length - 1];
  if (last) last.text = text.slice(last.start);
  const missing = clusters.filter(c => glyphs.slice(c.glyphStart,c.glyphEnd).some(g => g.id === 0))
    .map(({start,end,text}) => ({start,end,text}));
  if (missing.length) return {ok:false,reason:'missing-glyphs',faceId:info.id,missing};
  return {ok:true,value:{faceId:info.id,text,script:options.script,direction:'ltr',language:options.language,
    unitsPerEm:info.unitsPerEm,xAdvance,yAdvance,glyphs,clusters}};
}
