/**
 * 桌面 001：布局定义引擎——真实样本 layoutDef 求值与真值对照（函数级 + 默认渲染路径）。
 *
 * 真值来源（语料见 fixtures/corpus.json 的 libreoffice-smartart，固定提交 53ccec4c）：
 * - tdf145528_SmartArt_Matrix：PowerPoint 存出的缓存 drawing（逐形状几何）。
 * - smartart-snake-rows / smartart-cycle-matrix：缓存 drawing 为空，以 LibreOffice 同一提交
 *   sd/qa/unit/import-tests-smartart.cxx 的 testSnakeRows / testCycleMatrix 断言为准。
 * - smartart-org-chart(2)：hierRoot / hierChild 算法未实现，引擎返回稳定 reason 交启发式。
 */
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
const ns = dist
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
const coreParse = dist ? coreModule.parse : ns.coreParse;
const { evaluateLayoutDef, parseDataModel } = ns;
installDomEnv();
const rootEl = (part) => parseXml(part).doc.documentElement;

// ---------------- 无语料：reason 回退 ----------------
const tinyData = rootEl(
  `<?xml version="1.0"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:ptLst><dgm:pt modelId="d" type="doc"/><dgm:pt modelId="a"><dgm:t/></dgm:pt></dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="c1" type="parOf" srcId="d" destId="a" srcOrd="0" destOrd="0"/></dgm:cxnLst></dgm:dataModel>`,
);
const layoutDef = (body) =>
  rootEl(
    `<?xml version="1.0"?><dgm:layoutDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram">${body}</dgm:layoutDef>`,
  );
{
  const result = evaluateLayoutDef(
    layoutDef(
      '<dgm:layoutNode name="root"><dgm:alg type="lin"/><dgm:shape type="none"/><dgm:presOf/><dgm:constrLst/><dgm:ruleLst/></dgm:layoutNode>',
    ),
    parseDataModel(tinyData),
    400,
    300,
  );
  bound.equal(result.reason, 'minimal-layout-definition', '极简 layoutDef 返回稳定 reason');
  bound.equal(result.shapes.length, 0, '极简 layoutDef 不输出形状');
}
for (const alg of ['nonexistentAlg', 'lin', 'hierRoot', 'cycle']) {
  const result = evaluateLayoutDef(
    layoutDef(
      `<dgm:layoutNode name="root"><dgm:alg type="${alg}"/><dgm:forEach axis="ch"><dgm:layoutNode name="leaf"><dgm:alg type="tx"/><dgm:presOf axis="self"/></dgm:layoutNode></dgm:forEach></dgm:layoutNode>`,
    ),
    parseDataModel(tinyData),
    400,
    300,
  );
  bound.equal(result.reason, 'unsupported-algorithm', `未经真值验证的算法 ${alg} 返回稳定 reason`);
}
{
  // choose 分支里的 alg 并入所在 layoutNode（真实文件按 dir 选算法）：分支里的未支持算法同样拒绝
  const result = evaluateLayoutDef(
    layoutDef(
      '<dgm:layoutNode name="root"><dgm:choose><dgm:if func="var" arg="dir" op="equ" val="norm"><dgm:alg type="pyra"/></dgm:if></dgm:choose><dgm:forEach axis="ch"><dgm:layoutNode name="leaf"><dgm:alg type="tx"/><dgm:presOf axis="self"/></dgm:layoutNode></dgm:forEach></dgm:layoutNode>',
    ),
    parseDataModel(tinyData),
    400,
    300,
  );
  bound.equal(result.reason, 'unsupported-algorithm', 'choose 分支里的算法参与支持判定');
}
{
  // composite 约束代数：r/b 与偏移、ctrX/ctrY、refForName 引用兄弟量
  const result = evaluateLayoutDef(
    layoutDef(
      `<dgm:layoutNode name="root"><dgm:alg type="composite"/><dgm:constrLst>
        <dgm:constr type="w" for="ch" forName="a" refType="w" fact="0.25"/>
        <dgm:constr type="h" for="ch" forName="a" refType="h" fact="0.5"/>
        <dgm:constr type="r" for="ch" forName="a" refType="w"/>
        <dgm:constr type="rOff" for="ch" forName="a" refType="w" fact="-0.1"/>
        <dgm:constr type="b" for="ch" forName="a" refType="h"/>
        <dgm:constr type="w" for="ch" forName="b" refType="w" refFor="ch" refForName="a"/>
        <dgm:constr type="h" for="ch" forName="b" refType="w" refFor="ch" refForName="a" fact="0.5"/>
        <dgm:constr type="ctrX" for="ch" forName="b" refType="w" fact="0.5"/>
        <dgm:constr type="ctrY" for="ch" forName="b" refType="h" fact="0.5"/>
      </dgm:constrLst>
      <dgm:layoutNode name="a"><dgm:alg type="tx"/><dgm:shape type="rect"/><dgm:presOf axis="ch" ptType="node"/></dgm:layoutNode>
      <dgm:layoutNode name="b"><dgm:alg type="sp"/><dgm:shape type="ellipse"/><dgm:presOf/></dgm:layoutNode></dgm:layoutNode>`,
    ),
    parseDataModel(tinyData),
    400,
    200,
  );
  bound.equal(result.reason, null, 'composite 约束样例求值成功');
  const [a, b] = result.shapes;
  bound.deepEqual([a.x, a.y, a.w, a.h], [260, 100, 100, 100], 'r + rOff / b 定位与 w/h 引用父尺寸');
  bound.deepEqual([b.x, b.y, b.w, b.h], [150, 75, 100, 50], 'refForName 引用兄弟 w，ctrX/ctrY 居中');
  bound.deepEqual(b.ptIds, [], '空 presOf 的装饰形状不承载数据点');
}

