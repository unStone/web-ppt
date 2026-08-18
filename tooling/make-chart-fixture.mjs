/**
 * 生成图表测试用 fixtures/sample-chart.pptx。
 * 覆盖：簇状柱、百分比堆叠柱、堆叠条形、折线（含标记/平滑/缺口/负值）、
 *       饼图（含 dPt 独立着色 + 爆炸）、环形图、散点图、堆叠面积、雷达（不支持占位）。
 * 打包方式与 make-fixture.mjs 一致：手写最小 Zip，无外部依赖。
 */
import { deflateSync } from 'fflate';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
};

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- chart*.xml 构件 ----------

const strRef = (f, vals) =>
  `<c:strRef><c:f>${f}</c:f><c:strCache><c:ptCount val="${vals.length}"/>` +
  vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('') +
  '</c:strCache></c:strRef>';

const numRef = (f, vals, fmt = 'General') =>
  `<c:numRef><c:f>${f}</c:f><c:numCache><c:formatCode>${esc(fmt)}</c:formatCode>` +
  `<c:ptCount val="${vals.length}"/>` +
  vals.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('') +
  '</c:numCache></c:numRef>';

const tx = (name) => `<c:tx>${strRef('Sheet1!$A$1', [name])}</c:tx>`;
const solidFill = (scheme) => `<a:solidFill><a:schemeClr val="${scheme}"/></a:solidFill>`;

/** 通用系列：cat + val */
function ser(i, name, cats, vals, opts = {}) {
  const { fill, ln, marker, smooth, fmt = 'General', dPts = '', dLbls = '' } = opts;
  const spPr = fill || ln ? `<c:spPr>${fill ?? ''}${ln ?? ''}</c:spPr>` : '';
  return (
    `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(name)}${spPr}` +
    (marker ?? '') +
    dPts +
    dLbls +
    `<c:cat>${strRef('Sheet1!$A$2:$A$9', cats)}</c:cat>` +
    `<c:val>${numRef('Sheet1!$B$2:$B$9', vals, fmt)}</c:val>` +
    (smooth ? '<c:smooth val="1"/>' : '<c:smooth val="0"/>') +
    '</c:ser>'
  );
}

/** 散点系列：xVal + yVal */
function xySer(i, name, xs, ys, opts = {}) {
  const { ln, marker } = opts;
  return (
    `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(name)}` +
    (ln ? `<c:spPr>${ln}</c:spPr>` : '') +
    (marker ?? '') +
    `<c:xVal>${numRef('Sheet1!$A$2:$A$9', xs, '0.0')}</c:xVal>` +
    `<c:yVal>${numRef('Sheet1!$B$2:$B$9', ys, '0.00')}</c:yVal>` +
    '<c:smooth val="0"/></c:ser>'
  );
}

const catAx = (id, cross, extra = '') =>
  `<c:catAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
  `<c:delete val="0"/><c:axPos val="b"/>${extra}<c:crossAx val="${cross}"/>` +
  '<c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>' +
  '<c:noMultiLvlLbl val="0"/></c:catAx>';

const valAx = (id, cross, pos = 'l', extra = '') =>
  `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
  `<c:delete val="0"/><c:axPos val="${pos}"/><c:majorGridlines/>${extra}` +
  `<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;

const numFmt = (code) => `<c:numFmt formatCode="${esc(code)}" sourceLinked="0"/>`;

const axTitle = (t) =>
  `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx></c:title>`;

/** 次值轴：crosses=max + 独立 axId 对，且不带 majorGridlines */
const valAxSecondary = (id, cross, pos = 'r', extra = '') =>
  `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
  `<c:delete val="0"/><c:axPos val="${pos}"/>${extra}` +
  `<c:crossAx val="${cross}"/><c:crosses val="max"/><c:crossBetween val="between"/></c:valAx>`;

/** 次轴对里被隐藏的类目轴 */
const catAxHidden = (id, cross) =>
  `<c:catAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
  `<c:delete val="1"/><c:axPos val="b"/><c:crossAx val="${cross}"/></c:catAx>`;

/** 3D 的深度（系列）轴 */
const serAx = (id, cross) =>
  `<c:serAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
  `<c:delete val="1"/><c:axPos val="b"/><c:crossAx val="${cross}"/></c:serAx>`;

