import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { makeZip } from './lib/ooxml.mjs';
import { bundleBrowser } from './lib/bundle-browser.mjs';
const root = resolve(import.meta.dirname, '..'), out = join(root, 'out/ole-fixture'); mkdirSync(out, { recursive: true });
const { createCompoundFile, readCompoundFile, writeCompoundFile } = await bundleBrowser({ root, entry: join(root, 'packages/edit-core/src/cfb/index.ts'), output: join(out, 'cfb.mjs') });
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const rootRel = (target) => `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="${target}"/></Relationships>`;
const types = (entries) => `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${entries.map(([part,type])=>`<Override PartName="/${part}" ContentType="${type}"/>`).join('')}</Types>`;
const xlsx = makeZip([
 ['[Content_Types].xml',types([['xl/workbook.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],['xl/worksheets/sheet1.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'],['xl/worksheets/sheet2.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'],['xl/sharedStrings.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml']])],
 ['_rels/.rels',rootRel('xl/workbook.xml')],
 ['xl/workbook.xml',`<workbook xmlns="${SS}" xmlns:r="${R}"><sheets><sheet name="营业数据" sheetId="1" r:id="sheet1"/><sheet name="其他数据" sheetId="2" r:id="sheet2"/></sheets><extLst><ext uri="test"><keep xmlns="urn:test">保留工作簿扩展</keep></ext></extLst></workbook>`],
 ['xl/_rels/workbook.xml.rels',`<Relationships xmlns="${REL}"><Relationship Id="sheet1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="sheet2" Type="${R}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="strings" Type="${R}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
 ['xl/sharedStrings.xml',`<sst xmlns="${SS}" count="2" uniqueCount="2"><si><t>季度</t></si><si><t>销售额</t></si></sst>`],
 ['xl/worksheets/sheet1.xml',`<worksheet xmlns="${SS}"><dimension ref="A1:C2"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>第一季</t></is></c><c r="B2"><v>100</v></c><c r="C2"><f>B2*2</f><v>200</v></c></row></sheetData><extLst><ext uri="preserve"><keep xmlns="urn:test">未知工作表扩展</keep></ext></extLst></worksheet>`],
 ['xl/worksheets/sheet2.xml',`<worksheet xmlns="${SS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>独立工作表</t></is></c></row></sheetData></worksheet>`],
]);
const docx = makeZip([
 ['[Content_Types].xml',types([['word/document.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml']])],['_rels/.rels',rootRel('word/document.xml')],
 ['word/document.xml',`<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>嵌入的文档标题</w:t></w:r></w:p><w:p><w:r><w:t>正文内容</w:t></w:r></w:p><w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`],
 ['custom/unknown.xml','<keep>未知文档部件</keep>'],
]);
const wordFile = readCompoundFile(createCompoundFile({ Package: docx, '\u0001CompObj':new Uint8Array([9,8,7]), 'PrivateStorage/state':new Uint8Array([5,4,3]) }));
wordFile.entries[0].raw.set([0x06,0x09,0x02,0,0,0,0,0,0xc0,0,0,0,0,0,0,0x46],80);
const label = new TextEncoder().encode('Sheet\0book.xlsx\0'), command = new TextEncoder().encode('book.xlsx\0');
const start = 6+label.length+4+4+command.length+4, native = new Uint8Array(start+xlsx.length+2), d = new DataView(native.buffer);
d.setUint32(0,native.length-4,true);d.setUint16(4,2,true); native.set(label,6);d.setUint16(6+label.length+2,3,true);d.setUint32(6+label.length+4,command.length,true);native.set(command,6+label.length+8);d.setUint32(start-4,xlsx.length,true);native.set(xlsx,start);
const embedded = [xlsx,writeCompoundFile(wordFile),createCompoundFile({ '\u0001Ole10Native': native, '\u0001CompObj': new Uint8Array([1,4,7]) })];
const parts = unzipSync(readFileSync(join(root,'fixtures/sample-ole.pptx'))), enc = new TextEncoder(), dec = new TextDecoder();
for(let i=1;i<=3;i++) {
 const path=`ppt/slides/slide${i}.xml`;
 parts[path]=enc.encode(dec.decode(parts[path]).replace(/progId="[^"]*"/g,`progId="${i===2?'Word.Document.12':'Excel.Sheet.12'}"`).replace('name="OLE',`name="OLE ${i}`));
 const rel=`ppt/slides/_rels/slide${i}.xml.rels`;parts[rel]=enc.encode(dec.decode(parts[rel]).replace('embeddings/oleObject1.bin',`embeddings/oleEdit${i}.${i===1?'xlsx':'bin'}`));
 parts[`ppt/embeddings/oleEdit${i}.${i===1?'xlsx':'bin'}`]=embedded[i-1];
}
parts['[Content_Types].xml']=enc.encode(dec.decode(parts['[Content_Types].xml']).replace('</Types>','<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/></Types>'));
delete parts['ppt/embeddings/oleObject1.bin'];
writeFileSync(join(root,'fixtures/sample-ole-edit.pptx'),makeZip(Object.entries(parts)));
console.log('OLE 内容固件：原生 XLSX、CFB Package DOCX、Ole10Native XLSX、未知流与扩展');