const corpusDir = join(root, 'corpus/libreoffice-smartart');
if (!existsSync(corpusDir)) {
  console.log('SmartArt 真实语料缺失（corpus/ 不入库）：node tooling/fetch-corpus.mjs libreoffice-smartart 拉取后重跑');
  record();
  process.exit(0);
}

const EMU_PX = 12700;
const sample = (name) => {
  const zip = unzipSync(new Uint8Array(readFileSync(join(corpusDir, `${name}.pptx`))));
  const text = (key) => Buffer.from(zip[Object.keys(zip).find((k) => k.includes(key))]).toString();
  const data = rootEl(text('diagrams/data'));
  const textById = new Map();
  for (const pt of data.getElementsByTagName('dgm:pt')) {
    const t = pt.getElementsByTagName('dgm:t')[0];
    if (!t) continue;
    const paragraphs = [...t.getElementsByTagName('a:p')].map((p) => ({
      runs: [...p.getElementsByTagName('a:t')].map((r) => ({ text: r.textContent })),
    }));
    textById.set(pt.getAttribute('modelId'), { paragraphs });
  }
  const frame = Buffer.from(zip['ppt/slides/slide1.xml'])
    .toString()
    .match(/<p:graphicFrame>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"/);
  const points = parseDataModel(data);
  const textOf = (id) => textById.get(id) ?? null;
  const evaluate = () => evaluateLayoutDef(rootEl(text('diagrams/layout')), points, +frame[1] / EMU_PX, +frame[2] / EMU_PX, { textOf });
  const plain = (shape) =>
    shape.ptIds
      .map((id) =>
        textOf(id)
          .paragraphs.map((p) => p.runs.map((r) => r.text).join(''))
          .join('\n'),
      )
      .join('\n');
  const flat = [];
  const walk = (list) => list.forEach((pt) => (flat.push(pt.id), walk(pt.children)));
  walk(points);
  return { zip, text, evaluate, plain, flat, frame: { w: +frame[1] / EMU_PX, h: +frame[2] / EMU_PX } };
};
const covered = (result) => new Set(result.shapes.flatMap((s) => s.ptIds));
const near = (a, b) => Math.abs(a - b) < 0.5;

// ---------------- matrix1：与 PowerPoint 缓存逐形状一致 ----------------
{
  const s = sample('tdf145528_SmartArt_Matrix');
  const result = s.evaluate();
  bound.equal(result.reason, null, 'matrix1 引擎接管');
  bound.equal(covered(result).size, s.flat.length, 'matrix1 数据点全覆盖');
  const drawing = rootEl(s.text('diagrams/drawing'));
  const cache = [...drawing.getElementsByTagName('dsp:sp')].map((sp) => {
    const xfrm = sp.getElementsByTagName('a:xfrm')[0];
    const off = xfrm.getElementsByTagName('a:off')[0];
    const ext = xfrm.getElementsByTagName('a:ext')[0];
    return {
      text: [...sp.getElementsByTagName('a:t')].map((t) => t.textContent).join(''),
      rot: Number(xfrm.getAttribute('rot') ?? 0) / 60000,
      rect: [off.getAttribute('x'), off.getAttribute('y'), ext.getAttribute('cx'), ext.getAttribute('cy')].map((v) => +v / EMU_PX),
    };
  });
  bound.equal(cache.length, 5, 'matrix1 缓存 5 个形状');
  // 缓存把背景形状与其文本合成一个 dsp:sp；引擎按布局定义分开输出——用承载同一数据点的背景形状对照
  const byPoint = new Map();
  result.shapes.forEach((shape, i) => {
    const text = shape.ptIds.length ? s.plain(shape) : null;
    // 文本形状之前紧邻的同名前缀背景（tileN / tileNtext），centerTile 自带文本
    const geometry = shape.name.endsWith('text') ? result.shapes[i - 1] : shape;
    if (text) byPoint.set(text, geometry);
  });
  for (const shape of cache) {
    const engine = byPoint.get(shape.text);
    bound.ok(engine, `matrix1「${shape.text}」有对应引擎形状`);
    bound.ok(
      [engine.x, engine.y, engine.w, engine.h].every((v, i) => near(v, shape.rect[i])) && engine.rot === shape.rot,
      `matrix1「${shape.text}」位置、尺寸与旋转与缓存一致（引擎 ${[engine.x, engine.y, engine.w, engine.h].map((v) => v.toFixed(1))} rot ${engine.rot}）`,
    );
  }
}

// ---------------- snake（bList2）：LibreOffice testSnakeRows——6 个节点排成 2 行 ----------------
{
  const s = sample('smartart-snake-rows');
  const result = s.evaluate();
  bound.equal(result.reason, null, 'snake 引擎接管');
  bound.equal(covered(result).size, s.flat.length, 'snake 数据点全覆盖');
  const nodes = result.shapes.filter((shape) => shape.name === 'parentText');
  bound.equal(nodes.length, 6, 'snake 6 个父节点文本');
  bound.equal(new Set(nodes.map((n) => Math.round(n.y))).size, 2, 'snake 排成 2 行');
  bound.equal(new Set(nodes.map((n) => Math.round(n.x))).size, 3, 'snake 每行 3 个');
  bound.deepEqual(
    result.shapes.slice(0, 4).map((shape) => shape.name),
    ['childRect', 'parentRect', 'parentText', 'adorn'],
    'snake parentText 的 zOrderOff=1 让文本画在 parentRect 之上',
  );
  bound.ok(
    result.shapes.every(
      (shape) => shape.x >= -0.5 && shape.y >= -0.5 && shape.x + shape.w <= s.frame.w + 0.5 && shape.y + shape.h <= s.frame.h + 0.5,
    ),
    'snake 全部形状在 frame 内',
  );
  const run = () =>
    s
      .evaluate()
      .shapes.map((shape) => `${shape.x.toFixed(3)},${shape.y.toFixed(3)},${shape.w.toFixed(3)},${shape.h.toFixed(3)}`)
      .join('|');
  bound.equal(run(), run(), '引擎几何确定性（同输入两次一致）');

  // 默认渲染路径：缓存为空时走引擎；数据模型直设的 sz（父 11pt / 子 16pt）优先于约束字号
  const pres = await coreParse(new Uint8Array(readFileSync(join(corpusDir, 'smartart-snake-rows.pptx'))), {});
  const shapes = [];
  const collect = (list) => list.forEach((e) => (e.kind === 'group' ? collect(e.children) : e.kind === 'shape' && shapes.push(e)));
  collect(pres.slides[0].elements);
  const sizeOf = (label) =>
    shapes.find((e) => e.text?.paragraphs.some((p) => p.runs.some((r) => r.text === label)))?.text.paragraphs[0].runs[0].size;
  bound.equal(sizeOf('Parent 1'), (11 * 96) / 72, '默认路径：父节点保留数据模型直设的 11pt');
  bound.equal(sizeOf('Child 1'), (16 * 96) / 72, '默认路径：子节点保留数据模型直设的 16pt');
  bound.ok(new Set(shapes.map((e) => `${Math.round(e.x)},${Math.round(e.y)}`)).size > 6, '默认路径：形状不再叠放在同一位置');
}

// ---------------- cycle4：LibreOffice testCycleMatrix ----------------
{
  const s = sample('smartart-cycle-matrix');
  const result = s.evaluate();
  bound.equal(result.reason, null, 'cycle4 引擎接管');
  bound.equal(covered(result).size, s.flat.length, 'cycle4 数据点全覆盖');
  const byText = new Map(result.shapes.filter((shape) => shape.ptIds.length).map((shape) => [s.plain(shape), shape]));
  const [a2, b2, c2, d2, a1] = ['A2', 'B2', 'C2-1\nC2-2\nC2-3\nC2-4', 'D2', 'A1'].map((t) => byText.get(t));
  bound.ok(a2 && b2 && c2 && d2 && a1, 'cycle4 A1 / A2 / B2 / C2 / D2 各由一个文本形状承载');
  bound.equal(c2.ptIds.length, 4, 'cycle4 C2 一个形状承载 4 个数据点，按点序');
  bound.ok(b2.x > a2.x && near(b2.y, a2.y), 'cycle4 B2 在 A2 右侧同一行');
  bound.ok(c2.x > a2.x && c2.y > a2.y, 'cycle4 C2 在 A2 右下');
  bound.ok(near(d2.x, a2.x) && d2.y > a2.y, 'cycle4 D2 在 A2 正下方');
  bound.ok(near(a1.w, a1.h), 'cycle4 A1 象限宽高相等');
  const extent = Math.max(...result.shapes.map((shape) => shape.y + shape.h)) - Math.min(...result.shapes.map((shape) => shape.y));
  bound.ok(near(extent, s.frame.h), `cycle4 整体高度等于 frame 高（${extent.toFixed(1)} / ${s.frame.h.toFixed(1)}）`);
  bound.deepEqual(
    result.shapes.filter((shape) => shape.name.startsWith('quadrant')).map((shape) => shape.rot),
    [0, 90, 180, 270],
    'cycle4 四个象限按 choose 分支的 rot 旋转',
  );
}

// ---------------- orgChart1：层级算法未实现，稳定 reason 回退 ----------------
for (const name of ['smartart-org-chart', 'smartart-org-chart2']) {
  const result = sample(name).evaluate();
  bound.equal(result.reason, 'unsupported-algorithm', `${name} hierRoot / hierChild 未实现，返回稳定 reason`);
  bound.equal(result.shapes.length, 0, `${name} 不输出未经验证的排布`);
}

record();
console.log('SmartArt 布局定义引擎：reason 回退、composite 约束代数、matrix1 缓存逐形状、snake / cycle4 参照断言与默认渲染路径通过');