const view3D = (rotX = 15, rotY = 20, depth = 100) =>
  `<c:view3D><c:rotX val="${rotX}"/><c:rotY val="${rotY}"/>` +
  `<c:depthPercent val="${depth}"/><c:rAngAx val="1"/></c:view3D>`;

const title = (t, sz = 1400) =>
  `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr>` +
  `<a:defRPr sz="${sz}" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:defRPr></a:pPr>` +
  `<a:r><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
  '<c:autoTitleDeleted val="0"/>';

const legend = (pos) => `<c:legend><c:legendPos val="${pos}"/><c:overlay val="0"/></c:legend>`;

const chartSpace = (inner, txSz = 1000) =>
  `${XML}<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">` +
  `<c:chart>${inner}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
  `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>` +
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${txSz}"/></a:pPr>` +
  '<a:endParaRPr lang="zh-CN"/></a:p></c:txPr></c:chartSpace>';

const QUARTERS = ['第一季度', '第二季度', '第三季度', '第四季度'];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月'];
const MONTHS6 = MONTHS.slice(0, 6);
const REGIONS = ['华东', '华北', '华南', '西部'];

// ---------- 各图表 ----------

// 1. 簇状柱：两系列 + 数据标签 + 千分位 + 网格线
const chartBar = chartSpace(
  title('季度营收对比（簇状柱）') +
    '<c:plotArea><c:layout/>' +
    '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
    ser(0, '2024 年', QUARTERS, [1280, 1640, 1420, 2050], { fill: solidFill('accent1'), fmt: '#,##0' }) +
    ser(1, '2025 年', QUARTERS, [1510, 1390, 1880, 2360], { fill: solidFill('accent2'), fmt: '#,##0' }) +
    '<c:dLbls><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:spPr><a:noFill/></c:spPr>' +
    '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr/></a:p></c:txPr>' +
    '<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/>' +
    '<c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>' +
    '<c:gapWidth val="150"/><c:overlap val="-20"/>' +
    '<c:axId val="101"/><c:axId val="102"/></c:barChart>' +
    catAx(101, 102) +
    valAx(102, 101, 'l', '<c:numFmt formatCode="#,##0" sourceLinked="0"/><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>金额（万元）</a:t></a:r></a:p></c:rich></c:tx></c:title>') +
    '</c:plotArea>' +
    legend('b'),
);

// 2. 百分比堆叠柱：三系列，值轴自动 0-100%
const chartPct = chartSpace(
  title('渠道占比（百分比堆叠）') +
    '<c:plotArea><c:layout/>' +
    '<c:barChart><c:barDir val="col"/><c:grouping val="percentStacked"/><c:varyColors val="0"/>' +
    ser(0, '直营', QUARTERS, [420, 500, 380, 610], { fill: solidFill('accent1') }) +
    ser(1, '分销', QUARTERS, [300, 260, 420, 350], { fill: solidFill('accent4') }) +
    ser(2, '线上', QUARTERS, [180, 340, 260, 480], { fill: solidFill('accent6') }) +
    '<c:gapWidth val="80"/><c:overlap val="100"/>' +
    '<c:axId val="201"/><c:axId val="202"/></c:barChart>' +
    catAx(201, 202) +
    valAx(202, 201, 'l', '<c:numFmt formatCode="0%" sourceLinked="0"/>') +
    '</c:plotArea>' +
    legend('r'),
);

// 3. 堆叠条形（barDir=bar）：类目在左，值轴在下
const chartStackedBar = chartSpace(
  title('人力投入（堆叠条形）') +
    '<c:plotArea><c:layout/>' +
    '<c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/><c:varyColors val="0"/>' +
    ser(0, '研发', ['平台', '交付', '增长'], [18, 9, 6], { fill: solidFill('accent5') }) +
    ser(1, '设计', ['平台', '交付', '增长'], [4, 3, 7], { fill: solidFill('accent3') }) +
    '<c:gapWidth val="60"/><c:overlap val="100"/>' +
    '<c:axId val="301"/><c:axId val="302"/></c:barChart>' +
    '<c:catAx><c:axId val="301"/><c:scaling><c:orientation val="minMax"/></c:scaling>' +
    '<c:delete val="0"/><c:axPos val="l"/><c:crossAx val="302"/></c:catAx>' +
    valAx(302, 301, 'b') +
    '</c:plotArea>' +
    legend('b'),
);

