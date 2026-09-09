import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8, strToU8 } from 'fflate';
import { makeZip } from './lib/ooxml.mjs';

const hierarchy = unzipSync(readFileSync('fixtures/sample-chart-hierarchy.pptx'));
const parts = { ...hierarchy };
// 前两页是不同图表视图，第三页再次引用首图；三者共同指向同一个原生工作簿。
parts['ppt/charts/chart2.xml'] = parts['ppt/charts/chart1.xml'].slice();
parts['ppt/charts/_rels/chart2.xml.rels'] = parts['ppt/charts/_rels/chart1.xml.rels'].slice();
parts['ppt/slides/_rels/slide3.xml.rels'] = strToU8(strFromU8(parts['ppt/slides/_rels/slide3.xml.rels'])
  .replace('charts/chart3.xml', 'charts/chart1.xml'));
for (const part of ['ppt/charts/chart3.xml', 'ppt/charts/_rels/chart3.xml.rels',
  'ppt/embeddings/hierarchy2.xlsx', 'ppt/embeddings/hierarchy3.xlsx']) delete parts[part];
parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml'])
  .replace(/<Override\b[^>]*PartName="\/ppt\/charts\/chart3.xml"[^>]*\/>/, ''));
writeFileSync('fixtures/sample-chart-shared.pptx', makeZip(Object.entries(parts).sort(([a], [b]) => a.localeCompare(b))));
writeFileSync('fixtures/sample-chart-shared-horizontal.pptx', makeZip(Object.entries({ ...parts,
  'ppt/charts/chart1.xml': hierarchy['ppt/charts/chart3.xml'],
  'ppt/charts/chart2.xml': hierarchy['ppt/charts/chart3.xml'],
  'ppt/embeddings/hierarchy1.xlsx': hierarchy['ppt/embeddings/hierarchy3.xlsx'],
}).sort(([a], [b]) => a.localeCompare(b))));
writeFileSync('fixtures/sample-chart-shared-three-level.pptx', makeZip(Object.entries({ ...parts,
  'ppt/charts/chart1.xml': hierarchy['ppt/charts/chart2.xml'],
  'ppt/charts/chart2.xml': hierarchy['ppt/charts/chart2.xml'],
  'ppt/embeddings/hierarchy1.xlsx': hierarchy['ppt/embeddings/hierarchy2.xlsx'],
}).sort(([a], [b]) => a.localeCompare(b))));

const cacheOnly = { ...parts };
for (const number of [1, 2]) {
  const part = `ppt/charts/chart${number}.xml`;
  cacheOnly[part] = strToU8(strFromU8(parts[part]).replace(/<c:externalData\b[\s\S]*?<\/c:externalData>/g, ''));
  delete cacheOnly[`ppt/charts/_rels/chart${number}.xml.rels`];
}
delete cacheOnly['ppt/embeddings/hierarchy1.xlsx'];
writeFileSync('fixtures/sample-chart-shared-cache.pptx', makeZip(Object.entries(cacheOnly).sort(([a], [b]) => a.localeCompare(b))));
for (const [name, number] of [['horizontal', 3], ['three-level', 2]]) {
  const source = strToU8(strFromU8(hierarchy[`ppt/charts/chart${number}.xml`])
    .replace(/<c:externalData\b[\s\S]*?<\/c:externalData>/g, ''));
  writeFileSync(`fixtures/sample-chart-shared-cache-${name}.pptx`, makeZip(Object.entries({ ...cacheOnly,
    'ppt/charts/chart1.xml': source, 'ppt/charts/chart2.xml': source,
  }).sort(([a], [b]) => a.localeCompare(b))));
}
const xyCache = { ...cacheOnly, 'ppt/charts/chart1.xml':
  unzipSync(readFileSync('fixtures/sample-chart-data.pptx'))['ppt/charts/chart11.xml'] };
writeFileSync('fixtures/sample-chart-shared-cache-xy.pptx', makeZip(Object.entries(xyCache).sort(([a], [b]) => a.localeCompare(b))));

// 第二个视图只引用中间三行，类别身份与本地索引不同，仍应按工作簿地址联动。
const partial = { ...parts };
const subset = cache => cache.replace('<c:ptCount val="5"/>', '<c:ptCount val="3"/>')
  .replace(/<c:pt idx="(\d+)">[\s\S]*?<\/c:pt>/g, (point, raw) => {
    const index = Number(raw);
    return index >= 1 && index <= 3 ? point.replace(`idx="${index}"`, `idx="${index - 1}"`) : '';
  });
