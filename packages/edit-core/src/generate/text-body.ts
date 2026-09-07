import { warpMarkup } from './warp';
import { TEXT_RUN_DIRECT_BITS } from '@web-ppt/core';
import type { Paragraph, TextBody, TextRun } from '@web-ppt/core';
import { DRAWINGML_NS } from '../xml/qname';
import { parseXmlTree, serializeXmlNode } from '../xml/tree';
import { materializeRunProperties } from '../save/text-source-less';
import { hasNativeText, materializeNativeText } from './text-effects';
import { mathMarkup } from './math';
import { removeXmlAttribute } from '../xml/mutate';
import { removeDrawingFillChildren } from '../save/shape-format';
const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function generatedFieldId(part: string, spid: number, paragraph: number, run: number): string {
  const seed = `${part}:${spid}:${paragraph}:${run}`;
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < seed.length; index++) {
    left = Math.imul(left ^ seed.charCodeAt(index), 0x01000193) >>> 0;
    right = Math.imul(right ^ seed.charCodeAt(index), 0x85ebca6b) >>> 0;
  }
  const leftHex = left.toString(16).padStart(8, '0');
  const rightHex = right.toString(16).padStart(8, '0');
  return `{00000000-0000-0000-${leftHex.slice(0, 4)}-${leftHex.slice(4)}${rightHex}}`.toUpperCase();
}

function generatedRunProperties(run: TextRun, paragraph?: Paragraph): string {
  const properties = parseXmlTree(`<a:rPr xmlns:a="${DRAWINGML_NS}"/>`).root;
  const { text: _text, ...props } = run;
  materializeRunProperties(properties, { from: 0, to: run.text.length, props });
  materializeNativeText(properties, run);
  if (paragraph) {
    const direct = (paragraph.editInfo?.directRun ?? 0) | (run.editInfo?.direct ?? 0);
    if (!(direct & TEXT_RUN_DIRECT_BITS.b)) removeXmlAttribute(properties, 'b');
    if (!(direct & TEXT_RUN_DIRECT_BITS.color) && !run.gradientFill) removeDrawingFillChildren(properties);
  }
  return serializeXmlNode(properties);
}

export function generatedTextBody(body: TextBody, part: string, spid: number, prefix = 'p', tableStyleAware = false): string {
  const paragraphs = body.paragraphs.map((paragraph, paragraphIndex) => {
    const properties = (run: TextRun) => generatedRunProperties(run, tableStyleAware ? paragraph : undefined);
    const mathProperties = paragraph.runs.filter(run => run.math?.length).map(properties);
    if (mathProperties.some(properties => properties !== mathProperties[0])) {
      throw new Error(`段落 ${paragraphIndex + 1} 的公式需要不同字符属性，当前不能共用段落默认值`);
    }
    const runs = paragraph.runs.map((run, runIndex) => {
      const text = esc(run.text);
      if (run.math?.length) {
        const omml = `<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${mathMarkup(run.math)}</m:oMath>`;
        const content = paragraph.runs.length === 1
          ? `<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${omml}</m:oMathPara>` : omml;
        return `<a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main">${content}</a14:m>`;
      }
      if (!run.field) return `<a:r>${hasNativeText(run) ? properties(run) : ''}<a:t>${text}</a:t></a:r>`;
      const id = generatedFieldId(part, spid, paragraphIndex, runIndex);
      return `<a:fld id="${id}" type="${esc(run.field)}">${properties(run)}<a:t>${text}</a:t></a:fld>`;
    }).join('');
    const math = paragraph.runs.find(run => run.math?.length);
    const defaults = math ? `<a:pPr lvl="${paragraph.lvl}" rtl="${paragraph.rtl ? '1' : '0'}">${properties(math).replace(/a:rPr/g, 'a:defRPr')}</a:pPr>` : '';
    return `<a:p>${defaults}${runs}<a:endParaRPr/></a:p>`;
  }).join('');
  return `<${prefix}:txBody><a:bodyPr>${warpMarkup(body.warp)}</a:bodyPr><a:lstStyle/>${paragraphs}</${prefix}:txBody>`;
}