// 4. 折线：标记 + 平滑 + 缺失点 + 负值
const marker = (sym, sz = 6) =>
  `<c:marker><c:symbol val="${sym}"/><c:size val="${sz}"/></c:marker>`;
const chartLine = chartSpace(
  title('月度净增（折线 + 标记）') +
    '<c:plotArea><c:layout/>' +
    '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' +
    ser(0, '新增用户', MONTHS, [120, 168, 145, 210, 198, 265, 240, 310], {
      ln: `<a:ln w="28575">${solidFill('accent1')}</a:ln>`,
      marker: marker('circle', 7),
      fmt: '#,##0',
    }) +
    ser(1, '净增（含流失）', MONTHS, [40, -18, 62, null, 30, 96, -12, 140], {
      ln: `<a:ln w="28575">${solidFill('accent2')}</a:ln>`,
      marker: marker('diamond', 7),
      smooth: true,
      fmt: '#,##0',
    }) +
    '<c:marker val="1"/>' +
    '<c:axId val="401"/><c:axId val="402"/></c:lineChart>' +
    catAx(401, 402) +
    valAx(402, 401, 'l', '<c:numFmt formatCode="#,##0" sourceLinked="0"/>') +
    '</c:plotArea>' +
    legend('t'),
);

// 5. 饼图：dPt 独立着色 + 爆炸 + 百分比标签
const dPt = (i, scheme, explosion) =>
  `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/>` +
  (explosion ? `<c:explosion val="${explosion}"/>` : '') +
  `<c:spPr>${solidFill(scheme)}<a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`;
const PIE_CATS = ['华东', '华北', '华南', '西部', '海外'];
const chartPie = chartSpace(
  title('区域收入分布（饼图）') +
    '<c:plotArea><c:layout/>' +
    '<c:pieChart><c:varyColors val="1"/>' +
    '<c:ser><c:idx val="0"/><c:order val="0"/>' +
    tx('2025 年') +
    dPt(0, 'accent1', 12) +
    dPt(1, 'accent2') +
    dPt(2, 'accent4') +
    dPt(3, 'accent6') +
    dPt(4, 'accent5') +
    '<c:dLbls><c:spPr><a:noFill/></c:spPr>' +
    '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr/></a:p></c:txPr>' +
    '<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/>' +
    '<c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/></c:dLbls>' +
    `<c:cat>${strRef('Sheet1!$A$2:$A$6', PIE_CATS)}</c:cat>` +
    `<c:val>${numRef('Sheet1!$B$2:$B$6', [3200, 2400, 1800, 900, 700], '#,##0')}</c:val>` +
    '</c:ser>' +
    '<c:firstSliceAng val="0"/></c:pieChart>' +
    '</c:plotArea>' +
    legend('r'),
);

// 6. 环形图：两圈（两个系列）
const chartDoughnut = chartSpace(
  title('两年对比（环形图）') +
    '<c:plotArea><c:layout/>' +
    '<c:doughnutChart><c:varyColors val="1"/>' +
    ser(0, '2024', PIE_CATS, [2800, 2100, 1500, 800, 400], { fmt: '#,##0' }) +
    ser(1, '2025', PIE_CATS, [3200, 2400, 1800, 900, 700], { fmt: '#,##0' }) +
    '<c:firstSliceAng val="0"/><c:holeSize val="45"/></c:doughnutChart>' +
    '</c:plotArea>' +
    legend('b'),
);

// 7. 散点：两系列，含负值，一条只有标记
const chartScatter = chartSpace(
  title('投放效率（散点图）') +
    '<c:plotArea><c:layout/>' +
    '<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>' +
    xySer(0, 'A 组', [-4, -2, 0, 1.5, 3, 5.5, 8], [-2.4, -0.8, 0.6, 1.9, 2.4, 3.8, 4.1], {
      ln: `<a:ln w="19050">${solidFill('accent1')}</a:ln>`,
      marker: marker('circle', 6),
    }) +
    xySer(1, 'B 组', [-3, -1, 1, 2.5, 4, 6, 7.5], [1.2, 2.6, 0.4, -1.1, 3.2, 1.4, 5.2], {
      ln: '<a:ln><a:noFill/></a:ln>',
      marker: marker('triangle', 7),
    }) +
    '<c:axId val="701"/><c:axId val="702"/></c:scatterChart>' +
    valAx(701, 702, 'b', '<c:numFmt formatCode="0.0" sourceLinked="0"/>') +
    valAx(702, 701, 'l', '<c:numFmt formatCode="0.00" sourceLinked="0"/>') +
    '</c:plotArea>' +
    legend('b'),
);

