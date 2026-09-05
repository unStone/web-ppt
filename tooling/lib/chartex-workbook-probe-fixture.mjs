import { makeZip } from './ooxml.mjs';

const SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
const relationships = (entries) => `<Relationships xmlns="${REL}">${entries}</Relationships>`;

/** 人工数据边界，不包含上游媒体，也不声称由 Office 保存；包内路径故意不使用惯例名称。 */
export function workbookProbeFixture() {
  return {
    '_rels/.rels': relationships(`<Relationship Id="book" Type="${R}/officeDocument" Target="book/main.xml"/>`),
    'book/main.xml': `<workbook xmlns="${SS}" xmlns:r="${R}"><sheets><sheet name="O'Brien data" sheetId="1" r:id="sheet"/></sheets><definedNames><definedName name="data">'O''Brien data'!$A$1:$A$13</definedName></definedNames></workbook>`,
    'book/_rels/main.xml.rels': relationships(`<Relationship Id="sheet" Type="${R}/worksheet" Target="/data/values.xml"/><Relationship Id="strings" Type="${R}/sharedStrings" Target="/data/strings.xml"/>`),
    'data/strings.xml': `<sst xmlns="${SS}"><si><r><t>中</t></r><r><t>文</t></r><rPh sb="0" eb="1"><t>zhong</t></rPh></si></sst>`,
    'data/values.xml': `<worksheet xmlns="${SS}"><sheetData><row r="1">
      <c r="A1"><v>0</v></c><c r="A2"/><c r="A4" t="b"><v>1</v></c><c r="A5" t="e"><v>#N/A</v></c>
      <c r="A6"><f>1+2</f><v>3</v></c><c r="A7"><f>4+5</f></c><c r="A8" t="inlineStr"><is><t></t></is></c>
      <c r="A9" t="s"><v></v></c><c r="A10" t="s"><v>0</v></c><c r="A11"><v>0x10</v></c>
      <c r="A12" t="d"><v>2026-09-06</v></c><c r="A13" t="str"><v>007</v></c>
    </row></sheetData></worksheet>`,
    'chart/chart.xml': `<cx:chartSpace xmlns:cx="${CX}" xmlns:r="${R}"><cx:chartData><cx:data id="0"><cx:numDim type="val"><cx:f dir="row">data</cx:f></cx:numDim></cx:data></cx:chartData><cx:chart><cx:plotArea><cx:plotAreaRegion><cx:series layoutId="waterfall"><cx:dataId val="0"/></cx:series></cx:plotAreaRegion></cx:plotArea></cx:chart></cx:chartSpace>`,
  };
}

export const workbookProbeBytes = (parts) => makeZip(Object.entries(parts));
