import type {FontFaceInfo,FontShapeOptions,GlyphRun,ShaperGlyph} from './types';
import {FontFault} from './fault';
import {makeGlyphRun} from './shape-run';

/** Worker 也是输入边界；先限制簇范围，再展开，避免错误消息造成无限循环或大分配。 */
export function workerGlyphs(value: unknown, info: FontFaceInfo, text: string, options: FontShapeOptions): ShaperGlyph[] {
  const bad = (): never => { throw new FontFault('shaper-failed'); };
  if (!value || typeof value !== 'object') bad();
  const run = value as GlyphRun;
  if (!Array.isArray(run.glyphs) || !Array.isArray(run.clusters) || run.faceId !== info.id ||
      run.text !== text || run.unitsPerEm !== info.unitsPerEm || run.script !== options.script ||
      run.direction !== options.direction || run.language !== options.language) bad();
  if (run.glyphs.length > Math.max(256,text.length * 32) || run.clusters.length > run.glyphs.length) {
    throw new FontFault('resource-limit');
  }
  const raw: ShaperGlyph[] = [];
  let glyphEnd = 0, end = 0;
  for (const cluster of run.clusters) {
    if (!cluster || !Number.isInteger(cluster.glyphEnd) || !Number.isInteger(cluster.end) ||
        cluster.glyphStart !== glyphEnd || cluster.glyphEnd <= glyphEnd || cluster.glyphEnd > run.glyphs.length ||
        cluster.start !== end || cluster.end <= end || cluster.end > text.length ||
        cluster.text !== text.slice(cluster.start,cluster.end)) bad();
    for (let index = cluster.glyphStart; index < cluster.glyphEnd; index++) {
      const glyph = run.glyphs[index];
      if (!glyph || typeof glyph !== 'object') bad();
      raw.push({...glyph,cluster:cluster.start});
    }
    glyphEnd = cluster.glyphEnd; end = cluster.end;
  }
  if (glyphEnd !== run.glyphs.length || end !== text.length) bad();
  const checked = makeGlyphRun(info,text,options,raw);
  if (!checked.ok || checked.value.xAdvance !== run.xAdvance || checked.value.yAdvance !== run.yAdvance) bad();
  return raw;
}
