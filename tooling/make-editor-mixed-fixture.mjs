import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8, strToU8 } from 'fflate';
import { makeZip } from './lib/ooxml.mjs';

const read = (name) => unzipSync(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
const parts = read('sample-chart-data.pptx'), modern = read('sample-chartex-native.pptx');
const shell = strFromU8(modern['ppt/slides/slide1.xml']).match(/<mc:AlternateContent[\s\S]*<\/mc:AlternateContent>/)[0]
  .replaceAll('id="6"', 'id="906"').replaceAll('rId2', 'rIdModern').replaceAll('rId3', 'rIdModernPreview');
parts['ppt/slides/slide1.xml'] = strToU8(strFromU8(parts['ppt/slides/slide1.xml']).replace('</p:spTree>', `${shell}</p:spTree>`));
const rels = 'ppt/slides/_rels/slide1.xml.rels';
parts[rels] = strToU8(strFromU8(parts[rels]).replace('</Relationships>',
  '<Relationship Id="rIdModern" Type="http://schemas.microsoft.com/office/2014/relationships/chartEx" Target="../charts/chartEx1.xml"/>'
  + '<Relationship Id="rIdModernPreview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/chartex.png"/></Relationships>'));
let types = strFromU8(parts['[Content_Types].xml']);
if (!types.includes('Extension="png"')) types = types.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
parts['[Content_Types].xml'] = strToU8(types.replace('</Types>', '<Override PartName="/ppt/charts/chartEx1.xml" ContentType="application/vnd.ms-office.chartex+xml"/></Types>'));
for (const part of ['ppt/charts/chartEx1.xml', 'ppt/media/chartex.png']) parts[part] = modern[part];
writeFileSync(new URL('../fixtures/sample-editor-mixed.pptx', import.meta.url), makeZip(Object.entries(parts)));