// 8. 堆叠面积
const chartArea = chartSpace(
  title('负载构成（堆叠面积）') +
    '<c:plotArea><c:layout/>' +
    '<c:areaChart><c:grouping val="stacked"/><c:varyColors val="0"/>' +
    ser(0, 'CPU', MONTHS, [22, 28, 26, 35, 30, 42, 38, 46], { fill: solidFill('accent5') }) +
    ser(1, '内存', MONTHS, [15, 18, 24, 20, 27, 25, 33, 30], { fill: solidFill('accent6') }) +
    ser(2, 'IO', MONTHS, [8, 6, 12, 9, 14, 11, 16, 19], { fill: solidFill('accent2') }) +
    '<c:axId val="801"/><c:axId val="802"/></c:areaChart>' +
    '<c:catAx><c:axId val="801"/><c:scaling><c:orientation val="minMax"/></c:scaling>' +
    '<c:delete val="0"/><c:axPos val="b"/><c:crossAx val="802"/></c:catAx>' +
    valAx(802, 801, 'l', '<c:numFmt formatCode="0" sourceLinked="0"/>') +
    '</c:plotArea>' +
    legend('b'),
);

// 9. 雷达图：多系列 + 标记样式
const RADAR_CATS = ['速度', '质量', '成本', '体验', '稳定性', '扩展性'];
const chartRadar = chartSpace(
  title('能力雷达（多系列）') +
    '<c:plotArea><c:layout/>' +
    '<c:radarChart><c:radarStyle val="marker"/>' +
    ser(0, '当前版本', RADAR_CATS, [70, 85, 60, 90, 75, 55]) +
    ser(1, '目标', RADAR_CATS, [90, 95, 80, 95, 88, 85]) +
    '<c:axId val="901"/><c:axId val="902"/></c:radarChart>' +
    catAx(901, 902) +
    valAx(902, 901) +
    '</c:plotArea>' +
    legend('r'),
);

// 9b. 填充式雷达
const chartRadarFilled = chartSpace(
  title('资源占用（填充雷达）') +
    '<c:plotArea><c:layout/>' +
    '<c:radarChart><c:radarStyle val="filled"/>' +
    ser(0, '峰值', RADAR_CATS, [80, 40, 70, 55, 90, 45]) +
    '<c:axId val="911"/><c:axId val="912"/></c:radarChart>' +
    catAx(911, 912) +
    valAx(912, 911) +
    '</c:plotArea>',
);

// 10. 主次坐标轴组合：柱状（主轴，1000~3000 台）+ 折线（次轴，0~30%）
const chartCombo = chartSpace(
  title('销量与同比增长率（主次坐标轴）') +
    '<c:plotArea><c:layout/>' +
    '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
    ser(0, '销量（台）', MONTHS6, [1180, 1420, 1360, 1980, 2240, 2610], {
      fill: solidFill('accent1'),
      fmt: '#,##0',
    }) +
    ser(1, '目标（台）', MONTHS6, [1200, 1400, 1600, 1800, 2100, 2400], {
      fill: solidFill('accent5'),
      fmt: '#,##0',
    }) +
    '<c:gapWidth val="100"/><c:overlap val="-15"/>' +
    '<c:axId val="1001"/><c:axId val="1002"/></c:barChart>' +
    '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' +
    ser(2, '同比增长率', MONTHS6, [0.082, 0.115, 0.094, 0.203, 0.248, 0.291], {
      ln: `<a:ln w="28575">${solidFill('accent2')}</a:ln>`,
      marker: marker('circle', 7),
      fmt: '0%',
    }) +
    '<c:marker val="1"/>' +
    '<c:axId val="1003"/><c:axId val="1004"/></c:lineChart>' +
    catAx(1001, 1002) +
    valAx(1002, 1001, 'l', axTitle('销量（台）') + numFmt('#,##0')) +
    catAxHidden(1003, 1004) +
    valAxSecondary(1004, 1003, 'r', axTitle('增长率') + numFmt('0%')) +
    '</c:plotArea>' +
    legend('b'),
);

