/**
 * 生成 fixtures/sample-media.pptx，覆盖 pptx 侧新补齐的特性：
 *   1. 媒体：内嵌视频（封面帧）/ 内嵌音频（真实 WAV）/ 外链视频 / 无封面帧媒体
 *   2. 墨迹：mc:AlternateContent → p14:contentPart → InkML（含差分编码的 trace）
 *      以及 InkML 缺失时回退到 mc:Fallback 里的图片
 *   3. 批注：ppt/comments/comment1.xml + ppt/commentAuthors.xml
 *   4. 节：presentation.xml 的 p14:sectionLst
 *   5. 图表：气泡图 / 股价图（蜡烛 + OHLC）/ 复合饼图（子母饼 + 复合条饼）/ 曲面图
 *
 * 打包复用 scripts/lib/ooxml.mjs 的最小 Zip 与 PNG 编码器，无外部依赖。
 *   node tooling/make-media-fixture.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { concat, label, makePng, makeZip, NS, nvGrp, px, solid, sp, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const NS_P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const NS_A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
const NS_INKML = 'http://www.w3.org/2003/InkML';

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------- 二进制素材 ----------------

const ascii = (buf, off, s) => {
  for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
};

/** 真实可播放的 8bit PCM WAV（一段轻微正弦，约 0.4 秒） */
function makeWav(seconds = 0.4, rate = 8000) {
  const n = Math.floor(seconds * rate);
  const buf = new Uint8Array(44 + n);
  const dv = new DataView(buf.buffer);
  ascii(buf, 0, 'RIFF');
  dv.setUint32(4, 36 + n, true);
  ascii(buf, 8, 'WAVE');
  ascii(buf, 12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate, true);
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  ascii(buf, 36, 'data');
  dv.setUint32(40, n, true);
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(24 * Math.sin(i / 11));
  return buf;
}

/** 占位 MP4：只有合法的 ftyp + 空 mdat，用于验证解析链路（不可播放） */
function makeMp4Stub() {
  const box = (type, payload) => {
    const out = new Uint8Array(8 + payload.length);
    new DataView(out.buffer).setUint32(0, out.length);
    ascii(out, 4, type);
    out.set(payload, 8);
    return out;
  };
  const brands = new Uint8Array(16);
  ascii(brands, 0, 'isom');
  new DataView(brands.buffer).setUint32(4, 512);
  ascii(brands, 8, 'isom');
  ascii(brands, 12, 'mp41');
  return concat([box('ftyp', brands), box('mdat', new Uint8Array(64))]);
}

/** 视频封面帧：暗色渐变 + 中央亮块，一眼能看出是「一帧画面」 */
const posterPng = makePng(320, 180, (x, y) => {
  const t = y / 180;
  const inner = x > 96 && x < 224 && y > 54 && y < 126;
  if (inner) return [232, 236, 244];
  return [Math.round(26 + 46 * t), Math.round(34 + 58 * t), Math.round(56 + 74 * t)];
});

/** 音频对象的喇叭图标（PowerPoint 内嵌音频用的那种小图标） */
const speakerPng = makePng(96, 96, (x, y) => {
  const dx = x - 34;
  const dy = y - 48;
  const box = x >= 18 && x <= 34 && y >= 36 && y <= 60;
  const cone = x > 34 && x < 60 && Math.abs(dy) < 6 + (x - 34) * 1.1;
  const ring = Math.abs(Math.hypot(dx, dy) - 44) < 3.2 && x > 52;
  if (box || cone || ring) return [58, 92, 168];
  return [242, 245, 250];
});

/** 墨迹回退用的示意图 */
const inkFallbackPng = makePng(240, 120, (x, y) => {
  const on = Math.abs(y - (60 + 28 * Math.sin(x / 18))) < 5;
  return on ? [216, 74, 60] : [252, 250, 246];
});

// ---------------- InkML ----------------

/**
 * 生成一条 trace 的数据串。
 * 首点显式，第二点带 `'` 前缀切到一阶差分，其后不带前缀（沿用差分模式），
 * 与 PowerPoint 的写法一致，正好压到解码器的模式延续分支。
 */
function traceData(points) {
  const parts = [];
  points.forEach(([x, y], i) => {
    const px0 = Math.round(x);
    const py0 = Math.round(y);
    if (i === 0) {
      parts.push(`${px0} ${py0}`);
      return;
    }
    const [ax, ay] = points[i - 1];
    const dx = px0 - Math.round(ax);
    const dy = py0 - Math.round(ay);
    parts.push(i === 1 ? `'${dx} '${dy}` : `${dx} ${dy}`);
  });
  return parts.join(',');
}

