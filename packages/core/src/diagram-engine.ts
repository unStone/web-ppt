/**
 * SmartArt 布局定义引擎（ECMA-376 Part 1 §21.4.2 的求值子集）。
 *
 * 与 diagram.ts 的「按算法族手工排布」不同，本文件读真实的 dgm:layoutDef：
 * layoutNode 树（choose/if/else、forEach 轴选择、alg 算法、shape、presOf）、
 * constrLst（w/h/primFontSz/sp/sibSp/secSibSp，refType + for/forName/refFor/
 * refForName 作用域引用）与 ruleLst（primFontSz 收缩）。
 *
 * 明确做到哪一步：约束求值是子集——支持的约束类型与引用形态见下面的
 * SUPPORTED_* 集合；遇到不认识的算法、轴、函数测试或约束类型时求值终止并
 * 返回稳定 reason（unsupported-*），由调用方回退到启发式族布局或占位框。
 * 输出与 diagram.ts 同一形状协议（prst + colorIdx + 连线段），调用方无需
 * 区分来源。
 */

import { attr, kids, numAttr } from './xml';
import { measure } from './chart/util';
import type { DiagramPoint } from './pptx/diagram';
export { parseDataModel } from './pptx/diagram';

export interface EngineShape {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 数据点 id（tx/sp 节点才有） */
  ptId: string | null;
  prst: string;
  /** 布局节点名（约束引用与调试用） */
  name: string;
  /** 求值出的字号（pt）；null = 调用方缺省 */
  fontSz: number | null;
  /** conn 算法的折线路径点（父底边中点 → 子顶边中点） */
  connector: { from: [number, number]; to: [number, number] } | null;
}

/**
 * 引擎开关（模块级，与 setFontDecoder 等 hook 同模式）。默认关闭——
 * 层级分支（hierBranch）与 composite 完整约束代数交付前，默认路径保持
 * 启发式，避免 lint / 编辑链的元素 id 与颜色漂移。宿主显式开启。
 */
let engineEnabled = false;
export const setSmartArtLayoutEngine = (on: boolean): void => {
  engineEnabled = on;
};
export const smartArtLayoutEngineEnabled = (): boolean => engineEnabled;

export type EngineReason =
  | 'unsupported-algorithm'
  | 'unsupported-axis'
  | 'unsupported-algorithm'
  | 'unsupported-axis'
  | 'unsupported-function'
  | 'unsupported-constraint'
  | 'unsupported-rule'
  | 'no-layout-definition'
  | 'no-points'
  | 'minimal-layout-definition'
  | 'incomplete-coverage';

export interface EngineResult {
  shapes: EngineShape[];
  connectors: EngineShape[];
  /** 非 null 表示引擎放弃（调用方按 reason 回退） */
  reason: EngineReason | null;
  /** 引擎求值出的字号（最后一个 tx 节点的值，供 rule 收缩观察） */
  fontSize: number | null;
}

// ---------- 求值中间树 ----------

interface LayoutNode {
  name: string;
  kind: 'node';
  alg: { type: string; params: Map<string, string> } | null;
  shape: { prst: string; blip: boolean } | null;
  hasPresOf: boolean;
  constraints: Constraint[];
  rules: Rule[];
  children: Child[];
}

type Child = { type: 'node'; node: LayoutNode } | { type: 'forEach'; node: ForEach } | { type: 'choose'; node: Choose };

interface ForEach {
  name: string;
  axis: string;
  ptType: string | null;
  st: number;
  cnt: number | null;
  ref: string | null;
  children: Child[];
}

interface Choose {
  name: string;
  branches: { test: IfTest | null; children: Child[] }[];
}

interface IfTest {
  func: string;
  arg: string | null;
  op: string;
  val: string;
  /** func=cnt 时按轴 / 类型选当前点的关联点计数 */
  axis: string | null;
  ptType: string | null;
}

interface Constraint {
  type: string;
  /** 作用域：本节点 self / 后代 des / 祖先 anc / 全部 all；缺省 self */
  for: string;
  forName: string | null;
  ptType: string | null;
  refType: string | null;
  refFor: string | null;
  refForName: string | null;
  op: string;
  fact: number;
  val: number | null;
}

interface Rule {
  type: string;
  val: number | null;
  fact: number;
  /** 收缩步数上限 */
  max: number;
}

const SUPPORTED_ALGORITHMS = new Set(['lin', 'snake', 'cycle', 'pyra', 'hierRoot', 'hierChild', 'conn', 'tx', 'sp', 'composite']);
const SUPPORTED_AXES = new Set(['self', 'ch', 'des', 'sib', 'precedSib', 'followSib', 'anc', 'par', 'selfAndPar', 'root', 'root des']);
const SUPPORTED_CONSTRAINTS = new Set([
  'w',
  'h',
  'ctrX',
  'ctrY',
  'primFontSz',
  'secFontSz',
  'sp',
  'sibSp',
  'secSibSp',
  'alignOff',
  'bendDist',
  'lMarg',
  'rMarg',
  'tMarg',
  'bMarg',
  'begPad',
  'endPad',
  'l',
  't',
  'r',
  'b',
]);

// ---------- 解析 ----------

const parseConstraint = (el: Element): Constraint => ({
  type: attr(el, 'type') ?? '',
  for: attr(el, 'for') ?? 'self',
  forName: attr(el, 'forName'),
  ptType: attr(el, 'ptType'),
  refType: attr(el, 'refType'),
  refFor: attr(el, 'refFor'),
  refForName: attr(el, 'refForName'),
  op: attr(el, 'op') ?? 'equ',
  fact: numAttr(el, 'fact') ?? 1,
  val: numAttr(el, 'val'),
});

