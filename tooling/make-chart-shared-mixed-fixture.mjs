import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8, strToU8 } from 'fflate';
import { makeZip } from './lib/ooxml.mjs';

const bookPart = 'ppt/embeddings/hierarchy1.xlsx', sheetPart = 'xl/worksheets/sheet1.xml';
const zip = parts => makeZip(Object.entries(parts).sort(([a], [b]) => a.localeCompare(b)));
const read = name => unzipSync(readFileSync(`fixtures/sample-chart-shared${name}.pptx`));
const shift = text => text.replace(/([A-Z]+)(\$?\d+)/g, (_, column, row) => {
  let value = [...column].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) + 12;
  let result = '';
  while (value) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result + row;
});

for (const [name, horizontal, xyHorizontal, overlap] of [
  ['mixed', false, false, false], ['mixed-horizontal', true, true, false],
  ['mixed-scatter', false, false, false],
  ['mixed-crossed', false, true, false], ['mixed-overlap', false, false, true],
  ['mixed-records', false, false, true], ['mixed-records-horizontal', true, true, true],
  ['mixed-records-flat-horizontal', true, true, true],
  ['mixed-overlap-crossed', false, true, true],
]) {
  const parts = read(horizontal ? '-horizontal' : ''), xyParts = read(`-xy${xyHorizontal ? '-horizontal' : ''}`);
  const book = unzipSync(parts[bookPart]), xyBook = unzipSync(xyParts[bookPart]);
  const moveXY = horizontal && overlap
    ? text => text.replace(/([A-Z]+\$?)(\d+)/g, (_, column, row) => column + (Number(row) + 12)) : shift;
  const original = strFromU8(parts['ppt/charts/chart1.xml']), xy = strFromU8(xyParts['ppt/charts/chart1.xml']);
  let plot = xy.match(/<c:bubbleChart>[\s\S]*?<\/c:bubbleChart>/)[0];
  let index = 0;
  plot = plot.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, series => index++ ? '' : series
    .replace(/<c:(idx|order) val="0"\/>/g, '<c:$1 val="2"/>'))
    .replace(/<c:f>[\s\S]*?<\/c:f>/g, moveXY);
  if (overlap) {
    // X 直接引用类别系列的数值区域；其余维度仍沿各自模板，异向版本没有共同记录轴。
    const values = original.match(/<c:val>([\s\S]*?)<\/c:val>/)[1];
    plot = plot.replace(/<c:xVal>[\s\S]*?<\/c:xVal>/, `<c:xVal>${values}</c:xVal>`);
    if (name === 'mixed-overlap') plot = plot.replace(/<c:xVal>[\s\S]*?<\/c:xVal>/,
      '<c:xVal><c:numRef><c:f>Sheet1!C2:C5</c:f><c:numCache><c:formatCode>General</c:formatCode>'
      + '<c:ptCount val="4"/><c:pt idx="0"><c:v>0</c:v></c:pt><c:pt idx="1"><c:v>10</c:v></c:pt>'
      + '<c:pt idx="2"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:xVal>');
  }
  const axes = xy.match(/<c:valAx>[\s\S]*?<\/c:valAx>/g).join('');
  if (name === 'mixed-scatter') plot = plot.replace(/bubbleChart/g, 'scatterChart')
    .replace('<c:scatterChart>', '<c:scatterChart><c:scatterStyle val="marker"/>')
    .replace(/<c:bubbleSize>[\s\S]*?<\/c:bubbleSize>/g, '')
    .replace(/<c:(?:bubbleScale|showNegBubbles|sizeRepresents)[^>]*\/>/g, '')
    .replace('<c:xVal>', '<c:marker><c:symbol val="circle"/><c:size val="6"/></c:marker><c:xVal>');
  let combined = original.replace('<c:catAx>', plot + '<c:catAx>').replace('</c:plotArea>', axes + '</c:plotArea>');
  if (name === 'mixed-records-flat-horizontal') combined = combined.replace(/<c:multiLvlStrRef>[\s\S]*?<\/c:multiLvlStrRef>/g,
    raw => '<c:strRef><c:f>Sheet1!$B$2:$F$2</c:f><c:strCache><c:ptCount val="5"/>'
      + raw.match(/<c:lvl>([\s\S]*?)<\/c:lvl>/)[1] + '</c:strCache></c:strRef>');
  parts['ppt/charts/chart1.xml'] = parts['ppt/charts/chart2.xml'] = strToU8(combined);
  const rows = new Map();
  for (const [xml, transform] of [[strFromU8(book[sheetPart]), text => text], [strFromU8(xyBook[sheetPart]), moveXY]]) {
    for (const row of xml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      for (const cell of row[2].matchAll(/<c\b[\s\S]*?(?:<\/c>|\/>)/g)) {
        const value = transform(cell[0]), index = Number(value.match(/\br="[A-Z]+(\d+)"/)[1]);
        const cells = rows.get(index) ?? []; cells.push(value); rows.set(index, cells);
      }
    }
  }
  book[sheetPart] = strToU8(strFromU8(book[sheetPart]).replace(/<sheetData>[\s\S]*?<\/sheetData>/,
    `<sheetData>${[...rows].sort(([a], [b]) => a - b).map(([row, cells]) => `<row r="${row}">${cells.join('')}</row>`).join('')}</sheetData>`));
  parts[bookPart] = zip(book);
  writeFileSync(`fixtures/sample-chart-shared-${name}.pptx`, zip(parts));
}