function inkXml(strokes) {
  const brushes = strokes
    .map((s, i) =>
      `<inkml:brush xml:id="br${i}">` +
      `<inkml:brushProperty name="width" value="${s.width}" units="himetric"/>` +
      `<inkml:brushProperty name="height" value="${s.width}" units="himetric"/>` +
      `<inkml:brushProperty name="color" value="${s.color}"/>` +
      '</inkml:brush>')
    .join('');
  return (
    `${XML}<inkml:ink xmlns:inkml="${NS_INKML}">` +
    '<inkml:definitions><inkml:context xml:id="ctx0"><inkml:inkSource xml:id="src0">' +
    '<inkml:traceFormat>' +
    '<inkml:channel name="X" type="integer" max="32767" units="himetric"/>' +
    '<inkml:channel name="Y" type="integer" max="32767" units="himetric"/>' +
    '<inkml:channel name="F" type="integer" max="32767" units="dev"/>' +
    '</inkml:traceFormat></inkml:inkSource></inkml:context>' +
    brushes +
    '</inkml:definitions>' +
    strokes
      .map((s, i) => `<inkml:trace contextRef="#ctx0" brushRef="#br${i}">${traceData(s.pts)}</inkml:trace>`)
      .join('') +
    '</inkml:ink>'
  );
}

/** 手写风格的示意笔迹：一条对勾 + 一圈圈选 + 一条波浪下划线 */
const CHECK = [];
for (let i = 0; i <= 12; i++) CHECK.push([600 + i * 55, 1500 + i * 62]);
for (let i = 1; i <= 22; i++) CHECK.push([1260 + i * 78, 2244 - i * 92]);

const CIRCLE = [];
for (let i = 0; i <= 46; i++) {
  const a = (i / 46) * Math.PI * 2;
  CIRCLE.push([2600 + 1150 * Math.cos(a), 1700 + 720 * Math.sin(a) * 1.05]);
}

const WAVE = [];
for (let i = 0; i <= 60; i++) WAVE.push([500 + i * 62, 3050 + 130 * Math.sin(i / 3.1)]);

const inkPart = inkXml([
  { pts: CHECK, color: '#E8453C', width: 72 },
  { pts: CIRCLE, color: '#2E7BE4', width: 54 },
  { pts: WAVE, color: '#F2A93B', width: 46 },
]);

// ---------------- 图表构件 ----------------

const numRef = (f, vals, fmt = 'General') =>
  `<c:numRef><c:f>${f}</c:f><c:numCache><c:formatCode>${esc(fmt)}</c:formatCode>` +
  `<c:ptCount val="${vals.length}"/>` +
  vals.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('') +
  '</c:numCache></c:numRef>';

const strRef = (f, vals) =>
  `<c:strRef><c:f>${f}</c:f><c:strCache><c:ptCount val="${vals.length}"/>` +
  vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('') +
  '</c:strCache></c:strRef>';

const tx = (name) => `<c:tx>${strRef('Sheet1!$A$1', [name])}</c:tx>`;
const fillOf = (scheme) => `<a:solidFill><a:schemeClr val="${scheme}"/></a:solidFill>`;
const srgb = (hex) => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;

const title = (t, sz = 1300) =>
  `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr>` +
  `<a:defRPr sz="${sz}" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:defRPr></a:pPr>` +
  `<a:r><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
  '<c:autoTitleDeleted val="0"/>';

const legend = (pos) => `<c:legend><c:legendPos val="${pos}"/><c:overlay val="0"/></c:legend>`;

const numFmt = (code) => `<c:numFmt formatCode="${esc(code)}" sourceLinked="0"/>`;

const axTitle = (t) =>
  `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx></c:title>`;

const catAx = (id, cross, extra = '') =>
  `<c:catAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
  `<c:delete val="0"/><c:axPos val="b"/>${extra}<c:crossAx val="${cross}"/>` +
  '<c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>';

const valAx = (id, cross, pos = 'l', extra = '') =>
  `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
  `<c:delete val="0"/><c:axPos val="${pos}"/><c:majorGridlines/>${extra}` +
  `<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`;

const serAx = (id, cross) =>
  `<c:serAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
  `<c:delete val="1"/><c:axPos val="b"/><c:crossAx val="${cross}"/></c:serAx>`;

const chartSpace = (inner, txSz = 950) =>
  `${XML}<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">` +
  `<c:chart>${inner}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
  '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' +
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${txSz}"/></a:pPr>` +
  '<a:endParaRPr lang="zh-CN"/></a:p></c:txPr></c:chartSpace>';

// ---- 气泡图 ----

