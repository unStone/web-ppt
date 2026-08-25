/** 页面复制固件：在删除固件的复杂关系图上增加嵌套组与 notes→slide 回指。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { makeZip, px } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const files = unzipSync(readFileSync(join(root, 'fixtures/sample-editor-remove-slide.pptx')));
const replace = (part, fn) => { files[part] = encoder.encode(fn(decoder.decode(files[part]))); };

const nestedGroup = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="50" name="外层组合"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="300000"><a:off x="${px(260)}" y="${px(430)}"/><a:ext cx="${px(300)}" cy="${px(140)}"/><a:chOff x="0" y="0"/><a:chExt cx="${px(300)}" cy="${px(140)}"/></a:xfrm></p:grpSpPr>
<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="51" name="内层组合"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(20)}" y="${px(20)}"/><a:ext cx="${px(240)}" cy="${px(100)}"/><a:chOff x="0" y="0"/><a:chExt cx="${px(240)}" cy="${px(100)}"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="52" name="嵌套副本内容"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(20)}" y="${px(20)}"/><a:ext cx="${px(200)}" cy="${px(60)}"/></a:xfrm><a:prstGeom prst="hexagon"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent5"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1600"/><a:t>嵌套副本</a:t></a:r></a:p></p:txBody></p:sp>
</p:grpSp></p:grpSp>`;

replace('ppt/slides/slide2.xml', (xml) => xml.replace('</p:spTree>', `${nestedGroup}</p:spTree>`));
replace('ppt/notesSlides/_rels/notesSlide2.xml.rels', (xml) => xml.replace('</Relationships>',
  `<Relationship Id="rId10" Type="${REL}/slide" Target="../slides/slide2.xml"/></Relationships>`));

const output = makeZip(Object.entries(files));
writeFileSync(join(root, 'fixtures/sample-editor-duplicate-slide.pptx'), output);
console.log(`fixtures/sample-editor-duplicate-slide.pptx 已生成（${(output.length / 1024).toFixed(1)} KB）`);

// OPC part 与 Relationship@Id 都是任意 URI/NCName；另存一份反惯例固件，防止实现偷看 slideN/rIdN 命名。
const noncanonical = { ...files };
const move = (from, to) => {
  noncanonical[to] = noncanonical[from];
  delete noncanonical[from];
};
const replaceNoncanonical = (part, fn) => {
  noncanonical[part] = encoder.encode(fn(decoder.decode(noncanonical[part])));
};
move('ppt/slides/slide2.xml', 'ppt/slides/source-page.xml');
move('ppt/slides/_rels/slide2.xml.rels', 'ppt/slides/_rels/source-page.xml.rels');
move('ppt/notesSlides/notesSlide2.xml', 'ppt/notesSlides/source-note.xml');
move('ppt/notesSlides/_rels/notesSlide2.xml.rels', 'ppt/notesSlides/_rels/source-note.xml.rels');
replaceNoncanonical('[Content_Types].xml', (xml) => xml
  .replace('/ppt/slides/slide2.xml', '/ppt/slides/source-page.xml')
  .replace('/ppt/notesSlides/notesSlide2.xml', '/ppt/notesSlides/source-note.xml'));
replaceNoncanonical('ppt/_rels/presentation.xml.rels', (xml) =>
  xml.replace('Target="slides/slide2.xml"', 'Target="slides/source-page.xml"'));
replaceNoncanonical('ppt/slides/_rels/source-page.xml.rels', (xml) => xml
  .replace(`Id="rId1" Type="${REL}/slideLayout"`, `Id="layout-main" Type="${REL}/slideLayout"`)
  .replace(`Id="rId9" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide2.xml"`,
    `Id="notes-main" Type="${REL}/notesSlide" Target="../notesSlides/source-note.xml"`));
replaceNoncanonical('ppt/notesSlides/_rels/source-note.xml.rels', (xml) => xml
  .replace('Id="rId10"', 'Id="slide-back"')
  .replace('Target="../slides/slide2.xml"', 'Target="../slides/source-page.xml"'));
const noncanonicalOutput = makeZip(Object.entries(noncanonical));
writeFileSync(join(root, 'fixtures/sample-editor-duplicate-slide-noncanonical.pptx'), noncanonicalOutput);
console.log(`fixtures/sample-editor-duplicate-slide-noncanonical.pptx 已生成（${(noncanonicalOutput.length / 1024).toFixed(1)} KB）`);
