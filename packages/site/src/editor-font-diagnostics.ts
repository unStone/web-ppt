import type {SlideElement,TextBody,TextRun,TextVert} from '@web-ppt/core';
import type {EditorSession} from '@web-ppt/editor';
import type {FontFaceInfo,FontFailure,FontGlyphProvider,FontScript} from '@web-ppt/fonts/glyphs';
import {diagnosticFontText} from './editor-font-text';

export interface DocumentFontIssue {
  slideId: string; page: number; object: string; paragraph: number; run: number;
  family: string; text: string; failure: FontFailure;
}
export interface DocumentFontCheck {issues: DocumentFontIssue[]; checkedRuns: number}

function requestedFamily(run: TextRun, script: FontScript): string {
  const slots = run.editInfo?.fontSlots;
  return (script === 'Hani' ? slots?.eastAsian : slots?.latin) || run.fonts[0] || '';
}

/** 检查的是当前投影中的实际文本；不把系统回退字形当成已取得可移植字体字节。 */
export async function inspectDocumentFonts(session: EditorSession, provider: FontGlyphProvider,
  faces: readonly FontFaceInfo[], signal: AbortSignal): Promise<DocumentFontCheck> {
  const issues: DocumentFontIssue[] = [];
  let checkedRuns = 0, characters = 0;
  const live = () => {
    if (signal.aborted || session.disposed || provider.state().disposed) throw new DOMException('字体检查已取消','AbortError');
  };
  const find = (family: string, run: TextRun) => faces.find(face => face.family.toLowerCase() === family.toLowerCase()
    && face.weight === (run.b ? 700 : 400) && face.italic === !!run.i);
  const body = async (text: TextBody | null, location: Pick<DocumentFontIssue,'slideId'|'page'|'object'>, vert?: TextVert) => {
    if (!text) return;
    for (const [paragraph,para] of text.paragraphs.entries()) {
      const runs = para.bullet && para.runs[0]
        ? [{text:para.bullet,b:false,i:false,u:false,strike:false,size:para.runs[0].size,color:para.runs[0].color,
          fonts:para.bulletFont ? [para.bulletFont] : para.runs[0].fonts},...para.runs] : para.runs;
      for (const [runIndex,run] of runs.entries()) {
        live();
        if (!run.text) continue;
        checkedRuns++; characters += run.text.length;
        const add = (failure: FontFailure, family = run.fonts[0] ?? '') => issues.push({...location,paragraph,run:runIndex,
          family,text:run.text,failure});
        if (checkedRuns > 20_000 || characters > 1_000_000 || issues.length >= 499) {
          add({ok:false,reason:'resource-limit'}); return false;
        }
        if (para.rtl) { add({ok:false,reason:'unsupported-direction'}); continue; }
        if ((vert ?? text.vert ?? 'horz') !== 'horz' || text.warp || run.math?.length || run.caps === 'small') {
          add({ok:false,reason:'unsupported-layout'}); continue;
        }
        const display = diagnosticFontText(run);
        if (display.problem) { add(display.problem); continue; }
        for (const segment of display.segments) {
          live();
          if (issues.length >= 499) { add({ok:false,reason:'resource-limit'}); return false; }
          const family = requestedFamily(run,segment.script), face = find(family,run);
          if (!face) { add({ok:false,reason:faces.some(face => face.family.toLowerCase() === family.toLowerCase())
            ? 'face-style-mismatch' : 'face-unavailable'},family); continue; }
          const shaped = await provider.shape(face.id,segment.text,{purpose:'edit',script:segment.script,
            direction:'ltr',language:'und',signal});
          live();
          if (!shaped.ok) add(display.failure(shaped,segment.start),family);
        }
      }
    }
    return true;
  };
  const elements = async (items: readonly SlideElement[], slideId: string, page: number): Promise<boolean> => {
    for (const element of items) {
      live();
      const location = {slideId,page,object:element.name || String(element.id)};
      if (element.kind === 'group') { if (!await elements(element.children,slideId,page)) return false; }
      if (element.kind === 'shape' && await body(element.text,location) === false) return false;
      if (element.kind === 'table') for (const row of element.rows) for (const cell of row.cells) {
        if (!cell.merged && await body(cell.text,location,cell.vert) === false) return false;
      }
    }
    return true;
  };
  for (const [index,id] of session.editor.doc.slideOrder.entries()) {
    live();
    if (!await elements(session.editor.toSlide(id).elements,id,index + 1)) break;
  }
  return {issues,checkedRuns};
}
