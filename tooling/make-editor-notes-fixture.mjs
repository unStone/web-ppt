/** 演讲者备注固件：正文、多占位符、回指、外链、notesMaster 与未知扩展共存。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { makeZip, NS, nvGrp, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const files = unzipSync(readFileSync(join(root, 'fixtures/sample-editor-remove-slide.pptx')));

files['ppt/notesSlides/notesSlide1.xml'] = encoder.encode(`${XML}<p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld><p:spTree>${nvGrp}
<p:sp><p:nvSpPr><p:cNvPr id="2" name="备注正文"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1200"/><a:t>来源第一段</a:t></a:r></a:p><a:p><a:r><a:rPr sz="1200"/><a:t>来源第二段</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="页脚"/><p:cNvSpPr/><p:nvPr><p:ph type="ftr" idx="2"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>页脚不得进入备注正文</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="4" name="页码"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" idx="3"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{NOTES-PAGE-FIELD}" type="slidenum"><a:t>1</a:t></a:fld></a:p></p:txBody></p:sp>
</p:spTree></p:cSld><p:extLst><p:ext uri="{WEB-PPT-NOTES-KEEP}"><fixture:keep xmlns:fixture="urn:web-ppt:notes" value="unknown-extension"/></p:ext></p:extLst>
</p:notes>`);

files['ppt/notesSlides/_rels/notesSlide1.xml.rels'] = encoder.encode(`${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="external-link" Type="${REL}/hyperlink" Target="https://example.com/speaker-notes" TargetMode="External"/>
<Relationship Id="master-ref" Type="${REL}/notesMaster" Target="../notesMasters/notesMasterKeep.xml"/>
<Relationship Id="slide-back" Type="${REL}/slide" Target="../slides/slide1.xml"/>
<Relationship Id="unknown-ref" Type="urn:web-ppt:notes:unknown" Target="../../customXml/keep.xml"/>
</Relationships>`);

const output = makeZip(Object.entries(files));
writeFileSync(join(root, 'fixtures/sample-editor-notes.pptx'), output);
console.log(`fixtures/sample-editor-notes.pptx 已生成（${(output.length / 1024).toFixed(1)} KB）`);