// 11. 3D 簇状柱
const chartBar3D = chartSpace(
  title('区域销量（3D 簇状柱）') +
    view3D(15, 20) +
    '<c:plotArea><c:layout/>' +
    '<c:bar3DChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
    ser(0, '上半年', REGIONS, [860, 1240, 990, 1480], { fill: solidFill('accent1'), fmt: '#,##0' }) +
    ser(1, '下半年', REGIONS, [1120, 980, 1360, 1210], { fill: solidFill('accent6'), fmt: '#,##0' }) +
    '<c:gapWidth val="90"/><c:shape val="box"/>' +
    '<c:axId val="1101"/><c:axId val="1102"/><c:axId val="1103"/></c:bar3DChart>' +
    catAx(1101, 1102) +
    valAx(1102, 1101, 'l', numFmt('#,##0')) +
    serAx(1103, 1102) +
    '</c:plotArea>' +
    legend('b'),
);

// 12. 3D 堆叠柱
const chartBar3DStack = chartSpace(
  title('成本构成（3D 堆叠柱）') +
    view3D(20, 25) +
    '<c:plotArea><c:layout/>' +
    '<c:bar3DChart><c:barDir val="col"/><c:grouping val="stacked"/><c:varyColors val="0"/>' +
    ser(0, '原料', QUARTERS, [320, 380, 350, 420], { fill: solidFill('accent5'), fmt: '#,##0' }) +
    ser(1, '人工', QUARTERS, [180, 210, 240, 260], { fill: solidFill('accent4'), fmt: '#,##0' }) +
    ser(2, '物流', QUARTERS, [90, 120, 100, 150], { fill: solidFill('accent2'), fmt: '#,##0' }) +
    '<c:gapWidth val="70"/><c:shape val="box"/>' +
    '<c:axId val="1201"/><c:axId val="1202"/><c:axId val="1203"/></c:bar3DChart>' +
    catAx(1201, 1202) +
    valAx(1202, 1201, 'l', numFmt('#,##0')) +
    serAx(1203, 1202) +
    '</c:plotArea>' +
    legend('b'),
);

// 13. 3D 饼（椭圆化 + 侧壁）
const chartPie3D = chartSpace(
  title('渠道占比（3D 饼图）') +
    view3D(30, 0) +
    '<c:plotArea><c:layout/>' +
    '<c:pie3DChart><c:varyColors val="1"/>' +
    '<c:ser><c:idx val="0"/><c:order val="0"/>' +
    tx('2025 年') +
    dPt(0, 'accent1') +
    dPt(1, 'accent2') +
    dPt(2, 'accent4') +
    dPt(3, 'accent6') +
    dPt(4, 'accent5') +
    '<c:dLbls><c:spPr><a:noFill/></c:spPr>' +
    '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr/></a:p></c:txPr>' +
    '<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/>' +
    '<c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/></c:dLbls>' +
    `<c:cat>${strRef('Sheet1!$A$2:$A$6', PIE_CATS)}</c:cat>` +
    `<c:val>${numRef('Sheet1!$B$2:$B$6', [3200, 2400, 1800, 900, 700], '#,##0')}</c:val>` +
    '</c:ser></c:pie3DChart>' +
    '</c:plotArea>' +
    legend('r'),
);

// 14. 3D 折线（退化为 2D 渲染，但保留 3D 地面/背墙）
const chartLine3D = chartSpace(
  title('负载趋势（3D 折线）') +
    view3D(15, 20) +
    '<c:plotArea><c:layout/>' +
    '<c:line3DChart><c:grouping val="standard"/><c:varyColors val="0"/>' +
    ser(0, 'CPU', MONTHS, [22, 28, 26, 35, 30, 42, 38, 46], {
      ln: `<a:ln w="28575">${solidFill('accent1')}</a:ln>`,
      marker: marker('circle', 6),
      fmt: '0',
    }) +
    ser(1, '内存', MONTHS, [15, 18, 24, 20, 27, 25, 33, 30], {
      ln: `<a:ln w="28575">${solidFill('accent6')}</a:ln>`,
      marker: marker('square', 6),
      fmt: '0',
    }) +
    '<c:axId val="1301"/><c:axId val="1302"/><c:axId val="1303"/></c:line3DChart>' +
    catAx(1301, 1302) +
    valAx(1302, 1301, 'l', numFmt('0')) +
    serAx(1303, 1302) +
    '</c:plotArea>' +
    legend('b'),
);

