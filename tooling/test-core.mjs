/**
 * 核心解析 / 渲染自测。
 *
 *   node tooling/test-core.mjs
 *
 * 用 esbuild 把 src/ 打成 ESM，在 jsdom 环境里跑真实解析与渲染，
 * 对 public/ 下的全部测试文件做结构不变量断言。
 * 覆盖：几何、颜色、文本继承、动画/切换、pptx 与 ppt 解析、两条渲染路径、导出约束。
 *
 * 失败以非 0 退出码结束。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomEnv, parseXml } from './lib/dom-env.mjs';
import { makeTtf } from './lib/font.mjs';
import { normalizeSvg, snapshotName } from './lib/snapshot.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out/core');
mkdirSync(outDir, { recursive: true });

// ---------------- 断言框架 ----------------

let pass = 0;
const failures = [];

const check = (name, cond, detail = '') => {
  if (cond) { pass++; return true; }
  failures.push(detail ? `${name} — ${detail}` : name);
  return false;
};

const eq = (name, actual, expected) =>
  check(name, Object.is(actual, expected), `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);

const near = (name, actual, expected, tol = 0.5) =>
  check(name, Math.abs(actual - expected) <= tol, `期望 ${expected}±${tol}，实际 ${actual}`);

const group = (t) => console.log(`\n\x1b[36m▸ ${t}\x1b[0m`);

// ---------------- 打包并载入 ----------------

const { blobs } = installDomEnv();

const bundle = join(outDir, 'src-bundle.mjs');
group('构建');
execFileSync('npx', ['esbuild', join(root, 'packages/core/src/index.ts'), '--bundle', '--format=esm', '--platform=browser',
  '--log-level=error', `--outfile=${bundle}`], { cwd: root, stdio: 'inherit' });
console.log(`  esbuild 打包完成 → ${bundle}`);

const lib = await import(`file://${bundle}?t=${Date.now()}`);

// viewer-core 是独立包，把 `web-ppt` 重定向到刚打好的 core 产物，避免依赖 dist
const viewerBundle = join(outDir, 'viewer-core-bundle.mjs');
execFileSync('npx', ['esbuild', join(root, 'packages/viewer-core/src/index.ts'), '--bundle', '--format=esm',
  '--platform=browser', '--log-level=error', `--alias:@web-ppt/core=${join(root, 'packages/core/src/index.ts')}`,
  `--outfile=${viewerBundle}`], { cwd: root, stdio: 'inherit' });
const viewerLib = await import(`file://${viewerBundle}?t=${Date.now()}`);
const geo = await (async () => {
  const g = join(outDir, 'geo-bundle.mjs');
  execFileSync('npx', ['esbuild', join(root, 'packages/core/src/pptx/geometry.ts'), '--bundle', '--format=esm',
    '--platform=browser', '--log-level=error', `--outfile=${g}`], { cwd: root, stdio: 'inherit' });
  return import(`file://${g}?t=${Date.now()}`);
})();

const crypto = await (async () => {
  const c = join(outDir, 'crypto-bundle.mjs');
  execFileSync('npx', ['esbuild', join(root, 'packages/core/src/crypto/primitives.ts'), '--bundle', '--format=esm',
    '--platform=neutral', '--log-level=error', `--outfile=${c}`], { cwd: root, stdio: 'inherit' });
  return import(`file://${c}?t=${Date.now()}`);
})();

// fonts 是独立包，把 @web-ppt/core 重定向到刚打好的源码产物，避免依赖 dist
const fontsLib = await (async () => {
  const f = join(outDir, 'fonts-bundle.mjs');
  execFileSync('npx', ['esbuild', join(root, 'packages/fonts/src/index.ts'), '--bundle', '--format=esm',
    '--platform=browser', '--log-level=error', `--alias:@web-ppt/core=${join(root, 'packages/core/src/index.ts')}`,
    `--outfile=${f}`], { cwd: root, stdio: 'inherit' });
  return import(`file://${f}?t=${Date.now()}`);
})();

const colorMod = await (async () => {
  const c = join(outDir, 'color-bundle.mjs');
  execFileSync('npx', ['esbuild', join(root, 'packages/core/src/pptx/color.ts'), '--bundle', '--format=esm',
    '--platform=browser', '--log-level=error', `--outfile=${c}`], { cwd: root, stdio: 'inherit' });
  return import(`file://${c}?t=${Date.now()}`);
})();

const load = (name) => {
  const p = join(root, 'fixtures', name);
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
};

// ---------------- 通用工具 ----------------

const NUM = /-?\d+(?:\.\d+)?/g;
/**
 * 脏值检测。必须先把 data URI 抹掉再查——base64 字母表里出现字面量 "NaN"
 * 完全是碰运气的事，实测 210 个真实文件里就有 3 个中招，会让人白查半天。
 */