const bubbleSer = (i, name, xs, ys, sizes, scheme) =>
  `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(name)}` +
  `<c:spPr>${fillOf(scheme)}<a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr>` +
  '<c:invertIfNegative val="0"/>' +
  `<c:xVal>${numRef('Sheet1!$A$2:$A$9', xs, '0.0')}</c:xVal>` +
  `<c:yVal>${numRef('Sheet1!$B$2:$B$9', ys, '0.0%')}</c:yVal>` +
  `<c:bubbleSize>${numRef('Sheet1!$C$2:$C$9', sizes, '#,##0')}</c:bubbleSize>` +
  '<c:bubble3D val="0"/></c:ser>';

const chartBubble = chartSpace(
  title('渠道投入 / 转化 / 规模（气泡图）') +
    '<c:plotArea><c:layout/>' +
    '<c:bubbleChart><c:varyColors val="0"/>' +
    bubbleSer(0, '一线城市', [12, 26, 38, 52, 66], [0.031, 0.052, 0.045, 0.078, 0.062], [820, 1600, 2400, 4200, 3100], 'accent1') +
    bubbleSer(1, '新兴市场', [18, 33, 44, 58, 72], [0.022, 0.038, 0.067, 0.041, 0.089], [1400, 900, 3600, 2100, 5200], 'accent2') +
    '<c:dLbls><c:spPr><a:noFill/></c:spPr>' +
    '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr/></a:p></c:txPr>' +
    '<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/>' +
    '<c:showPercent val="0"/><c:showBubbleSize val="1"/></c:dLbls>' +
    '<c:bubbleScale val="100"/><c:showNegBubbles val="0"/><c:sizeRepresents val="area"/>' +
    '<c:axId val="2101"/><c:axId val="2102"/></c:bubbleChart>' +
    valAx(2101, 2102, 'b', axTitle('投放强度') + numFmt('0')) +
    valAx(2102, 2101, 'l', axTitle('转化率') + numFmt('0%')) +
    '</c:plotArea>' +
    legend('b'),
);

/** sizeRepresents=w：半径直接正比，与面积模式对照 */
const chartBubbleWidth = chartSpace(
  title('半径正比模式（sizeRepresents=w）') +
    '<c:plotArea><c:layout/>' +
    '<c:bubbleChart><c:varyColors val="0"/>' +
    bubbleSer(0, '样本', [10, 25, 40, 55, 70], [0.02, 0.05, 0.035, 0.07, 0.055], [400, 1200, 2000, 3600, 5000], 'accent5') +
    '<c:bubbleScale val="80"/><c:showNegBubbles val="0"/><c:sizeRepresents val="w"/>' +
    '<c:axId val="2111"/><c:axId val="2112"/></c:bubbleChart>' +
    valAx(2111, 2112, 'b', numFmt('0')) +
    valAx(2112, 2111, 'l', numFmt('0%')) +
    '</c:plotArea>',
);

// ---- 股价图 ----

const DAYS = ['9/1', '9/2', '9/3', '9/4', '9/5', '9/8', '9/9', '9/10', '9/11', '9/12'];
const OPEN = [128.4, 131.2, 129.8, 133.5, 136.1, 134.2, 138.6, 141.0, 139.4, 143.2];
const HIGH = [132.6, 133.8, 134.9, 137.2, 138.4, 139.8, 142.5, 143.6, 145.1, 147.8];
const LOW = [127.1, 128.4, 128.2, 132.0, 133.0, 133.1, 137.4, 138.2, 138.0, 142.1];
const CLOSE = [131.3, 129.6, 133.7, 136.4, 134.0, 138.9, 141.2, 139.1, 143.6, 146.9];

const stockSer = (i, name, vals) =>
  `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(name)}` +
  '<c:spPr><a:ln w="9525"><a:noFill/></a:ln></c:spPr>' +
  `<c:cat>${strRef('Sheet1!$A$2:$A$11', DAYS)}</c:cat>` +
  `<c:val>${numRef('Sheet1!$B$2:$B$11', vals, '0.00')}</c:val></c:ser>`;

