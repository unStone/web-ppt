import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8, strToU8 } from 'fflate';
import { makeZip } from './lib/ooxml.mjs';

const baseline = unzipSync(readFileSync('fixtures/sample-chart-hierarchy.pptx'));
const scatter = strFromU8(unzipSync(readFileSync('fixtures/sample-chart-data.pptx'))['ppt/charts/chart7.xml']);
for (const suffix of ['', '-horizontal']) {
  const shared = unzipSync(readFileSync(`fixtures/sample-chart-shared-xy${suffix}.pptx`));
  // 先只有一个原生消费者，编辑后复制页面才形成共享关系。
  const parts = { ...baseline, 'ppt/charts/chart1.xml': shared['ppt/charts/chart1.xml'],
    'ppt/embeddings/hierarchy1.xlsx': shared['ppt/embeddings/hierarchy1.xlsx'] };
  writeFileSync(`fixtures/sample-chart-shared-transition-xy${suffix}.pptx`,
    makeZip(Object.entries(parts).sort(([a], [b]) => a.localeCompare(b))));
  const series = strFromU8(shared['ppt/charts/chart1.xml']).match(/<c:ser>[\s\S]*?<\/c:ser>/g);
  let index = 0;
  // 沿用原生散点绘图区与坐标轴，只替换已验证工作簿的名称和 X/Y 数据引用。
  const xml = scatter.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, original => {
    const source = series[index++];
    return original.replace(/<c:(tx|xVal|yVal)>[\s\S]*?<\/c:\1>/g,
      (_, field) => source.match(new RegExp(`<c:${field}>[\\s\\S]*?<\\/c:${field}>`))[0]);
  }).replace('</c:chartSpace>', '<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>');
  if (index !== series.length) throw new Error('散点与工作簿模板的系列数量必须一致');
  writeFileSync(`fixtures/sample-chart-shared-transition-scatter${suffix}.pptx`,
    makeZip(Object.entries({ ...parts, 'ppt/charts/chart1.xml': strToU8(xml) }).sort(([a], [b]) => a.localeCompare(b))));
}

const cache = { ...baseline };
for (const number of [1, 2, 3]) {
  const part = `ppt/charts/chart${number}.xml`;
  cache[part] = strToU8(strFromU8(cache[part]).replace(/<c:externalData\b[\s\S]*?<\/c:externalData>/g, ''));
  delete cache[`ppt/charts/_rels/chart${number}.xml.rels`];
  delete cache[`ppt/embeddings/hierarchy${number}.xlsx`];
}
writeFileSync('fixtures/sample-chart-shared-transition-cache.pptx',
  makeZip(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b))));

const shared = unzipSync(readFileSync('fixtures/sample-chart-shared-xy-shared-x.pptx'));
delete shared['ppt/charts/chart2.xml'];
delete shared['ppt/charts/_rels/chart2.xml.rels'];
shared['[Content_Types].xml'] = strToU8(strFromU8(shared['[Content_Types].xml'])
  .replace(/<Override\b[^>]*PartName="\/ppt\/charts\/chart2.xml"[^>]*\/>/, ''));
shared['ppt/slides/_rels/slide2.xml.rels'] = strToU8(strFromU8(shared['ppt/slides/_rels/slide2.xml.rels'])
  .replaceAll('chart2.xml', 'chart1.xml'));
writeFileSync('fixtures/sample-chart-shared-xy-single-part.pptx',
  makeZip(Object.entries(shared).sort(([a], [b]) => a.localeCompare(b))));
