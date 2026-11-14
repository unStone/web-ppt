/** 桌面 001：布局定义引擎——真实样本 layoutDef 求值、与 PowerPoint 缓存对照、reason 回退与确定性（函数级）。 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { countedAssert } from './lib/counted-assert.mjs';
const { assert: bound, record } = countedAssert('smartartEngine');
import { installDomEnv, parseXml } from './lib/dom-env.mjs';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = resolve(import.meta.dirname, '..'),
  out = join(root, 'out/smartart-engine');
mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.mjs');
writeFileSync(
  entry,
  `export { parse as coreParse } from ${JSON.stringify(join(root, 'packages/core/src/index.ts'))};
export { evaluateLayoutDef } from ${JSON.stringify(join(root, 'packages/core/src/diagram-engine.ts'))};
export { parseDataModel } from ${JSON.stringify(join(root, 'packages/core/src/pptx/diagram.ts'))};`,
);

const dist = process.argv.includes('--dist');
const coreModule = dist ? await import(pathToFileURL(join(root, 'packages/core/dist/core.js')).href) : null;
const engineModule = dist
  ? await import(pathToFileURL(join(root, 'packages/core/dist/diagram-engine.js')).href)
  : await bundleBrowser({
      root,
      entry,
      output: join(out, 'contract.mjs'),
      aliases: [
        ['@web-ppt/core/diagram-edit', join(root, 'packages/core/src/diagram-edit.ts')],
        ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
        ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
        ['@web-ppt/edit-core/opc', join(root, 'packages/edit-core/src/opc/index.ts')],
        ['@web-ppt/edit-core/xml', join(root, 'packages/edit-core/src/xml/index.ts')],
        ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
      ],
    });
const ns = engineModule;
const coreParse = dist ? coreModule.parse : ns.coreParse;
const { evaluateLayoutDef, parseDataModel } = ns;
installDomEnv();
void coreParse;

const rootEl = (part) => parseXml(part).doc.documentElement;

const corpusDir = join(root, 'corpus/libreoffice-smartart');
if (!existsSync(corpusDir)) {
  console.log('SmartArt 真实语料缺失（corpus/ 不入库）：node tooling/fetch-corpus.mjs 拉取后重跑');
  record();
  process.exit(0);
}

const SAMPLES = [
  // engine: 引擎接管并全覆盖（形状数与缓存同量级、数据点全绑定）
  { name: 'smartart-snake-rows', layout: 'bList2 / list（snake）', engine: true },
  { name: 'tdf145528_SmartArt_Matrix', layout: 'matrix1 / matrix（composite）', engine: true },
  // fallback: 覆盖守恒触发 → 稳定 reason（orgChart 分支方向与完整约束代数待后续）
  { name: 'smartart-org-chart', layout: 'orgChart1 / hierarchy', engine: false },
  { name: 'smartart-org-chart2', layout: 'orgChart1 / hierarchy（v12 变体）', engine: false },
  { name: 'smartart-cycle-matrix', layout: 'cycle4 / cycle', engine: false },
];

const cachedOf = async (file) => {
  const pres = await coreParse(new Uint8Array(readFileSync(file)), {});
  const shapes = [];
  const texts = [];
  const walk = (els) => {
    for (const e of els) {
      if (e.kind === 'group') walk(e.children);
      else if (e.kind === 'shape') {
        shapes.push(e);
        if (e.text) texts.push(e.text.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(''));
      }
    }
  };
  walk(pres.slides[0].elements);
  return { shapes, texts };
};

for (const sample of SAMPLES) {
  const file = join(corpusDir, `${sample.name}.pptx`);
  if (!existsSync(file)) {
    console.log(`样本缺失：${sample.name}`);
    continue;
  }
  const zip = unzipSync(new Uint8Array(readFileSync(file)));
  const layoutKey = Object.keys(zip).find((k) => k.includes('diagrams/layout'));
  const dataKey = Object.keys(zip).find((k) => k.includes('diagrams/data'));
  const points = parseDataModel(rootEl(Buffer.from(zip[dataKey]).toString()));
  bound.ok(points.length > 0, `${sample.name} 数据点树非空`);

  const result = evaluateLayoutDef(rootEl(Buffer.from(zip[layoutKey]).toString()), points, 720, 360);
  const cached = await cachedOf(file);
  const flatCount = (() => {
    let n = 0;
    const walk = (list) => {
      for (const pt of list) {
        n++;
        walk(pt.children);
      }
    };
    walk(points);
    return n;
  })();

  if (sample.engine) {
    bound.equal(result.reason, null, `${sample.name} 引擎接管（无 reason）`);
    bound.ok(
      result.shapes.length >= cached.shapes.length * 0.6,
      `${sample.name} 形状数与缓存同量级（${result.shapes.length} vs 缓存 ${cached.shapes.length}）`,
    );
    const boundPoints = new Set(result.shapes.map((s) => s.ptId).filter(Boolean));
    bound.equal(boundPoints.size, flatCount, `${sample.name} 数据点全覆盖（${boundPoints.size}/${flatCount}）`);
    bound.ok(
      result.shapes.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && s.w > 0 && s.h > 0),
      `${sample.name} 形状几何有效`,
    );
  } else {
    bound.equal(result.reason, 'incomplete-coverage', `${sample.name} 覆盖守恒触发（稳定 reason）`);
    bound.equal(result.shapes.length, 0, `${sample.name} 不输出不完整结果`);
  }

  console.log(
    `${sample.name} [${sample.layout}]: 缓存 ${cached.shapes.length} 形状 / ${cached.texts.length} 文本 → 引擎 ${result.shapes.length} 形状（reason: ${result.reason ?? '成功'}）`,
  );
}

// ---------------- 确定性：同输入两次求值几何一致 ----------------
{
  const zip = unzipSync(new Uint8Array(readFileSync(join(corpusDir, 'smartart-snake-rows.pptx'))));
  const layoutKey = Object.keys(zip).find((k) => k.includes('diagrams/layout'));
  const dataKey = Object.keys(zip).find((k) => k.includes('diagrams/data'));
  const run = () => {
    const points = parseDataModel(rootEl(Buffer.from(zip[dataKey]).toString()));
    return evaluateLayoutDef(rootEl(Buffer.from(zip[layoutKey]).toString()), points, 720, 360)
      .shapes.map((s) => `${Math.round(s.x)},${Math.round(s.y)},${Math.round(s.w)},${Math.round(s.h)}`)
      .join('|');
  };
  bound.equal(run(), run(), '引擎几何确定性（同输入两次一致）');
}

// ---------------- reason 回退：极简 layoutDef ----------------
{
  const minimal = rootEl(
    `<?xml version="1.0"?><dgm:layoutDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" uniqueId="x"><dgm:layoutNode name="root"><dgm:alg type="lin"/><dgm:shape type="none"/><dgm:presOf/><dgm:constrLst/><dgm:ruleLst/></dgm:layoutNode></dgm:layoutDef>`,
  );
  const points = parseDataModel(
    rootEl(
      `<?xml version="1.0"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:ptLst><dgm:pt modelId="d" type="doc"/><dgm:pt modelId="a"><dgm:t/></dgm:pt></dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="c1" type="parOf" srcId="d" destId="a" srcOrd="0" destOrd="0"/></dgm:cxnLst></dgm:dataModel>`,
    ),
  );
  const result = evaluateLayoutDef(minimal, points, 400, 300);
  bound.equal(result.reason, 'minimal-layout-definition', '极简 layoutDef 返回稳定 reason');
  bound.equal(result.shapes.length, 0, '极简 layoutDef 不输出形状');
}

// ---------------- reason 回退：不支持的算法 ----------------
{
  const unknown = rootEl(
    `<?xml version="1.0"?><dgm:layoutDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:layoutNode name="root"><dgm:alg type="nonexistentAlg"/><dgm:forEach axis="ch"><dgm:layoutNode name="leaf"><dgm:alg type="sp"/></dgm:layoutNode></dgm:forEach></dgm:layoutNode></dgm:layoutDef>`,
  );
  const result = evaluateLayoutDef(
    unknown,
    parseDataModel(
      rootEl(
        `<?xml version="1.0"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:ptLst><dgm:pt modelId="d" type="doc"/><dgm:pt modelId="a"><dgm:t/></dgm:pt></dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="c1" type="parOf" srcId="d" destId="a" srcOrd="0" destOrd="0"/></dgm:cxnLst></dgm:dataModel>`,
      ),
    ),
    400,
    300,
  );
  bound.equal(result.reason, 'unsupported-algorithm', '未知算法返回稳定 reason');
}

record();
console.log('SmartArt 布局定义引擎：真实样本求值、覆盖守恒回退、reason 断言与确定性通过（函数级；接线待层级分支完整后开启）');