const chartCandle = chartSpace(
  title('日 K 线（开高低收 + 涨跌柱）') +
    '<c:plotArea><c:layout/>' +
    '<c:stockChart>' +
    stockSer(0, '开盘', OPEN) +
    stockSer(1, '最高', HIGH) +
    stockSer(2, '最低', LOW) +
    stockSer(3, '收盘', CLOSE) +
    '<c:hiLowLines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="55606E"/></a:solidFill></a:ln></c:spPr></c:hiLowLines>' +
    '<c:upDownBars><c:gapWidth val="120"/>' +
    `<c:upBars><c:spPr>${srgb('FFFFFF')}<a:ln w="9525"><a:solidFill><a:srgbClr val="C0392B"/></a:solidFill></a:ln></c:spPr></c:upBars>` +
    `<c:downBars><c:spPr>${srgb('2E8B57')}<a:ln w="9525"><a:solidFill><a:srgbClr val="1F6F45"/></a:solidFill></a:ln></c:spPr></c:downBars>` +
    '</c:upDownBars>' +
    '<c:axId val="2201"/><c:axId val="2202"/></c:stockChart>' +
    catAx(2201, 2202) +
    valAx(2202, 2201, 'l', axTitle('价格') + numFmt('0.0')) +
    '</c:plotArea>' +
    legend('b'),
);

/** 三系列（高低收）且无涨跌柱 → 传统 OHLC 竖线 + 收盘短横 */
const chartOhlc = chartSpace(
  title('高低收（无涨跌柱 → OHLC 竖线）') +
    '<c:plotArea><c:layout/>' +
    '<c:stockChart>' +
    stockSer(0, '最高', HIGH) +
    stockSer(1, '最低', LOW) +
    stockSer(2, '收盘', CLOSE) +
    '<c:hiLowLines/>' +
    '<c:axId val="2211"/><c:axId val="2212"/></c:stockChart>' +
    catAx(2211, 2212) +
    valAx(2212, 2211, 'l', numFmt('0.0')) +
    '</c:plotArea>' +
    legend('b'),
);

// ---- 复合饼图 ----

const OF_CATS = ['直营门店', '电商自营', '平台旗舰', '经销代理', '出口', '批发', '其他渠道'];
const OF_VALS = [4200, 3100, 2400, 900, 520, 380, 210];

const ofSer = () =>
  '<c:ser><c:idx val="0"/><c:order val="0"/>' +
  tx('2025 年收入') +
  '<c:dLbls><c:spPr><a:noFill/></c:spPr>' +
  '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr/></a:p></c:txPr>' +
  '<c:dLblPos val="ctr"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/>' +
  '<c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/></c:dLbls>' +
  `<c:cat>${strRef('Sheet1!$A$2:$A$8', OF_CATS)}</c:cat>` +
  `<c:val>${numRef('Sheet1!$B$2:$B$8', OF_VALS, '#,##0')}</c:val></c:ser>`;

const chartOfPie = chartSpace(
  title('渠道收入（子母饼：末 3 项拆到次饼）') +
    '<c:plotArea><c:layout/>' +
    '<c:ofPieChart><c:ofPieType val="pie"/><c:varyColors val="1"/>' +
    ofSer() +
    '<c:gapWidth val="100"/><c:splitType val="pos"/><c:splitPos val="3"/>' +
    '<c:secondPieSize val="70"/><c:serLines/></c:ofPieChart>' +
    '</c:plotArea>' +
    legend('r'),
);

const chartOfBar = chartSpace(
  title('复合条饼（占比 < 6% 拆到次条）') +
    '<c:plotArea><c:layout/>' +
    '<c:ofPieChart><c:ofPieType val="bar"/><c:varyColors val="1"/>' +
    ofSer() +
    '<c:gapWidth val="100"/><c:splitType val="percent"/><c:splitPos val="6"/>' +
    '<c:secondPieSize val="85"/><c:serLines/></c:ofPieChart>' +
    '</c:plotArea>' +
    legend('r'),
);

// ---- 曲面图 ----

const SURF_CATS = ['0.5h', '1h', '2h', '4h', '8h', '12h', '24h'];
const SURF_SERIES = [
  ['20℃', [12, 18, 26, 38, 52, 61, 68]],
  ['30℃', [16, 25, 37, 55, 74, 82, 88]],
  ['40℃', [22, 34, 52, 76, 95, 104, 110]],
  ['50℃', [29, 46, 71, 98, 118, 126, 131]],
  ['60℃', [35, 58, 88, 116, 134, 141, 145]],
];

const surfSer = (i, name, vals) =>
  `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(name)}` +
  `<c:cat>${strRef('Sheet1!$A$2:$A$8', SURF_CATS)}</c:cat>` +
  `<c:val>${numRef('Sheet1!$B$2:$B$8', vals, '0')}</c:val></c:ser>`;

const bandFmts = ['1F4E79', '2E75B6', '9DC3E6', 'C5E0B4', 'FFE699', 'F4B183', 'C00000']
  .map((hex, i) => `<c:bandFmt><c:idx val="${i}"/><c:spPr>${srgb(hex)}</c:spPr></c:bandFmt>`)
  .join('');