const parseRule = (el: Element): Rule => ({
  type: attr(el, 'type') ?? '',
  val: numAttr(el, 'val'),
  fact: numAttr(el, 'fact') ?? 1,
  max: numAttr(el, 'max') ?? 1,
});

function parseChildren(parent: Element, ownName: string): { children: Child[]; reason: EngineReason | null } {
  const children: Child[] = [];
  for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
    const name = attr(c, 'name') ?? ownName;
    if (c.localName === 'layoutNode') {
      const node = parseLayoutNode(c, name);
      if (typeof node === 'string') return { children, reason: node };
      children.push({ type: 'node', node });
    } else if (c.localName === 'forEach') {
      const node = parseForEach(c, name);
      if (typeof node === 'string') return { children, reason: node };
      children.push({ type: 'forEach', node });
    } else if (c.localName === 'choose') {
      const node = parseChoose(c, name);
      if (typeof node === 'string') return { children, reason: node };
      children.push({ type: 'choose', node });
    }
    // alg / shape / constrLst / ruleLst / presOf / varLst / param / adjLst 在
    // parseLayoutNode 内消费；其余元素（extLst、sampleSign）忽略
  }
  return { children, reason: null };
}

function parseLayoutNode(el: Element, name: string): LayoutNode | EngineReason {
  const node: LayoutNode = {
    name: attr(el, 'name') ?? name,
    kind: 'node',
    alg: null,
    shape: null,
    hasPresOf: false,
    constraints: [],
    rules: [],
    children: [],
  };
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === 'alg') {
      const type = attr(c, 'type') ?? 'lin';
      if (!SUPPORTED_ALGORITHMS.has(type)) return 'unsupported-algorithm';
      const params = new Map<string, string>();
      for (const p of kids(c, 'param')) {
        const key = attr(p, 'type');
        const value = attr(p, 'val');
        if (key) params.set(key, value ?? '');
      }
      node.alg = { type, params };
    } else if (c.localName === 'shape') {
      // dgm:shape 的形状名在 type 属性（如 round1Rect），非 prst
      // hasAttribute 是 DOM API；xml-lite 的 LiteElement 没有，用 attr 判空
      node.shape = {
        prst: attr(c, 'type') ?? attr(c, 'prst') ?? 'roundRect',
        blip: attr(c, 'r:blip') !== null || attr(c, 'blipPh') === 'true',
      };
    } else if (c.localName === 'presOf') {
      node.hasPresOf = true;
    } else if (c.localName === 'constrLst') {
      for (const con of kids(c, 'constr')) {
        const parsed = parseConstraint(con);
        if (!SUPPORTED_CONSTRAINTS.has(parsed.type)) return 'unsupported-constraint';
        node.constraints.push(parsed);
      }
    } else if (c.localName === 'ruleLst') {
      for (const rule of kids(c, 'rule')) {
        const parsed = parseRule(rule);
        if (parsed.type !== 'primFontSz') return 'unsupported-rule';
        node.rules.push(parsed);
      }
    }
  }
  const { children, reason } = parseChildren(el, node.name);
  if (reason) return reason;
  node.children = children;
  return node;
}

function parseForEach(el: Element, name: string): ForEach | EngineReason {
  const axis = attr(el, 'axis') ?? 'ch';
  if (!SUPPORTED_AXES.has(axis)) return 'unsupported-axis';
  const ref = attr(el, 'ref');
  const node: ForEach = {
    name: attr(el, 'name') ?? name,
    axis,
    ptType: attr(el, 'ptType'),
    st: numAttr(el, 'st') ?? 0,
    cnt: numAttr(el, 'cnt'),
    ref,
    children: [],
  };
  // ref 引用同层其它 forEach 的属性；真实文件里 ref 目标先出现，这里不校验顺序
  if (ref) {
    const source = findForEachByName(el, ref);
    if (!source) return 'unsupported-axis';
    node.axis = attr(source, 'axis') ?? axis;
    node.ptType = attr(source, 'ptType') ?? node.ptType;
    node.st = numAttr(source, 'st') ?? node.st;
    node.cnt = numAttr(source, 'cnt') ?? node.cnt;
  }
  const { children, reason } = parseChildren(el, node.name);
  if (reason) return reason;
  node.children = children;
  return node;
}

function findForEachByName(el: Element, name: string): Element | null {
  // ref 目标可能在 choose/if 的兄弟分支里：从 layoutDef 根整树找（同名 forEach
  // 在真实文件里唯一）
  let root: Element | null = el;
  while (root.parentElement) root = root.parentElement;
  // kids 只查直接子元素；forEach 藏在 layoutNode/choose 深处，必须递归
  let found: Element | null = null;
  const walk = (node: Element): void => {
    if (found) return;
    for (const child of kids(node, 'forEach')) {
      if (attr(child, 'name') === name) {
        found = child;
        return;
      }
      walk(child);
    }
    for (let c = node.firstElementChild; c; c = c.nextElementSibling) walk(c);
  };
  walk(root);
  return found;
}

function parseChoose(el: Element, name: string): Choose | EngineReason {
  const branches: { test: IfTest | null; children: Child[] }[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName !== 'if' && c.localName !== 'else') continue;
    let test: IfTest | null = null;
    if (c.localName === 'if') {
      test = {
        func: attr(c, 'func') ?? 'var',
        arg: attr(c, 'arg'),
        op: attr(c, 'op') ?? 'equ',
        val: attr(c, 'val') ?? '',
        axis: attr(c, 'axis'),
        ptType: attr(c, 'ptType'),
      };
      if (test.func !== 'var' && test.func !== 'cnt' && test.func !== 'depth' && test.func !== 'maxDepth') return 'unsupported-function';
      if (test.func === 'var' && test.arg !== 'dir' && test.arg !== 'linDir' && test.arg !== 'hierBranch') return 'unsupported-function';
    }
    const { children, reason } = parseChildren(c, name);
    if (reason) return reason;
    branches.push({ test, children });
  }
  return { name: attr(el, 'name') ?? name, branches };
}

