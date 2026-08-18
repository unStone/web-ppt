import { presetGeom } from 'web-ppt/geometry';

// 与 geometry.ts 的 PRESETS 保持同步的展示清单
const NAMES = [
  'rect', 'roundRect', 'round1Rect', 'round2SameRect', 'round2DiagRect', 'snip1Rect', 'snip2SameRect',
  'snip2DiagRect', 'snipRoundRect', 'plaque', 'bevel', 'frame', 'halfFrame', 'corner', 'diagStripe',
  'foldedCorner', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'parallelogram', 'trapezoid',
  'nonIsoscelesTrapezoid', 'pentagon', 'heptagon', 'decagon', 'dodecagon', 'hexagon', 'octagon',
  'homePlate', 'chevron', 'plus', 'teardrop', 'can', 'cube', 'donut', 'noSmoking', 'pie', 'chord',
  'arc', 'blockArc', 'cloud', 'heart', 'lightningBolt', 'sun', 'moon', 'smileyFace', 'irregularSeal1',
  'irregularSeal2', 'gear6', 'gear9', 'funnel', 'star4', 'star5', 'star6', 'star7', 'star8', 'star10',
  'star12', 'star16', 'star24', 'star32', 'rightArrow', 'leftArrow', 'upArrow', 'downArrow',
  'leftRightArrow', 'upDownArrow', 'quadArrow', 'leftRightUpArrow', 'bentArrow', 'uturnArrow',
  'curvedRightArrow', 'curvedLeftArrow', 'curvedUpArrow', 'curvedDownArrow', 'stripedRightArrow',
  'notchedRightArrow', 'circularArrow', 'rightArrowCallout', 'leftArrowCallout', 'upArrowCallout',
  'downArrowCallout', 'leftRightArrowCallout', 'mathPlus', 'mathMinus', 'mathMultiply', 'mathDivide',
  'mathEqual', 'mathNotEqual', 'leftBracket', 'rightBracket', 'bracketPair', 'leftBrace', 'rightBrace',
  'bracePair', 'ribbon', 'ribbon2', 'verticalScroll', 'horizontalScroll', 'wave', 'doubleWave',
  'wedgeRectCallout', 'wedgeRoundRectCallout', 'wedgeEllipseCallout', 'cloudCallout', 'borderCallout1',
  'borderCallout2', 'flowChartProcess', 'flowChartAlternateProcess', 'flowChartDecision',
  'flowChartInputOutput', 'flowChartPredefinedProcess', 'flowChartInternalStorage', 'flowChartDocument',
  'flowChartMultidocument', 'flowChartTerminator', 'flowChartPreparation', 'flowChartManualInput',
  'flowChartManualOperation', 'flowChartConnector', 'flowChartOffpageConnector', 'flowChartPunchedCard',
  'flowChartPunchedTape', 'flowChartSummingJunction', 'flowChartOr', 'flowChartCollate', 'flowChartSort',
  'flowChartExtract', 'flowChartMerge', 'flowChartOnlineStorage', 'flowChartMagneticTape',
  'flowChartMagneticDisk', 'flowChartMagneticDrum', 'flowChartDisplay', 'flowChartDelay',
  'actionButtonBlank', 'actionButtonHome', 'actionButtonForwardNext', 'actionButtonBackPrevious',
  'actionButtonBeginning', 'actionButtonEnd', 'actionButtonInformation', 'actionButtonReturn',
  'actionButtonDocument', 'actionButtonSound', 'actionButtonMovie', 'actionButtonHelp',
  'chartX', 'chartPlus', 'chartStar', 'line', 'bentConnector2', 'bentConnector3', 'bentConnector4',
  'bentConnector5', 'curvedConnector2', 'curvedConnector3', 'curvedConnector4', 'curvedConnector5',
];

const grid = document.getElementById('grid')!;
const q = document.getElementById('q') as HTMLInputElement;
const adjEl = document.getElementById('adj') as HTMLInputElement;
const ratioEl = document.getElementById('ratio') as HTMLSelectElement;
const count = document.getElementById('count')!;

function render(): void {
  // 支持逗号 / 空格分隔的多关键词
  const terms = q.value.toLowerCase().split(/[,\s]+/).filter(Boolean);
  const adjVal = Number(adjEl.value);
  const ratio = Number(ratioEl.value);
  const W = 160;
  const H = Math.round(W / ratio);
  const adj: Record<string, number> = {
    adj: adjVal, adj1: adjVal, adj2: adjVal, adj3: adjVal, adj4: adjVal,
  };
  const list = NAMES.filter((n) => !terms.length || terms.some((t) => n.toLowerCase().includes(t)));
  count.textContent = `${list.length} / ${NAMES.length}`;
  grid.innerHTML = list
    .map((name) => {
      // 角度类形状用角度调节值，避免滑杆把弧线压成 0
      const isAngular = ['pie', 'chord', 'arc', 'blockArc'].includes(name);
      const a = isAngular ? { adj1: 0, adj2: 270 * 60000, adj3: adjVal } : adj;
      const g = presetGeom(name, W, H, a);
      const fill = g.open ? 'none' : '#4472C4';
      return (
        `<div class="cell${g.open ? ' open' : ''}">` +
        `<svg viewBox="-4 -4 ${W + 8} ${H + 8}"><path d="${g.d}" fill="${fill}" fill-rule="evenodd" stroke="#1F3864" stroke-width="1.5"/></svg>` +
        `<div class="n">${name}</div></div>`
      );
    })
    .join('');
}

q.addEventListener('input', render);
adjEl.addEventListener('input', render);
ratioEl.addEventListener('change', render);
render();