const chartSurface = chartSpace(
  title('反应转化率曲面（俯视等高线 · 自带色带）') +
    '<c:plotArea><c:layout/>' +
    '<c:surface3DChart><c:wireframe val="0"/>' +
    SURF_SERIES.map(([n, v], i) => surfSer(i, n, v)).join('') +
    `<c:bandFmts>${bandFmts}</c:bandFmts>` +
    '<c:axId val="2301"/><c:axId val="2302"/><c:axId val="2303"/></c:surface3DChart>' +
    catAx(2301, 2302) +
    valAx(2302, 2301, 'l', numFmt('0')) +
    serAx(2303, 2302) +
    '</c:plotArea>',
);

const chartSurfaceRamp = chartSpace(
  title('无 bandFmts → 内置色带') +
    '<c:plotArea><c:layout/>' +
    '<c:surfaceChart><c:wireframe val="0"/>' +
    SURF_SERIES.map(([n, v], i) => surfSer(i, n, v)).join('') +
    '<c:axId val="2311"/><c:axId val="2312"/><c:axId val="2313"/></c:surfaceChart>' +
    catAx(2311, 2312) +
    valAx(2312, 2311, 'l', numFmt('0')) +
    serAx(2313, 2312) +
    '</c:plotArea>',
);

// ---------------- 幻灯片零件 ----------------

let picId = 500;
const nextPicId = () => ++picId;

/** 媒体 p:pic：nvPr 里挂 audioFile / videoFile，blipFill 是封面帧 */
function mediaPic({ x, y, w, h, name, kind, linkRid, embedRid, blipRid, mediaRid }) {
  const tag = kind === 'audio' ? 'a:audioFile' : 'a:videoFile';
  const ref = linkRid ? `r:link="${linkRid}"` : `r:embed="${embedRid}"`;
  const p14media = mediaRid
    ? `<a:extLst><a:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}">` +
      `<p14:media xmlns:p14="${NS_P14}" r:embed="${mediaRid}"/></a:ext></a:extLst>`
    : '';
  return (
    '<p:pic><p:nvPicPr>' +
    `<p:cNvPr id="${nextPicId()}" name="${esc(name)}"/>` +
    '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>' +
    `<p:nvPr><${tag} ${ref}/>${p14media}</p:nvPr></p:nvPicPr>` +
    `<p:blipFill>${blipRid ? `<a:blip r:embed="${blipRid}"/>` : ''}<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
  );
}

/** 普通图片 */
function picture({ x, y, w, h, name, rid }) {
  return (
    '<p:pic><p:nvPicPr>' +
    `<p:cNvPr id="${nextPicId()}" name="${esc(name)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
  );
}

/** 墨迹：Choice 走 p14:contentPart，Fallback 是位图 */
function inkAlternate({ x, y, w, h, rid, fallbackRid, name }) {
  return (
    `<mc:AlternateContent xmlns:mc="${NS_MC}">` +
    '<mc:Choice xmlns:p14="' + NS_P14 + '" Requires="p14">' +
    `<p14:contentPart p14:bwMode="auto" r:id="${rid}">` +
    `<p14:nvContentPartPr><p14:cNvPr id="${nextPicId()}" name="${esc(name)}"/><p14:cNvContentPartPr/><p14:nvPr/></p14:nvContentPartPr>` +
    `<p14:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></p14:xfrm>` +
    '</p14:contentPart></mc:Choice>' +
    '<mc:Fallback>' +
    picture({ x, y, w, h, name: `${name}（Fallback 位图）`, rid: fallbackRid }) +
    '</mc:Fallback></mc:AlternateContent>'
  );
}

const frame = (rid, x, y, w, h) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${nextPicId()}" name="Chart"/>` +
  '<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
  `<p:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></p:xfrm>` +
  `<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS.r}" r:id="${rid}"/>` +
  '</a:graphicData></a:graphic></p:graphicFrame>';

const titleSp = (text) =>
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="457200" y="228600"/><a:ext cx="11277600" cy="685800"/></a:xfrm></p:spPr>' +
  `<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:r><a:rPr sz="2400"/><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;

const caption = (x, y, w, text) =>
  sp({ x, y, w, h: 26, fill: '<a:noFill/>', text: label(text, 1000, '5A6172'), name: 'caption' });

function slideDoc(body, extraNs = '') {
  return (
    `${XML}<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"${extraNs}>` +
    `<p:cSld><p:spTree>${nvGrp}${body}</p:spTree></p:cSld>` +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
  );
}

// ---------------- 各页 ----------------

const REL = (id, type, target, external) =>
  `<Relationship Id="${id}" Type="${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`;
const LAYOUT_REL = REL('rId1', `${NS.r}/slideLayout`, '../slideLayouts/slideLayout1.xml');