// ---------- 求值 ----------

interface PointCtx {
  pt: DiagramPoint;
  parent: PointCtx | null;
}

interface EvalCtx {
  /** 当前 forEach 已选中的点（供轴计算） */
  siblings: PointCtx[];
  index: number;
  /** var/param 环境（choose 的 dir/linDir 测试） */
  dir: 'norm' | 'rev';
  /** varLst 的 hierBranch 变量（组织结构图分支方向），缺省 std */
  hierBranch: string;
  /** 当前点上下文（cnt 带轴测试用） */
  current?: PointCtx;
  /** 数据根（maxDepth 测试用） */
  rootPoint?: PointCtx;
}

/** 求值期的中间形状：矩形已定，待约束修正 */
interface Working {
  node: LayoutNode;
  pt: PointCtx | null;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSz: number | null;
  children: Working[];
  /** 分配到的间距（sibSp），供 lin/snake/hier 使用 */
  sibSp: number;
  secSibSp: number;
  /** 约束对齐偏移（alignOff） */
  alignOff: number;
  bendDist: number;
  /** composite 定位约束（l/t 直接定位、ctrX/ctrY 容器居中） */
  posL: number | null;
  posT: number | null;
  ctrX: boolean;
  ctrY: boolean;
  secFontSz: number | null;
}

/**
 * 按 for/forName/ptType 判断一条约束是否作用于目标节点。
 * for=des：目标是声明节点的后代或自身；for=anc：目标是声明节点的祖先。
 * 两者都以「约束收集时传入的声明位置链」判定。
 */
function constraintTargets(con: Constraint, scopeNode: LayoutNode, target: Working, declaredChain: LayoutNode[]): boolean {
  if (con.forName && scopeNode.name !== con.forName) return false;
  if (con.for === 'self') return target.node === scopeNode;
  if (con.for === 'des') {
    if (con.ptType && con.ptType !== 'node' && con.ptType !== 'all') return false;
    // target 在求值树上是 scopeNode 实例的后代：声明位置链上有 scopeNode，
    // 且 target 的节点类型出现在链尾之后不可靠——按「collect 的调用点保证」：
    // collectConstraints(target, ancestors) 里 ancestors 是 target 的祖先链，
    // 因此 scopeNode ∈ ancestors 即后代（含自身）
    return declaredChain.includes(scopeNode);
  }
  if (con.for === 'anc') return !declaredChain.includes(scopeNode) || target.node !== scopeNode;
  return true;
}

/** 收集祖先链 + 自身声明的、作用于 target 的约束 */
function collectConstraints(target: Working, ancestors: LayoutNode[]): Constraint[] {
  const chain = [...ancestors, target.node];
  const out: Constraint[] = [];
  for (const node of chain) {
    for (const con of node.constraints) {
      if (constraintTargets(con, node, target, chain)) out.push(con);
    }
  }
  return out;
}

/**
 * 引擎主入口。`roots` 为数据点树，`w`/`h` 为 SmartArt frame 尺寸。
 * 任何不支持的构造都终止求值并返回 reason。
 */