partial['ppt/charts/chart2.xml'] = strToU8(strFromU8(parts['ppt/charts/chart2.xml'])
  .replace(/<c:multiLvlStrCache>[\s\S]*?<\/c:multiLvlStrCache>/g, cache => subset(cache)
    .replace('<c:lvl><c:pt idx="1"><c:v>South', '<c:lvl><c:pt idx="0"><c:v>North</c:v></c:pt><c:pt idx="1"><c:v>South'))
  .replace(/<c:numCache>[\s\S]*?<\/c:numCache>/g, subset)
  .replaceAll('Sheet1!$A$2:$B$6', 'Sheet1!$A$3:$B$5')
  .replaceAll('Sheet1!C2:C6', 'Sheet1!C3:C5').replaceAll('Sheet1!D2:D6', 'Sheet1!D3:D5'));
writeFileSync('fixtures/sample-chart-shared-views.pptx', makeZip(Object.entries(partial).sort(([a], [b]) => a.localeCompare(b))));

const bookPart = 'ppt/embeddings/hierarchy1.xlsx';
const workbook = unzipSync(parts[bookPart]), sheet = strFromU8(workbook['xl/worksheets/sheet1.xml']);
const saveVariant = (name, xml, book) => writeFileSync(`fixtures/sample-chart-shared-${name}.pptx`,
  makeZip(Object.entries({ ...parts, 'ppt/charts/chart2.xml': strToU8(xml),
    [bookPart]: makeZip(Object.entries(book).sort(([a], [b]) => a.localeCompare(b))),
  }).sort(([a], [b]) => a.localeCompare(b))));
const original = strFromU8(parts['ppt/charts/chart2.xml']);
saveVariant('occupied', original, { ...workbook,
  'xl/worksheets/sheet1.xml': strToU8(sheet.replace('<row r="3">', '<row r="3"><c r="E3"><v>909</v></c>')),
});
saveVariant('row-blocked', original, { ...workbook,
  'xl/worksheets/sheet1.xml': strToU8(sheet.replace('<row r="20">', '<row r="7"><c r="D7"><v>999</v></c></row><row r="20">')),
});
saveVariant('metadata', original, { ...workbook,
  'xl/worksheets/sheet1.xml': strToU8(sheet.replace('<row r="3">', '<row r="3"><c r="E3" cm="1"/>')),
});
saveVariant('merged', original, { ...workbook,
  'xl/worksheets/sheet1.xml': strToU8(sheet.replace('</worksheet>', '<mergeCells count="1"><mergeCell ref="E2:E4"/></mergeCells></worksheet>')),
});
saveVariant('array-formula', original, { ...workbook,
  'xl/worksheets/sheet1.xml': strToU8(sheet.replace('<row r="3">', '<row r="3"><c r="E3"><f t="array" ref="E2:G6">1</f><v>1</v></c>')),
});
const shift = text => text.replace(/(\$?)([A-D])(\$?\d+)/g,
  (_, dollar, column, row) => `${dollar}${String.fromCharCode(column.charCodeAt(0) + 7)}${row}`);
saveVariant('disjoint', original.replace(/<c:f>[\s\S]*?<\/c:f>/g, shift), { ...workbook,
  'xl/worksheets/sheet1.xml': strToU8(sheet.replace(/(<row r="[1-6]">)([\s\S]*?)(<\/row>)/g,
    (_, open, cells, close) => `${open}${cells}${cells.replace(/r="[A-D]\d+"/g, shift)}${close}`)),
});
saveVariant('sheets', original.replaceAll('Sheet1!', "'Data Two'!"), { ...workbook,
  'xl/worksheets/sheet3.xml': workbook['xl/worksheets/sheet1.xml'],
  'xl/workbook.xml': strToU8(strFromU8(workbook['xl/workbook.xml'])
    .replace('</sheets>', '<sheet name="Data Two" sheetId="3" r:id="rId5"/></sheets>')),
  'xl/_rels/workbook.xml.rels': strToU8(strFromU8(workbook['xl/_rels/workbook.xml.rels'])
    .replace('</Relationships>', '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>')),
  '[Content_Types].xml': strToU8(strFromU8(workbook['[Content_Types].xml'])
    .replace('</Types>', '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')),
});
saveVariant('flat', original.replace(/<c:multiLvlStrRef>[\s\S]*?<\/c:multiLvlStrRef>/g, reference => {
  const leaf = reference.match(/<c:lvl>([\s\S]*?)<\/c:lvl>/)[1];
  return `<c:strRef><c:f>Sheet1!B2:B6</c:f><c:strCache><c:ptCount val="5"/>${leaf}</c:strCache></c:strRef>`;
}), workbook);
saveVariant('flat-parent', original.replace(/<c:multiLvlStrRef>[\s\S]*?<\/c:multiLvlStrRef>/g,
  `<c:strRef><c:f>Sheet1!A2:A6</c:f><c:strCache><c:ptCount val="5"/>${['North', 'North', 'South', '', ''].map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`), workbook);