const slides = [];
const mediaParts = [];
const chartParts = [];
const extraParts = [];
let chartSeq = 0;

/** 注册一个图表 part，返回 rel 项 */
function addChart(xml, rid) {
  chartSeq++;
  chartParts.push([`ppt/charts/chart${chartSeq}.xml`, xml]);
  return REL(rid, `${NS.r}/chart`, `../charts/chart${chartSeq}.xml`);
}

// 1. 媒体页
mediaParts.push(['ppt/media/poster1.png', posterPng]);
mediaParts.push(['ppt/media/speaker1.png', speakerPng]);
mediaParts.push(['ppt/media/ink-fallback.png', inkFallbackPng]);
mediaParts.push(['ppt/media/clip1.mp4', makeMp4Stub()]);
mediaParts.push(['ppt/media/tone1.wav', makeWav()]);

slides.push({
  xml: slideDoc(
    titleSp('媒体对象：封面帧 + 播放标识') +
      caption(60, 128, 460, '内嵌视频（mp4）· 封面帧来自 blipFill') +
      mediaPic({
        x: 60, y: 160, w: 460, h: 259, name: '产品演示.mp4', kind: 'video',
        linkRid: 'rId3', blipRid: 'rId2', mediaRid: 'rId4',
      }) +
      caption(560, 128, 300, '内嵌音频（wav）· 喇叭图标为封面') +
      mediaPic({
        x: 640, y: 160, w: 130, h: 130, name: '配音.wav', kind: 'audio',
        linkRid: 'rId5', blipRid: 'rId6', mediaRid: 'rId7',
      }) +
      caption(860, 128, 360, '外链视频（r:link → https）') +
      mediaPic({
        x: 860, y: 160, w: 340, h: 191, name: '外链宣传片', kind: 'video',
        linkRid: 'rId8', blipRid: 'rId2',
      }) +
      caption(60, 452, 460, '无封面帧的媒体：深色底板 + 标识') +
      mediaPic({
        x: 60, y: 484, w: 300, h: 169, name: '无封面视频', kind: 'video', linkRid: 'rId3',
      }) +
      caption(420, 452, 460, '无封面音频') +
      mediaPic({
        x: 470, y: 484, w: 150, h: 150, name: '无封面音频', kind: 'audio', linkRid: 'rId5',
      }),
  ),
  rels: [
    LAYOUT_REL,
    REL('rId2', `${NS.r}/image`, '../media/poster1.png'),
    REL('rId3', `${NS.r}/video`, '../media/clip1.mp4'),
    REL('rId4', `${NS.r}/media`, '../media/clip1.mp4'),
    REL('rId5', `${NS.r}/audio`, '../media/tone1.wav'),
    REL('rId6', `${NS.r}/image`, '../media/speaker1.png'),
    REL('rId7', `${NS.r}/media`, '../media/tone1.wav'),
    REL('rId8', `${NS.r}/video`, 'https://example.com/media/promo.mp4', true),
  ],
});

// 2. 墨迹页
extraParts.push(['ppt/ink/ink1.xml', inkPart]);
slides.push({
  xml: slideDoc(
    titleSp('墨迹批注：InkML → SVG 路径') +
      caption(60, 128, 560, 'p14:contentPart → InkML（含差分编码 trace）') +
      inkAlternate({ x: 60, y: 170, w: 560, h: 330, rid: 'rId2', fallbackRid: 'rId3', name: '墨迹 1' }) +
      caption(680, 128, 480, 'InkML 缺失 → 回退 mc:Fallback 的位图') +
      inkAlternate({ x: 680, y: 170, w: 480, h: 240, rid: 'rIdMissing', fallbackRid: 'rId3', name: '墨迹 2' }) +
      sp({
        x: 680, y: 440, w: 480, h: 120, prst: 'roundRect',
        fill: solid('EEF3FB'), ln: '<a:ln w="12700"><a:solidFill><a:srgbClr val="B9CDEA"/></a:solidFill></a:ln>',
        text: label('墨迹按整体包围盒等比映射进 contentPart 的框内，笔宽随之缩放', 1000, '3C4759'),
        name: 'note',
      }),
  ),
  rels: [
    LAYOUT_REL,
    REL('rId2', `${NS.r}/customXml`, '../ink/ink1.xml'),
    REL('rId3', `${NS.r}/image`, '../media/ink-fallback.png'),
  ],
});