export function evaluateLayoutDef(
  layoutRoot: Element | null,
  roots: DiagramPoint[],
  w: number,
  h: number,
  options: { dir?: 'norm' | 'rev'; trace?: (msg: string) => void } = {},
): EngineResult {
  if (!layoutRoot) return { shapes: [], connectors: [], reason: 'no-layout-definition', fontSize: null };
  if (!roots.length) return { shapes: [], connectors: [], reason: 'no-points', fontSize: null };
  const dir = options.dir ?? 'norm';
  const rootChildren = kids(layoutRoot, 'layoutNode');
  const entry = rootChildren[0] ?? null;
  if (!entry) return { shapes: [], connectors: [], reason: 'no-layout-definition', fontSize: null };
  const docPoint: PointCtx = { pt: { id: '', text: null, children: roots, depth: -1, ptType: 'doc' }, parent: null };

  const parse = parseLayoutNode(entry, attr(entry, 'name') ?? 'root');
  if (typeof parse === 'string') return { shapes: [], connectors: [], reason: parse, fontSize: null };
  // 极简版式：入口节点没有任何子树（第三方工具只写算法名，点展开无从表达），
  // 交启发式族布局处理（那里的输出对这类文件已通过验收）。真实版式无论用
  // forEach 拆点还是 composite 平铺，入口下必有子节点。
  if (!parse.children.length) return { shapes: [], connectors: [], reason: 'minimal-layout-definition', fontSize: null };

  const connectors: EngineShape[] = [];
  let lastFontSz: number | null = null;

  const trace = options.trace;
  const say = (msg: string): void => trace?.(msg);

  const runChildren = (
    children: Child[],
    points: PointCtx[],
    box: { x: number; y: number; w: number; h: number },
    ctx: EvalCtx,
    ancestors: LayoutNode[],
  ): Working[] => {
    const out: Working[] = [];
    for (const child of children) {
      if (child.type === 'choose') {
        const branch = pickBranch(child.node, ctx);
        if (!branch) {
          say(`choose ${child.node.name}: 全部分支不匹配，跳过`);
          return out;
        }
        say(`choose ${child.node.name}: 匹配`);
        out.push(...runChildren(branch, points, box, ctx, ancestors));
      } else if (child.type === 'forEach') {
        const got = selectPoints(child.node, points, ctx);
        say(`forEach ${child.node.name} axis=${child.node.axis}: 选中 ${got.length}`);
        out.push(...runForEach(child.node, points, box, ctx, ancestors));
      } else {
        say(`layoutNode ${child.node.name}: alg=${child.node.alg?.type ?? '无'} shape=${child.node.shape ? '有' : '无'}`);
        out.push(...runLayoutNode(child.node, points, box, ctx, ancestors));
      }
    }
    return out;
  };

  const pickBranch = (choose: Choose, ctx: EvalCtx): Child[] | null => {
    for (const branch of choose.branches) {
      if (!branch.test) return branch.children;
      const test = branch.test;
      if (test.func === 'var' && (test.arg === 'dir' || test.arg === 'linDir')) {
        const actual = ctx.dir;
        if (test.op === 'equ' ? actual === test.val : actual !== test.val) return branch.children;
      } else if (test.func === 'var' && test.arg === 'hierBranch') {
        // hierBranch 是 layoutNode varLst 变量，缺省 std；真实文件的 l/r/hang 分支
        // 在缺省链路不匹配时落到 else（初始分支）
        if (test.op === 'equ' ? ctx.hierBranch === test.val : ctx.hierBranch !== test.val) return branch.children;
      } else if (test.func === 'cnt') {
        // 顶层 choose 没有 current 点：回退到数据根容器（docPoint 的 children
        // 就是数据点树），cnt axis=ch 数的正是根的直接子节点数
        const current = ctx.current ?? ctx.rootPoint ?? docPoint;
        let count = 0;
        if (test.axis) {
          const probe: ForEach = { name: 'cnt-probe', axis: test.axis, ptType: test.ptType, st: 0, cnt: null, ref: null, children: [] };
          count = selectPoints(probe, [current], { ...ctx, current }).length;
        } else count = ctx.siblings.length;
        const value = Number(test.val);
        const matches =
          test.op === 'equ'
            ? count === value
            : test.op === 'gte'
              ? count >= value
              : test.op === 'lte'
                ? count <= value
                : test.op === 'gt'
                  ? count > value
                  : count < value;
        if (matches) return branch.children;
      } else if (test.func === 'depth' || test.func === 'maxDepth') {
        const current = ctx.current;
        const value = Number(test.val);
        const actual = test.func === 'depth' ? (current?.pt.depth ?? 0) : maxDepthOf(current ?? ctx.rootPoint);
        const matches =
          test.op === 'equ' ? actual === value : test.op === 'gte' ? actual >= value : test.op === 'lte' ? actual <= value : actual > value;
        if (matches) return branch.children;
      }
    }
    return null;
  };

  const selectPoints = (fe: ForEach, points: PointCtx[], ctx: EvalCtx): PointCtx[] => {
    const current = points[ctx.index] ?? points[0] ?? docPoint;
    // ptType 过滤：nonAsst 是「非助理点的所有点」（含 node），asst 只选助理点
    const filter = (list: PointCtx[]): PointCtx[] =>
      list.filter(
        (p) =>
          !fe.ptType ||
          fe.ptType === 'all' ||
          (fe.ptType === 'nonAsst' ? pointTypeOf(p.pt) !== 'asst' : pointTypeOf(p.pt) === fe.ptType),
      );
    let pool: PointCtx[];
    switch (fe.axis) {
      case 'self':
        pool = filter([current]);
        break;
      case 'ch':
        pool = filter(current.pt.children.map((pt) => ({ pt, parent: current })));
        break;
      case 'des':
        pool = filter(flattenCtx(current));
        break;
      case 'sib':
      case 'followSib':
      case 'precedSib': {
        const sibs: PointCtx[] = current.parent
          ? current.parent.pt.children.map((pt) => ({ pt, parent: current.parent }))
          : points.map((ptCtx) => ({ pt: ptCtx.pt, parent: null }));
        const at = Math.max(
          sibs.findIndex((s) => s.pt.id === current.pt.id),
          0,
        );
        pool = fe.axis === 'sib' ? sibs : fe.axis === 'followSib' ? sibs.slice(at + 1) : sibs.slice(0, Math.max(at, 0));
        pool = filter(pool);
        break;
      }
      case 'root':
      case 'root des': {
        // 文档根（可带 des 合成「root 的全部后代」）
        const docCtx: PointCtx = { pt: { id: '', text: null, children: roots, depth: -1, ptType: 'doc' }, parent: null };
        pool = fe.axis === 'root' ? [docCtx] : filter(flattenCtx(docCtx));
        break;
      }
      case 'anc':
      case 'par':
      case 'selfAndPar': {
        const chain: PointCtx[] = [];
        for (let walk = current.parent; walk; walk = walk.parent) chain.push(walk);
        pool = fe.axis === 'anc' ? filter(chain) : fe.axis === 'par' ? filter(chain.slice(0, 1)) : filter([current, ...chain]);
        break;
      }
      default:
        return [];
    }
    const st = fe.st ?? 0;
    const list = st < 0 ? pool.slice(Math.max(pool.length + st, 0)) : pool.slice(st);
    return fe.cnt !== null ? list.slice(0, fe.cnt) : list;
  };

  const runForEach = (
    fe: ForEach,
    points: PointCtx[],
    box: { x: number; y: number; w: number; h: number },
    ctx: EvalCtx,
    ancestors: LayoutNode[],
  ): Working[] => {
    const selected = selectPoints(fe, points, ctx);
    const out: Working[] = [];
    for (const [index, point] of selected.entries()) {
      // forEach 不是布局节点：子项直接按其内容求值（容器语义透传）
      out.push(
        ...runChildren(
          fe.children,
          [point],
          box,
          { siblings: selected, index, dir, hierBranch: ctx.hierBranch, current: point },
          ancestors,
        ),
      );
    }
    return out;
  };

  const runLayoutNode = (
    node: LayoutNode,
    points: PointCtx[],
    box: { x: number; y: number; w: number; h: number },
    ctx: EvalCtx,
    ancestors: LayoutNode[],
  ): Working[] => {
    const working: Working = {
      node,
      pt: points[ctx.index] ?? null,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fontSz: null,
      children: [],
      sibSp: 0,
      secSibSp: 0,
      alignOff: 0,
      bendDist: 0,
      posL: null,
      posT: null,
      ctrX: false,
      ctrY: false,
      secFontSz: null,
    };
    // 子内容；祖先链带上本节点（des 约束按声明位置链判定）
    const childWorkings = runChildren(node.children, points, box, ctx, [...ancestors, node]);
    working.children = childWorkings;
    // 约束求值（约束声明在含 alg 的 layoutNode 上，作用于本节点与子孙）
    applyConstraints(working, [...ancestors, node]);
    // 算法布局：给 childWorkings 分配矩形
    if (node.alg) layoutByAlgorithm(node, working, childWorkings, box, ancestors);
    // sp/tx 叶子（无子内容且带 shape）本身产出形状
    if (!childWorkings.length && (node.shape || node.alg?.type === 'tx' || node.alg?.type === 'sp')) {
      return [working];
    }
    // 有子内容的节点：自己是容器，产出归子节点；但叶子 sp 节点已在上面返回
    const leaves: Working[] = [];
    const collect = (list: Working[]): void => {
      for (const item of list) {
        if (item.children.length) collect(item.children);
        else leaves.push(item);
      }
    };
    collect(childWorkings);
    // 收集 conn 折线
    if (node.alg?.type === 'conn') {
      for (const [index, item] of childWorkings.entries()) {
        if (index === 0) continue;
        const parent = childWorkings[0];
        const from: [number, number] = [parent.x + parent.w / 2, parent.y + parent.h];
        const to: [number, number] = [item.x + item.w / 2, item.y];
        connectors.push(makeConnector(from, to, working));
      }
    }
    return leaves.length ? leaves : [working];
  };

  const rootWorkings = runChildren(
    parse.children,
    [docPoint],
    { x: 0, y: 0, w, h },
    { siblings: [docPoint], index: 0, dir, hierBranch: 'std' },
    [parse],
  );
  // 规则求值：文本收缩
  const fontSize = applyRules(rootWorkings, parse, roots, w, h);
  lastFontSz = fontSize;

  const shapes: EngineShape[] = [];
  const emit = (list: Working[]): void => {
    for (const item of list) {
      emit(item.children);
      if (item.node.shape || (item.node.alg && (item.node.alg.type === 'tx' || item.node.alg.type === 'sp'))) {
        shapes.push({
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          ptId: item.pt?.pt.id || null,
          prst: item.node.shape?.prst ?? (item.node.alg?.type === 'tx' ? 'roundRect' : 'roundRect'),
          name: item.node.name,
          fontSz: item.fontSz,
          connector: null,
        });
      }
    }
  };
  emit(rootWorkings);
  // 无 forEach 的树（composite 类）形状不带数据点：按布局序与数据点序绑定，
  // 与 PowerPoint 表现层的「第 i 个形状承载第 i 个数据点」一致。
  // forEach 的 ptType 变体（parTrans / sibTrans）会让部分形状绑到连线点上
  //（那些点不在数据点树里）——统一改绑到下一个未占用的数据点。
  const flat = flattenPoints(roots);
  const flatIds = new Set(flat.map((p) => p.id));
  let cursor = 0;
  for (const shape of shapes) {
    if (shape.ptId && flatIds.has(shape.ptId)) {
      const at = flat.findIndex((p) => p.id === shape.ptId);
      if (at >= 0) cursor = Math.max(cursor, at + 1);
      continue;
    }
    if (cursor < flat.length) {
      shape.ptId = flat[cursor].id;
      cursor++;
    }
    // 数据点耗尽后的装饰形状不绑点（ptId=null），文本集合不出现重复项
  }
  // 覆盖守恒：绑定后仍有数据点未被任何形状承载时（某些版本变体的分支在
  // 缺省条件下未展开），引擎结果不完整——返回稳定 reason 让调用方回退
  // 启发式，不输出比启发式更差的结果
  const covered = new Set(shapes.map((shape) => shape.ptId).filter((id) => id && flatIds.has(id)));
  if (covered.size < flat.length) {
    return { shapes: [], connectors: [], reason: 'incomplete-coverage', fontSize: null };
  }
  return { shapes, connectors, reason: null, fontSize: lastFontSz };
}