// ---------- 幻灯片 ----------

const nvGrp = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

const frame = (id, rid, x, y, cx, cy) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart ${id}"/>` +
  '<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
  `<p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></p:xfrm>` +
  `<a:graphic><a:graphicData uri="${NS.c}"><c:chart xmlns:c="${NS.c}" xmlns:r="${NS.r}" r:id="${rid}"/>` +
  '</a:graphicData></a:graphic></p:graphicFrame>';

const titleSp = (text) =>
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="609600" y="228600"/><a:ext cx="10972800" cy="742950"/></a:xfrm></p:spPr>' +
  `<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:r><a:rPr sz="2800"/><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;

/** 每页：标题 + 若干图表帧 */
const SLIDES = [
  { title: '簇状柱状图 · 数据标签 / 网格线 / 轴标题', charts: [{ xml: chartBar, box: [762000, 1143000, 10668000, 5181600] }] },
  {
    title: '百分比堆叠柱 + 堆叠条形',
    charts: [
      { xml: chartPct, box: [457200, 1143000, 5334000, 5181600] },
      { xml: chartStackedBar, box: [6096000, 1143000, 5334000, 5181600] },
    ],
  },
  { title: '折线图 · 标记 / 平滑 / 缺口 / 负值', charts: [{ xml: chartLine, box: [762000, 1143000, 10668000, 5181600] }] },
  {
    title: '饼图 + 环形图',
    charts: [
      { xml: chartPie, box: [457200, 1143000, 5334000, 5181600] },
      { xml: chartDoughnut, box: [6096000, 1143000, 5334000, 5181600] },
    ],
  },
  { title: '散点图 · 双数值轴 / 负值', charts: [{ xml: chartScatter, box: [762000, 1143000, 10668000, 5181600] }] },
  {
    title: '堆叠面积 + 雷达图',
    charts: [
      { xml: chartArea, box: [457200, 1143000, 6858000, 5181600] },
      { xml: chartRadar, box: [7620000, 1143000, 3810000, 5181600] },
    ],
  },
  {
    title: '雷达图：标记 / 填充',
    charts: [
      { xml: chartRadar, box: [457200, 1143000, 5486400, 5181600] },
      { xml: chartRadarFilled, box: [6248400, 1143000, 5181600, 5181600] },
    ],
  },
  {
    title: '次坐标轴 · 柱状（销量）+ 折线（增长率 %）',
    charts: [{ xml: chartCombo, box: [762000, 1143000, 10668000, 5181600] }],
  },
  {
    title: '3D 柱状图 · 簇状 / 堆叠',
    charts: [
      { xml: chartBar3D, box: [457200, 1143000, 5334000, 5181600] },
      { xml: chartBar3DStack, box: [6096000, 1143000, 5334000, 5181600] },
    ],
  },
  {
    title: '3D 饼图 + 3D 折线',
    charts: [
      { xml: chartPie3D, box: [457200, 1143000, 5334000, 5181600] },
      { xml: chartLine3D, box: [6096000, 1143000, 5334000, 5181600] },
    ],
  },
];

// ---------- 公共 part ----------

let chartSeq = 0;
const chartParts = [];
const slideParts = [];

SLIDES.forEach((slide, si) => {
  const frames = [];
  const rels = [
    `<Relationship Id="rId1" Type="${NS.r}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
  ];
  slide.charts.forEach((ch, ci) => {
    chartSeq++;
    const rid = `rId${ci + 2}`;
    chartParts.push([`ppt/charts/chart${chartSeq}.xml`, ch.xml]);
    rels.push(`<Relationship Id="${rid}" Type="${NS.r}/chart" Target="../charts/chart${chartSeq}.xml"/>`);
    frames.push(frame(10 + ci, rid, ...ch.box));
  });
  slideParts.push([
    `ppt/slides/slide${si + 1}.xml`,
    `${XML}<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree>${nvGrp}` +
      titleSp(slide.title) +
      frames.join('') +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>',
  ]);
  slideParts.push([
    `ppt/slides/_rels/slide${si + 1}.xml.rels`,
    `${XML}<Relationships xmlns="${NS.rel}">${rels.join('')}</Relationships>`,
  ]);
});