// XY 的三个维度分别占用连续列；两个图表部件共用同一组单元格。
for (const horizontal of [false, true]) {
  const cells = new Map();
  let seriesIndex = 0;
  const column = index => String.fromCharCode(65 + index);
  const put = (address, value) => cells.set(address, typeof value === 'number'
    ? `<c r="${address}"><v>${value}</v></c>` : `<c r="${address}" t="inlineStr"><is><t>${value}</t></is></c>`);
  const xy = strFromU8(xyCache['ppt/charts/chart1.xml']).replace(/<c:ser>[\s\S]*?<\/c:ser>/g, series => {
    const offset = seriesIndex++ * 3;
    const address = (dimension, point) => horizontal ? `${column(point + 1)}${offset + dimension + 1}` : `${column(offset + dimension)}${point + 2}`;
    const name = horizontal ? `A${offset + 1}` : `${column(offset)}1`;
    const label = series.match(/<c:tx><c:v>(.*?)<\/c:v><\/c:tx>/)[1];
    put(name, label);
    let dimension = 0;
    return series.replace(/<c:tx>[\s\S]*?<\/c:tx>/, `<c:tx><c:strRef><c:f>Sheet1!${name}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${label}</c:v></c:pt></c:strCache></c:strRef></c:tx>`)
      .replace(/<c:numRef>[\s\S]*?<\/c:numRef>/g, reference => {
        const axis = dimension++;
        for (const match of reference.matchAll(/<c:pt idx="(\d+)"><c:v>(.*?)<\/c:v><\/c:pt>/g)) put(address(axis, Number(match[1])), Number(match[2]));
        return reference.replace(/<c:f>.*?<\/c:f>/, `<c:f>Sheet1!${address(axis, 0)}:${address(axis, 3)}</c:f>`);
      });
  }).replace('</c:chartSpace>', '<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>');
  const rows = new Map();
  for (const [address, cell] of cells) {
    const row = Number(address.match(/\d+/)[0]);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push([address, cell]);
  }
  const data = [...rows].sort(([a], [b]) => a - b).map(([row, cells]) => `<row r="${row}">${cells.sort(([a], [b]) => a.localeCompare(b)).map(([, cell]) => cell).join('')}</row>`).join('');
  const xyBook = { ...workbook, 'xl/worksheets/sheet1.xml': strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`) };
  const saveXY = (suffix, first = xy, second = first, book = xyBook) =>
    writeFileSync(`fixtures/sample-chart-shared-xy${horizontal ? '-horizontal' : ''}${suffix}.pptx`, makeZip(Object.entries({ ...parts,
      'ppt/charts/chart1.xml': strToU8(first), 'ppt/charts/chart2.xml': strToU8(second),
      [bookPart]: makeZip(Object.entries(book).sort(([a], [b]) => a.localeCompare(b))),
    }).sort(([a], [b]) => a.localeCompare(b))));
  saveXY('');
  const view = xy.replace(/<c:numRef>[\s\S]*?<\/c:numRef>/g, reference => reference
    .replace(/<c:f>Sheet1!([A-F])([1-6]):([A-F])([1-6])<\/c:f>/, (_, a, b, c, d) =>
      `<c:f>Sheet1!${horizontal ? `C${b}:D${d}` : `${a}3:${c}4`}</c:f>`)
    .replace('<c:ptCount val="4"/>', '<c:ptCount val="2"/>')
    .replace(/<c:pt idx="(\d+)">[\s\S]*?<\/c:pt>/g, (point, index) =>
      Number(index) === 1 || Number(index) === 2 ? point.replace(`idx="${index}"`, `idx="${Number(index) - 1}"`) : ''));
  saveXY('-views', xy, view);
  const sharedX = xy.match(/<c:xVal>[\s\S]*?<\/c:xVal>/)[0];
  saveXY('-shared-x', xy.replace(/<c:xVal>[\s\S]*?<\/c:xVal>/g, sharedX));
  saveXY('-aliased', xy.replace(/<c:ser>[\s\S]*?<\/c:ser>/, series => series.replace(/<c:yVal>[\s\S]*?<\/c:yVal>/,
    series.match(/<c:xVal>[\s\S]*?<\/c:xVal>/)[0].replaceAll('xVal', 'yVal'))));
  const lastSheet = strFromU8(xyBook['xl/worksheets/sheet1.xml']);
  saveXY('-blocked', xy, xy, { ...xyBook, 'xl/worksheets/sheet1.xml': strToU8(horizontal
    ? lastSheet.replace('<row r="1">', '<row r="1"><c r="F1"><v>999</v></c>')
    : lastSheet.replace('</sheetData>', '<row r="6"><c r="A6"><v>999</v></c></row></sheetData>')) });
  const empty = xy.replace(/<c:numRef>[\s\S]*?<\/c:numRef>/g, reference => reference
    .replace(/(<c:f>Sheet1!)([^:]+):[^<]+/, '$1$2:$2')
    .replace('<c:ptCount val="4"/>', '<c:ptCount val="0"/>').replace(/<c:pt idx="\d+">[\s\S]*?<\/c:pt>/g, ''));
  saveXY('-empty', empty, empty, { ...xyBook, 'xl/worksheets/sheet1.xml':
    strToU8(lastSheet.replace(/<c r="[A-F]\d+"><v>[\s\S]*?<\/c>/g, '')) });
  const sheetMetadata = unzipSync(unzipSync(readFileSync('fixtures/sample-chart-shared-sheets.pptx'))[bookPart]);
  saveXY('-sheets', xy, xy.replaceAll('Sheet1!', "'Data Two'!"), { ...sheetMetadata,
    'xl/worksheets/sheet1.xml': xyBook['xl/worksheets/sheet1.xml'], 'xl/worksheets/sheet3.xml': xyBook['xl/worksheets/sheet1.xml'] });
  if (!horizontal) {
    const crossed = new Map(); let owner = 0;
    const crossXML = xy.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, series => {
      const first = owner++ === 0, name = first ? 'A5' : 'E1', label = first ? 'Horizontal' : 'Vertical';
      crossed.set(name, `<c r="${name}" t="inlineStr"><is><t>${label}</t></is></c>`);
      let dimension = 0;
      return series.replace(/<c:tx>[\s\S]*?<\/c:tx>/,
        `<c:tx><c:strRef><c:f>Sheet1!${name}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${label}</c:v></c:pt></c:strCache></c:strRef></c:tx>`)
        .replace(/<c:numRef>[\s\S]*?<\/c:numRef>/g, reference => {
          const lane = dimension++, address = point => first ? `${column(point + 1)}${lane + 5}` : `${column(lane + 4)}${point + 2}`;
          return reference.replace(/<c:f>[\s\S]*?<\/c:f>/, `<c:f>Sheet1!${address(0)}:${address(1)}</c:f>`)
            .replace('<c:ptCount val="4"/>', '<c:ptCount val="2"/>')
            .replace(/<c:pt idx="(\d+)"><c:v>(.*?)<\/c:v><\/c:pt>/g, (point, index, value) => {
              if (Number(index) > 1) return '';
              const cell = address(Number(index)); crossed.set(cell, `<c r="${cell}"><v>${value}</v></c>`); return point;
            });
        });
    });
    const data = Array.from({ length: 7 }, (_, index) => `<row r="${index + 1}">${[...crossed]
      .filter(([address]) => Number(address.match(/\d+/)[0]) === index + 1).sort(([a], [b]) => a.localeCompare(b)).map(([, cell]) => cell).join('')}</row>`).join('');
    saveXY('-crossed', crossXML, crossXML, { ...xyBook, 'xl/worksheets/sheet1.xml':
      strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`) });
  }
}