const makeConnector = (from: [number, number], to: [number, number], host: Working): EngineShape => ({
  x: Math.min(from[0], to[0]),
  y: Math.min(from[1], to[1]),
  w: Math.abs(to[0] - from[0]),
  h: Math.abs(to[1] - from[1]),
  ptId: null,
  prst: 'bentConnector3',
  name: host.node.name,
  fontSz: null,
  connector: { from, to },
});

const flattenPoints = (roots: DiagramPoint[]): DiagramPoint[] => {
  const out: DiagramPoint[] = [];
  const walk = (list: DiagramPoint[]): void => {
    for (const pt of list) {
      out.push(pt);
      walk(pt.children);
    }
  };
  walk(roots);
  return out;
};

const maxDepthOf = (root: PointCtx | undefined): number => {
  if (!root) return 0;
  let max = 0;
  const walk = (ctx: PointCtx, depth: number): void => {
    max = Math.max(max, depth);
    for (const child of ctx.pt.children) walk({ pt: child, parent: ctx }, depth + 1);
  };
  walk(root, 0);
  return max;
};

const flattenCtx = (root: PointCtx): PointCtx[] => {
  const out: PointCtx[] = [];
  const walk = (list: PointCtx[]): void => {
    for (const item of list) {
      out.push(item);
      walk(item.pt.children.map((pt) => ({ pt, parent: item })));
    }
  };
  walk(root.pt.children.map((pt) => ({ pt, parent: root })));
  return out;
};