// 3. 批注页
extraParts.push([
  'ppt/comments/comment1.xml',
  `${XML}<p:cmLst xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">` +
    '<p:cm authorId="0" dt="2026-08-18T09:24:11.482" idx="1">' +
    '<p:pos x="2200000" y="1500000"/>' +
    '<p:text>这一版的封面帧需要换成正式素材，注意保持 16:9。</p:text></p:cm>' +
    '<p:cm authorId="1" dt="2026-08-18T10:02:37.115" idx="2">' +
    '<p:pos x="6900000" y="3100000"/>' +
    '<p:text>数据来源要在附录里标注清楚。</p:text></p:cm>' +
    '<p:cm authorId="0" dt="2026-08-18T10:41:02.900" idx="3">' +
    '<p:pos x="4300000" y="4700000"/>' +
    '<p:text>这里可以再压缩两行。</p:text></p:cm>' +
    '</p:cmLst>',
]);

slides.push({
  xml: slideDoc(
    titleSp('批注：解析成结构化数据（默认不渲染标记）') +
      sp({
        x: 120, y: 160, w: 520, h: 200, prst: 'roundRect', fill: solid('FFF7E6'),
        ln: '<a:ln w="12700"><a:solidFill><a:srgbClr val="F0C674"/></a:solidFill></a:ln>',
        text: label('批注 1 锚点在这一块附近', 1200, '6B4E12'), name: 'block1',
      }) +
      sp({
        x: 700, y: 300, w: 420, h: 180, prst: 'roundRect', fill: solid('E8F3EC'),
        ln: '<a:ln w="12700"><a:solidFill><a:srgbClr val="8FBFA3"/></a:solidFill></a:ln>',
        text: label('批注 2 锚点在这一块附近', 1200, '234A34'), name: 'block2',
      }) +
      caption(120, 600, 900, 'RenderOptions.showComments = true 时才画黄色气泡标记'),
  ),
  rels: [LAYOUT_REL, REL('rId2', `${NS.r}/comments`, '../comments/comment1.xml')],
});

// 4-7. 图表页
const chartSlides = [
  {
    title: '气泡图：xVal / yVal / bubbleSize',
    charts: [
      { xml: chartBubble, box: [60, 120, 700, 560] },
      { xml: chartBubbleWidth, box: [790, 120, 420, 560] },
    ],
  },
  {
    title: '股价图：蜡烛（涨跌柱）与 OHLC 竖线',
    charts: [
      { xml: chartCandle, box: [50, 120, 590, 560] },
      { xml: chartOhlc, box: [670, 120, 560, 560] },
    ],
  },
  {
    title: '复合饼图：子母饼 / 复合条饼',
    charts: [
      { xml: chartOfPie, box: [40, 120, 590, 560] },
      { xml: chartOfBar, box: [650, 120, 590, 560] },
    ],
  },
  {
    title: '曲面图：退化为俯视等高线网格',
    charts: [
      { xml: chartSurface, box: [40, 120, 590, 560] },
      { xml: chartSurfaceRamp, box: [650, 120, 590, 560] },
    ],
  },
];

for (const s of chartSlides) {
  const rels = [LAYOUT_REL];
  const body = s.charts
    .map((c, i) => {
      const rid = `rId${i + 2}`;
      rels.push(addChart(c.xml, rid));
      return frame(rid, ...c.box);
    })
    .join('');
  slides.push({ xml: slideDoc(titleSp(s.title) + body), rels });
}

// ---------------- 公共 part ----------------

const slideParts = [];
slides.forEach((s, i) => {
  slideParts.push([`ppt/slides/slide${i + 1}.xml`, s.xml]);
  slideParts.push([
    `ppt/slides/_rels/slide${i + 1}.xml.rels`,
    `${XML}<Relationships xmlns="${NS.rel}">${s.rels.join('')}</Relationships>`,
  ]);
});

const commentAuthors =
  `${XML}<p:cmAuthorLst xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">` +
  '<p:cmAuthor id="0" name="陈磊" initials="CL" lastIdx="3" clrIdx="0"/>' +
  '<p:cmAuthor id="1" name="评审组" initials="PS" lastIdx="1" clrIdx="1"/>' +
  '</p:cmAuthorLst>';

const SECTIONS = [
  { name: '媒体与墨迹', ids: [256, 257] },
  { name: '协作信息', ids: [258] },
  { name: '新增图表', ids: [259, 260, 261, 262] },
];

const sectionLst =
  '<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}">' +
  `<p14:sectionLst xmlns:p14="${NS_P14}">` +
  SECTIONS.map(
    (s, i) =>
      `<p14:section name="${esc(s.name)}" id="{3B3A1C0${i}-8A0E-4F1B-9B3E-1F5A6C7D8E9${i}}">` +
      '<p14:sldIdLst>' +
      s.ids.map((id) => `<p14:sldId id="${id}"/>`).join('') +
      '</p14:sldIdLst></p14:section>',
  ).join('') +
  '</p14:sectionLst></p:ext></p:extLst>';