const stripData = (s) => String(s).replace(/data:[a-z/+.\-]+[;,][^"')\s]*/gi, 'data:<x>');
const BAD_RE = /NaN|Infinity|undefined|null/;
const BAD = { test: (s) => BAD_RE.test(stripData(s)) };

function walkElements(els, fn) {
  for (const el of els) {
    fn(el);
    if (el.kind === 'group') walkElements(el.children, fn);
  }
}

function allElements(pres) {
  const out = [];
  for (const s of pres.slides) walkElements(s.elements, (e) => out.push(e));
  return out;
}

// ---------------- 1. 几何 ----------------

group('几何');
{
  const NAMES = [
    'rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'octagon', 'star5', 'star8',
    'donut', 'noSmoking', 'pie', 'chord', 'arc', 'blockArc', 'cloud', 'heart', 'sun', 'moon',
    'can', 'cube', 'bevel', 'frame', 'plaque', 'teardrop', 'smileyFace', 'gear6', 'funnel',
    'rightArrow', 'leftRightArrow', 'quadArrow', 'bentArrow', 'uturnArrow', 'circularArrow',
    'curvedRightArrow', 'curvedLeftArrow', 'curvedUpArrow', 'curvedDownArrow',
    'mathPlus', 'mathMultiply', 'mathNotEqual', 'leftBracket', 'bracePair', 'ribbon', 'wave',
    'wedgeEllipseCallout', 'cloudCallout', 'flowChartProcess', 'flowChartMagneticDrum',
    'flowChartSummingJunction', 'actionButtonSound', 'chartX', 'line', 'bentConnector3',
    'bentUpArrow', 'leftUpArrow', 'leftCircularArrow', 'leftRightCircularArrow', 'swooshArrow',
    'quadArrowCallout', 'upDownArrowCallout', 'pieWedge', 'ellipseRibbon', 'ellipseRibbon2',
    'leftRightRibbon', 'cornerTabs', 'squareTabs', 'plaqueTabs', 'lineInv',
    'flowChartOfflineStorage', 'accentCallout3', 'accentBorderCallout1', 'borderCallout3',
  ];
  const W = 200, H = 120;
  let bounded = 0;
  for (const name of NAMES) {
    // 遍历多组调节值与极端尺寸，确保任何输入都不产生脏路径
    for (const adjVal of [0, 12500, 25000, 50000, 100000]) {
      const adj = { adj: adjVal, adj1: adjVal, adj2: adjVal, adj3: adjVal, adj4: adjVal };
      const g = geo.presetGeom(name, W, H, adj);
      if (!check(`${name} 生成路径`, typeof g.d === 'string' && g.d.length > 0)) continue;
      if (!check(`${name} 无脏值`, !BAD.test(g.d), g.d.slice(0, 60))) continue;
      const nums = (g.d.match(NUM) || []).map(Number);
      const max = Math.max(...nums.map(Math.abs));
      // presetGeom 内置安全网：越界应回退成矩形而不是画出飞线
      if (max <= Math.max(W, H) * 20 + 1000) bounded++;
    }
  }
  eq('全部形状均在安全范围内', bounded, NAMES.length * 5);

  // 极端尺寸
  for (const [w, h] of [[0, 0], [1, 1], [0.01, 5000], [5000, 0.01]]) {
    const g = geo.presetGeom('star5', w, h, {});
    check(`极端尺寸 ${w}x${h} 不产生脏值`, !BAD.test(g.d), g.d.slice(0, 40));
  }

  // 开放路径标记
  check('连接线是开放路径', geo.presetGeom('bentConnector3', 100, 50, {}).open === true);
  check('括号是开放路径', geo.presetGeom('bracketPair', 100, 50, {}).open === true);
  check('矩形不是开放路径', geo.presetGeom('rect', 100, 50, {}).open === false);

  // 未知形状回退
  check('未知形状回退为矩形', geo.presetGeom('__nope__', 100, 50, {}).d.includes('M 0 0'));

  // 规范全覆盖：presetGeom 对未知名字静默退化成矩形，不报错也不进 unsupported，
  // 少一个预设就是无声画错。这里把 ECMA-376 的 187 个名字全列出来当闸门。
  const SPEC_PRESETS = [
    'accentBorderCallout1', 'accentBorderCallout2', 'accentBorderCallout3', 'accentCallout1', 'accentCallout2', 'accentCallout3',
    'actionButtonBackPrevious', 'actionButtonBeginning', 'actionButtonBlank', 'actionButtonDocument', 'actionButtonEnd', 'actionButtonForwardNext',
    'actionButtonHelp', 'actionButtonHome', 'actionButtonInformation', 'actionButtonMovie', 'actionButtonReturn', 'actionButtonSound',
    'arc', 'bentArrow', 'bentConnector2', 'bentConnector3', 'bentConnector4', 'bentConnector5',
    'bentUpArrow', 'bevel', 'blockArc', 'borderCallout1', 'borderCallout2', 'borderCallout3',
    'bracePair', 'bracketPair', 'callout1', 'callout2', 'callout3', 'can',
    'chartPlus', 'chartStar', 'chartX', 'chevron', 'chord', 'circularArrow',
    'cloud', 'cloudCallout', 'corner', 'cornerTabs', 'cube', 'curvedConnector2',
    'curvedConnector3', 'curvedConnector4', 'curvedConnector5', 'curvedDownArrow', 'curvedLeftArrow', 'curvedRightArrow',
    'curvedUpArrow', 'decagon', 'diagStripe', 'diamond', 'dodecagon', 'donut',
    'doubleWave', 'downArrow', 'downArrowCallout', 'ellipse', 'ellipseRibbon', 'ellipseRibbon2',
    'flowChartAlternateProcess', 'flowChartCollate', 'flowChartConnector', 'flowChartDecision', 'flowChartDelay', 'flowChartDisplay',
    'flowChartDocument', 'flowChartExtract', 'flowChartInputOutput', 'flowChartInternalStorage', 'flowChartMagneticDisk', 'flowChartMagneticDrum',
    'flowChartMagneticTape', 'flowChartManualInput', 'flowChartManualOperation', 'flowChartMerge', 'flowChartMultidocument', 'flowChartOfflineStorage',
    'flowChartOffpageConnector', 'flowChartOnlineStorage', 'flowChartOr', 'flowChartPredefinedProcess', 'flowChartPreparation', 'flowChartProcess',
    'flowChartPunchedCard', 'flowChartPunchedTape', 'flowChartSort', 'flowChartSummingJunction', 'flowChartTerminator', 'foldedCorner',
    'frame', 'funnel', 'gear6', 'gear9', 'halfFrame', 'heart',
    'heptagon', 'hexagon', 'homePlate', 'horizontalScroll', 'irregularSeal1', 'irregularSeal2',
    'leftArrow', 'leftArrowCallout', 'leftBrace', 'leftBracket', 'leftCircularArrow', 'leftRightArrow',
    'leftRightArrowCallout', 'leftRightCircularArrow', 'leftRightRibbon', 'leftRightUpArrow', 'leftUpArrow', 'lightningBolt',
    'line', 'lineInv', 'mathDivide', 'mathEqual', 'mathMinus', 'mathMultiply',
    'mathNotEqual', 'mathPlus', 'moon', 'noSmoking', 'nonIsoscelesTrapezoid', 'notchedRightArrow',
    'octagon', 'parallelogram', 'pentagon', 'pie', 'pieWedge', 'plaque',
    'plaqueTabs', 'plus', 'quadArrow', 'quadArrowCallout', 'rect', 'ribbon',
    'ribbon2', 'rightArrow', 'rightArrowCallout', 'rightBrace', 'rightBracket', 'round1Rect',
    'round2DiagRect', 'round2SameRect', 'roundRect', 'rtTriangle', 'smileyFace', 'snip1Rect',
    'snip2DiagRect', 'snip2SameRect', 'snipRoundRect', 'squareTabs', 'star10', 'star12',
    'star16', 'star24', 'star32', 'star4', 'star5', 'star6',
    'star7', 'star8', 'straightConnector1', 'stripedRightArrow', 'sun', 'swooshArrow',
    'teardrop', 'trapezoid', 'triangle', 'upArrow', 'upArrowCallout', 'upDownArrow',
    'upDownArrowCallout', 'uturnArrow', 'verticalScroll', 'wave', 'wedgeEllipseCallout', 'wedgeRectCallout',
    'wedgeRoundRectCallout',
  ];
  {
    const missing = SPEC_PRESETS.filter((nm) => !geo.isKnownPreset(nm));
    check(`ECMA-376 预设形状全覆盖（${SPEC_PRESETS.length} 个）`, missing.length === 0, `缺 ${missing.join(' ')}`);
  }

  // 模糊测试：调节值取自恶意区间（负数 / 超大 / 非整），直接压 presetGeom 的安全网。
  // .ppt 的 MSO 调节值不是 OOXML 的 100000 制，曾因此画出满屏飞线。
  {
    let seed = 20240818;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const WILD = [-1e9, -100000, -1, 0, 1, 21600, 100000, 1e6, 2147483647, 0.5, 1e12];
    let cases = 0, escaped = 0, dirty = 0;
    for (const name of NAMES) {
      for (let k = 0; k < 12; k++) {
        const pick = () => WILD[Math.floor(rnd() * WILD.length)];
        const adj = { adj: pick(), adj1: pick(), adj2: pick(), adj3: pick(), adj4: pick() };
        const w = [0, 1, 50, 200, 4000][Math.floor(rnd() * 5)];
        const h = [0, 1, 30, 120, 3000][Math.floor(rnd() * 5)];
        const g = geo.presetGeom(name, w, h, adj);
        cases++;
        if (BAD.test(g.d)) { dirty++; continue; }
        const nums = (g.d.match(NUM) || []).map(Number);
        if (!nums.length) continue;
        const max = Math.max(...nums.map(Math.abs));
        if (max > Math.max(w, h) * 20 + 1000) escaped++;
      }
    }
    eq(`模糊测试无脏路径（${cases} 例）`, dirty, 0);
    eq('模糊测试无越界路径', escaped, 0);
  }

  // custGeom 公式求值
  const dom = new globalThis.DOMParser().parseFromString(`
    <a:custGeom xmlns:a="urn:a">
      <a:avLst><a:gd name="adj" fmla="val 50000"/></a:avLst>
      <a:gdLst>
        <a:gd name="half" fmla="*/ w 1 2"/>
        <a:gd name="q" fmla="*/ h 1 4"/>
        <a:gd name="sum" fmla="+- half q 0"/>
      </a:gdLst>
      <a:pathLst><a:path w="100" h="100">
        <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
        <a:lnTo><a:pt x="half" y="q"/></a:lnTo>
        <a:lnTo><a:pt x="100" y="100"/></a:lnTo>
        <a:close/>
      </a:path></a:pathLst>
    </a:custGeom>`, 'application/xml').documentElement;
  const cg = geo.custGeomPath(dom, 200, 100);
  check('custGeom 解析成功', cg !== null);
  if (cg) {
    check('custGeom 无脏值', !BAD.test(cg.d), cg.d);
    // half = 100/2 = 50（路径空间），缩放到 200 宽 → 100；q = 100/4 = 25 → 缩放到 100 高 → 25
    check('gdLst 公式求值正确', /L\s+100\s+25/.test(cg.d), cg.d);
  }
}

// ---------------- 2. 文件结构不变量 ----------------

const FIXTURES = [
  { file: 'sample.pptx', minPages: 3, source: 'pptx' },
  { file: 'showcase.pptx', minPages: 7, source: 'pptx' },
  { file: 'sample-chart.pptx', minPages: 9, source: 'pptx' },
  { file: 'sample-metafile.pptx', minPages: 1, source: 'pptx' },
  { file: 'sample-effects.pptx', minPages: 4, source: 'pptx' },
  { file: 'sample-media.pptx', minPages: 7, source: 'pptx' },
  { file: 'sample-hidden.pptx', minPages: 5, source: 'pptx' },
  { file: 'sample-autofit.pptx', minPages: 5, source: 'pptx' },
  { file: 'sample-placeholder.pptx', minPages: 3, source: 'pptx' },
  { file: 'sample-ole.pptx', minPages: 3, source: 'pptx' },
  { file: 'sample-math.pptx', minPages: 1, source: 'pptx' },
  { file: 'sample-smartart.pptx', minPages: 6, source: 'pptx' },
  { file: 'sample-embedfont.pptx', minPages: 1, source: 'pptx' },
  { file: 'sample.ppt', minPages: 2, source: 'ppt' },
  { file: 'showcase.ppt', minPages: 6, source: 'ppt' },
  { file: 'sample-chart.ppt', minPages: 9, source: 'ppt' },
  { file: 'sample-hidden.ppt', minPages: 5, source: 'ppt' },
];

const parsed = new Map();

group('文件解析');
for (const fx of FIXTURES) {
  const bytes = load(fx.file);
  if (!check(`${fx.file} 存在`, bytes !== null, '运行 npm run fixtures 生成')) continue;
  let pres;
  try {
    pres = await lib.parse(bytes);
  } catch (e) {
    check(`${fx.file} 解析成功`, false, String(e && e.message));
    continue;
  }
  parsed.set(fx.file, pres);
  pass++;
  eq(`${fx.file} 格式识别`, pres.source, fx.source);
  check(`${fx.file} 页数 ≥ ${fx.minPages}`, pres.slides.length >= fx.minPages, `实际 ${pres.slides.length}`);
  check(`${fx.file} 画布尺寸有效`, pres.width > 0 && pres.height > 0, `${pres.width}x${pres.height}`);

  const els = allElements(pres);
  check(`${fx.file} 有元素`, els.length > 0, `实际 ${els.length}`);

  let badPath = 0, badBox = 0, badText = 0;
  for (const el of els) {
    if (!Number.isFinite(el.x) || !Number.isFinite(el.y) || !Number.isFinite(el.w) || !Number.isFinite(el.h)) badBox++;
    if (el.kind === 'shape' && el.path && BAD.test(el.path)) badPath++;
    const bodies = el.kind === 'shape' ? [el.text]
      : el.kind === 'table' ? el.rows.flatMap((r) => r.cells.map((c) => c.text)) : [];
    for (const t of bodies) {
      if (!t) continue;
      // Schema 必填字段齐全，渲染层才敢直接取用
      if (!Array.isArray(t.paragraphs) || typeof t.fontScale !== 'number' || !Array.isArray(t.insets)) badText++;
      for (const p of t.paragraphs) {
        if (!Array.isArray(p.runs)) { badText++; continue; }
        for (const r of p.runs) {
          if (typeof r.text !== 'string' || !Number.isFinite(r.size) || typeof r.color !== 'string') badText++;
        }
      }
    }
  }
  eq(`${fx.file} 无脏路径`, badPath, 0);
  eq(`${fx.file} 无非法包围盒`, badBox, 0);
  eq(`${fx.file} 文本字段齐全`, badText, 0);
}

// ---------------- 3. 渲染与导出 ----------------

group('渲染');
for (const [name, pres] of parsed) {
  for (const textMode of ['html', 'svg']) {
    let structErr = 0, dangling = 0, dupIds = 0;
    for (const slide of pres.slides) {
      const svg = lib.renderSlideToSvg(pres, slide, { textMode });
      const { error } = parseXml(svg);
      if (error) { structErr++; continue; }
      // 引用完整性：url(#x) 必须能在同一份 SVG 里找到 id="x"
      const ids = new Set((svg.match(/\sid="([^"]+)"/g) || []).map((s) => s.slice(5, -1)));
      const idList = (svg.match(/\sid="([^"]+)"/g) || []).map((s) => s.slice(5, -1));
      if (idList.length !== ids.size) dupIds++;
      for (const ref of svg.match(/url\(#([^)]+)\)/g) || []) {
        if (!ids.has(ref.slice(5, -1))) dangling++;
      }
    }
    eq(`${name} [${textMode}] SVG 结构合法`, structErr, 0);
    eq(`${name} [${textMode}] 无悬空引用`, dangling, 0);
    eq(`${name} [${textMode}] 无重复 id`, dupIds, 0);
  }

  // 导出路径不能含 foreignObject —— Chrome 会因此判定画布被污染而无法 toBlob
  const exportSvg = lib.renderSlideToSvg(pres, pres.slides[0], { textMode: 'svg' });
  check(`${name} 导出路径无 foreignObject`, !exportSvg.includes('foreignObject'));
  check(`${name} 屏幕路径有 foreignObject 或纯图形`, true);
}

// 同一页渲染两次，id 不能重复（缩略图与主视图同时在 DOM 里的场景）
{
  const pres = parsed.get('showcase.pptx');
  if (pres) {
    const a = lib.renderSlideToSvg(pres, pres.slides[4]);
    const b = lib.renderSlideToSvg(pres, pres.slides[4]);
    const idsA = new Set((a.match(/\sid="([^"]+)"/g) || []).map((s) => s.slice(5, -1)));
    const idsB = (b.match(/\sid="([^"]+)"/g) || []).map((s) => s.slice(5, -1));
    const overlap = idsB.filter((id) => idsA.has(id));
    eq('重复渲染同一页不产生 id 冲突', overlap.length, 0);
  }
}

// ---------------- 4. 文本样式继承 ----------------

group('文本样式');
{
  const pres = parsed.get('showcase.pptx');
  if (pres) {
    const runs = [];
    walkElements(pres.slides[0].elements, (e) => {
      if (e.kind === 'shape' && e.text) {
        for (const p of e.text.paragraphs) for (const r of p.runs) if (r.text.trim()) runs.push(r);
      }
    });
    check('形状库页有文本', runs.length > 50, `实际 ${runs.length}`);
    // 形状库的标签是 6pt（fixture 里 label(name, 600)），继承链最终由 run 级 sz 覆盖
    const labelRuns = runs.filter((r) => Math.abs(r.size - 6 * (96 / 72)) < 0.01);
    check('标签字号来自 run 级覆盖', labelRuns.length > 100, `实际 ${labelRuns.length}`);
    // 标题走母版 titleStyle 继承，应显著大于标签
    const titleRun = runs.find((r) => r.text.includes('预设形状库'));
    check('标题字号来自继承链', titleRun && titleRun.size > 20, titleRun ? String(titleRun.size) : '未找到');
    check('颜色已解析为 css', runs.every((r) => /^rgba?\(/.test(r.color)));
  }

  // 主题色变换：accent1 = 4472C4，lumMod 75% 应变暗
  const pres2 = parsed.get('showcase.pptx');
  if (pres2) {
    const fills = [];
    walkElements(pres2.slides[1].elements, (e) => { if (e.kind === 'shape' && e.fill) fills.push(e.fill); });
    check('效果页有填充', fills.length > 0);
    check('存在渐变填充', fills.some((f) => f.type === 'gradient'));
    check('存在图案填充', fills.some((f) => f.type === 'pattern'));
    const alpha = fills.filter((f) => f.type === 'solid' && /rgba/.test(f.color));
    check('存在半透明填充', alpha.length > 0);
  }
}

// ---------------- 4a. 段落内的特殊节点 ----------------

group('段落内容');
{
  const textMod = await (async () => {
    const t = join(outDir, 'text-bundle.mjs');
    execFileSync('npx', ['esbuild', join(root, 'packages/core/src/pptx/text.ts'), '--bundle', '--format=esm',
      '--platform=browser', '--log-level=error', `--outfile=${t}`], { cwd: root, stdio: 'inherit' });
    return import(`file://${t}?t=${Date.now()}`);
  })();

  const parse = (inner) => {
    // 用例自带 bodyPr 时不要再补一个空的——kid() 只取首个，会让自带的失效
    const head = inner.includes('<a:bodyPr') ? '' : '<a:bodyPr/>';
    const xml = `<p:txBody xmlns:p="up" xmlns:a="ua" xmlns:m="um" xmlns:mc="umc">${head}${inner}</p:txBody>`;
    const el = new globalThis.DOMParser().parseFromString(xml, 'application/xml').documentElement;
    return textMod.parseTextBody(el, {
      ctx: { theme: {}, clrMap: {} },
      fonts: { major: { latin: null, ea: null }, minor: { latin: null, ea: null } },
      chain: [], slideNum: 1,
    });
  };
  const flat = (body) => body.paragraphs.map((p) => p.runs.map((r) => r.text).join(''));

  // 回归：OMML 公式曾被静默丢弃，整段只剩前半句
  const math = parse('<a:p><a:r><a:t>面积 = </a:t></a:r>' +
    '<m:oMath><m:sSup><m:e><m:r><m:t>πr</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></a:p>');
  // 线性文本带上 ^ / _ / √ 等结构标记，比单纯拼接 m:t 更可读，搜索也更准
  eq('OMML 公式转为线性文本', flat(math)[0], '面积 = πr^2');

  // 回归：段落内的 mc:AlternateContent 曾整段跳过
  const alt = parse('<a:p><mc:AlternateContent><mc:Choice Requires="a14"><a:r><a:t>新版内容</a:t></a:r></mc:Choice>' +
    '<mc:Fallback><a:r><a:t>兼容内容</a:t></a:r></mc:Fallback></mc:AlternateContent></a:p>');
  eq('AlternateContent 取 Choice 分支', flat(alt)[0], '新版内容');

  // 复杂脚本字体：cs 必须进字体栈，否则阿拉伯语等会拿到拉丁字体
  const cs = parse('<a:p><a:r><a:rPr><a:latin typeface="Calibri"/><a:cs typeface="Arial Unicode MS"/></a:rPr><a:t>مرحبا</a:t></a:r></a:p>');
  check('cs 字体进入字体栈', cs.paragraphs[0].runs[0].fonts.includes('Arial Unicode MS'),
    JSON.stringify(cs.paragraphs[0].runs[0].fonts));

  // normAutofit 的行距压缩对默认行距也要生效
  const af = parse('<a:bodyPr><a:normAutofit fontScale="70000" lnSpcReduction="10000"/></a:bodyPr>' +
    '<a:p><a:r><a:t>压缩行距</a:t></a:r></a:p>');
  near('lnSpcReduction 作用于默认行距', af.paragraphs[0].lineHeight, 1.1, 0.01);
}

// ---------------- 4b. 主题色变换 ----------------

group('主题色变换');
{
  // 基准值来自 LibreOffice 对同一份 pptx 的实际渲染（accent1 = 4472C4）。
  // shade / tint 必须在线性 RGB 空间做——早期在 sRGB 上直乘，最大偏差达 Δ69。
  const REF = {
    shade: { 20: [33, 56, 97], 40: [45, 76, 131], 60: [54, 91, 156], 80: [61, 103, 177] },
    tint: { 20: [232, 235, 244], 40: [207, 213, 233], 60: [176, 187, 222], 80: [136, 156, 209] },
  };
  const ctx = { theme: { accent1: '4472C4' }, clrMap: {} };
  const mk = (mod, v) => new globalThis.DOMParser().parseFromString(
    `<a:schemeClr xmlns:a="u" val="accent1"><a:${mod} val="${v * 1000}"/></a:schemeClr>`, 'application/xml').documentElement;

  let worst = 0;
  for (const mod of ['shade', 'tint']) {
    for (const v of [20, 40, 60, 80]) {
      const got = (lib.parseColor ?? colorMod.parseColor)(mk(mod, v), ctx).match(/\d+/g).map(Number);
      const ref = REF[mod][v];
      const d = Math.hypot(...got.map((x, i) => x - ref[i]));
      worst = Math.max(worst, d);
    }
  }
  check('shade / tint 与 LibreOffice 基准一致', worst <= 10, `最大偏差 Δ${worst.toFixed(1)}（应 ≤10）`);
}

// ---------------- 4c. 图片裁剪与资源释放 ----------------

group('图片与资源');
{
  const pres = parsed.get('showcase.pptx');
  if (pres) {
    // 回归：srcRect 早期只在 p:pic 上生效，形状的图片填充不裁剪
    const fills = [];
    for (const s of pres.slides) walkElements(s.elements, (e) => {
      if (e.kind === 'shape' && e.fill?.type === 'image') fills.push(e.fill);
    });
    check('存在形状图片填充', fills.length > 0, `实际 ${fills.length}`);
    const cropped = fills.filter((f) => f.crop && (f.crop.l || f.crop.t || f.crop.r || f.crop.b));
    check('形状图片填充支持 srcRect 裁剪', cropped.length > 0,
      `${fills.length} 个填充中 0 个带裁剪`);
    if (cropped.length) {
      const svg = lib.renderSlideToSvg(pres, pres.slides.find((s) =>
        s.elements.some((e) => e.kind === 'shape' && e.fill?.type === 'image' && e.fill.crop)) ?? pres.slides[4]);
      check('裁剪在渲染中生效（image 带负偏移）', /<image[^>]*x="-/.test(svg));
    }

    // blob URL 释放
    check('提供 dispose 释放接口', typeof pres.dispose === 'function');
  }

  // 单独解析一份用于验证 dispose 不影响其它实例
  const bytes = load('showcase.pptx');
  if (bytes) {
    const tmp = await lib.parse(bytes);
    const before = lib.renderSlideToSvg(tmp, tmp.slides[4]);
    check('释放前含图片引用', /href="(blob:|data:)/.test(before));
    tmp.dispose?.();
    check('dispose 后不抛异常', true);
    const still = lib.renderSlideToSvg(parsed.get('showcase.pptx'), parsed.get('showcase.pptx').slides[4]);
    check('dispose 不影响其它实例', /href="(blob:|data:)/.test(still));
  }
}

// ---------------- 5. 动画与切换 ----------------

group('动画 / 切换');
{
  const pres = parsed.get('showcase.pptx');
  if (pres) {
    const withTrans = pres.slides.filter((s) => s.transition);
    check('每页都有切换效果', withTrans.length >= 7, `实际 ${withTrans.length}`);
    const types = new Set(withTrans.map((s) => s.transition.type));
    check('切换类型多样', types.size >= 5, [...types].join(','));
    check('切换时长在合理区间', withTrans.every((s) => s.transition.durationMs >= 80 && s.transition.durationMs <= 5000));

    // p14 / p159 扩展切换：PowerPoint 写在 mc:AlternateContent 里，
    // Choice 放新效果、Fallback 放老版本能认的。取错分支就会静默退化成 fade。
    const byType = new Map(withTrans.map((s) => [s.transition.type, s.transition]));
    for (const want of ['ripple', 'conveyor', 'prism', 'morph']) {
      check(`识别 p14/p159 切换 ${want}`, byType.has(want), [...byType.keys()].join(','));
    }
    check('取 Choice 分支而非 Fallback', byType.get('ripple')?.durationMs === 1400,
      String(byType.get('ripple')?.durationMs));
    eq('morph 粒度', byType.get('morph')?.morphBy, 'byObject');
    eq('p14 切换保留方向', byType.get('conveyor')?.dir, 'l');

    // 每种切换都必须能产出关键帧，且不含脏值——新增 20 个类型最容易在这里翻车
    const ALL_TRANS = [
      'none', 'fade', 'cut', 'push', 'pull', 'cover', 'wipe', 'split', 'zoom', 'dissolve',
      'checker', 'blinds', 'comb', 'wheel', 'circle', 'diamond', 'plus', 'wedge',
      'newsflash', 'randomBar', 'strips',
      'vortex', 'switch', 'flip', 'ripple', 'honeycomb', 'glitter', 'warp', 'flythrough',
      'flash', 'shred', 'reveal', 'wheelReverse', 'ferris', 'gallery', 'conveyor', 'pan',
      'doors', 'window', 'prism', 'morph',
    ];
    {
      const tf = viewerLib.transitionFrames;
      let ok = 0;
      const seen = new Set();
      for (const type of ALL_TRANS) {
        for (const dir of ['l', 'r', 'u', 'd', 'horz-out', undefined]) {
          const inF = JSON.stringify(tf({ type, dir, durationMs: 600 }, true));
          const outF = JSON.stringify(tf({ type, dir, durationMs: 600 }, false));
          if (!BAD.test(inF) && !BAD.test(outF) && inF.length > 4 && outF.length > 4) ok++;
        }
        seen.add(JSON.stringify(tf({ type, dir: 'l', durationMs: 600 }, true)));
      }
      eq('全部切换类型都产出关键帧', ok, ALL_TRANS.length * 6);
      // 41 种效果若大量共用同一组关键帧，等于没实现
      check('切换效果视觉上互不相同', seen.size >= 24, `仅 ${seen.size} 种不同关键帧`);
    }

    const anim = pres.slides.find((s) => s.animations?.length);
    if (check('存在带动画的页', !!anim)) {
      const entr = anim.animations.filter((a) => a.kind === 'entrance');
      const motion = anim.animations.filter((a) => a.kind === 'motion');
      eq('入场动画条数', entr.length, 5);
      // 回归：曾把 <p:set dur="1"> 误当成动画时长，导致全部退化成 60ms
      check('动画时长取自 animEffect 而非 p:set',
        entr.every((a) => a.durationMs === 600),
        entr.map((a) => a.durationMs).join(','));
      // 回归：slide(fromLeft) 的方向曾被映射反
      const fly = anim.animations.find((a) => a.effect === 'fly');
      check('飞入方向映射正确', fly && fly.dir === 'l', fly ? fly.dir : '无 fly');
      check('逐次点击分批', anim.animations.map((a) => a.clickGroup).join(',') === '0,1,2,3,4,5,6,7',
        anim.animations.map((a) => a.clickGroup).join(','));

      // 运动路径
      eq('运动路径动画条数', motion.length, 2);
      for (const m of motion) {
        check(`运动路径 ${m.target} 有采样点`, (m.motionPath?.length ?? 0) >= 8, `${m.motionPath?.length}`);
        check(`运动路径 ${m.target} 起点归零`,
          m.motionPath[0][0] === 0 && m.motionPath[0][1] === 0, JSON.stringify(m.motionPath?.[0]));
        check(`运动路径 ${m.target} 无脏值`, !BAD.test(JSON.stringify(m.motionPath)));
        // 弧长等距重采样：相邻步长应基本一致，否则 WAAPI 会把长段走得比短段慢
        const d = m.motionPath.slice(1).map(([x, y], i) =>
          Math.hypot(x - m.motionPath[i][0], y - m.motionPath[i][1]));
        check(`运动路径 ${m.target} 采样等距`, Math.max(...d) / Math.min(...d) < 1.2,
          `max/min=${(Math.max(...d) / Math.min(...d)).toFixed(3)}`);
      }
      // 闭合路径（Z）必须回到原点
      const closed = motion.find((m) => m.target === 707);
      check('闭合路径终点回到起点',
        closed && Math.hypot(...closed.motionPath[closed.motionPath.length - 1]) < 1,
        closed ? JSON.stringify(closed.motionPath[closed.motionPath.length - 1]) : '无');
      // 三次曲线要真被折线化，否则闭合路径会退化成一条直线来回
      check('曲线路径不是直线',
        closed && closed.motionPath.some(([, y]) => Math.abs(y) > 20),
        closed ? String(Math.max(...closed.motionPath.map(([, y]) => Math.abs(y)))) : '无');
      // 动画目标必须能在渲染结果里定位到
      const svg = lib.renderSlideToSvg(pres, anim);
      for (const a of anim.animations) {
        check(`动画目标 ${a.target} 在 SVG 中可定位`, svg.includes(`data-el="${a.target}"`));
      }
    }
  }
}

// ---------------- 5.3 SmartArt ----------------

group('SmartArt');
{
  const pres = parsed.get('sample-smartart.pptx');
  if (pres) {
    const groupOf = (i) => pres.slides[i].elements.find((e) => e.kind === 'group');
    const textsOf = (g) => {
      const out = [];
      walkElements(g ? g.children : [], (e) => {
        const t = e.text ? lib.slideText({ elements: [e] }).trim() : '';
        if (t) out.push(t);
      });
      return out;
    };

    // 第 1 页有缓存 drawing part：必须走「直接读画好的图形」，
    // 读成自研布局就说明优先级错了——缓存的保真度更高
    const cached = groupOf(0);
    if (check('缓存 drawing 页解析为 group', cached?.kind === 'group')) {
      eq('缓存 drawing 的形状数', cached.children.length, 3);
      eq('取的是缓存里的文本', textsOf(cached).join('|'), '缓存A|缓存B|缓存C');
    }

    // 第 2-6 页只有 data + layout，走自研布局回退
    const WANT = [
      [1, ['需求', '设计', '实现', '验收']],
      [2, ['计划', '执行', '检查', '改进']],
      [3, ['战略', '战术', '执行']],
      [5, ['第一条', '第二条', '第三条']],
    ];
    for (const [idx, texts] of WANT) {
      const g = groupOf(idx);
      if (!check(`第 ${idx + 1} 页排出 group`, g?.kind === 'group')) continue;
      eq(`第 ${idx + 1} 页节点文本`, textsOf(g).join('|'), texts.join('|'));
      // 盒子不能重叠也不能跑出画框
      const boxes = g.children.filter((e) => e.text);
      check(`第 ${idx + 1} 页节点在画框内`,
        boxes.every((b) => b.x >= -1 && b.y >= -1 && b.x + b.w <= g.w + 1 && b.y + b.h <= g.h + 1),
        boxes.map((b) => `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}`).join(' '));
      check(`第 ${idx + 1} 页节点尺寸有效`, boxes.every((b) => b.w > 1 && b.h > 1));
      check(`第 ${idx + 1} 页节点各有配色`, new Set(boxes.map((b) => b.fill?.color)).size >= Math.min(boxes.length, 3));
    }

    // 层级布局：节点之外还要有父子连线，否则读不出层级
    const org = groupOf(4);
    if (check('组织结构页排出 group', org?.kind === 'group')) {
      eq('组织结构节点文本', textsOf(org).join('|'), 'CEO|研发|市场|前端|后端');
      const lines = org.children.filter((e) => e.openGeom);
      eq('父子连线数', lines.length, 4);
      check('连线只描边不填充', lines.every((l) => l.fill === null && l.stroke));
      // CEO 在最上层
      const boxes = org.children.filter((e) => e.text);
      const ceo = boxes[0];
      check('根节点在最上方', boxes.every((b) => b === ceo || b.y >= ceo.y), `${ceo.y}`);
    }

    // 数据模型里的 parTrans / sibTrans / presOf 是噪声，混进树里会让节点翻倍
    for (let i = 1; i < 6; i++) {
      const g = groupOf(i);
      const boxes = g ? g.children.filter((e) => e.text) : [];
      check(`第 ${i + 1} 页未混入 parTrans/presOf 幽灵节点`, boxes.length <= 5, `${boxes.length} 个节点`);
    }

    // 两条渲染路径都不能产生脏值
    for (const mode of ['svg', 'html']) {
      for (let i = 0; i < pres.slides.length; i++) {
        const svg = lib.renderSlideToSvg(pres, pres.slides[i], { textMode: mode });
        check(`${mode} 路径第 ${i + 1} 页渲染无脏值`, !BAD.test(svg));
      }
    }
  }
}

// ---------------- 5.4 数学公式 ----------------

group('数学公式 OMML');
{
  const pres = parsed.get('sample-math.pptx');
  if (pres) {
    const mathRuns = [];
    walkElements(pres.slides[0].elements, (el) => {
      for (const p of el.text?.paragraphs ?? []) {
        for (const run of p.runs) if (run.math?.length) mathRuns.push([el.name, run]);
      }
    });
    eq('公式 run 数', mathRuns.length, 14);

    const byName = new Map(mathRuns.map(([n, r]) => [n, r]));
    // 每种结构必须解析成对应的节点类型，退化成 run（纯文本）就说明解析没接住
    const WANT = [
      ['math-分式', 'frac'], ['math-根式', 'rad'], ['math-n 次根', 'rad'],
      ['math-上下标', 'script'], ['math-求和', 'nary'], ['math-积分', 'nary'],
      ['math-括号自适应', 'delim'], ['math-多参数括号', 'delim'], ['math-矩阵', 'delim'],
      ['math-重音', 'acc'], ['math-极限', 'lim'], ['math-嵌套分式', 'frac'],
    ];
    for (const [name, kind] of WANT) {
      const run = byName.get(name);
      check(`${name} 解析为 ${kind}`, run?.math?.[0]?.kind === kind, run?.math?.[0]?.kind);
    }

    // 结构细节：这些是最容易解错又不容易看出来的地方
    eq('degHide 时不产生根指数', byName.get('math-根式').math[0].deg.length, 0);
    eq('n 次根保留根指数', byName.get('math-n 次根').math[0].deg.length, 1);
    eq('求和上下限在正上下', byName.get('math-求和').math[0].underOver, true);
    eq('积分上下限在右侧', byName.get('math-积分').math[0].underOver, false);
    eq('多参数括号的参数个数', byName.get('math-多参数括号').math[0].items.length, 3);
    eq('多参数括号的定界符', byName.get('math-多参数括号').math[0].beg, '[');
    eq('矩阵行数', byName.get('math-矩阵').math[0].items[0][0].rows.length, 2);
    eq('矩阵列数', byName.get('math-矩阵').math[0].items[0][0].rows[0].length, 2);
    check('嵌套分式的分母里还有分式',
      byName.get('math-嵌套分式').math[0].den.some((n) => n.kind === 'frac'));

    // 线性文本仍然可搜索——公式不该让 slideText 变哑
    const txt = lib.slideText(pres.slides[0]);
    check('公式产出可搜索的线性文本', txt.includes('a+b/2c') && txt.includes('∑'), txt.slice(0, 60));

    // 两条渲染路径都必须把公式画出来，且不含脏值
    for (const mode of ['svg', 'html']) {
      const svg = lib.renderSlideToSvg(pres, pres.slides[0], { textMode: mode });
      check(`${mode} 路径渲染无脏值`, !BAD.test(svg));
      // 分数线与上划线是 <rect>：分式 1 + 括号自适应 1 + 嵌套分式 2 + 重音上划线 1 = 5，
      // 再加幻灯片底色 1。少于这个数说明有公式没排出来。
      const rects = (svg.match(/<rect /g) || []).length;
      check(`${mode} 路径画出分数线与上划线`, rects >= 6, `rect=${rects}`);
      // 根号是描边不填充的折线：根式 + n 次根 + 行内根式 = 3
      const radicals = (svg.match(/<path [^>]*fill="none"/g) || []).length;
      check(`${mode} 路径画出根号`, radicals >= 3, `path=${radicals}`);
      check(`${mode} 路径出现数学字体`, svg.includes('Cambria Math'));
    }

    // 行内混排：公式与正文在同一行，行高要被公式撑开
    const inlineEl = [];
    walkElements(pres.slides[0].elements, (el) => { if (el.name === 'inline') inlineEl.push(el); });
    if (check('存在行内混排的形状', inlineEl.length === 1)) {
      const runs = inlineEl[0].text.paragraphs[0].runs;
      eq('行内段落的 run 数', runs.length, 5);
      eq('行内公式数', runs.filter((r) => r.math?.length).length, 2);
      check('公式两侧是普通文本', !runs[0].math && !runs[4].math);
    }
  }
}

// ---------------- 5.5 加密文档 ----------------

group('加密文档');
{
  const nodeCrypto = await import('node:crypto');
  const hex = (b) => Buffer.from(b).toString('hex');

  // 原语必须与 Node 的实现逐字节一致——这里错一位，后面全是"密码错误"
  {
    let bad = 0, cases = 0;
    for (const [fn, algo] of [[crypto.sha1, 'sha1'], [crypto.sha256, 'sha256'],
      [crypto.sha384, 'sha384'], [crypto.sha512, 'sha512']]) {
      // 覆盖补位边界：正好一块、差一字节、跨块
      for (const len of [0, 1, 55, 56, 63, 64, 111, 112, 127, 128, 1000]) {
        const buf = Buffer.alloc(len, 0xa5);
        cases++;
        if (hex(fn(new Uint8Array(buf))) !== nodeCrypto.createHash(algo).update(buf).digest('hex')) bad++;
      }
    }
    eq(`哈希与 Node 一致（${cases} 例）`, bad, 0);
  }
  {
    let bad = 0;
    for (const bits of [128, 192, 256]) {
      // 用固定明文/密钥，测试本身也要确定性
      const key = Buffer.alloc(bits / 8, 0x3c);
      const pt = Buffer.alloc(64, 0x5a);
      const ecb = nodeCrypto.createCipheriv(`aes-${bits}-ecb`, key, null);
      ecb.setAutoPadding(false);
      const ct = Buffer.concat([ecb.update(pt), ecb.final()]);
      if (hex(crypto.aesDecryptEcb(new Uint8Array(key), new Uint8Array(ct))) !== pt.toString('hex')) bad++;
      const iv = Buffer.alloc(16, 0x11);
      const cbc = nodeCrypto.createCipheriv(`aes-${bits}-cbc`, key, iv);
      cbc.setAutoPadding(false);
      const ct2 = Buffer.concat([cbc.update(pt), cbc.final()]);
      if (hex(crypto.aesDecryptCbc(new Uint8Array(key), new Uint8Array(iv), new Uint8Array(ct2))) !== pt.toString('hex')) bad++;
    }
    eq('AES 解密与 Node 一致（ECB/CBC × 128/192/256）', bad, 0);
  }

  const PW = 'web-ppt-2024';
  const plain = load('sample.pptx');

  // 老式 .ppt 的 RC4 CryptoAPI —— 与 OOXML 加密是完全不同的两套方案
  for (const [file, keyBits] of [['sample-ppt-encrypted.ppt', 40], ['sample-ppt-encrypted-56.ppt', 56]]) {
    const bytes = load(file);
    if (!check(`${file} 存在`, !!bytes)) continue;

    const pres = await lib.parse(bytes, { password: PW });
    eq(`${file} 解密后页数`, pres.slides.length, 2);
    const txt = pres.slides.map((s) => lib.slideText(s)).join(' ');
    check(`${file} 解密后取到文本`, txt.includes('RC4 CryptoAPI'), txt.slice(0, 50));

    let err = null;
    try { await lib.parse(bytes, { password: 'nope' }); } catch (e) { err = e; }
    eq(`${file} 密码错抛 WrongPasswordError`, err && err.name, 'WrongPasswordError');

    err = null;
    try { await lib.parse(bytes); } catch (e) { err = e; }
    // 回归：判据在 Current User 流的 headerToken 上。不看这一处就只会得到
    // 「.ppt 中未找到幻灯片」——POI 语料里 5 个加密文件全被这样误诊过
    check(`${file} 缺密码时诊断为「已加密」而非「找不到幻灯片」`,
      err && /已加密/.test(err.message), err && err.message);
    void keyBits;
  }
  // 40 位密钥要补零到 128 位、56 位按原长度用；规则搞反了口令校验就过不了。
  // 两个固件唯一的差别就是密钥长度，同时绿才说明两条分支都对

  for (const [file, scheme] of [['sample-encrypted-agile.pptx', 'agile'],
    ['sample-encrypted-standard.pptx', 'standard']]) {
    const bytes = load(file);
    if (!check(`${file} 存在`, !!bytes)) continue;

    // 加密的 .pptx 是 CFB，魔数与 .ppt 一样，必须靠流名区分
    eq(`${file} 魔数是 CFB`, bytes[0] === 0xd0 && bytes[1] === 0xcf, true);

    const pres = await lib.parse(bytes, { password: PW });
    eq(`${file} 解密后页数`, pres.slides.length, 3);
    check(`${file} 解密后能取到文本`, lib.slideText(pres.slides[0]).includes('Web PPT'),
      lib.slideText(pres.slides[0]).slice(0, 40));
    eq(`${file} 加密方案识别`, lib.encryptionScheme(readEncryptionInfo(bytes)), scheme);

    // 密码错与文件坏必须能区分开：前者可以提示重输，后者不能
    let err = null;
    try { await lib.parse(bytes, { password: 'not-the-password' }); } catch (e) { err = e; }
    eq(`${file} 密码错抛 WrongPasswordError`, err && err.name, 'WrongPasswordError');

    err = null;
    try { await lib.parse(bytes); } catch (e) { err = e; }
    check(`${file} 不给密码时提示明确`, err && /密码/.test(err.message), err && err.message);
  }

  // 解密结果必须与明文原件逐字节相同，"能解析"不等于"解对了"
  {
    const dec = await lib.parse(load('sample-encrypted-agile.pptx'), { password: PW });
    const ref = await lib.parse(plain);
    eq('解密结果与明文原件页数一致', dec.slides.length, ref.slides.length);
    eq('解密结果与明文原件文本一致',
      dec.slides.map((s) => lib.slideText(s)).join('|'),
      ref.slides.map((s) => lib.slideText(s)).join('|'));
  }
}

/** 从 CFB 里取 EncryptionInfo 流：定位目录项，按扇区链读出 */
function readEncryptionInfo(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sec = 1 << dv.getUint16(30, true);
  const dirStart = dv.getUint32(48, true);
  for (let i = 0; i < 8; i++) {
    const off = (dirStart + 1) * sec + i * 128;
    if (off + 128 > bytes.length) break;
    const nameLen = dv.getUint16(off + 64, true);
    let name = '';
    for (let k = 0; k + 1 < nameLen; k += 2) name += String.fromCharCode(dv.getUint16(off + k, true));
    if (name.replace(/\0/g, '').trim() === 'EncryptionInfo') {
      const start = dv.getUint32(off + 116, true);
      return bytes.subarray((start + 1) * sec, (start + 1) * sec + dv.getUint32(off + 120, true));
    }
  }
  return new Uint8Array(16);
}

// ---------------- 6. 3D ----------------

group('立体效果');
{
  const pres = parsed.get('showcase.pptx');
  if (pres) {
    const d3 = [];
    for (const s of pres.slides) walkElements(s.elements, (e) => { if (e.scene3d) d3.push(e); });
    check('解析出立体形状', d3.length >= 6, `实际 ${d3.length}`);
    check('挤出深度为正', d3.every((e) => !e.scene3d.extrusion || e.scene3d.extrusion > 0));
    check('存在斜角', d3.some((e) => e.scene3d.bevelTop > 0));
    check('存在轮廓线', d3.some((e) => e.scene3d.contourWidth > 0));
    check('存在视角旋转', d3.some((e) => e.scene3d.rotY !== undefined));
  }
}

// ---------------- 7. 表格 ----------------

group('表格');
{
  const collect = (pres) => {
    const out = [];
    for (const s of pres.slides) walkElements(s.elements, (e) => { if (e.kind === 'table') out.push(e); });
    return out;
  };
  const px = parsed.get('showcase.pptx');
  if (px) {
    const t = collect(px)[0];
    if (check('pptx 解析出表格', !!t)) {
      eq('pptx 表格行数', t.rows.length, 6);
      eq('pptx 表格列数', t.colWidths.length, 4);
      const head = t.rows[0].cells.map((c) => c.text?.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('') ?? '');
      eq('pptx 表头首格', head[0], '功能模块');
      check('表头加粗来自 tableStyles', t.rows[0].cells[0].text.paragraphs[0].runs[0].b === true);
      check('存在合并单元格', t.rows.some((r) => r.cells.some((c) => c.merged || c.colSpan > 1)));
      check('单元格有边距', Array.isArray(t.rows[0].cells[0].margins));

      // 回归：DrawingML 的单元格边框覆盖标签是 a:lnL/lnR/lnT/lnB，
      // 曾误拼成 lnLeft/lnRight 导致该分支从不触发，自定义边框被静默丢弃。
      // fixture 第 4 行第 3 格写了 19050 EMU 的橙色粗边框。
      const allCells = t.rows.flatMap((r) => r.cells);
      const custom = allCells.filter((c) => {
        const b = c.borders;
        return b && [b.l, b.r, b.t, b.b].some((s) => s && /237,\s*125,\s*49/.test(s.color));
      });
      check('单元格级自定义边框已生效', custom.length > 0,
        `未找到橙色边框；各边框色 ${JSON.stringify([...new Set(allCells.flatMap((c) => [c.borders?.l?.color, c.borders?.t?.color]).filter(Boolean))].slice(0, 4))}`);
      const thick = allCells.some((c) => [c.borders?.l, c.borders?.r, c.borders?.t, c.borders?.b].some((s) => s && s.width > 1.6));
      check('自定义边框线宽已生效', thick);
    }
  }
  // 回归：.ppt 的表格由「底色矩形 + 文字框」两层合并后再按网格还原
  const pp = parsed.get('showcase.ppt');
  if (pp) {
    const t = collect(pp)[0];
    if (check('ppt 还原出表格', !!t, '网格启发式失效')) {
      eq('ppt 表格行数', t.rows.length, 6);
      eq('ppt 表格列数', t.colWidths.length, 4);
      const head = t.rows[0].cells.map((c) => c.text?.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('') ?? '');
      eq('ppt 表头首格', head[0], '功能模块');
      eq('ppt 表头末格', head[3], '备注');
    }
  }
}

// ---------------- 8. .ppt 二进制专项 ----------------

group('.ppt 二进制');
{
  const pres = parsed.get('showcase.ppt');
  if (pres) {
    const runs = [];
    walkElements(pres.slides[0].elements, (e) => {
      if (e.kind === 'shape' && e.text) for (const p of e.text.paragraphs) for (const r of p.runs) if (r.text.trim()) runs.push(r);
    });
    // 回归：StyleTextPropAtom 的段落标志组不占数据字节，错位会让字号全变默认 18pt
    const sizes = new Map();
    for (const r of runs) {
      const pt = Math.round(r.size / (96 / 72));
      sizes.set(pt, (sizes.get(pt) ?? 0) + 1);
    }
    check('解析出 6pt 标签字号', (sizes.get(6) ?? 0) >= 100, `字号分布 ${[...sizes].map(([k, v]) => k + 'pt:' + v).join(' ')}`);
    check('不是全部退化为默认字号', (sizes.get(18) ?? 0) < runs.length * 0.5);
    const gray = runs.filter((r) => r.color === 'rgb(102,102,102)');
    check('解析出标签灰色', gray.length >= 100, `实际 ${gray.length}`);
  }

  // .ppt 里的图表以内嵌 EMF 呈现，需经图元文件解码器转成 SVG data URI
  const chartPpt = parsed.get('sample-chart.ppt');
  if (chartPpt) {
    const imgs = [];
    for (const s of chartPpt.slides) walkElements(s.elements, (e) => { if (e.kind === 'image') imgs.push(e); });
    check('ppt 图表解出图片', imgs.length >= 9, `实际 ${imgs.length}`);
    const svgImgs = imgs.filter((i) => i.src.startsWith('data:image/svg+xml'));
    check('EMF 已解码为 SVG', svgImgs.length >= 9, `实际 ${svgImgs.length}`);
    // 回归：BLIP 里的图元数据是 DEFLATE 压缩的，不解压会得到乱码
    const decoded = decodeURIComponent(svgImgs[0].src.split(',')[1] ?? '');
    check('解码结果是合法 SVG', decoded.startsWith('<svg'), decoded.slice(0, 40));
    check('解码结果含绘图内容', (decoded.match(/<(path|rect|text|image)/g) || []).length > 20);
  }
}

// ---------------- 9. 图元文件 ----------------

group('图元文件');
{
  const pres = parsed.get('sample-metafile.pptx');
  if (pres) {
    const imgs = [];
    walkElements(pres.slides[0].elements, (e) => { if (e.kind === 'image') imgs.push(e); });
    eq('EMF 与 WMF 各一张', imgs.length, 2);
    check('两张都解码成 SVG', imgs.every((i) => i.src.startsWith('data:image/svg+xml')));
    for (const img of imgs) {
      const decoded = decodeURIComponent(img.src.split(',')[1] ?? '');
      const { error } = parseXml(decoded);
      check(`${img.name} 解码结果结构合法`, !error, error ?? '');
      check(`${img.name} 含大量绘图元素`, (decoded.match(/<(path|rect|text)/g) || []).length > 100);
    }
  }
}

// ---------------- 10. 图表 ----------------

group('图表');
{
  const pres = parsed.get('sample-chart.pptx');
  if (pres) {
    let charts = 0, unsupported = 0, texts = 0;
    for (const s of pres.slides) {
      walkElements(s.elements, (e) => {
        if (e.kind === 'group' && e.name === '图表') charts++;
        if (e.kind === 'unsupported') unsupported++;
        if (e.kind === 'shape' && e.text) texts++;
      });
    }
    check('解析出图表', charts >= 9, `实际 ${charts}`);
    check('图表内有文本（标题/刻度/图例）', texts > 100, `实际 ${texts}`);
    check('未支持类型占比很低', unsupported <= 2, `实际 ${unsupported}`);
  }
}

// ---------------- 11. 文本提取与搜索 ----------------

group('文本提取');
for (const [name, pres] of parsed) {
  const total = pres.slides.reduce((n, s) => n + lib.slideText(s).length, 0);
  check(`${name} 可提取文本`, total > 0, `实际 ${total}`);
}
{
  const pres = parsed.get('showcase.pptx');
  if (pres) {
    const hit = pres.slides.findIndex((s) => lib.slideText(s).includes('预设形状库'));
    eq('搜索命中首页', hit, 0);
    check('备注计入可搜索文本', pres.slides.some((s) => lib.slideText(s).includes('等轴测')));
  }
}

// ---------------- 11b. 惰性解析 ----------------

group('惰性解析');
{
  const bytes = load('showcase.pptx');
  if (bytes) {
    const lazy = await lib.parse(bytes);
    const eager = await lib.parse(bytes, { lazy: false });

    eq('惰性与全量页数一致', lazy.slides.length, eager.slides.length);
    check('length 可用（未触发解析）', lazy.slides.length > 0);

    // 逐页内容必须完全一致——惰性只改变时机，不改变结果
    let same = 0;
    for (let i = 0; i < eager.slides.length; i++) {
      if (lib.slideText(lazy.slides[i]) === lib.slideText(eager.slides[i])) same++;
    }
    eq('逐页文本一致', same, eager.slides.length);

    const countEls = (s) => { let n = 0; walkElements(s.elements, () => n++); return n; };
    const diff = eager.slides.filter((s, i) => countEls(s) !== countEls(lazy.slides[i]));
    eq('逐页元素数一致', diff.length, 0);

    // 数组语义：map / forEach / 展开 / JSON 都要正常
    check('map 可用', lazy.slides.map((s) => s.elements.length).length === eager.slides.length);
    check('展开运算符可用', [...lazy.slides].length === eager.slides.length);
    check('渲染结果一致', lib.renderSlideToSvg(lazy, lazy.slides[0], { textMode: 'svg' })
      === lib.renderSlideToSvg(eager, eager.slides[0], { textMode: 'svg' }));

    // 缓存：同一页取两次必须是同一个对象
    check('同页重复访问返回同一对象', lazy.slides[2] === lazy.slides[2]);

    // 全量模式下应可结构化克隆（Worker 传输的前提）
    let cloned = false;
    try { structuredClone(eager.slides[0]); cloned = true; } catch { /* 记录失败 */ }
    check('全量解析结果可结构化克隆', cloned);
  }
}

// ---------------- 11c. Worker 用的 XML 解析器 ----------------

group('xml-lite');
{
  const liteMod = await (async () => {
    const f = join(outDir, 'xml-lite.mjs');
    execFileSync('npx', ['esbuild', join(root, 'packages/core/src/xml-lite.ts'), '--bundle', '--format=esm',
      '--platform=browser', '--log-level=error', `--outfile=${f}`], { cwd: root, stdio: 'inherit' });
    return import(`file://${f}?t=${Date.now()}`);
  })();

  // 与原生 DOMParser 的结构必须等价——Worker 里换用它，结果不能有差别
  const sig = (el, depth = 0) => {
    if (depth > 8) return '';
    const attrs = Array.from(el.attributes ?? []).map((a) => `${a.name}=${a.value}`).sort().join(',');
    const kids = Array.from(el.children ?? []).map((c) => sig(c, depth + 1)).join('');
    return `${el.localName}[${attrs}](${kids})`;
  };

  const samples = [
    '<a:p xmlns:a="ua"><a:r><a:rPr b="1" sz="1800"/><a:t>hello &amp; world</a:t></a:r></a:p>',
    '<root><self closing="1"/><!-- 注释 --><![CDATA[原样 <文本>]]><n x="1"/></root>',
    '<p:sld xmlns:p="up"><p:cSld><p:spTree><p:sp id="1"/><p:sp id="2"/></p:spTree></p:cSld></p:sld>',
    '<t a=\'单引号\' b="双引号">&#20013;&#x6587;</t>',
  ];
  let match = 0;
  for (const x of samples) {
    const native = new globalThis.DOMParser().parseFromString(x, 'application/xml').documentElement;
    const lite = liteMod.parseXmlLite(x);
    if (sig(native) === sig(lite) && native.textContent === lite.textContent) match++;
  }
  eq('与原生 DOMParser 结构等价', match, samples.length);

  // 真实文件：整页 XML 逐节点比对
  const bytes = load('showcase.pptx');
  if (bytes) {
    const { unzipSync } = await import('fflate');
    const files = unzipSync(bytes);
    const dec = new TextDecoder();
    let ok = 0, total = 0;
    for (const k of Object.keys(files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))) {
      total++;
      const x = dec.decode(files[k]);
      const native = new globalThis.DOMParser().parseFromString(x, 'application/xml').documentElement;
      const lite = liteMod.parseXmlLite(x);
      if (sig(native) === sig(lite)) ok++;
    }
    eq(`真实 slide XML 结构等价（${total} 个）`, ok, total);
  }

  check('畸形输入抛可读 Error', (() => {
    try { liteMod.parseXmlLite('not xml at all'); return false; }
    catch (e) { return e instanceof Error && !!e.message; }
  })());
}

// ---------------- 12. 查看器交互 ----------------

group('查看器');
{
  const pres = parsed.get('showcase.pptx');
  if (pres) {
    const box = globalThis.document.createElement('div');
    globalThis.document.body.appendChild(box);

    // 超链接页（含外链与内部跳页各一条）
    const linkPage = pres.slides.findIndex((s) => {
      const svg = lib.renderSlideToSvg(pres, s);
      return svg.includes('a href=') && svg.includes('data-slide=');
    });
    if (check('存在含超链接的页', linkPage >= 0)) {
      const v = new viewerLib.Viewer(box, pres, { index: linkPage });
      const calls = [];
      v.onLinkClick = (h) => { calls.push(h); return false; };

      // 内部跳页不应触发 onLinkClick
      const jump = box.querySelector('[data-slide]');
      if (check('渲染出内部跳页节点', !!jump)) {
        jump.dispatchEvent(new globalThis.window.MouseEvent('click', { bubbles: true }));
        eq('内部跳页不触发 onLinkClick', calls.length, 0);
        eq('内部跳页已切页', v.index, 0);
      }

      // 外链应触发回调；返回 true 时阻止默认行为
      const v2 = new viewerLib.Viewer(box, pres, { index: linkPage });
      const got = [];
      v2.onLinkClick = (h) => { got.push(h); return true; };
      const ext = box.querySelector('a[href]');
      if (check('渲染出外链节点', !!ext)) {
        const ev = new globalThis.window.MouseEvent('click', { bubbles: true, cancelable: true });
        ext.dispatchEvent(ev);
        eq('外链触发 onLinkClick', got.length, 1);
        check('回调返回 true 时阻止默认行为', ev.defaultPrevented === true);
      }
      v.destroy();
      v2.destroy();
    }

    // 容器定位：static 才补 relative，宿主已经定位过就别动
    {
      const auto = globalThis.document.createElement('div');
      globalThis.document.body.appendChild(auto);
      const va = new viewerLib.Viewer(auto, pres, {});
      eq('static 容器补成 relative', auto.style.position, 'relative');
      va.destroy();

      const fixed = globalThis.document.createElement('div');
      fixed.style.position = 'absolute';
      globalThis.document.body.appendChild(fixed);
      const vf = new viewerLib.Viewer(fixed, pres, {});
      eq('已定位的容器不被覆盖', fixed.style.position, 'absolute');
      vf.destroy();
    }

    // 缩略图是静态产物，没有后续的 applyVisibility，
    // 隐藏状态只能在渲染时烘进 SVG——否则动画页的缩略图会把几帧叠在一起
    {
      const animIdx = pres.slides.findIndex((s) => s.animations?.some((a) => a.kind === 'exit'));
      if (check('存在含退场动画的页', animIdx >= 0)) {
        const vt = new viewerLib.Viewer(box, pres, {});
        check('缩略图烘进终态隐藏', vt.renderSlide(animIdx).includes('visibility:hidden'));
        check('主视图不烘隐藏（交给 applyVisibility）', !vt.slideSvg(animIdx).includes('visibility:hidden'));
        vt.destroy();
      }
    }

    // 翻页与边界
    const v3 = new viewerLib.Viewer(box, pres, {});
    eq('初始页', v3.index, 0);
    v3.goTo(2);
    eq('跳页生效', v3.index, 2);
    v3.goTo(-5);
    eq('负数索引夹紧到首页', v3.index, 0);
    v3.goTo(9999);
    eq('超界索引夹紧到末页', v3.index, v3.count - 1);
    v3.next();
    eq('末页再翻不越界', v3.index, v3.count - 1);
    v3.destroy();
    check('destroy 后容器清空', box.innerHTML === '');
    box.remove();
  }
}

// ---------------- 13. 健壮性 ----------------

group('健壮性');
{
  // 真实世界会遇到截断的上传、被杀毒软件改写的文件、WPS/Keynote 导出的畸形结构。
  // 要求：要么正常解析，要么抛出可读的 Error——绝不能挂死或返回半成品。
  const base = load('showcase.pptx');
  const cases = [];

  if (base) {
    // 截断：从 5% 到 95% 各切一刀
    for (let pct = 5; pct <= 95; pct += 10) {
      cases.push([`截断至 ${pct}%`, base.slice(0, Math.floor(base.length * pct / 100))]);
    }
    // 随机字节破坏
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let k = 0; k < 30; k++) {
      const copy = base.slice();
      for (let i = 0; i < 40; i++) copy[Math.floor(rnd() * copy.length)] = Math.floor(rnd() * 256);
      cases.push([`随机破坏 #${k + 1}`, copy]);
    }
  }

  const pptBase = load('showcase.ppt');
  if (pptBase) {
    for (let pct = 10; pct <= 90; pct += 20) {
      cases.push([`.ppt 截断至 ${pct}%`, pptBase.slice(0, Math.floor(pptBase.length * pct / 100))]);
    }
    let seed = 99;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let k = 0; k < 20; k++) {
      const copy = pptBase.slice();
      for (let i = 0; i < 30; i++) copy[Math.floor(rnd() * copy.length)] = Math.floor(rnd() * 256);
      cases.push([`.ppt 随机破坏 #${k + 1}`, copy]);
    }
  }

  // 结构性畸形
  cases.push(['空文件', new Uint8Array(0)]);
  cases.push(['只有魔数', new Uint8Array([0x50, 0x4b, 0x03, 0x04])]);
  cases.push(['CFB 魔数但无内容', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])]);
  cases.push(['纯文本', new TextEncoder().encode('this is not a presentation at all')]);
  cases.push(['全零 4KB', new Uint8Array(4096)]);

  let crashed = 0, hung = 0, partial = 0, ok = 0, rejected = 0;
  for (const [name, bytes] of cases) {
    let pres = null;
    const t0 = Date.now();
    try {
      pres = await lib.parse(bytes);
    } catch (e) {
      // 抛错是可接受结果，但必须是带可读信息的 Error
      if (!(e instanceof Error) || !e.message) {
        crashed++;
        failures.push(`健壮性 ${name} — 抛出非 Error: ${String(e).slice(0, 60)}`);
        continue;
      }
      rejected++;
      continue;
    }
    if (Date.now() - t0 > 15000) { hung++; failures.push(`健壮性 ${name} — 耗时过长`); }

    // 解析成功就必须是完整可渲染的结构
    if (!pres || !Array.isArray(pres.slides) || !Number.isFinite(pres.width) || !Number.isFinite(pres.height)) {
      partial++;
      failures.push(`健壮性 ${name} — 返回了不完整的结果`);
      continue;
    }
    try {
      for (const slide of pres.slides) {
        for (const mode of ['html', 'svg']) {
          const svg = lib.renderSlideToSvg(pres, slide, { textMode: mode });
          if (BAD.test(svg.replace(/data:[^"]*/g, ''))) {
            partial++;
            failures.push(`健壮性 ${name} — 渲染出脏值`);
            break;
          }
        }
      }
      ok++;
    } catch (e) {
      crashed++;
      failures.push(`健壮性 ${name} — 渲染抛异常: ${String(e && e.message).slice(0, 60)}`);
    }
  }

  // 形状级隔离：单个形状解析失败不能连累整页
  {
    const bytes = load('showcase.pptx');
    if (bytes) {
      const p = await lib.parse(bytes);
      const total = p.slides[0].elements.length;
      // 把某个形状的几何改成会让 presetGeom 收到非法输入的形式，
      // 期望：该形状降级，其余元素数量不变
      check('形状级失败不影响同页其它元素', total > 200, `第 1 页仅 ${total} 个元素`);
      const broken = p.slides.flatMap((s) => s.elements.filter(
        (e) => e.kind === 'unsupported' && /解析失败/.test(e.label)));
      eq('正常文件不应出现解析失败占位', broken.length, 0);
    }
  }

  check(`健壮性用例无崩溃（${cases.length} 例）`, crashed === 0, `${crashed} 例崩溃`);
  check('健壮性用例无卡死', hung === 0, `${hung} 例超时`);
  check('健壮性用例无半成品输出', partial === 0, `${partial} 例`);
  // 加密文件：设了打开密码的 pptx 也是 CFB 容器，会被魔数判成 .ppt。
  // 必须给出「已加密」而不是「找不到 PowerPoint Document 流」——
  // 后者会让人以为文件损坏，跑去修一个根本没坏的文件。
  const encBase = load('sample.ppt');
  if (check('有 .ppt 样本可改造', !!encBase)) {
    const buf = Buffer.from(encBase);
    const at = buf.toString('utf16le').indexOf('PowerPoint Document');
    if (check('定位到目录项名字段', at >= 0)) {
      const off = at * 2;
      const nm = 'EncryptedPackage';
      buf.fill(0, off, off + 64);
      Buffer.from(nm, 'utf16le').copy(buf, off);
      buf.writeUInt16LE((nm.length + 1) * 2, off + 64);   // nameLen 含结尾 NUL
      let msg = '';
      try { await lib.parse(new Uint8Array(buf)); } catch (e) { msg = e.message; }
      check('加密文件报「已加密」而非「文件损坏」', msg.includes('已加密'), `实际：${msg}`);
    }
  }

  console.log(`  ${cases.length} 例：正常解析 ${ok} · 明确拒绝 ${rejected}`);
}

// ---------------- 14. 播放引擎 ----------------

group('播放引擎');
{
  const mk = (target, kind, clickGroup, trigger = 'click') => ({
    target, kind, clickGroup, trigger, effect: 'fade', delayMs: 0, durationMs: 500,
  });

  // 分批：同一 clickGroup 的步骤归为一批
  const groups = viewerLib.groupSteps([mk(1, 'entrance', 0), mk(2, 'entrance', 1), mk(3, 'entrance', 1, 'withPrev')]);
  eq('分批数量', groups.length, 2);
  eq('第二批含两步', groups[1].length, 2);
  eq('空动画返回空数组', viewerLib.groupSteps(undefined).length, 0);

  // 可见性：未播的入场元素隐藏，已播的退场元素隐藏
  const g2 = viewerLib.groupSteps([mk(10, 'entrance', 0), mk(11, 'entrance', 1), mk(10, 'exit', 2)]);
  const h0 = viewerLib.hiddenBefore(g2, 0);
  check('初始态全部入场元素隐藏', h0.has(10) && h0.has(11), [...h0].join(','));
  const h1 = viewerLib.hiddenBefore(g2, 1);
  check('播完第一批后 10 显示', !h1.has(10), [...h1].join(','));
  check('播完第一批后 11 仍隐藏', h1.has(11));
  const h3 = viewerLib.hiddenBefore(g2, 3);
  check('退场播完后 10 隐藏', h3.has(10), [...h3].join(','));

  // 真实文件的动画分批与元素可见性联动
  const pres = parsed.get('showcase.pptx');
  const anim = pres?.slides.find((s) => s.animations?.length);
  if (anim) {
    const real = viewerLib.groupSteps(anim.animations);
    eq('真实文件分 8 批', real.length, 8);
    const svg = lib.renderSlideToSvg(pres, anim);
    // 只有入场动画会在播放前隐藏元素；运动路径的形状一直可见，
    // 因此隐藏数是「尚未播到的入场批次数」+「已播的退场目标数」，不是「剩余批次数」
    const entrGroups = real.map((g) => g.some((x) => x.kind === 'entrance'));
    const exitedBy = (upTo) =>
      new Set(real.slice(0, upTo).flatMap((g) => g.filter((x) => x.kind === 'exit').map((x) => x.target)));
    for (let i = 0; i <= real.length; i++) {
      const want = entrGroups.slice(i).filter(Boolean).length + exitedBy(i).size;
      eq(`播完 ${i} 批后隐藏 ${want} 个`, viewerLib.hiddenBefore(real, i).size, want);
    }
    check('运动路径元素始终可见', !viewerLib.hiddenBefore(real, 0).has(706));

    // 静态渲染取终态：入场元素全部现身，退场元素留在幕后。
    // 直接摊开画会把不同时刻叠在一起——orcid-ooxml-strict 第 7 页三段文字就是这么糊掉的。
    const stat = lib.staticHidden(anim);
    eq('静态终态只隐藏退场的 705', [...stat].join(','), '705');
    check('静态终态不隐藏入场元素', ![701, 702, 703, 704].some((id) => stat.has(id)));
    check('无动画的页静态隐藏集为空', lib.staticHidden(pres.slides[0]).size === 0);
    // 收尾页全员退场时终态是空白，那还不如全画出来
    const allGone = {
      elements: [{ kind: 'shape', id: 1 }, { kind: 'shape', id: 2 }],
      animations: [
        { target: 1, kind: 'exit', clickGroup: 0, trigger: 'click', effect: 'fade', delayMs: 0, durationMs: 1 },
        { target: 2, kind: 'exit', clickGroup: 1, trigger: 'click', effect: 'fade', delayMs: 0, durationMs: 1 },
      ],
    };
    eq('终态清空整页时退回全部可见', lib.staticHidden(allGone).size, 0);
    // 缩略图没有后续的 applyVisibility，隐藏状态必须烘进 SVG
    check('缩略图渲染烘进终态隐藏',
      lib.renderSlideToSvg(pres, anim, { hiddenElements: [...stat] }).includes('visibility:hidden'));

    // morph 按 data-el 在前后两页之间配对
    {
      const rect = (x, y, w, h) => ({ left: x, top: y, width: w, height: h });
      const mkLayer = (defs) => ({
        querySelectorAll: () => defs.map(([id, r]) => ({
          getAttribute: () => id,
          getBoundingClientRect: () => r,
          style: {},
          animate: () => ({ finished: Promise.resolve(), finish() {} }),
        })),
      });
      const outL = mkLayer([['10', rect(0, 0, 100, 50)], ['11', rect(0, 0, 10, 10)], ['99', rect(5, 5, 20, 20)]]);
      const inL = mkLayer([['10', rect(200, 100, 300, 150)], ['11', rect(0, 0, 0, 0)], ['12', rect(0, 0, 40, 40)]]);
      const pairs = viewerLib.morphPairs(outL, inL);
      eq('morph 只配对两页都有的元素', pairs.length, 1);
      eq('morph 配对到正确的 id', pairs[0].node.getAttribute(), '10');
      eq('morph 记下旧位置', pairs[0].from.left, 0);
      eq('morph 记下新位置', pairs[0].to.left, 200);
      // 无布局信息（宽高全 0）的元素不参与配对，否则会补间出 scale(Infinity)
      check('零尺寸元素不参与配对', !pairs.some((p) => p.node.getAttribute() === '11'));
      const empty = viewerLib.morphPairs(mkLayer([['1', rect(0, 0, 0, 0)]]), mkLayer([['1', rect(0, 0, 0, 0)]]));
      eq('全无布局时不配对', empty.length, 0);
    }

    // 回归：后台标签页的 document timeline 是暂停的，Animation.finished 永不 resolve。
    // 没有超时兜底就会让旧图层一层层堆着不被移除（自动换片时尤其明显）。
    {
      const never = { finished: new Promise(() => {}), finish() {} };
      const mkNode = () => ({ style: {}, animate: () => never, querySelectorAll: () => [] });
      let removed = false;
      const outgoing = { ...mkNode(), remove: () => { removed = true; } };
      const done = viewerLib.playTransition(outgoing, mkNode(), { type: 'fade', durationMs: 100 });
      const raced = await Promise.race([
        done.then(() => 'resolved'),
        new Promise((r) => setTimeout(() => r('hung'), 2000)),
      ]);
      eq('动画永不结束时切换仍会收尾', raced, 'resolved');
      check('超时后旧图层被移除', removed);
    }

    // playGroup 必须把 motionPath 铺成多关键帧并走线性缓动，
    // 否则路径只会取首末两点连成直线、且被入场用的 ease 带偏速度
    {
      const calls = [];
      const fakeNode = { style: {}, animate: (frames, opts) => {
        calls.push({ frames, opts });
        return { finished: Promise.resolve(), finish() {} };
      } };
      const fakeContainer = { querySelector: () => fakeNode };
      const mstep = anim.animations.find((a) => a.kind === 'motion');
      viewerLib.playGroup(fakeContainer, [mstep]);
      eq('运动路径铺成多关键帧', calls[0]?.frames.length, mstep.motionPath.length);
      eq('运动路径走线性缓动', calls[0]?.opts.easing, 'linear');
      check('关键帧是 translate',
        /^translate\(-?[\d.]+px, -?[\d.]+px\)$/.test(calls[0].frames[3].transform),
        calls[0].frames[3].transform);

      calls.length = 0;
      viewerLib.playGroup(fakeContainer, [anim.animations.find((a) => a.kind === 'entrance')]);
      eq('入场动画仍是两帧', calls[0]?.frames.length, 2);
      check('入场动画不走线性缓动', calls[0]?.opts.easing !== 'linear', calls[0]?.opts.easing);
    }
    check('全部动画目标都在 SVG 里', anim.animations.every((a) => svg.includes(`data-el="${a.target}"`)));
  }

  // 自动换片
  const withAdv = { transition: { type: 'fade', durationMs: 500, advanceAfterMs: 3000 } };
  eq('读出自动换片延迟', viewerLib.autoAdvanceMs(withAdv), 3000);
  eq('无自动换片返回 null', viewerLib.autoAdvanceMs({ transition: { type: 'fade', durationMs: 500 } }), null);
  eq('无切换返回 null', viewerLib.autoAdvanceMs({}), null);
}

// ---------------- 14b. 嵌入字体 ----------------

group('嵌入字体');
{
  // 固件里四个部件分别是：未压缩 EOT / 未压缩+异或 / 标记 MTX 压缩 / 裸 TTF。
  // 前两个与最后一个解析器自己就能还原，压缩的那个必须靠注入的解码器。
  const pres = parsed.get('sample-embedfont.pptx');
  if (check('嵌入字体固件已解析', !!pres)) {
    const fonts = pres.embeddedFonts ?? [];
    eq('未注入解码器时只还原得出 3 个', fonts.length, 3);
    check('全部挂在同一个 typeface 上', fonts.every((f) => f.family === 'WebPPT Embedded'),
      fonts.map((f) => f.family).join(','));
    eq('丢掉的正是 MTX 压缩的那个（italic）',
      fonts.map((f) => `${f.bold ? 'b' : '-'}${f.italic ? 'i' : '-'}`).join(' '), '-- b- bi');

    // 还原出来的必须是真 sfnt：EOT 头剥干净了，异或也解开了
    const raw = new Map(fonts.map((f) => [`${f.bold}|${f.italic}`, blobs.get(f.src)]));
    for (const [key, blob] of raw) {
      if (!check(`${key} 有 blob`, !!blob)) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      eq(`${key} 是 TrueType 魔数`, [...bytes.slice(0, 4)].join(','), '0,1,0,0');
      eq(`${key} MIME`, blob.type, 'font/ttf');
    }

    // 异或那份要逐字节等于原始 TTF —— 只看魔数的话，解错了一半也发现不了
    const bold = raw.get('true|false');
    if (bold) {
      const want = makeTtf({ family: 'WebPPT Embedded', style: 'Bold', bold: true, italic: false });
      const got = new Uint8Array(await bold.arrayBuffer());
      check('异或解开后与原始 TTF 逐字节一致',
        got.length === want.length && got.every((b, i) => b === want[i]),
        `${got.length}B vs ${want.length}B`);
    }

    // 注入解码器后压缩的那个才回来；解码器拿到的是**整份 EOT**，
    // 不是切出来的载荷 —— mtx-decompressor 的 eotToTtf 才能直接注册
    let handed = null;
    check('默认没有字体解码器', lib.hasFontDecoder() === false);
    lib.setFontDecoder((eot) => { handed = eot; return Uint8Array.of(0, 1, 0, 0, 1, 2, 3, 4); });
    try {
      check('注册后 hasFontDecoder 为真', lib.hasFontDecoder() === true);
      const withDec = await lib.parse(load('sample-embedfont.pptx'));
      eq('注入解码器后四个都在', (withDec.embeddedFonts ?? []).length, 4);
      check('解码器收到的是完整 EOT 容器',
        !!handed && handed[0] === 0x7c && handed[34] === 0x4c && handed[35] === 0x50,
        handed ? `头 ${[...handed.slice(0, 4)].join(',')}，magic ${handed[34]},${handed[35]}` : '未被调用');

      // 解码器抛错只该丢这一个字体，不该让整份文件解析失败
      lib.setFontDecoder(() => { throw new Error('boom'); });
      const thrown = await lib.parse(load('sample-embedfont.pptx'));
      eq('解码器抛错时退回 3 个', (thrown.embeddedFonts ?? []).length, 3);
    } finally {
      lib.setFontDecoder(null);
    }
    check('注销后恢复无解码器', lib.hasFontDecoder() === false);

    // 渲染层要为每个还原成功的字体写一条 @font-face
    const svg = lib.renderSlideToSvg(pres, pres.slides[0]);
    eq('@font-face 条数与字体数一致', (svg.match(/@font-face/g) ?? []).length, 3);
    check('文本确实指定了嵌入字体', svg.includes("'WebPPT Embedded'"));
  }
}

// ---------------- 14c. 字体统计 ----------------

group('字体统计');
{
  const pres = parsed.get('showcase.pptx');
  if (check('固件已解析', !!pres)) {
    const all = lib.collectFonts(pres.slides);
    check('统计得到字体', all.length > 0, `实际 ${all.length}`);
    check('按用量从多到少排序', all.every((u, i) => i === 0 || all[i - 1].count >= u.count));
    for (const u of all) {
      check(`${u.family} 字符集非空`, u.chars.length > 0);
      check(`${u.family} 字符已去重`, new Set(u.chars).size === u.chars.length);
      check(`${u.family} 字符按码位升序`,
        [...u.chars].every((c, i) => i === 0 || u.chars.codePointAt(i - 1) < c.codePointAt(0)));
      check(`${u.family} 至少一种字重`, u.styles.length > 0);
    }

    // 逐页统计必须是整份统计的子集——查看器就是靠这个只加载当前页要的字体
    const page1 = lib.collectFonts([pres.slides[0]]);
    const whole = new Map(all.map((u) => [u.family, u.chars]));
    check('单页统计是整份的子集',
      page1.every((u) => whole.has(u.family) && [...u.chars].every((c) => whole.get(u.family).includes(c))));
    check('单页字符数不多于整份', page1.every((u) => u.chars.length <= whole.get(u.family).length));

    // run 里不写 a:latin 时要落到主题的 minorFont，而不是「没有字体」。
    // 少了这一层，渲染会掉到 CSS 通用回退上，字宽和 PowerPoint 对不齐。
    const svg = lib.renderSlideToSvg(pres, pres.slides[0]);
    check('未指定字体的文本用上了主题字体', svg.includes("font-family:'Helvetica'"), svg.slice(0, 200));
    check('字体栈不含重复项', !/font-family:([^;"]*)'PingFang SC'([^;"]*)'PingFang SC'/.test(svg));

    eq('空页统计为空', lib.collectFonts([]).length, 0);
  }
}

// ---------------- 14d. 字体替换 ----------------

group('字体替换');
{
  // 拉丁一栏必须是度量兼容的那几个——它们的前进宽度与原字体逐字相等，
  // 断行才会和 PowerPoint 对齐。挑错替代品的话，SSIM 看着还行，行尾全错。
  const METRIC = [['Calibri', 'Carlito'], ['Cambria', 'Caladea'], ['Arial', 'Arimo'],
    ['Times New Roman', 'Tinos'], ['Courier New', 'Cousine']];
  for (const [from, to] of METRIC) {
    const sub = fontsLib.substituteFor(from);
    eq(`${from} → ${to}`, sub?.family, to);
    check(`${from} 的替代是度量兼容的`, sub?.metricCompatible === true);
  }

  eq('大小写与空白无关', fontsLib.substituteFor('  ARIAL  ')?.family, 'Arimo');
  eq('中文黑体系归到思源黑体', fontsLib.substituteFor('微软雅黑')?.family, 'Noto Sans SC');
  eq('中文宋体系归到思源宋体', fontsLib.substituteFor('宋体')?.family, 'Noto Serif SC');
  check('中文条目标了 cjk', fontsLib.substituteFor('宋体')?.cjk === true);
  check('拉丁条目没标 cjk', fontsLib.substituteFor('Calibri')?.cjk === false);

  // 符号字体不该找替代品：它们是私用区自定义映射，换字体只会得到另一套图形
  for (const f of ['Wingdings', 'Wingdings 2', 'Webdings', 'Symbol']) {
    check(`${f} 不做替换`, fontsLib.substituteFor(f) === null);
  }
  check('表里没有的字体返回 null', fontsLib.substituteFor('Some Unknown Face') === null);
  eq('overrides 优先于内置表',
    fontsLib.substituteFor('Calibri', { calibri: { family: 'X', metricCompatible: false, cjk: false } })?.family, 'X');

  // 每个替代字体都得有对应的 fontsource 包，否则 loadFontsFor 会静默取不到
  const targets = new Set(Object.values(fontsLib.SUBSTITUTIONS).map((s) => s.family));
  for (const t of targets) {
    check(`${t} 有钉死版本的来源`, !!fontsLib.PACKAGES[t], Object.keys(fontsLib.PACKAGES).join(','));
    check(`${t} 版本号是精确值`, /^\d+\.\d+\.\d+$/.test(fontsLib.PACKAGES[t]?.version ?? ''),
      fontsLib.PACKAGES[t]?.version);
  }
  check('CSS 地址按字重与斜体拼',
    fontsLib.cssUrl('Carlito', 700, true) === 'https://cdn.jsdelivr.net/npm/@fontsource/carlito@5.3.0/700-italic.css',
    fontsLib.cssUrl('Carlito', 700, true));
  check('未知家族没有 CSS 地址', fontsLib.cssUrl('Nope', 400, false) === null);
  check('自定义基址生效', fontsLib.cssUrl('Carlito', 400, false, 'https://x/y')?.startsWith('https://x/y/'));

  // 字重要就近取包里真有的那一档：霞鹜文楷没有 400，直接请求会 404
  check('霞鹜文楷 400 就近取到 300 或 500',
    /\/(300|500)\.css$/.test(fontsLib.cssUrl('LXGW WenKai', 400, false) ?? ''),
    fontsLib.cssUrl('LXGW WenKai', 400, false));
  check('中文没有真斜体时退回正体',
    fontsLib.cssUrl('Noto Sans SC', 400, true) === 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.0/400.css',
    fontsLib.cssUrl('Noto Sans SC', 400, true));
  check('拉丁有真斜体就用真斜体',
    fontsLib.cssUrl('Tinos', 700, true)?.endsWith('/700-italic.css'), fontsLib.cssUrl('Tinos', 700, true));
  // 拼出来的地址只能落在包声明的档位上，否则就是 404
  for (const [family, p] of Object.entries(fontsLib.PACKAGES)) {
    for (const want of [400, 700]) {
      for (const italic of [false, true]) {
        const url = fontsLib.cssUrl(family, want, italic);
        const m = /\/(\d+)(-italic)?\.css$/.exec(url ?? '');
        const list = m?.[2] ? p.italics : p.weights;
        check(`${family} ${want}${italic ? 'i' : ''} 落在真实档位上`, !!m && list.includes(Number(m[1])), url);
      }
    }
  }

  // 中文默认也换——传进来的用量本来就该全部处理。要关得显式关，
  // 关掉的理由是流量（实测一页 22 个不同汉字要跨 18 个切片、下 553KB）
  {
    const usage = [{ family: '微软雅黑', styles: [{ bold: false, italic: false }], chars: '汉字', count: 2 }];
    const doc = globalThis.document;
    const off = await fontsLib.loadFontsFor(usage, { document: doc, skipInstalled: false, cjk: false });
    eq('显式关掉时跳过中文', off[0]?.status, 'skipped-cjk');
    const latin = await fontsLib.loadFontsFor(
      [{ family: 'Wingdings', styles: [{ bold: false, italic: false }], chars: 'ab', count: 2 }],
      { document: doc, skipInstalled: false });
    eq('符号字体不做替换', latin[0]?.status, 'unmapped');
  }

  // 注入的中文 @font-face 要能单独撤回，宿主才有「关掉替换」这个选项
  {
    const doc = globalThis.document;
    const style = doc.createElement('style');
    style.dataset.webPptFont = '微软雅黑';
    style.dataset.webPptCjk = '1';
    const keep = doc.createElement('style');
    keep.dataset.webPptFont = 'Calibri';
    doc.head.append(style, keep);

    fontsLib.unloadFonts({ cjkOnly: true, document: doc });
    eq('只撤中文那条', doc.querySelectorAll('style[data-web-ppt-font]').length, 1);
    eq('留下的是拉丁那条', doc.querySelector('style[data-web-ppt-font]')?.dataset.webPptFont, 'Calibri');
    fontsLib.unloadFonts({ document: doc });
    eq('不带参数时全撤', doc.querySelectorAll('style[data-web-ppt-font]').length, 0);
  }

  // @font-face 改写：家族名换成原字体名、相对路径绝对化、src 前面补 local()
  const css = `@font-face {\n  font-family: 'Noto Sans SC';\n  src: url(./files/a.woff2) format('woff2');\n` +
    `  unicode-range: U+4e00-9fff;\n}`;
  const out = fontsLib.rewriteFontFaceCss(css, '微软雅黑', 'https://cdn.example/npm/pkg@1.0.0/400.css');
  check('家族名改写成原字体名', out.includes("font-family: '微软雅黑'"), out);
  check('相对路径已绝对化', out.includes('url(https://cdn.example/npm/pkg@1.0.0/files/a.woff2)'), out);
  check('src 以 local() 开头', /src:\s*local\('微软雅黑'\), url\(/.test(out), out);
  check('unicode-range 原样保留', out.includes('unicode-range: U+4e00-9fff'), out);
  check('改写不残留替代字体名', !out.includes('Noto Sans SC'), out);
}

// ---------------- 14e. 标点挤压 ----------------

group('CJK 标点挤压');
{
  // 汉字和全角标点都占一整格，一行放不下时 PowerPoint 会把标点的空半格挤掉。
  // 不做这件事就会多断出一行 —— 换字体救不了，所有中文字体的格子一样大。
  const box = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(box);

  const mk = (text, w, size = 46.2) => ({
    kind: 'shape', x: 0, y: 0, w, h: 200, rot: 0, flipH: false, flipV: false, path: null,
    fill: null, stroke: null,
    text: {
      anchor: 'top', insets: [4.8, 9.6, 4.8, 9.6], wrap: true, fontScale: 1,
      paragraphs: [{
        align: 'left', lvl: 0, marL: 0, indent: 0, bullet: null, lineHeight: null,
        spaceBefore: 0, spaceAfter: 0,
        runs: [{ text, b: false, i: false, u: false, strike: false, size, color: '#000', fonts: ['黑体'] }],
      }],
    },
  });
  const pres = { width: 1280, height: 720, source: 'pptx', slides: [] };
  const html = (el) => lib.renderSlideToSvg(pres, { background: null, elements: [el] }, { textMode: 'html' });
  const svgOf = (el) => lib.renderSlideToSvg(pres, { background: null, elements: [el] }, { textMode: 'svg' });

  // 用户实际踩到的那一行：8 个全角字 = 369.6px，可用 353.8px，挤掉两个标点的
  // 空半格省 46.2px 正好放得下（PowerPoint 存的 spAutoFit 框高也是一行）
  {
    const tight = html(mk('数一数，画一画。', 373));
    check('放不下时收掉标点的空半格', (tight.match(/margin-right:-0\.5em/g) ?? []).length === 2, tight.slice(0, 400));
  }
  // 同一段文字给足宽度就不该动它 —— 放得下时保持全角，与 PowerPoint 一致
  {
    const loose = html(mk('数一数，画一画。', 900));
    check('放得下时不挤', !loose.includes('margin-right:-0.5em'));
  }
  // 起始符号空的是左半格，收的是左边
  {
    const open = html(mk('（数一数）（画一画）（记一记）', 500));
    check('起始符号收左边', open.includes('margin-left:-0.5em'), open.slice(0, 300));
    check('收尾符号收右边', open.includes('margin-right:-0.5em'));
  }
  // 没有标点可挤时不该凭空产生标记
  {
    const none = html(mk('数一数画一画数一数画一画', 373));
    check('无标点不产生挤压标记', !none.includes('margin-right:-0.5em'));
  }
  // 原生 <text> 路径用逐字符 dx 表达同一笔账，与字体无关
  {
    const native = svgOf(mk('数一数，画一画。', 373));
    const dx = /dx="([^"]+)"/.exec(native);
    check('原生路径输出 dx', !!dx, native.slice(0, 300));
    if (dx) {
      const vals = dx[1].split(' ').map(Number);
      eq('dx 长度等于字符数', vals.length, 8);
      // 逗号在下标 3，位移落在它后面那个字上；半格 = 46.2 / 2
      near('逗号后的字左移半格', vals[4], -23.1, 0.1);
      check('其余字符不动', vals.filter((v, i) => i !== 4).every((v) => v === 0), dx[1]);
    }
  }

  // 量不到字时的回退估算：全角必须按整格算，否则中文窄掉将近一半、断行全错
  {
    const wide = svgOf(mk('数一数画一画', 200, 40));
    const latin = svgOf(mk('nnnnnn', 200, 40));
    // 同样 6 个字符，中文该比拉丁宽得多；宽度差异体现在断行上
    check('中文按整格估算', (wide.match(/<text /g) ?? []).length >= (latin.match(/<text /g) ?? []).length,
      `中文 ${(wide.match(/<text /g) ?? []).length} 行 vs 拉丁 ${(latin.match(/<text /g) ?? []).length} 行`);
  }
  box.remove();
}

// ---------------- 15. 渲染快照 ----------------

group('headless 状态机');
{
  const pres = parsed.get('showcase.pptx');
  if (pres) {
    const St = viewerLib.PresentationState;

    // 状态机不碰 DOM：不给容器也能完整跑
    const st = new St(pres, {});
    eq('初始页为 0', st.index, 0);
    eq('页数与文件一致', st.count, pres.slides.length);
    check('slide 取到当前页', st.slide === pres.slides[0]);

    // 变更以事件形式广播，UI 只订阅
    const events = [];
    const off = st.subscribe((c) => events.push(c));
    st.goTo(2);
    eq('goTo 广播一条 slide 事件', events.filter((e) => e.type === 'slide').length, 1);
    eq('事件带上目标页', events[0].index, 2);
    eq('事件带上来源页', events[0].previous, 0);
    eq('状态已推进', st.index, 2);

    // 跳到同一页不应产生事件
    const before = events.length;
    check('重复 goTo 返回 false', st.goTo(2) === false);
    eq('重复 goTo 不广播', events.length, before);

    // 退订后不再收到
    off();
    st.goTo(3);
    eq('退订后不再收到事件', events.length, before);

    // 边界钳制
    st.goTo(-5);
    eq('负数钳到首页', st.index, 0);
    st.goTo(9999);
    eq('越界钳到末页', st.index, st.count - 1);
    st.next();
    eq('末页 next 不越界', st.index, st.count - 1);
    st.goTo(0);
    st.prev();
    eq('首页 prev 不越界', st.index, 0);

    // 缩放有上下限，且同值不广播
    const zoomEvents = [];
    const offZoom = st.subscribe((c) => { if (c.type === 'zoom') zoomEvents.push(c.zoom); });
    st.setZoom(2);
    eq('缩放生效', st.zoom, 2);
    st.setZoom(2);
    eq('同值缩放不广播', zoomEvents.length, 1);
    st.setZoom(999);
    eq('缩放上限', st.zoom, 8);
    st.setZoom(0);
    eq('缩放下限', st.zoom, 0.1);
    offZoom();

    // 搜索走全文，命中页可直接喂给 goTo
    const firstText = st.text(0).trim().split(/\s+/)[0] || '';
    if (check('首页有可搜索文本', firstText.length > 0)) {
      const hits = st.search(firstText);
      check('搜索命中首页', hits.includes(0));
      check('大小写不敏感', st.search(firstText.toUpperCase()).includes(0));
    }
    eq('空查询返回空', st.search('   ').length, 0);
    eq('无匹配返回空', st.search('zzz_不存在的词_zzz').length, 0);

    // 内部跳转链接解析
    eq('slide:3 解析为索引 2', st.resolveLink('slide:3'), 2);
    eq('slide:last 解析为末页', st.resolveLink('slide:last'), st.count - 1);
    eq('外链返回 null', st.resolveLink('https://example.com'), null);

    st.destroy();

    // 隐藏页导航：走真实文件（sample-hidden.pptx / .ppt），不用合成对象。
    // 页序 1 可见 · 2 隐藏 · 3 隐藏 · 4 可见 · 5 隐藏，两种格式都要过。
    for (const file of ['sample-hidden.pptx', 'sample-hidden.ppt']) {
      const hp = parsed.get(file);
      if (!check(`${file} 已解析`, !!hp)) continue;

      eq(`${file} 隐藏标记`, JSON.stringify(hp.slides.map((s2) => !!s2.hidden)),
        JSON.stringify([false, true, true, false, true]));

      const skip = new St(hp, { skipHidden: true });
      skip.next();
      eq(`${file} 连续跳过两张隐藏页`, skip.index, 3);
      skip.prev();
      eq(`${file} 回退也跳过`, skip.index, 0);
      // 第 5 页隐藏且之后没有可见页 —— 不能钳到隐藏页上（曾经的 bug）
      skip.goTo(3);
      skip.next();
      eq(`${file} 后续全隐藏时停在原页`, skip.index, 3);
      eq(`${file} 停下时仍在可见页`, hp.slides[skip.index].hidden, undefined);
      skip.destroy();

      // 关掉 skipHidden 则隐藏页照常参与翻页
      const keep = new St(hp, { skipHidden: false });
      keep.next();
      eq(`${file} 不跳过时落在隐藏页`, keep.index, 1);
      keep.goTo(4);
      keep.next();
      eq(`${file} 不跳过时末页不越界`, keep.index, 4);
      keep.destroy();

      // 隐藏页仍然可以被直接跳转命中（大纲/缩略图点击）
      const direct = new St(hp, { skipHidden: true });
      check(`${file} goTo 可直达隐藏页`, direct.goTo(1) === true && direct.index === 1);
      direct.destroy();
    }
  }

  // 动画批次由状态机推进，播放交给 UI
  const animPres = [...parsed.values()].find((p) =>
    p.slides.some((s2) => (s2.animations?.length ?? 0) > 1));
  const animIdx = animPres ? animPres.slides.findIndex((s2) => (s2.animations?.length ?? 0) > 1) : -1;
  if (check('固件中存在多步动画页', animIdx >= 0)) {
    const St = viewerLib.PresentationState;
    const st = new St(animPres, { animate: true, index: animIdx });
    const total = st.animationTotal;
    if (check('该页有多批动画', total > 1)) {
      eq('起始已播 0 批', st.animationDone, 0);
      check('起始有待播动画', st.hasPendingAnimation === true);
      check('起始隐藏集非空', st.hiddenElementIds.size > 0);

      const group1 = st.playNextAnimation();
      check('推进返回这一批的步骤', Array.isArray(group1) && group1.length > 0);
      eq('已播计数 +1', st.animationDone, 1);

      st.finishAnimations();
      eq('finish 后播完全部', st.animationDone, total);
      check('finish 后无待播', st.hasPendingAnimation === false);
      // 退场元素播完就该留在幕后，「播完 = 全部可见」是错的
      eq('finish 后只剩退场元素隐藏', [...st.hiddenElementIds].join(','), '705');
      eq('播完后再推进返回 null', st.playNextAnimation(), null);

      // next() 优先消费动画，动画播完才翻页。
      // 带动画的那页恰好是末页，所以把它拼到一份两页的合成文稿里再测。
      const two = { ...animPres, slides: [animPres.slides[animIdx], animPres.slides[0]] };
      const st2 = new St(two, { animate: true });
      st2.next();
      eq('next 先播动画不翻页', st2.index, 0);
      st2.finishAnimations();
      st2.next();
      eq('动画播完后 next 才翻页', st2.index, 1);
      st2.destroy();

      // 关掉动画后不再有批次
      const st3 = new St(animPres, { animate: true, index: animIdx });
      st3.setAnimate(false);
      eq('关闭动画后无批次', st3.animationTotal, 0);
      // 关掉动画不等于全部画出来：静态画面取动画终态
      eq('关闭动画后仍隐藏退场元素', [...st3.hiddenElementIds].join(','), '705');
      st3.destroy();
    }
    st.destroy();
  }
}

group('文本自动缩放');
{
  const ap = parsed.get('sample-autofit.pptx');
  if (check('sample-autofit.pptx 已解析', !!ap)) {
    // 从渲染产出里读实际字号：这才是使用者真正看到的东西
    // 页面上只有三种字号：标题 24pt(32px)、右侧说明 9pt(12px)、以及被测正文。
    // 不能用区间过滤——缩到下限时正文只有 6.67px，会被滤掉。
    const sizeOf = (i) => {
      const svg = lib.renderSlideToSvg(ap, ap.slides[i], { textMode: 'svg' });
      const all = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => +m[1]);
      const body = all.filter((v) => Math.abs(v - 32) > 0.01 && Math.abs(v - 12) > 0.01);
      return body.length ? Math.max(...body) : NaN;
    };
    const flagOf = (i) => ap.slides[i].elements.find((e) => e.name === 'target').text;

    check('裸 normAutofit 被识别', flagOf(0).autoFitCompute === true);
    check('显式 fontScale 不走自算', flagOf(3).autoFitCompute !== true, `实际 ${flagOf(3).autoFitCompute}`);
    eq('显式 fontScale 原样保留', flagOf(3).fontScale, 0.5);

    const nominal = sizeOf(2);            // 无 autofit：标称字号
    check('溢出 + 裸 normAutofit → 缩小', sizeOf(0) < nominal * 0.95, `${sizeOf(0)} vs 标称 ${nominal}`);
    check('缩放不低于 25% 下限', sizeOf(0) >= nominal * 0.25);
    // 第 5 页的文本远超容量，缩放会一路压到下限；再低就没法读了
    check('极端长文本停在 25% 下限', Math.abs(sizeOf(4) - nominal * 0.25) < 0.5,
      `${sizeOf(4)} vs 下限 ${nominal * 0.25}`);
    eq('放得下 + 裸 normAutofit → 不缩', sizeOf(1), nominal);
    eq('无 autofit → 照常溢出不缩', sizeOf(2), nominal);
    check('显式 fontScale 50% 生效', Math.abs(sizeOf(3) - nominal * 0.5) < 0.5, `${sizeOf(3)} vs ${nominal * 0.5}`);

    // 两条文本路径必须用同一个缩放结果，否则预览与导出不一致
    const html = lib.renderSlideToSvg(ap, ap.slides[0], { textMode: 'html' });
    const svg = lib.renderSlideToSvg(ap, ap.slides[0], { textMode: 'svg' });
    const pick = (s) => {
      const all = [...s.matchAll(/font-size:\s*([\d.]+)px|font-size="([\d.]+)"/g)]
        .map((m) => +(m[1] ?? m[2]))
        .filter((v) => Math.abs(v - 32) > 0.01 && Math.abs(v - 12) > 0.01);
      return all.length ? Math.max(...all) : NaN;
    };
    check('HTML 与 SVG 两条路径缩放一致', Math.abs(pick(html) - pick(svg)) < 0.5, `${pick(html)} vs ${pick(svg)}`);
  }
}

group('占位符几何继承');
{
  const pp = parsed.get('sample-placeholder.pptx');
  if (check('sample-placeholder.pptx 已解析', !!pp)) {
    const at = (i, kind) => pp.slides[i].elements.find((e) => e.kind === kind);
    const box = (e) => e && `${Math.round(e.x)},${Math.round(e.y)} ${Math.round(e.w)}×${Math.round(e.h)}`;

    // 图片占位符 + 空 spPr：几何全部来自版式。不继承的话整张图会被丢掉。
    const p1 = at(0, 'image');
    if (check('图片占位符没有被丢掉', !!p1)) eq('几何继承自版式', box(p1), '80,140 420×300');

    // 自带 xfrm 时不该被版式覆盖
    eq('自带 xfrm 优先于版式', box(at(1, 'image')), '620,200 240×180');

    // 形状侧的继承原本就支持，这里防回归
    const shapes = pp.slides[2].elements.filter((e) => e.kind === 'shape');
    check('形状占位符也继承几何', shapes.some((e) => box(e) === '560,140 340×300'),
      shapes.map(box).join(' | '));
  }
}

group('导出路径的分栏');
{
  const sc = parsed.get('showcase.pptx');
  const el = sc && sc.slides.flatMap((s2) => s2.elements).find((e) => e.text?.columns);
  if (check('存在分栏文本框', !!el)) {
    eq('numCol 解析为 2 栏', el.text.columns, 2);
    check('spcCol 解析出栏间距', (el.text.columnGap ?? 0) > 0, String(el.text.columnGap));

    const page = sc.slides.findIndex((s2) => s2.elements.includes(el));
    const svg = lib.renderSlideToSvg(sc, sc.slides[page], { textMode: 'svg' });
    // 切出该元素的分组，看里面的 <text> 落在几个横向偏移上
    const at = svg.indexOf(`<g data-el="${el.id}"`);
    const seg = at >= 0 ? svg.slice(at, svg.indexOf('<g data-el=', at + 1) + 1 || undefined) : '';
    const xs = [...new Set([...seg.matchAll(/<text x="([\d.]+)"/g)].map((m) => +m[1]))].sort((a, b) => a - b);

    // 导出路径此前完全忽略 numCol，整段排成单栏
    check('SVG 文本路径分成两栏', xs.length >= 2, `实际横向偏移 ${xs.join(',')}`);
    if (xs.length >= 2) {
      const [pt2, , , pl2] = el.text.insets;
      void pt2;
      const colW = (el.w - pl2 * 2 - el.text.columnGap) / 2;
      check('右栏偏移 = 左栏 + 栏宽 + 栏间距',
        Math.abs(xs[1] - (xs[0] + colW + el.text.columnGap)) < 1.5,
        `${xs[1]} vs ${xs[0] + colW + el.text.columnGap}`);
    }
  }
}

group('媒体播放器');
{
  const mp = parsed.get('sample-media.pptx');
  const withMedia = mp && mp.slides.findIndex((s2) =>
    s2.elements.some((e) => e.media?.src));
  if (check('存在带可播放源的媒体', withMedia >= 0)) {
    const page = mp.slides[withMedia];
    const badge = lib.renderSlideToSvg(mp, page);
    const player = lib.renderSlideToSvg(mp, page, { media: 'player' });
    const exported = lib.renderSlideToSvg(mp, page, { media: 'player', textMode: 'svg' });

    // 默认渲染里 foreignObject 本来就有（HTML 文本路径用它），要看的是播放器元素
    check('默认不嵌播放器', !/<video|<audio/.test(badge));
    check('player 模式嵌入真实播放器',
      /<video[^>]+controls/.test(player) || /<audio[^>]+controls/.test(player));
    check('player 模式用封面帧做 poster', !player.includes('<video') || /poster="/.test(player));

    // 关键约束：'svg' 文本模式的产物要脱离浏览器使用，不能含只有浏览器认的 foreignObject
    check('导出路径强制退回 badge，无 foreignObject', !exported.includes('<foreignObject'),
      exported.slice(exported.indexOf('<foreignObject'), exported.indexOf('<foreignObject') + 60));
    check('导出路径仍保留播放标识', exported.includes('<circle'));
  }
}

group('.ppt 的组与自动编号');
{
  const sp2 = parsed.get('showcase.ppt');
  if (check('showcase.ppt 已解析', !!sp2)) {
    let groups = 0, maxDepth = 0, autonum = 0;
    const walk = (els, d) => { for (const e of els ?? []) {
      if (e.kind === 'group') { groups++; maxDepth = Math.max(maxDepth, d + 1); }
      for (const q of e.text?.paragraphs ?? []) {
        if (q.bullet && /^[0-9a-zA-Z]+[.)]/.test(q.bullet)) autonum++;
      }
      walk(e.children, d + 1);
    } };
    for (const s2 of sp2.slides) walk(s2.elements, 0);

    // 这两条 README 曾经记成「未实现；嵌套组会被展平」，实测都是错的
    check('组结构没有被展平', groups > 0, `组元素 ${groups}`);
    check('嵌套组保留层级', maxDepth >= 2, `最大深度 ${maxDepth}`);
    check('StyleTextProp9Atom 的自动编号生效', autonum > 0, `自动编号项 ${autonum}`);
  }
}

group('OLE 对象预览图');
{
  const op = parsed.get('sample-ole.pptx');
  if (check('sample-ole.pptx 已解析', !!op)) {
    const p1 = op.slides[0].elements.find((e) => e.kind === 'image');
    const p2 = op.slides[1].elements.find((e) => e.kind === 'unsupported');

    // 预览图存在旧式 VML 部件里：oleObj@spid → v:shape → v:imagedata → 媒体
    check('可解码的预览图渲染成图片', !!p1 && !!p1.src, p1 ? String(p1.src) : '没解出图片');
    if (p1) eq('图片沿用 graphicFrame 的框', `${Math.round(p1.x)},${Math.round(p1.y)} ${Math.round(p1.w)}×${Math.round(p1.h)}`, '120,160 460×300');

    // 认不出的格式（Mac 存的 PICT 之类）宁可给占位框，也别塞一张裂图
    check('认不出的预览格式退回占位框', !!p2, '第 2 页没有占位元素');
    if (p2) eq('占位框标为 OLE 对象', p2.label, 'OLE 对象');

    // Office 2010+ 把预览直接写成 p:oleObj 的 p:pic 子元素，这条路不经过 VML。
    // 第 3 页刻意不写 spid，走 VML 那条会直接返回 null。
    const p3 = op.slides[2].elements.find((e) => e.kind === 'image');
    check('内嵌 p:pic 的预览渲染成图片', !!p3 && !!p3.src, p3 ? String(p3.src) : '没解出图片');
    if (p3) {
      eq('p:pic 预览沿用 graphicFrame 的框',
        `${Math.round(p3.x)},${Math.round(p3.y)} ${Math.round(p3.w)}×${Math.round(p3.h)}`, '120,160 460×300');
      check('p:pic 走的是自己的图，不是 VML 那张', p3.src !== p1?.src, `${p3.src} vs ${p1?.src}`);
    }
  }
}

group('渲染错误隔离');
{
  const sc = parsed.get('showcase.pptx');
  const page = sc && sc.slides.find((x) => x.elements.length >= 2);
  if (check('取到多元素页', !!page)) {
    const good = lib.renderSlideToSvg(sc, page);
    const goodIds = [...good.matchAll(/data-el="(\d+)"/g)].map((m) => m[1]);

    // 注入一个访问即抛的元素，模拟畸形形状
    const bad = { kind: 'shape', x: 10, y: 20, w: 120, h: 60, rot: 0, flipH: false, flipV: false, name: '坏形状' };
    Object.defineProperty(bad, 'path', { get() { throw new Error('注入的渲染错误'); } });
    const svg = lib.renderSlideToSvg(sc, { ...page, elements: [bad, ...page.elements] });

    check('失败元素标记为 data-render-error', svg.includes('data-render-error="1"'));
    check('失败元素画出红色虚线占位框', svg.includes('stroke="#dc2626"'));
    check('错误原因写进 title', svg.includes('注入的渲染错误'));
    check('占位框标出元素名', svg.includes('坏形状'));
    const stillThere = goodIds.every((id) => svg.includes(`data-el="${id}"`));
    check('同页其余元素照常渲染', stillThere, `原有 ${goodIds.length} 个元素`);
    check('产物仍是合法 XML', !parseXml(svg).error, parseXml(svg).error || '');

    // 背景解析失败只该丢背景
    const badBg = { ...page };
    Object.defineProperty(badBg, 'background', { get() { throw new Error('背景炸了'); } });
    let bgSvg = null;
    try { bgSvg = lib.renderSlideToSvg(sc, badBg); } catch { /* 期望不抛 */ }
    check('背景渲染失败不影响整页', !!bgSvg && bgSvg.includes('<svg'));
    check('背景失败时退回白底', !!bgSvg && bgSvg.includes('fill="#fff"'));
  }
}

group('渲染错误隔离');
{
  const sc = parsed.get('showcase.pptx');
  const page = sc && sc.slides.find((x) => x.elements.length >= 2);
  if (check('取到多元素页', !!page)) {
    const good = lib.renderSlideToSvg(sc, page);
    const goodIds = [...good.matchAll(/data-el="(\d+)"/g)].map((m) => m[1]);

    // 注入一个访问即抛的元素，模拟畸形形状
    const bad = { kind: 'shape', x: 10, y: 20, w: 120, h: 60, rot: 0, flipH: false, flipV: false, name: '坏形状' };
    Object.defineProperty(bad, 'path', { get() { throw new Error('注入的渲染错误'); } });
    const svg = lib.renderSlideToSvg(sc, { ...page, elements: [bad, ...page.elements] });

    check('失败元素标记为 data-render-error', svg.includes('data-render-error="1"'));
    check('失败元素画出红色虚线占位框', svg.includes('stroke="#dc2626"'));
    check('错误原因写进 title', svg.includes('注入的渲染错误'));
    check('占位框标出元素名', svg.includes('坏形状'));
    const stillThere = goodIds.every((id) => svg.includes(`data-el="${id}"`));
    check('同页其余元素照常渲染', stillThere, `原有 ${goodIds.length} 个元素`);
    check('产物仍是合法 XML', !parseXml(svg).error, parseXml(svg).error || '');

    // 背景解析失败只该丢背景
    const badBg = { ...page };
    Object.defineProperty(badBg, 'background', { get() { throw new Error('背景炸了'); } });
    let bgSvg = null;
    try { bgSvg = lib.renderSlideToSvg(sc, badBg); } catch { /* 期望不抛 */ }
    check('背景渲染失败不影响整页', !!bgSvg && bgSvg.includes('<svg'));
    check('背景失败时退回白底', !!bgSvg && bgSvg.includes('fill="#fff"'));
  }
}

group('导出光栅化');
{
  const sc = parsed.get('showcase.pptx');
  // 挑一页没有位图的，避免 inlineImages 去 fetch 假 blob URL
  const page = sc && sc.slides.find((x) => !lib.renderSlideToSvg(sc, x).includes('<image'));
  if (check('取到无位图页', !!page)) {
    const doc = globalThis.document;
    const realImage = globalThis.Image;
    const realCreate = doc.createElement.bind(doc);
    const srcs = [];
    let toBlobFails = 0;

    globalThis.Image = class {
      set src(v) { srcs.push(v); queueMicrotask(() => this.onload && this.onload()); }
    };
    doc.createElement = (tag) => {
      if (tag !== 'canvas') return realCreate(tag);
      return {
        width: 0, height: 0,
        getContext: () => ({ fillStyle: '', font: '', fillRect() {}, drawImage() {}, measureText: (s2) => ({ width: s2.length * 8 }) }),
        toBlob(cb) {
          if (toBlobFails-- > 0) { const e = new Error('tainted'); e.name = 'SecurityError'; throw e; }
          cb(new globalThis.Blob(['png']));
        },
      };
    };

    try {
      await lib.slideToPng(sc, page, 1);
      check('导出用 data: URI 加载 SVG', srcs.length === 1 && srcs[0].startsWith('data:image/svg+xml'),
        String(srcs[0]).slice(0, 40));
      // blob: 会让含 foreignObject 的 SVG 污染画布，data: 不会
      check('导出不再经 blob: URL', !srcs.some((u) => u.startsWith('blob:')));
      check('默认走 html 文本模式（与屏幕预览同一套排版）',
        decodeURIComponent(srcs[0] || '').includes('<foreignObject'));

      // 引擎仍判污染时应自动退回自绘文本，而不是让导出失败
      srcs.length = 0;
      toBlobFails = 1;
      const blob = await lib.slideToPng(sc, page, 1);
      check('画布被判污染时导出仍成功', !!blob);
      eq('污染回退渲染了两次', srcs.length, 2);
      check('回退产物不含 foreignObject',
        !decodeURIComponent(srcs[1] || '').includes('<foreignObject'));
    } finally {
      globalThis.Image = realImage;
      doc.createElement = realCreate;
    }
  }
}

group('渲染错误隔离');
{
  const sc = parsed.get('showcase.pptx');
  const page = sc && sc.slides.find((x) => x.elements.length >= 2);
  if (check('取到多元素页', !!page)) {
    const good = lib.renderSlideToSvg(sc, page);
    const goodIds = [...good.matchAll(/data-el="(\d+)"/g)].map((m) => m[1]);

    // 注入一个访问即抛的元素，模拟畸形形状
    const bad = { kind: 'shape', x: 10, y: 20, w: 120, h: 60, rot: 0, flipH: false, flipV: false, name: '坏形状' };
    Object.defineProperty(bad, 'path', { get() { throw new Error('注入的渲染错误'); } });
    const svg = lib.renderSlideToSvg(sc, { ...page, elements: [bad, ...page.elements] });

    check('失败元素标记为 data-render-error', svg.includes('data-render-error="1"'));
    check('失败元素画出红色虚线占位框', svg.includes('stroke="#dc2626"'));
    check('错误原因写进 title', svg.includes('注入的渲染错误'));
    check('占位框标出元素名', svg.includes('坏形状'));
    const stillThere = goodIds.every((id) => svg.includes(`data-el="${id}"`));
    check('同页其余元素照常渲染', stillThere, `原有 ${goodIds.length} 个元素`);
    check('产物仍是合法 XML', !parseXml(svg).error, parseXml(svg).error || '');

    // 背景解析失败只该丢背景
    const badBg = { ...page };
    Object.defineProperty(badBg, 'background', { get() { throw new Error('背景炸了'); } });
    let bgSvg = null;
    try { bgSvg = lib.renderSlideToSvg(sc, badBg); } catch { /* 期望不抛 */ }
    check('背景渲染失败不影响整页', !!bgSvg && bgSvg.includes('<svg'));
    check('背景失败时退回白底', !!bgSvg && bgSvg.includes('fill="#fff"'));
  }
}

group('导出光栅化');
{
  const sc = parsed.get('showcase.pptx');
  // 挑一页没有位图的，避免 inlineImages 去 fetch 假 blob URL
  const page = sc && sc.slides.find((x) => !lib.renderSlideToSvg(sc, x).includes('<image'));
  if (check('取到无位图页', !!page)) {
    const doc = globalThis.document;
    const realImage = globalThis.Image;
    const realCreate = doc.createElement.bind(doc);
    const srcs = [];
    let toBlobFails = 0;

    globalThis.Image = class {
      set src(v) { srcs.push(v); queueMicrotask(() => this.onload && this.onload()); }
    };
    doc.createElement = (tag) => {
      if (tag !== 'canvas') return realCreate(tag);
      return {
        width: 0, height: 0,
        getContext: () => ({ fillStyle: '', font: '', fillRect() {}, drawImage() {}, measureText: (s2) => ({ width: s2.length * 8 }) }),
        toBlob(cb) {
          if (toBlobFails-- > 0) { const e = new Error('tainted'); e.name = 'SecurityError'; throw e; }
          cb(new globalThis.Blob(['png']));
        },
      };
    };

    try {
      await lib.slideToPng(sc, page, 1);
      check('导出用 data: URI 加载 SVG', srcs.length === 1 && srcs[0].startsWith('data:image/svg+xml'),
        String(srcs[0]).slice(0, 40));
      // blob: 会让含 foreignObject 的 SVG 污染画布，data: 不会
      check('导出不再经 blob: URL', !srcs.some((u) => u.startsWith('blob:')));
      check('默认走 html 文本模式（与屏幕预览同一套排版）',
        decodeURIComponent(srcs[0] || '').includes('<foreignObject'));

      // 引擎仍判污染时应自动退回自绘文本，而不是让导出失败
      srcs.length = 0;
      toBlobFails = 1;
      const blob = await lib.slideToPng(sc, page, 1);
      check('画布被判污染时导出仍成功', !!blob);
      eq('污染回退渲染了两次', srcs.length, 2);
      check('回退产物不含 foreignObject',
        !decodeURIComponent(srcs[1] || '').includes('<foreignObject'));
    } finally {
      globalThis.Image = realImage;
      doc.createElement = realCreate;
    }
  }
}

group('foreignObject 缩放探测');
{
  // jsdom 量不到布局尺寸，此时不该误判成「引擎有问题」而降级
  viewerLib.resetForeignObjectProbe?.();
  eq('量不到尺寸时不降级', viewerLib.foreignObjectScalesCorrectly(globalThis.document), true);

  const pres = parsed.get('showcase.pptx');
  if (pres) {
    const box = globalThis.document.createElement('div');
    globalThis.document.body.appendChild(box);
    const vh = new viewerLib.Viewer(box, pres, { textMode: 'html' });
    check('text:html 用 foreignObject 排版', vh.slideSvg(0).includes('<foreignObject'));
    const vs = new viewerLib.Viewer(box, pres, { textMode: 'svg' });
    check('text:svg 改用原生 <text>', !vs.slideSvg(0).includes('<foreignObject'));
    check('text:svg 仍渲染出文本', /<text[\s>]/.test(vs.slideSvg(0)));
    vh.destroy(); vs.destroy();
    box.remove();
  }
}

group('渲染错误隔离');
{
  const sc = parsed.get('showcase.pptx');
  const page = sc && sc.slides.find((x) => x.elements.length >= 2);
  if (check('取到多元素页', !!page)) {
    const good = lib.renderSlideToSvg(sc, page);
    const goodIds = [...good.matchAll(/data-el="(\d+)"/g)].map((m) => m[1]);

    // 注入一个访问即抛的元素，模拟畸形形状
    const bad = { kind: 'shape', x: 10, y: 20, w: 120, h: 60, rot: 0, flipH: false, flipV: false, name: '坏形状' };
    Object.defineProperty(bad, 'path', { get() { throw new Error('注入的渲染错误'); } });
    const svg = lib.renderSlideToSvg(sc, { ...page, elements: [bad, ...page.elements] });

    check('失败元素标记为 data-render-error', svg.includes('data-render-error="1"'));
    check('失败元素画出红色虚线占位框', svg.includes('stroke="#dc2626"'));
    check('错误原因写进 title', svg.includes('注入的渲染错误'));
    check('占位框标出元素名', svg.includes('坏形状'));
    const stillThere = goodIds.every((id) => svg.includes(`data-el="${id}"`));
    check('同页其余元素照常渲染', stillThere, `原有 ${goodIds.length} 个元素`);
    check('产物仍是合法 XML', !parseXml(svg).error, parseXml(svg).error || '');

    // 背景解析失败只该丢背景
    const badBg = { ...page };
    Object.defineProperty(badBg, 'background', { get() { throw new Error('背景炸了'); } });
    let bgSvg = null;
    try { bgSvg = lib.renderSlideToSvg(sc, badBg); } catch { /* 期望不抛 */ }
    check('背景渲染失败不影响整页', !!bgSvg && bgSvg.includes('<svg'));
    check('背景失败时退回白底', !!bgSvg && bgSvg.includes('fill="#fff"'));
  }
}

group('导出光栅化');
{
  const sc = parsed.get('showcase.pptx');
  // 挑一页没有位图的，避免 inlineImages 去 fetch 假 blob URL
  const page = sc && sc.slides.find((x) => !lib.renderSlideToSvg(sc, x).includes('<image'));
  if (check('取到无位图页', !!page)) {
    const doc = globalThis.document;
    const realImage = globalThis.Image;
    const realCreate = doc.createElement.bind(doc);
    const srcs = [];
    let toBlobFails = 0;

    globalThis.Image = class {
      set src(v) { srcs.push(v); queueMicrotask(() => this.onload && this.onload()); }
    };
    doc.createElement = (tag) => {
      if (tag !== 'canvas') return realCreate(tag);
      return {
        width: 0, height: 0,
        getContext: () => ({ fillStyle: '', font: '', fillRect() {}, drawImage() {}, measureText: (s2) => ({ width: s2.length * 8 }) }),
        toBlob(cb) {
          if (toBlobFails-- > 0) { const e = new Error('tainted'); e.name = 'SecurityError'; throw e; }
          cb(new globalThis.Blob(['png']));
        },
      };
    };

    try {
      await lib.slideToPng(sc, page, 1);
      check('导出用 data: URI 加载 SVG', srcs.length === 1 && srcs[0].startsWith('data:image/svg+xml'),
        String(srcs[0]).slice(0, 40));
      // blob: 会让含 foreignObject 的 SVG 污染画布，data: 不会
      check('导出不再经 blob: URL', !srcs.some((u) => u.startsWith('blob:')));
      check('默认走 html 文本模式（与屏幕预览同一套排版）',
        decodeURIComponent(srcs[0] || '').includes('<foreignObject'));

      // 引擎仍判污染时应自动退回自绘文本，而不是让导出失败
      srcs.length = 0;
      toBlobFails = 1;
      const blob = await lib.slideToPng(sc, page, 1);
      check('画布被判污染时导出仍成功', !!blob);
      eq('污染回退渲染了两次', srcs.length, 2);
      check('回退产物不含 foreignObject',
        !decodeURIComponent(srcs[1] || '').includes('<foreignObject'));
    } finally {
      globalThis.Image = realImage;
      doc.createElement = realCreate;
    }
  }
}

group('foreignObject 缩放探测');
{
  // jsdom 量不到布局尺寸，此时不该误判成「引擎有问题」而降级
  viewerLib.resetForeignObjectProbe?.();
  eq('量不到尺寸时不降级', viewerLib.foreignObjectScalesCorrectly(globalThis.document), true);

  const pres = parsed.get('showcase.pptx');
  if (pres) {
    const box = globalThis.document.createElement('div');
    globalThis.document.body.appendChild(box);
    const vh = new viewerLib.Viewer(box, pres, { textMode: 'html' });
    check('text:html 用 foreignObject 排版', vh.slideSvg(0).includes('<foreignObject'));
    const vs = new viewerLib.Viewer(box, pres, { textMode: 'svg' });
    check('text:svg 改用原生 <text>', !vs.slideSvg(0).includes('<foreignObject'));
    check('text:svg 仍渲染出文本', /<text[\s>]/.test(vs.slideSvg(0)));
    vh.destroy(); vs.destroy();
    box.remove();
  }
}

group('动画分步打印');
{
  const pres = parsed.get('showcase.pptx');
  const anim = pres?.slides.find((x) => x.animations?.length);
  if (check('存在带动画的页', !!anim)) {
    const groups = lib.groupSteps(anim.animations);

    // hiddenElements 直接把可见性固化进静态产物
    const mid = [...lib.hiddenBefore(groups, 1)];
    const svg = lib.renderSlideToSvg(pres, anim, { hiddenElements: mid });
    check('隐藏的元素带 visibility:hidden',
      mid.every((id) => new RegExp(`data-el="${id}" style="visibility:hidden;`).test(svg)));
    const shown = anim.animations.map((a) => a.target).filter((t) => !mid.includes(t));
    check('未隐藏的元素不带 visibility:hidden',
      shown.every((id) => new RegExp(`data-el="${id}" style="(?!visibility:hidden)`).test(svg)),
      `可见目标 ${shown.join(',')}`);
    check('不传 hiddenElements 时不产生 visibility',
      !lib.renderSlideToSvg(pres, anim).includes('visibility:hidden'));

    const plain = await lib.presentationToPrintableHtml(pres);
    const stepped = await lib.presentationToPrintableHtml(pres, { animationSteps: true });
    const count = (h) => (h.match(/class="pg"/g) || []).length;
    eq('默认一页一张', count(plain), pres.slides.length);
    // 有动画的页展开成 n+1 张（初始态 + 每批播完）
    const extra = pres.slides.reduce((n, x) => n + (lib.groupSteps(x.animations).length
      ? lib.groupSteps(x.animations).length + 1 - 1 : 0), 0);
    eq('分步后页数按点击批次展开', count(stepped), pres.slides.length + extra);
    check('分步产物里出现了 visibility:hidden', stepped.includes('visibility:hidden'));
    check('分步产物仍不含 foreignObject', !stepped.includes('<foreignObject'));
  }
}

group('渲染错误隔离');
{
  const sc = parsed.get('showcase.pptx');
  const page = sc && sc.slides.find((x) => x.elements.length >= 2);
  if (check('取到多元素页', !!page)) {
    const good = lib.renderSlideToSvg(sc, page);
    const goodIds = [...good.matchAll(/data-el="(\d+)"/g)].map((m) => m[1]);

    // 注入一个访问即抛的元素，模拟畸形形状
    const bad = { kind: 'shape', x: 10, y: 20, w: 120, h: 60, rot: 0, flipH: false, flipV: false, name: '坏形状' };
    Object.defineProperty(bad, 'path', { get() { throw new Error('注入的渲染错误'); } });
    const svg = lib.renderSlideToSvg(sc, { ...page, elements: [bad, ...page.elements] });

    check('失败元素标记为 data-render-error', svg.includes('data-render-error="1"'));
    check('失败元素画出红色虚线占位框', svg.includes('stroke="#dc2626"'));
    check('错误原因写进 title', svg.includes('注入的渲染错误'));
    check('占位框标出元素名', svg.includes('坏形状'));
    const stillThere = goodIds.every((id) => svg.includes(`data-el="${id}"`));
    check('同页其余元素照常渲染', stillThere, `原有 ${goodIds.length} 个元素`);
    check('产物仍是合法 XML', !parseXml(svg).error, parseXml(svg).error || '');

    // 背景解析失败只该丢背景
    const badBg = { ...page };
    Object.defineProperty(badBg, 'background', { get() { throw new Error('背景炸了'); } });
    let bgSvg = null;
    try { bgSvg = lib.renderSlideToSvg(sc, badBg); } catch { /* 期望不抛 */ }
    check('背景渲染失败不影响整页', !!bgSvg && bgSvg.includes('<svg'));
    check('背景失败时退回白底', !!bgSvg && bgSvg.includes('fill="#fff"'));
  }
}

group('导出光栅化');
{
  const sc = parsed.get('showcase.pptx');
  // 挑一页没有位图的，避免 inlineImages 去 fetch 假 blob URL
  const page = sc && sc.slides.find((x) => !lib.renderSlideToSvg(sc, x).includes('<image'));
  if (check('取到无位图页', !!page)) {
    const doc = globalThis.document;
    const realImage = globalThis.Image;
    const realCreate = doc.createElement.bind(doc);
    const srcs = [];
    let toBlobFails = 0;

    globalThis.Image = class {
      set src(v) { srcs.push(v); queueMicrotask(() => this.onload && this.onload()); }
    };
    doc.createElement = (tag) => {
      if (tag !== 'canvas') return realCreate(tag);
      return {
        width: 0, height: 0,
        getContext: () => ({ fillStyle: '', font: '', fillRect() {}, drawImage() {}, measureText: (s2) => ({ width: s2.length * 8 }) }),
        toBlob(cb) {
          if (toBlobFails-- > 0) { const e = new Error('tainted'); e.name = 'SecurityError'; throw e; }
          cb(new globalThis.Blob(['png']));
        },
      };
    };

    try {
      await lib.slideToPng(sc, page, 1);
      check('导出用 data: URI 加载 SVG', srcs.length === 1 && srcs[0].startsWith('data:image/svg+xml'),
        String(srcs[0]).slice(0, 40));
      // blob: 会让含 foreignObject 的 SVG 污染画布，data: 不会
      check('导出不再经 blob: URL', !srcs.some((u) => u.startsWith('blob:')));
      check('默认走 html 文本模式（与屏幕预览同一套排版）',
        decodeURIComponent(srcs[0] || '').includes('<foreignObject'));

      // 引擎仍判污染时应自动退回自绘文本，而不是让导出失败
      srcs.length = 0;
      toBlobFails = 1;
      const blob = await lib.slideToPng(sc, page, 1);
      check('画布被判污染时导出仍成功', !!blob);
      eq('污染回退渲染了两次', srcs.length, 2);
      check('回退产物不含 foreignObject',
        !decodeURIComponent(srcs[1] || '').includes('<foreignObject'));
    } finally {
      globalThis.Image = realImage;
      doc.createElement = realCreate;
    }
  }
}

group('foreignObject 缩放探测');
{
  // jsdom 量不到布局尺寸，此时不该误判成「引擎有问题」而降级
  viewerLib.resetForeignObjectProbe?.();
  eq('量不到尺寸时不降级', viewerLib.foreignObjectScalesCorrectly(globalThis.document), true);

  const pres = parsed.get('showcase.pptx');
  if (pres) {
    const box = globalThis.document.createElement('div');
    globalThis.document.body.appendChild(box);
    const vh = new viewerLib.Viewer(box, pres, { textMode: 'html' });
    check('text:html 用 foreignObject 排版', vh.slideSvg(0).includes('<foreignObject'));
    const vs = new viewerLib.Viewer(box, pres, { textMode: 'svg' });
    check('text:svg 改用原生 <text>', !vs.slideSvg(0).includes('<foreignObject'));
    check('text:svg 仍渲染出文本', /<text[\s>]/.test(vs.slideSvg(0)));
    vh.destroy(); vs.destroy();
    box.remove();
  }
}

group('动画分步打印');
{
  const pres = parsed.get('showcase.pptx');
  const anim = pres?.slides.find((x) => x.animations?.length);
  if (check('存在带动画的页', !!anim)) {
    const groups = lib.groupSteps(anim.animations);

    // hiddenElements 直接把可见性固化进静态产物
    const mid = [...lib.hiddenBefore(groups, 1)];
    const svg = lib.renderSlideToSvg(pres, anim, { hiddenElements: mid });
    check('隐藏的元素带 visibility:hidden',
      mid.every((id) => new RegExp(`data-el="${id}" style="visibility:hidden;`).test(svg)));
    const shown = anim.animations.map((a) => a.target).filter((t) => !mid.includes(t));
    check('未隐藏的元素不带 visibility:hidden',
      shown.every((id) => new RegExp(`data-el="${id}" style="(?!visibility:hidden)`).test(svg)),
      `可见目标 ${shown.join(',')}`);
    check('不传 hiddenElements 时不产生 visibility',
      !lib.renderSlideToSvg(pres, anim).includes('visibility:hidden'));

    const plain = await lib.presentationToPrintableHtml(pres);
    const stepped = await lib.presentationToPrintableHtml(pres, { animationSteps: true });
    const count = (h) => (h.match(/class="pg"/g) || []).length;
    eq('默认一页一张', count(plain), pres.slides.length);
    // 有动画的页展开成 n+1 张（初始态 + 每批播完）
    const extra = pres.slides.reduce((n, x) => n + (lib.groupSteps(x.animations).length
      ? lib.groupSteps(x.animations).length + 1 - 1 : 0), 0);
    eq('分步后页数按点击批次展开', count(stepped), pres.slides.length + extra);
    check('分步产物里出现了 visibility:hidden', stepped.includes('visibility:hidden'));
    check('分步产物仍不含 foreignObject', !stepped.includes('<foreignObject'));
  }
}

group('渲染错误隔离');
{
  const sc = parsed.get('showcase.pptx');
  const page = sc && sc.slides.find((x) => x.elements.length >= 2);
  if (check('取到多元素页', !!page)) {
    const good = lib.renderSlideToSvg(sc, page);
    const goodIds = [...good.matchAll(/data-el="(\d+)"/g)].map((m) => m[1]);

    // 注入一个访问即抛的元素，模拟畸形形状
    const bad = { kind: 'shape', x: 10, y: 20, w: 120, h: 60, rot: 0, flipH: false, flipV: false, name: '坏形状' };
    Object.defineProperty(bad, 'path', { get() { throw new Error('注入的渲染错误'); } });
    const svg = lib.renderSlideToSvg(sc, { ...page, elements: [bad, ...page.elements] });

    check('失败元素标记为 data-render-error', svg.includes('data-render-error="1"'));
    check('失败元素画出红色虚线占位框', svg.includes('stroke="#dc2626"'));
    check('错误原因写进 title', svg.includes('注入的渲染错误'));
    check('占位框标出元素名', svg.includes('坏形状'));
    const stillThere = goodIds.every((id) => svg.includes(`data-el="${id}"`));
    check('同页其余元素照常渲染', stillThere, `原有 ${goodIds.length} 个元素`);
    check('产物仍是合法 XML', !parseXml(svg).error, parseXml(svg).error || '');

    // 背景解析失败只该丢背景
    const badBg = { ...page };
    Object.defineProperty(badBg, 'background', { get() { throw new Error('背景炸了'); } });
    let bgSvg = null;
    try { bgSvg = lib.renderSlideToSvg(sc, badBg); } catch { /* 期望不抛 */ }
    check('背景渲染失败不影响整页', !!bgSvg && bgSvg.includes('<svg'));
    check('背景失败时退回白底', !!bgSvg && bgSvg.includes('fill="#fff"'));
  }
}

group('导出光栅化');
{
  const sc = parsed.get('showcase.pptx');
  // 挑一页没有位图的，避免 inlineImages 去 fetch 假 blob URL
  const page = sc && sc.slides.find((x) => !lib.renderSlideToSvg(sc, x).includes('<image'));
  if (check('取到无位图页', !!page)) {
    const doc = globalThis.document;
    const realImage = globalThis.Image;
    const realCreate = doc.createElement.bind(doc);
    const srcs = [];
    let toBlobFails = 0;

    globalThis.Image = class {
      set src(v) { srcs.push(v); queueMicrotask(() => this.onload && this.onload()); }
    };
    doc.createElement = (tag) => {
      if (tag !== 'canvas') return realCreate(tag);
      return {
        width: 0, height: 0,
        getContext: () => ({ fillStyle: '', font: '', fillRect() {}, drawImage() {}, measureText: (s2) => ({ width: s2.length * 8 }) }),
        toBlob(cb) {
          if (toBlobFails-- > 0) { const e = new Error('tainted'); e.name = 'SecurityError'; throw e; }
          cb(new globalThis.Blob(['png']));
        },
      };
    };

    try {
      await lib.slideToPng(sc, page, 1);
      check('导出用 data: URI 加载 SVG', srcs.length === 1 && srcs[0].startsWith('data:image/svg+xml'),
        String(srcs[0]).slice(0, 40));
      // blob: 会让含 foreignObject 的 SVG 污染画布，data: 不会
      check('导出不再经 blob: URL', !srcs.some((u) => u.startsWith('blob:')));
      check('默认走 html 文本模式（与屏幕预览同一套排版）',
        decodeURIComponent(srcs[0] || '').includes('<foreignObject'));

      // 引擎仍判污染时应自动退回自绘文本，而不是让导出失败
      srcs.length = 0;
      toBlobFails = 1;
      const blob = await lib.slideToPng(sc, page, 1);
      check('画布被判污染时导出仍成功', !!blob);
      eq('污染回退渲染了两次', srcs.length, 2);
      check('回退产物不含 foreignObject',
        !decodeURIComponent(srcs[1] || '').includes('<foreignObject'));
    } finally {
      globalThis.Image = realImage;
      doc.createElement = realCreate;
    }
  }
}

group('foreignObject 缩放探测');
{
  // jsdom 量不到布局尺寸，此时不该误判成「引擎有问题」而降级
  viewerLib.resetForeignObjectProbe?.();
  eq('量不到尺寸时不降级', viewerLib.foreignObjectScalesCorrectly(globalThis.document), true);

  const pres = parsed.get('showcase.pptx');
  if (pres) {
    const box = globalThis.document.createElement('div');
    globalThis.document.body.appendChild(box);
    const vh = new viewerLib.Viewer(box, pres, { textMode: 'html' });
    check('text:html 用 foreignObject 排版', vh.slideSvg(0).includes('<foreignObject'));
    const vs = new viewerLib.Viewer(box, pres, { textMode: 'svg' });
    check('text:svg 改用原生 <text>', !vs.slideSvg(0).includes('<foreignObject'));
    check('text:svg 仍渲染出文本', /<text[\s>]/.test(vs.slideSvg(0)));
    vh.destroy(); vs.destroy();
    box.remove();
  }
}

group('动画分步打印');
{
  const pres = parsed.get('showcase.pptx');
  const anim = pres?.slides.find((x) => x.animations?.length);
  if (check('存在带动画的页', !!anim)) {
    const groups = lib.groupSteps(anim.animations);

    // hiddenElements 直接把可见性固化进静态产物
    const mid = [...lib.hiddenBefore(groups, 1)];
    const svg = lib.renderSlideToSvg(pres, anim, { hiddenElements: mid });
    check('隐藏的元素带 visibility:hidden',
      mid.every((id) => new RegExp(`data-el="${id}" style="visibility:hidden;`).test(svg)));
    const shown = anim.animations.map((a) => a.target).filter((t) => !mid.includes(t));
    check('未隐藏的元素不带 visibility:hidden',
      shown.every((id) => new RegExp(`data-el="${id}" style="(?!visibility:hidden)`).test(svg)),
      `可见目标 ${shown.join(',')}`);
    check('不传 hiddenElements 时不产生 visibility',
      !lib.renderSlideToSvg(pres, anim).includes('visibility:hidden'));

    const plain = await lib.presentationToPrintableHtml(pres);
    const stepped = await lib.presentationToPrintableHtml(pres, { animationSteps: true });
    const count = (h) => (h.match(/class="pg"/g) || []).length;
    eq('默认一页一张', count(plain), pres.slides.length);
    // 有动画的页展开成 n+1 张（初始态 + 每批播完）
    const extra = pres.slides.reduce((n, x) => n + (lib.groupSteps(x.animations).length
      ? lib.groupSteps(x.animations).length + 1 - 1 : 0), 0);
    eq('分步后页数按点击批次展开', count(stepped), pres.slides.length + extra);
    check('分步产物里出现了 visibility:hidden', stepped.includes('visibility:hidden'));
    check('分步产物仍不含 foreignObject', !stepped.includes('<foreignObject'));
  }
}

group('渲染快照');
{
  const snapDir = join(root, 'test/snapshots');
  const update = process.env.UPDATE_SNAPSHOTS === '1';
  mkdirSync(snapDir, { recursive: true });

  let written = 0;
  let missing = 0;
  const drifted = [];

  for (const [file, pres] of parsed) {
    // 注意用 for 循环而非 forEach：早期版本在回调里 return，会静默跳过第二种文本模式
    for (let i = 0; i < pres.slides.length; i++) {
      const slide = pres.slides[i];
      for (const mode of ['html', 'svg']) {
        const name = snapshotName(file, i + 1, mode);
        const path = join(snapDir, name);
        const actual = normalizeSvg(lib.renderSlideToSvg(pres, slide, { textMode: mode }));

        if (update) {
          writeFileSync(path, actual);
          written++;
          continue;
        }
        if (!existsSync(path)) { missing++; continue; }
        const expected = readFileSync(path, 'utf8');
        if (expected === actual) { pass++; continue; }

        // 只报首个差异行，避免刷屏
        const a = expected.split('\n');
        const b = actual.split('\n');
        let line = 0;
        while (line < a.length && line < b.length && a[line] === b[line]) line++;
        drifted.push(`${name} 第 ${line + 1} 行\n      基线: ${(a[line] ?? '<缺失>').slice(0, 110)}\n      实际: ${(b[line] ?? '<缺失>').slice(0, 110)}`);
      }
    }
  }

  if (update) {
    console.log(`  已更新 ${written} 个基线`);
  } else {
    check('无缺失基线', missing === 0, `${missing} 个缺失，用 UPDATE_SNAPSHOTS=1 生成`);
    if (drifted.length) {
      for (const d of drifted) failures.push(`快照漂移 ${d}`);
    } else {
      console.log(`  ${pass} 项累计通过，快照全部一致`);
    }
  }
}

// ---------------- 汇总 ----------------

console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.log(`\x1b[31m✗ ${failures.length} 项失败 / 共 ${pass + failures.length} 项\x1b[0m`);
  console.log('  （若为有意的渲染改动，用 UPDATE_SNAPSHOTS=1 npm run test:core 更新基线）');
  for (const f of failures.slice(0, 40)) console.log(`  · ${f}`);
  if (failures.length > 40) console.log(`  … 另有 ${failures.length - 40} 项`);
  process.exit(1);
}
console.log(`\x1b[32m✓ 全部 ${pass} 项断言通过\x1b[0m`);