const contentTypes =
  `${XML}<Types xmlns="${NS.ct}">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
  '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
  '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
  SLIDES.map(
    (_, i) =>
      `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join('') +
  chartParts
    .map(
      ([p]) =>
        `<Override PartName="/${p}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
    )
    .join('') +
  '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
  '</Types>';

const rootRels = `${XML}<Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${NS.r}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`;

const presentation =
  `${XML}<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">` +
  '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' +
  SLIDES.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('') +
  '</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>' +
  '<p:defaultTextStyle><a:defPPr><a:defRPr sz="1800"/></a:defPPr></p:defaultTextStyle></p:presentation>';

const presentationRels =
  `${XML}<Relationships xmlns="${NS.rel}">` +
  `<Relationship Id="rId1" Type="${NS.r}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
  SLIDES.map(
    (_, i) => `<Relationship Id="rId${i + 2}" Type="${NS.r}/slide" Target="slides/slide${i + 1}.xml"/>`,
  ).join('') +
  '</Relationships>';

const theme = `${XML}<a:theme xmlns:a="${NS.a}" name="ChartFixture">
<a:themeElements>
<a:clrScheme name="ChartFixture">
<a:dk1><a:sysClr val="windowText" lastClr="20242B"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F3864"/></a:dk2>
<a:lt2><a:srgbClr val="EEF3FB"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1>
<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
<a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
<a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink>
<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="ChartFixture">
<a:majorFont><a:latin typeface="Trebuchet MS"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Helvetica"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="ChartFixture">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>`;

const slideMaster = `${XML}<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld>
<p:bg><p:bgPr><a:solidFill><a:srgbClr val="F5F7FB"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree>
${nvGrp}
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="609600" y="228600"/><a:ext cx="10972800" cy="742950"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>
</p:spTree>
</p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles>
<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="2800" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle>
<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
</p:txStyles>
</p:sldMaster>`;

const slideMasterRels =
  `${XML}<Relationships xmlns="${NS.rel}">` +
  `<Relationship Id="rId1" Type="${NS.r}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
  `<Relationship Id="rId2" Type="${NS.r}/theme" Target="../theme/theme1.xml"/></Relationships>`;

const slideLayout =
  `${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="obj"><p:cSld name="ChartLayout">` +
  `<p:spTree>${nvGrp}` +
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
  '<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>' +
  '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

const slideLayoutRels =
  `${XML}<Relationships xmlns="${NS.rel}">` +
  `<Relationship Id="rId1" Type="${NS.r}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;

// ---------- 打包（手写最小 Zip，与 make-fixture.mjs 一致） ----------

const enc = new TextEncoder();

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = enc.encode(name);
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const compressed = deflateSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + payload.length);
    let dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, method, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, payload.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(payload, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    dv = new DataView(central.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(10, method, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, payload.length, true);
    dv.setUint32(24, data.length, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
  }
  const centralSize = centralParts.reduce((a, p) => a + p.length, 0);
  const end = new Uint8Array(22);
  const dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, entries.length, true);
  dv.setUint16(10, entries.length, true);
  dv.setUint32(12, centralSize, true);
  dv.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const zip = new Uint8Array(total);
  let pos = 0;
  for (const p of [...localParts, ...centralParts, end]) {
    zip.set(p, pos);
    pos += p.length;
  }
  return zip;
}

const zip = makeZip([
  ['[Content_Types].xml', contentTypes],
  ['_rels/.rels', rootRels],
  ['ppt/presentation.xml', presentation],
  ['ppt/_rels/presentation.xml.rels', presentationRels],
  ['ppt/theme/theme1.xml', theme],
  ['ppt/slideMasters/slideMaster1.xml', slideMaster],
  ['ppt/slideMasters/_rels/slideMaster1.xml.rels', slideMasterRels],
  ['ppt/slideLayouts/slideLayout1.xml', slideLayout],
  ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', slideLayoutRels],
  ...slideParts,
  ...chartParts,
]);

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-chart.pptx'), zip);
console.log(
  `fixtures/sample-chart.pptx 已生成（${zip.length} 字节，${SLIDES.length} 页 / ${chartParts.length} 个图表）`,
);
