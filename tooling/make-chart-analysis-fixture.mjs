/** 桌面 003 固件：在 sample-chart-data 的图表上注入趋势线 / 误差线 / 数据表，覆盖全部元素类型。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8, strToU8 } from 'fflate';
import { makeZip } from './lib/ooxml.mjs';

const parts = unzipSync(readFileSync(new URL('../fixtures/sample-chart-data.pptx', import.meta.url)));

// trendline / errBars 必须落在 ser 的 cat/val 之前（dml-chart.xsd 序列），不能贴着 </c:ser> 插
const injectIntoSer = (xml, injection) => {
  const anchor = xml.search(/<c:(cat|val|xVal)[ >]/);
  if (anchor < 0) throw new Error('图表系列缺少数据锚点');
  return xml.slice(0, anchor) + injection + xml.slice(anchor);
};

const TREND = {
  logarithmic: '<c:trendline><c:trendlineType val="logarithmic"/><c:dispRSqr val="1"/><c:dispEq val="1"/></c:trendline>',
  power: '<c:trendline><c:name>Power</c:name><c:trendlineType val="power"/><c:dispEq val="1"/></c:trendline>',
  linear: '<c:trendline><c:trendlineType val="linear"/><c:forward val="1"/><c:dispRSqr val="1"/><c:dispEq val="1"/></c:trendline>',
  movingAvg: '<c:trendline><c:trendlineType val="movingAvg"/><c:period val="2"/></c:trendline>',
  poly: '<c:trendline><c:trendlineType val="poly"/><c:order val="2"/><c:dispEq val="1"/></c:trendline>',
  exponential: '<c:trendline><c:trendlineType val="exponential"/><c:dispRSqr val="1"/><c:dispEq val="1"/></c:trendline>',
};
const ERR = {
  stdErr: '<c:errBars><c:errDir val="y"/><c:errBarType val="both"/><c:errValType val="stdErr"/></c:errBars>',
  fixedVal: '<c:errBars><c:errDir val="y"/><c:errBarType val="both"/><c:errValType val="fixedVal"/><c:val val="40"/></c:errBars>',
  percentage: '<c:errBars><c:errDir val="y"/><c:errBarType val="both"/><c:errValType val="percentage"/><c:val val="10"/></c:errBars>',
  stdDev: '<c:errBars><c:errDir val="y"/><c:errBarType val="both"/><c:errValType val="stdDev"/><c:val val="1"/></c:errBars>',
};
// cust 的 x 向误差线：正负各 0.5 个单位，8 个点
const numLit = (value) =>
  `<c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="8"/>${Array.from({ length: 8 }, (_, i) => `<c:pt idx="${i}"><c:v>${value}</c:v></c:pt>`).join('')}</c:numLit>`;
const custX = `<c:errBars><c:errDir val="x"/><c:errBarType val="both"/><c:errValType val="cust"/><c:plus>${numLit(0.5)}</c:plus><c:minus>${numLit(0.5)}</c:minus></c:errBars>`;

const replace = (part, update) => {
  parts[part] = strToU8(update(strFromU8(parts[part])));
};
const dTable = '<c:dTable><c:showHorzBorder val="1"/><c:showVertBorder val="1"/><c:showOutline val="1"/><c:showKeys val="1"/></c:dTable>';

// chart1 柱状图（正值）：对数趋势线
replace('ppt/charts/chart1.xml', (xml) => injectIntoSer(xml, TREND.logarithmic));
// chart2 柱状图：幂趋势线 + 固定值误差线；图内文案改 ASCII（矢量 PDF 用例的字体样本只覆盖 ASCII 与少量汉字）
replace('ppt/charts/chart2.xml', (xml) => {
  const ascii = xml
    .replace(/<c:v>直营<\/c:v>/g, '<c:v>Direct</c:v>')
    .replace(/<c:v>分销<\/c:v>/g, '<c:v>Online</c:v>')
    .replace(/<c:v>线上<\/c:v>/g, '<c:v>Retail</c:v>')
    .replace(/<c:v>第一季度<\/c:v>/g, '<c:v>Q1</c:v>')
    .replace(/<c:v>第二季度<\/c:v>/g, '<c:v>Q2</c:v>')
    .replace(/<c:v>第三季度<\/c:v>/g, '<c:v>Q3</c:v>')
    .replace(/<c:v>第四季度<\/c:v>/g, '<c:v>Q4</c:v>')
    .replace(/<a:t>渠道占比（百分比堆叠）<\/a:t>/g, '<a:t>Channel Share</a:t>');
  return injectIntoSer(ascii, TREND.power + ERR.fixedVal);
});
// chart4 折线图：线性趋势线（前推 1）+ 移动平均 + 标准误差误差线
replace('ppt/charts/chart4.xml', (xml) => injectIntoSer(xml, TREND.linear + TREND.movingAvg + ERR.stdErr));
// chart7 散点图：多项式趋势线 + cust x 向误差线 + 标准差误差线
replace('ppt/charts/chart7.xml', (xml) => injectIntoSer(xml, TREND.poly + custX + ERR.stdDev));
// chart8 面积图：指数趋势线 + 百分比误差线
replace('ppt/charts/chart8.xml', (xml) => injectIntoSer(xml, TREND.exponential + ERR.percentage));
// chart12 组合图：数据表（plotArea 尾部；dTable 必须在轴之后、chartSpace 属性之前）
replace('ppt/charts/chart12.xml', (xml) => {
  const anchor = xml.indexOf('</c:plotArea>');
  if (anchor < 0) throw new Error('chart12 缺少 plotArea 结束标签');
  return xml.slice(0, anchor) + dTable + xml.slice(anchor);
});

writeFileSync(new URL('../fixtures/sample-chart-analysis.pptx', import.meta.url), makeZip(Object.entries(parts)));
console.log('sample-chart-analysis.pptx 已生成（趋势线 6 型 / 误差线 5 型 / 数据表）');