const pointTypeOf = (pt: DiagramPoint): string => {
  // parseDataModel 携带点的真实类型（node / asst / doc）；forEach 的 ptType
  // 过滤（nonAsst / asst / node）依赖它区分助理点与普通点
  return pt.ptType ?? 'node';
};

/** 约束求值：解析作用于 working 的 w/h/primFontSz/sp/sibSp 等 */
function applyConstraints(working: Working, ancestors: LayoutNode[]): void {
  const constraints = collectConstraints(working, ancestors);
  // 命名引用：refForName 指向的命名节点矩形在同批祖先求值中先产出——求值期
  // 尚无兄弟矩形可查，refBase 按容器尺寸回退（引用解析的已知子集边界）
  const named = new Map<string, Working>();
  for (const con of constraints) {
    if (con.type === 'primFontSz' && con.val !== null) {
      working.fontSz = con.val;
      continue;
    }
    if (con.type === 'alignOff') {
      working.alignOff = con.fact * (con.refType === 'w' ? working.w : working.h);
      continue;
    }
    if (con.type === 'ctrX') {
      working.ctrX = true;
      continue;
    }
    if (con.type === 'ctrY') {
      working.ctrY = true;
      continue;
    }
    if (con.type === 'secFontSz') {
      working.secFontSz = con.val;
      continue;
    }
    undefined;
    if (con.type === 'bendDist') {
      working.bendDist = con.fact * con.val!;
      continue;
    }
    if (['lMarg', 'rMarg', 'tMarg', 'bMarg', 'begPad', 'endPad', 'l', 't', 'r', 'b'].includes(con.type)) continue;
    // w / h / sp / sibSp / secSibSp
    const base = refBase(con, working, named, ancestors);
    if (base === null) continue;
    const value = con.val !== null ? con.val : base * con.fact;
    if (con.type === 'l') {
      working.posL = value;
      continue;
    }
    if (con.type === 't') {
      working.posT = value;
      continue;
    }
    if (con.type === 'w') working.w = value;
    else if (con.type === 'h') working.h = value;
    else if (con.type === 'sp') working.sibSp = value;
    else if (con.type === 'sibSp') working.sibSp = value;
    else if (con.type === 'secSibSp') working.secSibSp = value;
  }
}

/** refType 的基准值：无 refType 用容器尺寸；引用命名节点或已求值量 */
function refBase(con: Constraint, working: Working, named: Map<string, Working>, ancestors: LayoutNode[]): number | null {
  const container = con.refType === 'h' ? working.h : working.w;
  if (!con.refType) return con.type === 'h' ? working.h : working.w;
  if (con.refType === 'w' || con.refType === 'h') {
    // refForName 指向命名节点的该维度
    if (con.refForName) {
      const target = named.get(con.refForName) ?? findNamedIn(ancestors, con.refForName);
      if (!target) return container;
      return con.refType === 'w' ? target.w : target.h;
    }
    return container;
  }
  if (con.refType === 'sp' || con.refType === 'sibSp' || con.refType === 'secSibSp') {
    const target = con.refForName ? (named.get(con.refForName) ?? findNamedIn(ancestors, con.refForName)) : null;
    if (!target) return null;
    return con.refType === 'sp' ? target.sibSp : con.refType === 'sibSp' ? target.sibSp : target.secSibSp;
  }
  if (con.refType === 'primFontSz') {
    const target = con.refForName ? (named.get(con.refForName) ?? findNamedIn(ancestors, con.refForName)) : working;
    return target?.fontSz ?? null;
  }
  return container;
}

function findNamedIn(ancestors: LayoutNode[], name: string): Working | null {
  // 命名节点通常是同名 layoutNode 的另一个实例；引擎按名字找不到已求值矩形时
  // 退回容器尺寸（由调用方的 fact 决定），保持求值继续而不是放弃
  void name;
  void ancestors;
  return null;
}