const presentation =
  `${XML}<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">` +
  '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' +
  slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('') +
  '</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>' +
  '<p:defaultTextStyle><a:defPPr><a:defRPr sz="1800"/></a:defPPr></p:defaultTextStyle>' +
  sectionLst +
  '</p:presentation>';

const presentationRels =
  `${XML}<Relationships xmlns="${NS.rel}">` +
  REL('rId1', `${NS.r}/slideMaster`, 'slideMasters/slideMaster1.xml') +
  slides.map((_, i) => REL(`rId${i + 2}`, `${NS.r}/slide`, `slides/slide${i + 1}.xml`)).join('') +
  REL(`rId${slides.length + 2}`, `${NS.r}/commentAuthors`, 'commentAuthors.xml') +
  REL(`rId${slides.length + 3}`, `${NS.r}/theme`, 'theme/theme1.xml') +
  '</Relationships>';

const theme = `${XML}<a:theme xmlns:a="${NS.a}" name="MediaFixture">
<a:themeElements>
<a:clrScheme name="MediaFixture">
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
<a:fontScheme name="MediaFixture">
<a:majorFont><a:latin typeface="Trebuchet MS"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Helvetica"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="MediaFixture">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>`;

const slideMaster = `${XML}<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld>
<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FBFCFE"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree>
${nvGrp}
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="457200" y="228600"/><a:ext cx="11277600" cy="685800"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>
</p:spTree>
</p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles>
<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="2400" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle>
<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
</p:txStyles>
</p:sldMaster>`;

const slideMasterRels =
  `${XML}<Relationships xmlns="${NS.rel}">` +
  REL('rId1', `${NS.r}/slideLayout`, '../slideLayouts/slideLayout1.xml') +
  REL('rId2', `${NS.r}/theme`, '../theme/theme1.xml') +
  '</Relationships>';

const slideLayout =
  `${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="obj"><p:cSld name="MediaLayout">` +
  `<p:spTree>${nvGrp}` +
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
  '<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>' +
  '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

const slideLayoutRels =
  `${XML}<Relationships xmlns="${NS.rel}">` +
  REL('rId1', `${NS.r}/slideMaster`, '../slideMasters/slideMaster1.xml') +
  '</Relationships>';

const CT = 'application/vnd.openxmlformats-officedocument.presentationml';
const contentTypes =
  `${XML}<Types xmlns="${NS.ct}">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  '<Default Extension="mp4" ContentType="video/mp4"/>' +
  '<Default Extension="wav" ContentType="audio/wav"/>' +
  `<Override PartName="/ppt/presentation.xml" ContentType="${CT}.presentation.main+xml"/>` +
  `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}.slideMaster+xml"/>` +
  `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}.slideLayout+xml"/>` +
  `<Override PartName="/ppt/commentAuthors.xml" ContentType="${CT}.commentAuthors+xml"/>` +
  `<Override PartName="/ppt/comments/comment1.xml" ContentType="${CT}.comments+xml"/>` +
  '<Override PartName="/ppt/ink/ink1.xml" ContentType="application/inkml+xml"/>' +
  slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${CT}.slide+xml"/>`).join('') +
  chartParts
    .map(([p]) =>
      `<Override PartName="/${p}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`)
    .join('') +
  '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
  '</Types>';

const rootRels =
  `${XML}<Relationships xmlns="${NS.rel}">` +
  REL('rId1', `${NS.r}/officeDocument`, 'ppt/presentation.xml') +
  '</Relationships>';

const zip = makeZip([
  ['[Content_Types].xml', contentTypes],
  ['_rels/.rels', rootRels],
  ['ppt/presentation.xml', presentation],
  ['ppt/_rels/presentation.xml.rels', presentationRels],
  ['ppt/commentAuthors.xml', commentAuthors],
  ['ppt/theme/theme1.xml', theme],
  ['ppt/slideMasters/slideMaster1.xml', slideMaster],
  ['ppt/slideMasters/_rels/slideMaster1.xml.rels', slideMasterRels],
  ['ppt/slideLayouts/slideLayout1.xml', slideLayout],
  ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', slideLayoutRels],
  ...slideParts,
  ...extraParts,
  ...mediaParts,
  ...chartParts,
]);

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-media.pptx'), zip);
console.log(
  `fixtures/sample-media.pptx 已生成（${zip.length} 字节，${slides.length} 页 / ${chartParts.length} 个图表 / ` +
    `${SECTIONS.length} 个节）`,
);
