import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { nativeFixture, chartXml, CX } from './lib/chartex-native-fixture.mjs';
import { makeZip } from './lib/ooxml.mjs';

const parts = unzipSync(nativeFixture()), decoder = new TextDecoder(), encoder = new TextEncoder();
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const source = unzipSync(readFileSync(new URL('../fixtures/sample-chart-data.pptx', import.meta.url)));
parts['ppt/embeddings/modern.xlsx'] = source['ppt/embeddings/chart-data.xlsx'];
const xml = chartXml('waterfall', { values: [1280, 1640, null, 2050], categories: [['第一季度', '第二季度', '第三季度', '第四季度']],
  layout: '<cx:subtotals><cx:idx val="0"/><cx:idx val="3"/></cx:subtotals>' })
  .replace('<cx:chartData>', '<cx:chartData><cx:externalData r:id="book"/>')
  .replace('<cx:strDim type="cat">', '<cx:strDim type="cat"><cx:f dir="col">Sheet1!$A$2:$A$5</cx:f>')
  .replace('<cx:numDim type="val">', '<cx:numDim type="val"><cx:f dir="col">Sheet1!$B$2:$B$5</cx:f>')
  .replace('</cx:chartSpace>', '<cx:extLst><cx:ext uri="test-keep"><keep xmlns="urn:test">原文保留</keep></cx:ext></cx:extLst></cx:chartSpace>');
parts['ppt/charts/chartEx6.xml'] = encoder.encode(xml);
parts['ppt/charts/_rels/chartEx6.xml.rels'] = encoder.encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="book" Type="${R}/package" Target="../embeddings/modern.xlsx"/></Relationships>`);
parts['[Content_Types].xml'] = encoder.encode(decoder.decode(parts['[Content_Types].xml']).replace('</Types>', '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/></Types>'));
writeFileSync(new URL('../fixtures/sample-chartex-edit.pptx', import.meta.url), makeZip(Object.entries(parts)));
console.log('ChartEx 编辑固件：七种原生图、分层类别、空值、内嵌工作簿与未知扩展');