/** 按算法给 childWorkings 分配矩形 */
function layoutByAlgorithm(
  node: LayoutNode,
  working: Working,
  children: Working[],
  box: { x: number; y: number; w: number; h: number },
  ancestors: LayoutNode[],
): void {
  const alg = node.alg!;
  const params = alg.params;
  const items = children;
  if (!items.length) return;
  const gap = Math.max(working.sibSp, working.secSibSp, 0);
  const linDir = params.get('linDir') ?? 'fromL';

  switch (alg.type) {
    case 'lin': {
      const vertical = linDir === 'fromT' || linDir === 'fromB';
      distribute(items, box, gap, vertical, linDir === 'fromR' || linDir === 'fromB');
      break;
    }
    case 'snake': {
      const contDir = params.get('contDir') ?? 'revDir';
      const vertical = linDir === 'fromT' || linDir === 'fromB';
      const aspect = box.w / Math.max(box.h, 1);
      // 每行/列可容纳的节点数按 1.6 宽高比估
      const perRow = Math.max(Math.ceil(Math.sqrt(items.length * (vertical ? 1 / Math.max(aspect, 0.01) : Math.max(aspect, 0.01)))), 1);
      const rows = Math.ceil(items.length / perRow);
      const cw = (box.w - gap * (perRow - 1)) / perRow;
      const ch = (box.h - gap * (rows - 1)) / rows;
      items.forEach((item, i) => {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        const flipped = contDir === 'revDir' && row % 2 === 1;
        const effectiveCol = flipped ? perRow - 1 - col : col;
        item.w = Math.min(cw, item.w > 0 && item.w !== box.w ? item.w : cw);
        item.h = Math.min(ch, item.h > 0 && item.h !== box.h ? item.h : ch);
        item.x = box.x + effectiveCol * (cw + gap);
        item.y = box.y + row * (ch + gap);
      });
      break;
    }
    case 'cycle': {
      const n = items.length;
      const bw = Math.min(box.w, box.h) * (n <= 4 ? 0.36 : 0.3);
      const bh = bw * 0.62;
      items.forEach((item, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        item.w = Math.min(item.w || bw, bw);
        item.h = Math.min(item.h || bh, bh);
        item.x = box.x + box.w / 2 + ((box.w - bw) / 2) * Math.cos(a) - item.w / 2;
        item.y = box.y + box.h / 2 + ((box.h - bh) / 2) * Math.sin(a) - item.h / 2;
      });
      break;
    }
    case 'pyra': {
      const n = items.length;
      const rowH = box.h / n;
      items.forEach((item, i) => {
        const level = linDir === 'fromB' ? n - 1 - i : i;
        const wide = ((level + 1) / n) * box.w;
        item.x = box.x + (box.w - wide) / 2;
        item.y = box.y + level * rowH;
        item.w = wide;
        item.h = rowH * 0.94;
      });
      break;
    }
    case 'hierRoot': {
      // 自身居中顶部，子分支由 hierChild 排布；这里只放自身（children 已由
      // hierChild 算法分配过的场合不再动）
      if (!items.length) break;
      const first = items[0];
      const selfH = first.h > 0 && first.h !== box.h ? first.h : box.h * 0.3;
      first.w = Math.min(first.w === box.w ? box.w * 0.4 : first.w, box.w);
      first.h = selfH;
      first.x = box.x + (box.w - first.w) / 2;
      first.y = box.y;
      break;
    }
    case 'hierChild': {
      // 组织结构图分支：兄弟分支水平排布（sibSp 间距），每个分支宽度按叶子数加权
      const leafCounts = items.map((item) => Math.max(countLeaves(item), 1));
      const total = leafCounts.reduce((a, b) => a + b, 0);
      const vertical = linDir === 'fromT' || linDir === 'fromB';
      let cursor = box.x + gap / 2;
      const avail = box.w - (gap * (items.length - 1)) / 1;
      items.forEach((item, i) => {
        if (vertical) {
          const rowH = (box.h - gap * (items.length - 1)) / items.length;
          item.x = box.x;
          item.y = box.y + i * (rowH + gap);
          item.w = box.w;
          item.h = rowH;
          return;
        }
        const share = (avail * leafCounts[i]) / total;
        item.x = cursor;
        item.y = box.y;
        item.w = share;
        item.h = box.h;
        cursor += share + gap;
      });
      break;
    }
    case 'conn': {
      // 第一个是父节点，其余子节点水平排布；折线在收集阶段产出
      const parent = items[0];
      const rest = items.slice(1);
      parent.w = Math.min(parent.w === box.w ? box.w * 0.3 : parent.w, box.w);
      parent.x = box.x + (box.w - parent.w) / 2;
      parent.y = box.y;
      const gapInner = Math.max(working.sibSp, box.w * 0.04);
      const cw = (box.w - gapInner * (rest.length - 1)) / Math.max(rest.length, 1);
      rest.forEach((item, i) => {
        item.w = Math.min(item.w === box.w ? cw : item.w, cw);
        item.x = box.x + i * (cw + gapInner);
        item.y = box.y + parent.h + Math.max(working.bendDist, box.h * 0.12);
        item.h = Math.max(box.h - parent.h - Math.max(working.bendDist, box.h * 0.12), box.h * 0.2);
      });
      break;
    }
    case 'tx':
    case 'sp': {
      // 叶子形状：吃满约束后的矩形（缺省容器）
      for (const item of items) {
        item.x = item.x === box.x ? box.x : item.x;
        item.y = item.y === box.y ? box.y : item.y;
      }
      break;
    }
    case 'composite': {
      // 子节点绝对定位：l/t 约束直接定位，ctrX/ctrY 容器居中；都没有则等分
      for (const item of items) {
        if (item.posL !== null) item.x = box.x + item.posL;
        if (item.posT !== null) item.y = box.y + item.posT;
        if (item.ctrX) item.x = box.x + (box.w - item.w) / 2;
        if (item.ctrY) item.y = box.y + (box.h - item.h) / 2;
      }
      break;
    }
    default:
      void linDir;
  }
  void ancestors;
}

const countLeaves = (item: Working): number => {
  if (!item.children.length) return 1;
  return item.children.reduce((sum, child) => sum + countLeaves(child), 0);
};

function distribute(
  items: Working[],
  box: { x: number; y: number; w: number; h: number },
  gap: number,
  vertical: boolean,
  reverse: boolean,
): void {
  const n = items.length;
  if (vertical) {
    const bh = (box.h - gap * (n - 1)) / n;
    items.forEach((item, i) => {
      item.w = Math.min(item.w === box.w ? box.w : item.w, box.w);
      item.h = bh;
      item.x = box.x;
      item.y = box.y + i * (bh + gap);
    });
    if (reverse) {
      const ys = items.map((item) => item.y);
      items.forEach((item, i) => (item.y = ys[items.length - 1 - i]));
    }
    return;
  }
  const bw = (box.w - gap * (n - 1)) / n;
  items.forEach((item, i) => {
    item.w = bw;
    item.h = Math.min(item.h === box.h ? box.h * 0.8 : item.h, box.h);
    item.x = box.x + i * (bw + gap);
    item.y = box.y + (box.h - item.h) / 2;
  });
  if (reverse) {
    const xs = items.map((item) => item.x);
    items.forEach((item, i) => (item.x = xs[items.length - 1 - i]));
  }
}

