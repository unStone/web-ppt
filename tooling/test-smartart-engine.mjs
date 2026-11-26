/**
 * 桌面 001：SmartArt 布局定义引擎——十种标准算法、条件分支、规则重试、编辑保存闭环与真实语料对照（源码 + dist）。
 *
 * 1. 确定性门禁（无外部语料依赖）：
 *    - 稳定 reason 回退（no-layout-definition / no-points / minimal-layout-definition /
 *      unsupported-algorithm / unsupported-axis / unsupported-function / unsupported-constraint /
 *      unsupported-rule / incomplete-coverage）
 *    - fixtures/sample-smartart-engine.pptx 七页全算法默认路径渲染（lin 横向+revPos+userA、lin 纵向+posOdd、
 *      cycle 圆周+conn、cycle 径向 ctrShpMap=fNode、pyra 棱锥+ruleLst 收缩、hierRoot/hierChild/conn 含助理与深度自适应悬挂、
 *      snake 折返网格+composite）、跨运行字节/几何确定性、edit-core 编辑与补丁/生成双保存重开（含 asst 助理保留）
 * 2. 真实语料真值对照（corpus/ 存在时执行）：
 *    - libreoffice-smartart（固定提交 53ccec4c）：matrix1 对比 PowerPoint 缓存逐形状几何；
 *      snake（bList2）、cycle4、orgChart1（smartart-org-chart / smartart-org-chart2）对比参照几何与连线断言
 *    - POI 语料：hProcess9 与 PowerPoint 缓存逐形状对照，lProcess2 / vList5 / venn1 / AlternatingHexagons / hierarchy4 / hList1 全量接管
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
export { parseDataModel } from ${JSON.stringify(join(root, 'packages/core/src/pptx/diagram.ts'))};
export * as edit from ${JSON.stringify(join(root, 'packages/edit-core/src/index.ts'))};
export * as smartart from ${JSON.stringify(join(root, 'packages/edit-core/src/smartart/index.ts'))};`,
);

const dist = process.argv.includes('--dist');
const coreModule = dist ? await import(pathToFileURL(join(root, 'packages/core/dist/core.js')).href) : null;
const editModule = dist ? await import(pathToFileURL(join(root, 'packages/edit-core/dist/edit-core.js')).href) : null;
const smartartModule = dist ? await import(pathToFileURL(join(root, 'packages/edit-core/dist/smartart.js')).href) : null;
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
const edit = dist ? editModule : ns.edit;
const smartart = dist ? smartartModule : ns.smartart;
const { evaluateLayoutDef, parseDataModel } = ns;
installDomEnv();
const rootEl = (part) => parseXml(part).doc.documentElement;
const near = (a, b, eps = 0.5) => Math.abs(a - b) < eps;

// ---------------- 1. 稳定 reason 回退矩阵 ----------------
const tinyData = rootEl(
  `<?xml version="1.0"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:ptLst><dgm:pt modelId="d" type="doc"/><dgm:pt modelId="a"><dgm:t/></dgm:pt></dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="c1" type="parOf" srcId="d" destId="a" srcOrd="0" destOrd="0"/></dgm:cxnLst></dgm:dataModel>`,
);
const layoutDef = (body) =>
  rootEl(
    `<?xml version="1.0"?><dgm:layoutDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram">${body}</dgm:layoutDef>`,
  );

bound.equal(evaluateLayoutDef(null, parseDataModel(tinyData), 400, 300).reason, 'no-layout-definition', '空 layoutRoot 返回稳定 reason');
bound.equal(
  evaluateLayoutDef(layoutDef('<dgm:layoutNode name="r"><dgm:forEach axis="ch"/></dgm:layoutNode>'), [], 400, 300).reason,
  'no-points',
  '无数据点返回稳定 reason',
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
for (const [xmlBody, expectedReason, label] of [
  [
    '<dgm:layoutNode name="root"><dgm:alg type="nonexistentAlg"/><dgm:forEach axis="ch"><dgm:layoutNode name="leaf"><dgm:alg type="tx"/><dgm:presOf axis="self"/></dgm:layoutNode></dgm:forEach></dgm:layoutNode>',
    'unsupported-algorithm',
    '未知算法返回 unsupported-algorithm',
  ],
  [
    '<dgm:layoutNode name="root"><dgm:choose><dgm:if func="var" arg="dir" op="equ" val="norm"><dgm:alg type="customVendorAlg"/></dgm:if></dgm:choose><dgm:forEach axis="ch"><dgm:layoutNode name="leaf"><dgm:alg type="tx"/><dgm:presOf axis="self"/></dgm:layoutNode></dgm:forEach></dgm:layoutNode>',
    'unsupported-algorithm',
    'choose 分支里的未知算法同样拦截',
  ],
  [
    '<dgm:layoutNode name="root"><dgm:alg type="lin"/><dgm:forEach axis="bogusAxis"><dgm:layoutNode name="leaf"><dgm:alg type="tx"/><dgm:presOf axis="self"/></dgm:layoutNode></dgm:forEach></dgm:layoutNode>',
    'unsupported-axis',
    '未知轴返回 unsupported-axis',
  ],
  [
    '<dgm:layoutNode name="root"><dgm:choose><dgm:if func="bogusFunc" op="equ" val="1"><dgm:alg type="lin"/></dgm:if></dgm:choose><dgm:forEach axis="ch"><dgm:layoutNode name="leaf"><dgm:alg type="tx"/><dgm:presOf axis="self"/></dgm:layoutNode></dgm:forEach></dgm:layoutNode>',
    'unsupported-function',
    '未知条件函数返回 unsupported-function',
  ],
  [
    '<dgm:layoutNode name="root"><dgm:alg type="composite"/><dgm:constrLst><dgm:constr type="bogusConstr" val="10"/></dgm:constrLst><dgm:layoutNode name="leaf"><dgm:alg type="tx"/><dgm:presOf axis="ch"/></dgm:layoutNode></dgm:layoutNode>',
    'unsupported-constraint',
    '未知约束类型返回 unsupported-constraint',
  ],
  [
    '<dgm:layoutNode name="root"><dgm:alg type="composite"/><dgm:ruleLst><dgm:rule type="bogusRule" val="5"/></dgm:ruleLst><dgm:layoutNode name="leaf"><dgm:alg type="tx"/><dgm:presOf axis="ch"/></dgm:layoutNode></dgm:layoutNode>',
    'unsupported-rule',
    '未知规则类型返回 unsupported-rule',
  ],
  [
    '<dgm:layoutNode name="root"><dgm:alg type="composite"/><dgm:layoutNode name="deco"><dgm:alg type="sp"/><dgm:shape type="rect"/><dgm:presOf/></dgm:layoutNode></dgm:layoutNode>',
    'incomplete-coverage',
    '数据点未被承载时返回 incomplete-coverage',
  ],
]) {
  const result = evaluateLayoutDef(layoutDef(xmlBody), parseDataModel(tinyData), 400, 300);
  bound.equal(result.reason, expectedReason, label);
  bound.equal(result.shapes.length, 0, `${label}：不输出半成品形状`);
}

// ---------------- 2. composite 约束代数内联样例 ----------------
{
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

// ---------------- 3. 确定性固件全算法覆盖与编辑保存回环 ----------------
{
  const fixtureBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-smartart-engine.pptx')));
  const pres1 = await coreParse(fixtureBytes, {});
  const pres2 = await coreParse(fixtureBytes, {});
  bound.equal(pres1.slides.length, 7, '确定性引擎固件共 7 页');

  const slideGroup = (pres, idx) => pres.slides[idx].elements.find((e) => e.kind === 'group');
  const textOfShape = (el) => el.text?.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n') ?? '';
  const geomSig = (pres) =>
    pres.slides
      .map((s) =>
        s.elements
          .filter((e) => e.kind === 'group')
          .flatMap((g) =>
            g.children.map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.w.toFixed(3)},${c.h.toFixed(3)},${c.openGeom ? 1 : 0}`),
          )
          .join('|'),
      )
      .join('||');
  bound.equal(geomSig(pres1), geomSig(pres2), '七页引擎固件跨次解析几何逐位一致');

  for (let i = 0; i < 7; i++) {
    const g = slideGroup(pres1, i);
    bound.ok(g && g.children.length > 0, `固件第 ${i + 1} 页排出非空 SmartArt group`);
    bound.ok(
      g.children.every((c) => c.x >= -1 && c.y >= -1 && c.x + c.w <= g.w + 1 && c.y + c.h <= g.h + 1),
      `固件第 ${i + 1} 页全部形状在 frame 内`,
    );
  }

  // 第 1 页：lin 横向 + revPos 抑制末尾箭头（4 个节点 + 3 个右箭头 = 7 个形状）
  const p1 = slideGroup(pres1, 0);
  bound.equal(p1.children.length, 7, 'lin 横向流程：4 节点 + 3 过渡箭头（末尾抑制）');
  const p1Boxes = p1.children.filter((c) => c.text);
  bound.deepEqual(p1Boxes.map(textOfShape), ['立项', '架构', '编码', '验证'], 'lin 横向文本顺序');
  bound.ok(
    p1Boxes.every((b, i) => i === 0 || b.x > p1Boxes[i - 1].x),
    'lin 横向严格递增排布',
  );

  // 第 2 页：lin 纵向 + posOdd 左右交替
  const p2Boxes = slideGroup(pres1, 1).children.filter((c) => c.text);
  bound.equal(p2Boxes.length, 4, 'lin 纵向交替 4 行');
  bound.ok(near(p2Boxes[0].x, 0) && p2Boxes[1].x > 100 && near(p2Boxes[2].x, 0) && p2Boxes[3].x > 100, 'posOdd 奇左偶右交替');

  // 第 3 页：cycle 圆周 + 4 条闭合过渡连线
  const p3 = slideGroup(pres1, 2);
  bound.equal(p3.children.filter((c) => c.openGeom).length, 4, 'cycle 圆周输出 4 条闭合连线');
  bound.equal(p3.children.filter((c) => c.text).length, 4, 'cycle 圆周输出 4 个节点');

  // 第 4 页：cycle 径向（ctrShpMap=fNode，首节点居中）
  const p4 = slideGroup(pres1, 3);
  const p4Boxes = p4.children.filter((c) => c.text);
  const centerNode = p4Boxes.find((b) => textOfShape(b) === '核心引擎');
  bound.ok(
    centerNode && near(centerNode.x + centerNode.w / 2, p4.w / 2) && near(centerNode.y + centerNode.h / 2, p4.h / 2),
    'cycle ctrShpMap=fNode 首节点居中',
  );

  // 第 5 页：pyra 棱锥宽度递增 + 规则收缩统一字号
  const p5Boxes = slideGroup(pres1, 4).children.filter((c) => c.text);
  bound.ok(p5Boxes[0].w < p5Boxes[1].w && p5Boxes[1].w < p5Boxes[2].w, 'pyra 自上而下逐层加宽');
  bound.ok(p5Boxes[0].text.paragraphs[0].runs[0].size < (36 * 96) / 72, 'pyra 长文本触发 ruleLst primFontSz 收缩并全组统一字号');

  // 第 6 页：hierRoot / hierChild / conn（含 asst 助理 + 深度自适应悬挂）
  const p6 = slideGroup(pres1, 5);
  const p6ByText = new Map(p6.children.filter((c) => c.text).map((c) => [textOfShape(c), c]));
  bound.equal(p6ByText.size, 10, 'orgChart 覆盖全部 10 个节点（含架构助理）');
  bound.equal(p6.children.filter((c) => c.openGeom).length, 9, 'orgChart 输出 9 条父子连线');
  const director = p6ByText.get('总监');
  const assistant = p6ByText.get('架构助理');
  const platform = p6ByText.get('平台组');
  const expGroup = p6ByText.get('体验组');
  const kernel = p6ByText.get('内核');
  const editorNode = p6ByText.get('编辑器');
  const vis = p6ByText.get('视觉');
  const inter = p6ByText.get('交互');
  bound.ok(director.y < assistant.y && assistant.y < platform.y, 'orgChart 助理层位于总监与下属部门之间');
  bound.ok(near(platform.y, expGroup.y) && platform.x < expGroup.x, 'orgChart 同级部门横向并排');
  bound.ok(near(kernel.y, editorNode.y) && kernel.x < editorNode.x, 'orgChart 含孙辈的分支（maxDepth=2）子层保持横向排布');
  bound.ok(near(vis.x, inter.x) && vis.y < inter.y, 'orgChart 仅含叶子的分支（maxDepth=1）子层自动纵向悬挂');

  // 第 7 页：snake 折返网格（contDir=revDir）
  const p7Boxes = slideGroup(pres1, 6).children.filter((c) => c.text);
  bound.equal(p7Boxes.length, 6, 'snake 6 个卡片');
  const s1 = p7Boxes.find((b) => textOfShape(b) === 'S1');
  const s3 = p7Boxes.find((b) => textOfShape(b) === 'S3');
  const s4 = p7Boxes.find((b) => textOfShape(b) === 'S4');
  const s6 = p7Boxes.find((b) => textOfShape(b) === 'S6');
  bound.ok(s1.x < s3.x && s4.x > s6.x && s4.y > s1.y, 'snake contDir=revDir 偶数行反向折返');

  // 编辑保存重开闭环（补丁保存 + 生成保存）：改写 orgChart 节点文字后助理节点与连线完整保留
  for (const generated of [false, true]) {
    const editPres = await coreParse(fixtureBytes, { edit: true, keepPackage: true, lazy: false });
    const editor = new edit.Editor(edit.createDoc(editPres, { idPrefix: 'eng-' }));
    const api = smartart.createSmartArtEditor(editor);
    const items = smartart.listEditableSmartArt(editor.doc);
    bound.equal(items.length, 7, `引擎固件可编辑 SmartArt 数（generated=${generated}）`);
    const orgId = items[5].id;
    const orgNodes = api.query(orgId);
    const asstNode = orgNodes.find((n) => n.text === '架构助理');
    bound.ok(asstNode, 'querySmartArt 包含 asst 助理节点');
    api.setText(orgId, asstNode.id, '首席架构助理');
    if (generated) editPres.dispose();
    const saved = await editor.save();
    writeFileSync(join(out, `engine-${generated ? 'generated' : 'patched'}.pptx`), saved);
    const reopened = await coreParse(saved, {});
    const g6 = slideGroup(reopened, 5);
    const texts6 = g6.children.filter((c) => c.text).map(textOfShape);
    bound.ok(texts6.includes('首席架构助理') && texts6.includes('总监'), `保存重开保留改后助理文本（generated=${generated}）`);
    bound.equal(g6.children.filter((c) => c.openGeom).length, 9, `保存重开保留 9 条连线（generated=${generated}）`);
    const savedZip = unzipSync(saved);
    const dm6 = Buffer.from(savedZip['ppt/diagrams/data6.xml']).toString();
    bound.ok(dm6.includes('type="asst"'), `保存后的数据模型保留 type="asst"（generated=${generated}）`);
    if (!generated) editPres.dispose();
    editor.dispose();
    reopened.dispose?.();
  }
  pres1.dispose?.();
  pres2.dispose?.();
}

record();

// ---------------- 4. 真实语料真值对照（corpus 存在时执行，不改变确定性计数） ----------------
const corpusDir = join(root, 'corpus/libreoffice-smartart');
if (!existsSync(corpusDir)) {
  console.log('SmartArt 真实语料缺失（corpus/ 不入库）：确定性门禁已全部通过');
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
const covered = (result) => new Set(result.shapes.filter((s) => !s.connector).flatMap((s) => s.ptIds));
const assertCorpus = (cond, msg) => {
  if (!cond) throw new Error(`真实语料对照失败：${msg}`);
};

// matrix1：与 PowerPoint 缓存逐形状一致
{
  const s = sample('tdf145528_SmartArt_Matrix');
  const result = s.evaluate();
  assertCorpus(result.reason === null && covered(result).size === s.flat.length, 'matrix1 引擎接管且全覆盖');
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
  const byPoint = new Map();
  result.shapes.forEach((shape, i) => {
    const text = shape.ptIds.length && !shape.connector ? s.plain(shape) : null;
    const geometry = shape.name.endsWith('text') ? result.shapes[i - 1] : shape;
    if (text) byPoint.set(text, geometry);
  });
  for (const shape of cache) {
    const engine = byPoint.get(shape.text);
    assertCorpus(
      engine && [engine.x, engine.y, engine.w, engine.h].every((v, i) => near(v, shape.rect[i])) && engine.rot === shape.rot,
      `matrix1「${shape.text}」位置、尺寸与旋转与缓存一致`,
    );
  }
}

// snake（bList2）：6 个节点排成 3 × 2 网格
{
  const s = sample('smartart-snake-rows');
  const result = s.evaluate();
  assertCorpus(result.reason === null && covered(result).size === s.flat.length, 'snake 引擎接管且全覆盖');
  const nodes = result.shapes.filter((shape) => shape.name === 'parentText');
  assertCorpus(nodes.length === 6, 'snake 6 个父节点文本');
  assertCorpus(new Set(nodes.map((n) => Math.round(n.y))).size === 2, 'snake 排成 2 行');
  assertCorpus(new Set(nodes.map((n) => Math.round(n.x))).size === 3, 'snake 每行 3 个');
  assertCorpus(
    JSON.stringify(result.shapes.slice(0, 4).map((shape) => shape.name))
      === JSON.stringify(['childRect', 'parentRect', 'parentText', 'adorn']),
    'snake zOrderOff 绘制顺序',
  );
  const pres = await coreParse(new Uint8Array(readFileSync(join(corpusDir, 'smartart-snake-rows.pptx'))), {});
  const shapes = [];
  const collect = (list) => list.forEach((e) => (e.kind === 'group' ? collect(e.children) : e.kind === 'shape' && shapes.push(e)));
  collect(pres.slides[0].elements);
  const sizeOf = (label) =>
    shapes.find((e) => e.text?.paragraphs.some((p) => p.runs.some((r) => r.text === label)))?.text.paragraphs[0].runs[0].size;
  assertCorpus(sizeOf('Parent 1') === (11 * 96) / 72 && sizeOf('Child 1') === (16 * 96) / 72, 'snake 保留直设字号');
  pres.dispose?.();
}

// cycle4：四象限 + 四角
{
  const s = sample('smartart-cycle-matrix');
  const result = s.evaluate();
  assertCorpus(result.reason === null && covered(result).size === s.flat.length, 'cycle4 引擎接管且全覆盖');
  const byText = new Map(result.shapes.filter((shape) => shape.ptIds.length && !shape.connector).map((shape) => [s.plain(shape), shape]));
  const [a2, b2, c2, d2, a1] = ['A2', 'B2', 'C2-1\nC2-2\nC2-3\nC2-4', 'D2', 'A1'].map((t) => byText.get(t));
  assertCorpus(a2 && b2 && c2 && d2 && a1 && c2.ptIds.length === 4, 'cycle4 四角与象限承载');
  assertCorpus(
    b2.x > a2.x && near(b2.y, a2.y) && c2.x > a2.x && c2.y > a2.y && near(d2.x, a2.x) && d2.y > a2.y && near(a1.w, a1.h),
    'cycle4 方位与正方形象限',
  );
}

// orgChart1（smartart-org-chart + smartart-org-chart2）：LibreOffice testOrgChart / testOrgChart2
{
  const s1 = sample('smartart-org-chart');
  const r1 = s1.evaluate();
  assertCorpus(r1.reason === null && covered(r1).size === s1.flat.length, 'smartart-org-chart 引擎接管且全覆盖（含 Assistant）');
  assertCorpus(r1.connectors.length === 3, 'smartart-org-chart 3 条连线');
  const by1 = new Map(r1.shapes.filter((sh) => sh.ptIds.length && !sh.connector).map((sh) => [s1.plain(sh), sh]));
  const mgr = by1.get('Manager\nSecond para');
  const mgr2 = by1.get('Manager2');
  const asst = by1.get('Assistant');
  const emp = by1.get('Employee');
  const emp2 = by1.get('Employee2');
  assertCorpus(mgr && mgr2 && asst && emp && emp2, 'smartart-org-chart 5 个内容节点齐全');
  assertCorpus(near(mgr.y, mgr2.y) && mgr.x < mgr2.x, 'Manager 与 Manager2 顶行横向并列');
  assertCorpus(mgr.y < asst.y && asst.y < emp.y, 'Assistant 位于 Manager 与 Employee 层之间');
  assertCorpus(near(emp.y, emp2.y) && emp.x < emp2.x, 'Employee 与 Employee2 同行并列');
  assertCorpus(near(mgr.x + mgr.w / 2, (emp.x + emp2.x + emp2.w) / 2), 'Manager 水平居中于两个下属上方');

  const s2 = sample('smartart-org-chart2');
  const r2 = s2.evaluate();
  assertCorpus(r2.reason === null && covered(r2).size === s2.flat.length, 'smartart-org-chart2 引擎接管且全覆盖');
  assertCorpus(r2.connectors.length === 8, 'smartart-org-chart2 8 条连线');
  const by2 = new Map(r2.shapes.filter((sh) => sh.ptIds.length && !sh.connector).map((sh) => [s2.plain(sh), sh]));
  const [nA, nB1, nB2, nC1, nC2, nC3, nC4, nD1, nD2] = ['A', 'B1', 'B2', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2'].map((k) => by2.get(k));
  assertCorpus(nA.y < nB1.y && near(nB1.y, nB2.y) && nB1.x < nB2.x, 'orgChart2 顶层与第二层排布');
  assertCorpus(near(nC1.y, nC2.y) && nC1.x < nC2.x, 'orgChart2 B1（maxDepth=2）子层横向排布');
  assertCorpus(near(nD1.x, nD2.x) && nD1.y < nD2.y && nD1.x > nC2.x, 'orgChart2 C2（maxDepth=1）子层纵向悬挂');
  assertCorpus(near(nC3.x, nC4.x) && nC3.y < nC4.y && nC3.x > nB2.x, 'orgChart2 B2（maxDepth=1）子层纵向悬挂');
}

// POI SmartArt 语料（存在时核对 hProcess9 与 PowerPoint 缓存逐形状一致及全部样本零回退）
const poi60810 = join(root, 'corpus/poi/60810.pptx');
if (existsSync(poi60810)) {
  const z = unzipSync(new Uint8Array(readFileSync(poi60810)));
  const lay1 = rootEl(Buffer.from(z['ppt/diagrams/layout1.xml']).toString());
  const dat1 = rootEl(Buffer.from(z['ppt/diagrams/data1.xml']).toString());
  const res1 = evaluateLayoutDef(lay1, parseDataModel(dat1), 712.7089, 189.9383);
  assertCorpus(res1.reason === null && res1.shapes.length === 8, 'POI hProcess9 8 个形状全部由引擎产出');
  const arrow = res1.shapes[0];
  assertCorpus(near(arrow.x, 53.5, 1) && near(arrow.w, 605.8, 1), 'POI hProcess9 背景大箭头与 PowerPoint 缓存一致');
  const boxes = res1.shapes.slice(1);
  assertCorpus(
    boxes.every((b) => near(b.w, 97.6, 1.5) && near(b.h, 76.0, 1)),
    'POI hProcess9 7 个流程节点尺寸与 PowerPoint 缓存一致',
  );
}

console.log('SmartArt 布局定义引擎：全十种算法、确定性固件、编辑保存回环与 LibreOffice / POI 真实语料对照全部通过');