/**
 * ruleLst 求值：primFontSz 收缩。测量约束矩形内的文字是否放得下，
 * 放不下按 fact 逐步缩小字号，至多 max 步。
 */
function applyRules(rootWorkings: Working[], entry: LayoutNode, roots: DiagramPoint[], w: number, h: number): number | null {
  const findRule = (node: LayoutNode): Rule | null => node.rules.find((r) => r.type === 'primFontSz') ?? null;
  const walk = (list: Working[], ancestors: LayoutNode[]): { working: Working; rule: Rule }[] => {
    const out: { working: Working; rule: Rule }[] = [];
    for (const item of list) {
      const rule = findRule(item.node);
      if (rule && item.fontSz !== null) out.push({ working: item, rule });
      out.push(...walk(item.children, [...ancestors, item.node]));
    }
    return out;
  };
  const targets = walk(rootWorkings, [entry]);
  if (!targets.length) return null;
  let observed: number | null = null;
  for (const { working, rule } of targets) {
    const text = textOfPoint(working, roots);
    if (!text) continue;
    let size = working.fontSz!;
    const start = rule.val ?? size;
    size = Math.min(size, start);
    const maxSteps = rule.max;
    for (let step = 0; step < maxSteps; step++) {
      const lines = Math.max(Math.ceil(measure(text, size) / Math.max(working.w - 8, 12)), 1);
      const lineH = size * 1.22 * lines;
      if (lineH <= working.h - 6) break;
      size = Math.max(size - rule.fact, 5);
    }
    working.fontSz = size;
    observed = size;
  }
  return observed;
}

function textOfPoint(working: Working, roots: DiagramPoint[]): string {
  if (!working.pt) return '';
  const walk = (list: DiagramPoint[]): DiagramPoint | null => {
    for (const pt of list) {
      if (pt.id === working.pt!.pt.id) return pt;
      const found = walk(pt.children);
      if (found) return found;
    }
    return null;
  };
  const pt = walk(roots);
  if (!pt?.text) return '';
  return pt.text.paragraphs
    .map((p) => p.runs.map((r) => r.text).join(''))
    .join('\n')
    .trim();
}

// ---------- 调用方辅助：引擎形状 → 统一 Schema ----------

import { presetGeom } from './geometry';
import type { Fill, ShapeElement, SlideElement, TextBody } from './types';

export interface EngineRenderOptions {
  colors: string[];
  textOf: (id: string) => TextBody | null;
  /** 字号缺省（引擎没给出时用） */
  fallbackFontSize?: number;
}

/** 引擎结果 → SlideElement[]（含连接线）。形状协议与 diagram.ts 一致。 */
export function engineShapesToElements(engine: EngineResult, roots: DiagramPoint[], options: EngineRenderOptions): SlideElement[] {
  const out: SlideElement[] = [];
  const textById = new Map<string, TextBody | null>();
  const collect = (list: DiagramPoint[]): void => {
    for (const pt of list) {
      textById.set(pt.id, pt.text);
      collect(pt.children);
    }
  };
  collect(roots);
  engine.shapes.forEach((shape, shapeIndex) => {
    const text = shape.ptId ? (options.textOf(shape.ptId) ?? textById.get(shape.ptId) ?? null) : null;
    const geom = presetGeom(shape.prst === 'bentConnector3' ? 'roundRect' : shape.prst, shape.w, shape.h, {});
    const color = options.colors[shapeIndex % Math.max(options.colors.length, 1)] ?? 'rgb(68,114,196)';
    const fill: Fill = { type: 'solid', color };
    const el: ShapeElement = {
      kind: 'shape',
      x: shape.x,
      y: shape.y,
      w: shape.w,
      h: shape.h,
      rot: 0,
      flipH: false,
      flipV: false,
      path: geom.d,
      fill,
      stroke: null,
      text,
      name: 'SmartArt 节点',
    };
    if (shape.fontSz !== null) {
      const size = (shape.fontSz * 96) / 72;
      el.text = text
        ? {
            ...text,
            anchor: 'middle',
            paragraphs: text.paragraphs.map((p) => ({
              ...p,
              align: 'center',
              runs: p.runs.map((r) => ({ ...r, size })),
            })),
          }
        : null;
    }
    out.push(el);
  });
  for (const connector of engine.connectors) {
    const { from, to } = connector.connector!;
    const midY = (from[1] + to[1]) / 2;
    const minX = Math.min(from[0], to[0]);
    const minY = Math.min(from[1], to[1]);
    const bw = Math.max(Math.abs(to[0] - from[0]), 1);
    const bh = Math.max(to[1] - from[1], 1);
    out.push({
      kind: 'shape',
      x: minX,
      y: minY,
      w: bw,
      h: bh,
      rot: 0,
      flipH: false,
      flipV: false,
      path: `M ${from[0] - minX} 0 L ${from[0] - minX} ${midY - minY} L ${to[0] - minX} ${midY - minY} L ${to[0] - minX} ${bh}`,
      fill: null,
      stroke: { color: options.colors[0] ?? 'rgb(68,114,196)', width: 1.5, dash: null },
      text: null,
      openGeom: true,
      name: 'SmartArt 连线',
    });
  }
  return out;
}
