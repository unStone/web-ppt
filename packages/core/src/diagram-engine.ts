/**
 * SmartArt 布局定义引擎（ECMA-376 Part 1 §21.4.2）。
 *
 * 读真实的 dgm:layoutDef，分两阶段求值：
 * 1. 构建：layoutNode 树按 choose/if/else（var / cnt / depth / maxDepth / pos / revPos / posOdd / posEven）、
 *    forEach 多段轴选择（含 parTrans / sibTrans 过渡点与 hideLastTrans）展开成实例树；choose 分支里的
 *    alg / shape / presOf / constrLst / ruleLst 并入所在 layoutNode；presOf 决定形状承载的数据点。
 * 2. 布局：自顶向下求值十种标准算法（composite / snake / lin / cycle / pyra / hierRoot / hierChild / conn / tx / sp），
 *    处理 for="self|ch|des" 约束与 ruleLst 文本收缩；不认识的构造或覆盖不完整时返回稳定 reason。
 */

import { attr, kids, numAttr } from './xml';
import { measure } from './chart/util';
import { presetGeom } from './geometry';
import type { DiagramPoint } from './pptx/diagram';
import type { Fill, ShapeElement, SlideElement, TextBody } from './types';
export { parseDataModel } from './pptx/diagram';

export interface EngineShape {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 旋转角（度，绕形状中心） */
  rot: number;
  /** 首个承载的数据点 id；无文本的装饰形状或连线为 null */
  ptId: string | null;
  /** 承载的全部数据点 id（presOf 选中的点，按文档序） */
  ptIds: string[];
  prst: string;
  /** 只显示文本、不绘制几何（shape hideGeom 或无几何类型） */
  hideGeom: boolean;
  /** 布局节点名（约束引用与调试用） */
  name: string;
  /** 求值出的字号（pt）；null = 调用方缺省 */
  fontSz: number | null;
  /** 连线路径端点；普通形状为 null */
  connector: { from: [number, number]; to: [number, number] } | null;
}

export type EngineReason =
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
  /** 最后一个带字号的文本形状的字号（pt），供规则收缩观察 */
  fontSize: number | null;
}

// ---------- 解析结构 ----------

interface AxisStep {
  axis: string;
  ptType: string;
  /** 1 起计；负数从末尾计（-1 = 最后一个） */
  st: number;
  /** 0 = 全部 */
  cnt: number;
  /** 步长（缺省 1） */
  step: number;
  /** 是否隐藏末尾兄弟过渡点（缺省 true） */
  hideLastTrans: boolean;
}

interface ShapeSpec {
  /** 预设几何名；null = 无几何（type 缺省或 none） */
  prst: string | null;
  rot: number;
  hideGeom: boolean;
  /** 在兄弟间的绘制层级偏移：从当前位置前移 / 后移的位数 */
  zOrderOff: number;
}

interface Constraint {
  type: string;
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
  /** primFontSz 收缩的下限（pt） */
  val: number | null;
  fact: number;
  max: number;
}

interface NodeProps {
  alg: { type: string; params: Map<string, string> } | null;
  /** undefined = 未声明（分支可覆盖） */
  shape: ShapeSpec | undefined;
  /** undefined = 未声明；null = 声明了但不呈现任何点 */
  presOf: AxisStep[] | null | undefined;
  constraints: Constraint[];
  rules: Rule[];
  vars: Map<string, string>;
}

interface LayoutNode {
  name: string;
  props: NodeProps;
  children: Child[];
}

interface ForEach {
  name: string;
  ref: string | null;
  steps: AxisStep[];
  children: Child[];
}

interface IfTest {
  func: string;
  arg: string | null;
  op: string;
  val: string;
  steps: AxisStep[] | null;
}

interface Branch {
  test: IfTest | null;
  props: NodeProps;
  children: Child[];
}

type Child = { type: 'node'; node: LayoutNode } | { type: 'forEach'; node: ForEach } | { type: 'choose'; branches: Branch[] };

const SUPPORTED_ALGORITHMS = new Set(['composite', 'snake', 'lin', 'cycle', 'pyra', 'hierRoot', 'hierChild', 'conn', 'tx', 'sp']);
const SUPPORTED_AXES = new Set([
  'self',
  'ch',
  'des',
  'desOrSelf',
  'sib',
  'precedSib',
  'followSib',
  'preced',
  'follow',
  'anc',
  'ancst',
  'ancOrSelf',
  'ancstOrSelf',
  'par',
  'root',
  'none',
]);
const POSITIONS = ['l', 't', 'r', 'b', 'ctrX', 'ctrY'];
const OFFSETS = ['lOff', 'tOff', 'rOff', 'bOff', 'ctrXOff', 'ctrYOff', 'wOff', 'hOff'];
const USER_VARS = Array.from({ length: 26 }, (_, i) => `user${String.fromCharCode(65 + i)}`);
const SUPPORTED_CONSTRAINTS = new Set([
  'none',
  'w',
  'h',
  'wArH',
  'hArH',
  ...POSITIONS,
  ...OFFSETS,
  'primFontSz',
  'secFontSz',
  'sp',
  'sibSp',
  'secSibSp',
  'alignOff',
  'bendDist',
  'connDist',
  'diam',
  'stemThick',
  'pyraAcctRatio',
  'lMarg',
  'rMarg',
  'tMarg',
  'bMarg',
  'begMarg',
  'endMarg',
  'begPad',
  'endPad',
  ...USER_VARS,
]);
const SUPPORTED_RULES = new Set(['primFontSz', 'secFontSz', 'w', 'h', 'sp', 'sibSp', 'secSibSp']);
const SUPPORTED_FUNCTIONS = new Set(['var', 'cnt', 'depth', 'maxDepth', 'pos', 'revPos', 'posOdd', 'posEven']);
const SUPPORTED_VARS = new Set([
  'dir',
  'hierBranch',
  'orgChart',
  'chMax',
  'chPref',
  'bulEnabled',
  'bulletEnabled',
  'animOne',
  'animLvl',
  'resizeHandles',
]);
const TEST_OPS = new Set(['equ', 'neq', 'gte', 'lte', 'gt', 'lt']);

type Parsed<T> = T | EngineReason;
const isReason = (value: unknown): value is EngineReason => typeof value === 'string';

const emptyProps = (): NodeProps => ({
  alg: null,
  shape: undefined,
  presOf: undefined,
  constraints: [],
  rules: [],
  vars: new Map(),
});

const parseBool = (raw: string | undefined, fallback: boolean): boolean => {
  if (raw === undefined || raw === '') return fallback;
  return raw !== '0' && raw !== 'false';
};

/** 空格分隔的多段轴（axis="ch ch desOrSelf"），ptType / st / cnt / step / hideLastTrans 按段对应 */
function parseSteps(el: Element): Parsed<AxisStep[]> | null {
  const axisAttr = attr(el, 'axis');
  if (!axisAttr || !axisAttr.trim() || axisAttr.trim() === 'none') return null;
  const axes = axisAttr.trim().split(/\s+/);
  const list = (name: string): string[] => (attr(el, name) ?? '').trim().split(/\s+/).filter(Boolean);
  const types = list('ptType');
  const starts = list('st');
  const counts = list('cnt');
  const stepsList = list('step');
  const hideList = list('hideLastTrans');
  const steps: AxisStep[] = [];
  for (const [i, axis] of axes.entries()) {
    if (!SUPPORTED_AXES.has(axis)) return 'unsupported-axis';
    if (axis === 'none') continue;
    steps.push({
      axis,
      ptType: types[i] ?? 'all',
      st: Number(starts[i] ?? 1),
      cnt: Number(counts[i] ?? 0),
      step: Math.max(Number(stepsList[i] ?? 1) || 1, 1),
      hideLastTrans: parseBool(hideList[i], true),
    });
  }
  return steps.length ? steps : null;
}

const parseConstraint = (el: Element): Constraint => {
  const refType = attr(el, 'refType');
  return {
    type: attr(el, 'type') ?? '',
    for: attr(el, 'for') ?? 'self',
    forName: attr(el, 'forName') || null,
    ptType: attr(el, 'ptType') || null,
    refType: refType && refType !== 'none' ? refType : null,
    refFor: attr(el, 'refFor') || null,
    refForName: attr(el, 'refForName') || null,
    op: attr(el, 'op') ?? 'none',
    fact: numAttr(el, 'fact') ?? 1,
    val: numAttr(el, 'val'),
  };
};

const finiteOr = (value: number | null, fallback: number): number => (value !== null && Number.isFinite(value) ? value : fallback);

/** 读取元素的直接属性子元素（alg / shape / presOf / constrLst / ruleLst / varLst）到 props */
function parseProps(el: Element, props: NodeProps): EngineReason | null {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === 'alg') {
      const type = attr(c, 'type') ?? 'composite';
      if (!SUPPORTED_ALGORITHMS.has(type)) return 'unsupported-algorithm';
      const params = new Map<string, string>();
      for (const p of kids(c, 'param')) {
        const key = attr(p, 'type');
        if (key) params.set(key, attr(p, 'val') ?? '');
      }
      props.alg = { type, params };
    } else if (c.localName === 'shape') {
      const type = attr(c, 'type');
      const hide = attr(c, 'hideGeom');
      props.shape = {
        prst: type && type !== 'none' ? type : null,
        rot: numAttr(c, 'rot') ?? 0,
        hideGeom: hide === '1' || hide === 'true',
        zOrderOff: numAttr(c, 'zOrderOff') ?? 0,
      };
    } else if (c.localName === 'presOf') {
      const steps = parseSteps(c);
      if (isReason(steps)) return steps;
      props.presOf = steps;
    } else if (c.localName === 'constrLst') {
      for (const con of kids(c, 'constr')) {
        const parsed = parseConstraint(con);
        if (!SUPPORTED_CONSTRAINTS.has(parsed.type)) return 'unsupported-constraint';
        if (parsed.refType && !SUPPORTED_CONSTRAINTS.has(parsed.refType)) return 'unsupported-constraint';
        if (parsed.type !== 'none') props.constraints.push(parsed);
      }
    } else if (c.localName === 'ruleLst') {
      for (const rule of kids(c, 'rule')) {
        const ruleType = attr(rule, 'type') ?? '';
        if (!SUPPORTED_RULES.has(ruleType)) return 'unsupported-rule';
        props.rules.push({
          type: ruleType,
          val: numAttr(rule, 'val'),
          fact: finiteOr(numAttr(rule, 'fact'), NaN),
          max: finiteOr(numAttr(rule, 'max'), NaN),
        });
      }
    } else if (c.localName === 'varLst') {
      for (let v = c.firstElementChild; v; v = v.nextElementSibling) {
        const val = attr(v, 'val');
        if (val !== null) props.vars.set(v.localName === 'bulletEnabled' ? 'bulEnabled' : v.localName, val);
      }
    }
  }
  return null;
}

function parseChildren(parent: Element, forEachByName: Map<string, Element>, depth: number): Parsed<Child[]> {
  if (depth > 64) return 'unsupported-axis';
  const children: Child[] = [];
  for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === 'layoutNode') {
      const node = parseLayoutNode(c, forEachByName, depth + 1);
      if (isReason(node)) return node;
      children.push({ type: 'node', node });
    } else if (c.localName === 'forEach') {
      const node = parseForEach(c, forEachByName, depth + 1);
      if (isReason(node)) return node;
      children.push({ type: 'forEach', node });
    } else if (c.localName === 'choose') {
      const branches = parseChoose(c, forEachByName, depth + 1);
      if (isReason(branches)) return branches;
      children.push({ type: 'choose', branches });
    }
  }
  return children;
}

function parseLayoutNode(el: Element, forEachByName: Map<string, Element>, depth: number): Parsed<LayoutNode> {
  const props = emptyProps();
  const reason = parseProps(el, props);
  if (reason) return reason;
  const children = parseChildren(el, forEachByName, depth);
  if (isReason(children)) return children;
  return { name: attr(el, 'name') ?? '', props, children };
}

function parseForEach(el: Element, forEachByName: Map<string, Element>, depth: number): Parsed<ForEach> {
  const ref = attr(el, 'ref') || null;
  const source = ref ? forEachByName.get(ref) : el;
  if (!source) return 'unsupported-axis';
  const steps = parseSteps(el.getAttribute('axis') ? el : source);
  if (isReason(steps)) return steps;
  // 空体的 ref（如 orgChart1 / hierarchy4 的递归树展开）在构建实例树时按数据点惰性解析，避免无界静态展开
  if (ref && !el.firstElementChild) {
    return { name: attr(el, 'name') ?? '', ref, steps: steps ?? [], children: [] };
  }
  const children = parseChildren(el, forEachByName, depth);
  if (isReason(children)) return children;
  return { name: attr(el, 'name') ?? '', ref: null, steps: steps ?? [], children };
}

function parseChoose(el: Element, forEachByName: Map<string, Element>, depth: number): Parsed<Branch[]> {
  const branches: Branch[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName !== 'if' && c.localName !== 'else') continue;
    let test: IfTest | null = null;
    if (c.localName === 'if') {
      const func = attr(c, 'func') ?? '';
      const arg = attr(c, 'arg');
      const op = attr(c, 'op') ?? 'equ';
      if (!SUPPORTED_FUNCTIONS.has(func) || !TEST_OPS.has(op)) return 'unsupported-function';
      if (func === 'var' && (!arg || !SUPPORTED_VARS.has(arg))) return 'unsupported-function';
      const steps = parseSteps(c);
      if (isReason(steps)) return steps;
      test = { func, arg, op, val: attr(c, 'val') ?? '', steps };
    }
    const props = emptyProps();
    const reason = parseProps(c, props);
    if (reason) return reason;
    const children = parseChildren(c, forEachByName, depth);
    if (isReason(children)) return children;
    branches.push({ test, props, children });
  }
  return branches;
}

const collectForEach = (root: Element): Map<string, Element> => {
  const out = new Map<string, Element>();
  const walk = (node: Element): void => {
    for (let c = node.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName === 'forEach') {
        const name = attr(c, 'name');
        if (name && !out.has(name)) out.set(name, c);
      }
      walk(c);
    }
  };
  walk(root);
  return out;
};

// ---------- 构建：实例树 ----------

interface PointCtx {
  pt: DiagramPoint;
  parent: PointCtx | null;
  /** 过渡点（parTrans / sibTrans）对应的目标子节点与是否为末尾兄弟过渡 */
  transTarget?: PointCtx;
  isLastSibTrans?: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Inst {
  name: string;
  props: NodeProps;
  point: PointCtx;
  pts: PointCtx[];
  children: Inst[];
  rect: Rect;
  fontSz: number | null;
}

const pointTypeOf = (pt: DiagramPoint): string => pt.ptType ?? 'node';

const TRANS_TYPES = new Set(['parTrans', 'sibTrans', 'nonNorm']);
const wantsTransition = (ptType: string | null): boolean => !!ptType && TRANS_TYPES.has(ptType);

const typeMatches = (ptType: string | null, point: PointCtx): boolean => {
  if (!ptType || ptType === 'all') return true;
  const actual = pointTypeOf(point.pt);
  // ECMA-376 ST_ElementType：node 涵盖普通节点与助理节点（区别于 doc/pres/trans），norm 仅指普通节点
  if (ptType === 'node') return actual === 'node' || actual === 'asst';
  if (ptType === 'norm') return actual === 'node';
  if (ptType === 'nonAsst') return actual === 'node' || actual === 'doc';
  if (ptType === 'nonNorm') return actual !== 'node';
  return actual === ptType;
};

/** 约束的 ptType 按实例承载的点判定（presOf 选中的首个点），无承载点时按上下文点 */
const instPoint = (inst: Inst): PointCtx => inst.pts[0] ?? inst.point;

const childrenOf = (point: PointCtx): PointCtx[] => point.pt.children.map((pt) => ({ pt, parent: point }));

/** 含过渡点的完整子序列：[parTrans_0, C_0, sibTrans_0, parTrans_1, C_1, sibTrans_1, ...] */
function childrenWithTransitions(point: PointCtx): PointCtx[] {
  const content = childrenOf(point);
  const out: PointCtx[] = [];
  content.forEach((child, idx) => {
    const parId = child.pt.parTransId ?? `#parTrans:${child.pt.id}`;
    const sibId = child.pt.sibTransId ?? `#sibTrans:${child.pt.id}`;
    out.push({
      pt: { id: parId, text: null, children: [], depth: child.pt.depth, ptType: 'parTrans' },
      parent: point,
      transTarget: child,
    });
    out.push(child);
    out.push({
      pt: { id: sibId, text: null, children: [], depth: child.pt.depth, ptType: 'sibTrans' },
      parent: point,
      transTarget: content[idx + 1] ?? content[0],
      isLastSibTrans: idx === content.length - 1,
    });
  });
  return out;
}

const descendantsOf = (point: PointCtx, withTrans = false): PointCtx[] => {
  const out: PointCtx[] = [];
  const walk = (ctx: PointCtx): void => {
    const list = withTrans ? childrenWithTransitions(ctx) : childrenOf(ctx);
    for (const item of list) {
      out.push(item);
      if (item.pt.children.length) walk(item);
    }
  };
  walk(point);
  return out;
};

function axisOf(axis: string, point: PointCtx, doc: PointCtx, includeTrans: boolean): PointCtx[] {
  switch (axis) {
    case 'self':
      return [point];
    case 'ch':
      return includeTrans ? childrenWithTransitions(point) : childrenOf(point);
    case 'des':
      return descendantsOf(point, includeTrans);
    case 'desOrSelf':
      return [point, ...descendantsOf(point, includeTrans)];
    case 'par':
      return point.parent ? [point.parent] : [];
    case 'anc':
    case 'ancst':
    case 'ancOrSelf':
    case 'ancstOrSelf': {
      const chain: PointCtx[] = axis === 'ancOrSelf' || axis === 'ancstOrSelf' ? [point] : [];
      for (let walk = point.parent; walk; walk = walk.parent) chain.push(walk);
      return chain;
    }
    case 'sib':
    case 'precedSib':
    case 'followSib': {
      if (!point.parent) return [];
      const sibs =
        includeTrans || pointTypeOf(point.pt).endsWith('Trans') ? childrenWithTransitions(point.parent) : childrenOf(point.parent);
      const at = sibs.findIndex((s) => s.pt.id === point.pt.id);
      if (axis === 'sib') return sibs;
      if (at < 0) return [];
      return axis === 'precedSib' ? sibs.slice(0, at) : sibs.slice(at + 1);
    }
    case 'preced':
    case 'follow': {
      const all = descendantsOf(doc, includeTrans);
      const at = all.findIndex((s) => s.pt.id === point.pt.id);
      if (at < 0) return [];
      return axis === 'preced' ? all.slice(0, at) : all.slice(at + 1);
    }
    case 'root':
      return [doc];
    default:
      throw new Error(`未登记的轴 ${axis}`);
  }
}

function selectSteps(steps: AxisStep[], from: PointCtx, doc: PointCtx): PointCtx[] {
  let set = [from];
  for (const step of steps) {
    const includeTrans = wantsTransition(step.ptType);
    const pool = set
      .flatMap((point) => axisOf(step.axis, point, doc, includeTrans))
      .filter((point) => {
        if (step.hideLastTrans && point.isLastSibTrans && pointTypeOf(point.pt) === 'sibTrans') return false;
        return typeMatches(step.ptType, point);
      });
    const start = step.st < 0 ? Math.max(pool.length + step.st, 0) : Math.max(step.st - 1, 0);
    const sliced = pool.slice(start);
    const stepped = step.step > 1 ? sliced.filter((_, idx) => idx % step.step === 0) : sliced;
    set = step.cnt > 0 ? stepped.slice(0, step.cnt) : stepped;
  }
  return set;
}

const maxDepthOf = (point: PointCtx): number => {
  let max = 0;
  const walk = (ctx: PointCtx, depth: number): void => {
    max = Math.max(max, depth);
    for (const child of childrenOf(ctx)) walk(child, depth + 1);
  };
  walk(point, 0);
  return max;
};

const normBoolStr = (v: string): string => (v === 'true' ? '1' : v === 'false' ? '0' : v);

const compare = (op: string, actual: number | string, expected: number | string): boolean => {
  const a = typeof actual === 'string' ? normBoolStr(actual) : actual;
  const b = typeof expected === 'string' ? normBoolStr(expected) : expected;
  switch (op) {
    case 'equ':
      return a === b;
    case 'neq':
      return a !== b;
    case 'gte':
      return a >= b;
    case 'lte':
      return a <= b;
    case 'gt':
      return a > b;
    default:
      return a < b;
  }
};

interface IterPos {
  index: number;
  count: number;
}

interface BuildEnv {
  doc: PointCtx;
  dir: 'norm' | 'rev';
  vars: Map<string, string>;
  iter: IterPos;
  forEachDefs: Map<string, ForEach>;
  depth: number;
}

const DEFAULT_VARS: Record<string, string> = {
  dir: 'norm',
  hierBranch: 'std',
  orgChart: '0',
  chMax: '-1',
  chPref: '-1',
  bulEnabled: '0',
  animOne: 'one',
  animLvl: 'none',
  resizeHandles: 'rel',
};

function resolveVar(arg: string, point: PointCtx, env: BuildEnv): string {
  const key = arg === 'bulletEnabled' ? 'bulEnabled' : arg;
  if (key === 'dir') return point.pt.dir ?? (env.vars.get('dir') as 'norm' | 'rev' | undefined) ?? env.dir;
  if (key === 'hierBranch') {
    // 节点上显式设置的分支样式（l / r / hang / std）优先于布局节点 varLst 的 init 缺省
    if (point.pt.hierBranch && point.pt.hierBranch !== 'init') return point.pt.hierBranch;
    return env.vars.get('hierBranch') ?? point.pt.hierBranch ?? 'std';
  }
  return env.vars.get(key) ?? DEFAULT_VARS[key] ?? '';
}

function testMatches(test: IfTest, point: PointCtx, env: BuildEnv): boolean {
  if (test.func === 'var') {
    return compare(test.op, resolveVar(test.arg ?? '', point, env), test.val);
  }
  if (test.func === 'cnt') {
    const count = test.steps ? selectSteps(test.steps, point, env.doc).length : point.parent ? point.parent.pt.children.length : 1;
    return compare(test.op, count, Number(test.val));
  }
  if (test.func === 'pos') return compare(test.op, env.iter.index + 1, Number(test.val));
  if (test.func === 'revPos') return compare(test.op, Math.max(env.iter.count - env.iter.index, 1), Number(test.val));
  if (test.func === 'posOdd') return compare(test.op, (env.iter.index + 1) % 2 === 1 ? 1 : 0, Number(normBoolStr(test.val)));
  if (test.func === 'posEven') return compare(test.op, (env.iter.index + 1) % 2 === 0 ? 1 : 0, Number(normBoolStr(test.val)));
  if (test.func === 'depth') {
    const targets = test.steps ? selectSteps(test.steps, point, env.doc) : [point];
    const d = targets.length ? Math.max(...targets.map((t) => t.pt.depth + 1), 0) : 0;
    return compare(test.op, d, Number(test.val));
  }
  // maxDepth：若末段轴为 des，从前缀轴选出的锚点计算子树最大深度（叶为 0，仅直接子层为 1）
  let anchors = [point];
  if (test.steps?.length) {
    const last = test.steps[test.steps.length - 1];
    if (last.axis === 'des' || last.axis === 'desOrSelf') {
      anchors = test.steps.length > 1 ? selectSteps(test.steps.slice(0, -1), point, env.doc) : [point];
    } else {
      anchors = selectSteps(test.steps, point, env.doc);
    }
  }
  const maxD = anchors.length ? Math.max(...anchors.map(maxDepthOf)) : 0;
  return compare(test.op, maxD, Number(test.val));
}

function mergeProps(into: NodeProps, from: NodeProps): void {
  if (from.alg) into.alg = from.alg;
  if (from.shape !== undefined) into.shape = from.shape;
  if (from.presOf !== undefined) into.presOf = from.presOf;
  into.constraints.push(...from.constraints);
  into.rules.push(...from.rules);
  for (const [k, v] of from.vars) into.vars.set(k, v);
}

function buildInst(node: LayoutNode, point: PointCtx, env: BuildEnv): Inst {
  const vars = new Map(env.vars);
  for (const [k, v] of node.props.vars) vars.set(k, v);
  const inst: Inst = {
    name: node.name,
    props: {
      ...node.props,
      constraints: [...node.props.constraints],
      rules: [...node.props.rules],
      vars: new Map(node.props.vars),
    },
    point,
    pts: [],
    children: [],
    rect: { x: 0, y: 0, w: 0, h: 0 },
    fontSz: null,
  };
  const scopedEnv: BuildEnv = { ...env, vars, depth: env.depth + 1 };
  const expand = (children: Child[], at: PointCtx, curEnv: BuildEnv): void => {
    if (curEnv.depth > 32) return;
    for (const child of children) {
      if (child.type === 'node') inst.children.push(buildInst(child.node, at, curEnv));
      else if (child.type === 'forEach') {
        const target = child.node.ref ? (curEnv.forEachDefs.get(child.node.ref) ?? child.node) : child.node;
        const steps = child.node.steps.length ? child.node.steps : target.steps;
        const body = child.node.children.length ? child.node.children : target.children;
        const selected = selectSteps(steps, at, curEnv.doc);
        selected.forEach((item, index) =>
          expand(body, item, { ...curEnv, iter: { index, count: selected.length }, depth: curEnv.depth + 1 }),
        );
      } else {
        const branch = child.branches.find((b) => !b.test || testMatches(b.test, at, curEnv));
        if (!branch) continue;
        mergeProps(inst.props, branch.props);
        for (const [k, v] of branch.props.vars) curEnv.vars.set(k, v);
        expand(branch.children, at, curEnv);
      }
    }
  };
  expand(node.children, point, scopedEnv);
  inst.pts = inst.props.presOf ? selectSteps(inst.props.presOf, point, scopedEnv.doc) : [];
  return inst;
}

// ---------- 布局：约束代数与十种算法 ----------

const fitAspect = (rect: Rect, ar: number): Rect => {
  if (!(ar > 0) || !(rect.w > 0) || !(rect.h > 0)) return rect;
  if (rect.w / rect.h > ar) {
    const w = rect.h * ar;
    return { x: rect.x + (rect.w - w) / 2, y: rect.y, w, h: rect.h };
  }
  const h = rect.w / ar;
  return { x: rect.x, y: rect.y + (rect.h - h) / 2, w: rect.w, h };
};

type Values = Map<string, number>;

interface DesScope {
  forName: string | null;
  ptType: string | null;
  type: string;
  val: number;
  op: string;
}

function defaultValue(values: Values, type: string, parent: Rect): number {
  const get = (name: string, fallback: number): number => values.get(name) ?? fallback;
  switch (type) {
    case 'w':
      return values.has('l') && values.has('r') ? get('r', 0) - get('l', 0) : parent.w;
    case 'h':
      return values.has('t') && values.has('b') ? get('b', 0) - get('t', 0) : parent.h;
    case 'l':
      return 0;
    case 't':
      return 0;
    case 'r':
      return get('l', 0) + get('w', parent.w);
    case 'b':
      return get('t', 0) + get('h', parent.h);
    case 'ctrX':
      return get('l', 0) + get('w', parent.w) / 2;
    case 'ctrY':
      return get('t', 0) + get('h', parent.h) / 2;
    default:
      return 0;
  }
}

function selfValue(type: string, inst: Inst, selfVars?: Values): number | null {
  const { w, h } = inst.rect;
  switch (type) {
    case 'w':
      return w;
    case 'h':
      return h;
    case 'l':
    case 't':
      return 0;
    case 'r':
      return w;
    case 'b':
      return h;
    case 'ctrX':
      return w / 2;
    case 'ctrY':
      return h / 2;
    case 'diam':
      return selfVars?.get('diam') ?? Math.min(w, h);
    case 'primFontSz':
      return inst.fontSz;
    default:
      return selfVars?.get(type) ?? null;
  }
}

const SIZE_TYPES = new Set(['w', 'h', 'wOff', 'hOff']);

function applyOp(values: Values, type: string, op: string, value: number): void {
  const current = values.get(type);
  if (op === 'gte' && current !== undefined) values.set(type, Math.max(current, value));
  else if (op === 'lte' && current !== undefined) values.set(type, Math.min(current, value));
  else values.set(type, value);
}

/** 求实例自身 for="self" 的标量约束（sp / sibSp / alignOff / user* / w / h 等） */
function evalSelfValues(inst: Inst, inherited: DesScope[]): Values {
  const out: Values = new Map();
  for (const s of inherited) {
    if ((!s.forName || s.forName === inst.name) && typeMatches(s.ptType, instPoint(inst))) {
      applyOp(out, s.type, s.op, s.val);
    }
  }
  for (const con of inst.props.constraints) {
    if (con.for !== 'self' || con.type === 'primFontSz' || con.type === 'secFontSz') continue;
    let value: number | null = null;
    if (con.refType) {
      const base = selfValue(con.refType, inst, out);
      if (base !== null) value = base * con.fact;
    } else if (con.val !== null) {
      value = con.val;
    } else if (!out.has(con.type)) {
      value = 0;
    }
    if (value !== null) applyOp(out, con.type, con.op, value);
  }
  return out;
}

/** 收集当前实例声明的 for="des" 约束，按已求出的量解析为数值作用域向下传递 */
function collectDesScopes(inst: Inst, selfVars: Values, existing: DesScope[]): DesScope[] {
  const next = [...existing];
  const lookupDes = (name: string | null, refType: string): number | null => {
    for (let i = next.length - 1; i >= 0; i--) {
      const item = next[i];
      if (item.type === refType && (!name || item.forName === name)) return item.val;
    }
    return null;
  };
  for (const con of inst.props.constraints) {
    if (con.for !== 'des') continue;
    let val: number | null = null;
    if (con.refType) {
      if (con.refFor === 'des') val = lookupDes(con.refForName, con.refType);
      else val = selfValue(con.refType, inst, selfVars);
      if (val !== null) val *= con.fact;
    } else if (con.val !== null) {
      val = con.val;
    }
    if (val !== null) next.push({ forName: con.forName, ptType: con.ptType, type: con.type, val, op: con.op });
  }
  return next;
}

/**
 * 父节点 for="ch" 约束 + 祖先 for="des" 约束 + 子节点自身 for="self" 约束 → 每个子实例的量表。
 */
function childValues(inst: Inst, desScopes: DesScope[], parentSelf: Values): Map<Inst, Values> {
  const table = new Map<Inst, Values>(inst.children.map((child) => [child, new Map()]));
  const algType = inst.props.alg?.type ?? 'composite';
  if (algType !== 'composite') {
    for (const child of inst.children) {
      const values = table.get(child)!;
      for (const s of desScopes) {
        if (s.type === 'primFontSz' || s.type === 'secFontSz') continue;
        if ((!s.forName || s.forName === child.name) && typeMatches(s.ptType, instPoint(child))) {
          applyOp(values, s.type, s.op, s.val);
        }
      }
    }
  }
  const named = (name: string): Inst | null => inst.children.find((child) => child.name === name) ?? null;
  for (const con of inst.props.constraints) {
    if (con.for !== 'ch' || con.type === 'primFontSz' || con.type === 'secFontSz') continue;
    let value: number | null;
    if (con.refType) {
      if (con.refForName) {
        const target = named(con.refForName);
        if (!target) continue;
        const values = table.get(target)!;
        value = values.get(con.refType) ?? defaultValue(values, con.refType, inst.rect);
      } else value = selfValue(con.refType, inst, parentSelf);
      if (value === null) continue;
      value *= con.fact;
    } else if (con.val !== null) value = con.val;
    else
      value = SIZE_TYPES.has(con.type)
        ? (selfValue(con.type === 'wOff' ? 'w' : con.type === 'hOff' ? 'h' : con.type, inst, parentSelf) ?? 0) * con.fact
        : 0;
    for (const child of inst.children) {
      if (con.forName && child.name !== con.forName) continue;
      if (!typeMatches(con.ptType, instPoint(child))) continue;
      applyOp(table.get(child)!, con.type, con.op, value);
    }
  }
  // 子节点自身的 for="self" 仅在引用父传下来的 userA..userZ 变量且父级未显式约束该量时回填（避免把无量纲自约束当像素值）
  for (const child of inst.children) {
    const values = table.get(child)!;
    for (const con of child.props.constraints) {
      if (con.for !== 'self' || !con.refType?.startsWith('user') || values.has(con.type)) continue;
      const base = values.get(con.refType);
      if (base !== undefined) applyOp(values, con.type, con.op, base * con.fact);
    }
  }
  return table;
}

/** composite：由量表解出子矩形（相对父矩形） */
function compositeRect(values: Values, parent: Rect): Rect {
  const off = (name: string): number => values.get(name) ?? 0;
  const pos = (name: string): number | undefined => {
    const v = values.get(name);
    return v === undefined ? undefined : v + off(`${name}Off`);
  };
  const axis = (start: string, end: string, center: string, size: string, total: number): [number, number] => {
    const a = pos(start);
    const b = pos(end);
    const c = pos(center);
    let length = values.get(size);
    if (length === undefined) length = a !== undefined && b !== undefined ? b - a : total;
    length += off(`${size}Off`);
    const origin = a !== undefined ? a : b !== undefined ? b - length : c !== undefined ? c - length / 2 : 0;
    return [origin, length];
  };
  const [x, w] = axis('l', 'r', 'ctrX', 'w', parent.w);
  const [y, h] = axis('t', 'b', 'ctrY', 'h', parent.h);
  return { x: parent.x + x, y: parent.y + y, w, h };
}

function selfAspect(child: Inst): number | null {
  const ar = Number(child.props.alg?.params.get('ar'));
  if (child.props.alg?.type === 'composite' && ar > 0) return 1 / ar;
  let w: number | null = null;
  let h: number | null = null;
  for (const con of child.props.constraints) {
    if (con.for !== 'self') continue;
    const base: number | null = con.refType === 'w' ? w : con.refType === 'h' ? h : null;
    const value: number | null = con.refType ? (base === null ? null : base * con.fact) : con.val;
    if (value === null) continue;
    if (con.type === 'w') w = value;
    else if (con.type === 'h') h = value;
  }
  return w && h ? h / w : null;
}

function snakeGap(inst: Inst): { rel: number; abs: number } {
  for (const con of inst.props.constraints) {
    if ((con.type !== 'sp' && con.type !== 'sibSp') || con.for !== 'self') continue;
    if (con.refForName && con.refType === 'w') return { rel: con.fact, abs: 0 };
    if (con.val !== null) return { rel: 0, abs: con.val };
  }
  return { rel: 0, abs: 0 };
}

function snakeRects(inst: Inst): Rect[] {
  const isSpacer = (ch: Inst): boolean =>
    pointTypeOf(ch.point.pt) === 'sibTrans' || (ch.props.alg?.type === 'sp' && !ch.props.shape?.prst && ch.pts.length === 0);
  const cellIndices: number[] = [];
  inst.children.forEach((ch, idx) => {
    if (!isSpacer(ch)) cellIndices.push(idx);
  });
  const rects: Rect[] = inst.children.map(() => ({ x: inst.rect.x, y: inst.rect.y, w: 0, h: 0 }));
  const n = cellIndices.length;
  if (!n) return rects;
  const box = inst.rect;
  const params = inst.props.alg!.params;
  const aspect = cellIndices.map((idx) => selfAspect(inst.children[idx])).find((a) => a !== null) ?? 1;
  const gap = snakeGap(inst);
  const byRow = (params.get('flowDir') ?? 'row') === 'row';
  const W = byRow ? box.w : box.h;
  const H = byRow ? box.h : box.w;
  const a = byRow ? aspect : 1 / aspect;
  let best = { per: 1, size: 0 };
  for (let per = 1; per <= n; per++) {
    const rows = Math.ceil(n / per);
    const fromW = (W - (per - 1) * gap.abs) / (per + (per - 1) * gap.rel);
    const fromH = (H - (rows - 1) * gap.abs) / (rows * a + (rows - 1) * gap.rel);
    const size = Math.min(fromW, fromH);
    if (size > best.size + 1e-9) best = { per, size };
  }
  const cell = best.size;
  const cellOther = cell * a;
  const space = gap.abs + gap.rel * cell;
  const rows = Math.ceil(n / best.per);
  const totalW = best.per * cell + (best.per - 1) * space;
  const totalH = rows * cellOther + (rows - 1) * space;
  const grDir = params.get('grDir') ?? 'tL';
  const fromRight = grDir === 'tR' || grDir === 'bR';
  const fromBottom = grDir === 'bL' || grDir === 'bR';
  const revRows = (params.get('contDir') ?? 'sameDir') === 'revDir';
  const centerRows = (params.get('off') ?? 'ctr') === 'ctr';
  cellIndices.forEach((childIdx, i) => {
    const row = Math.floor(i / best.per);
    const inRow = Math.min(best.per, n - row * best.per);
    let col = i % best.per;
    if (revRows && row % 2 === 1) col = inRow - 1 - col;
    const rowW = inRow * cell + (inRow - 1) * space;
    const lead = (W - totalW) / 2 + (centerRows ? (totalW - rowW) / 2 : 0);
    let u = lead + col * (cell + space);
    let v = (H - totalH) / 2 + row * (cellOther + space);
    if (fromRight) u = W - u - cell;
    if (fromBottom) v = H - v - cellOther;
    rects[childIdx] = byRow ? { x: box.x + u, y: box.y + v, w: cell, h: cellOther } : { x: box.x + v, y: box.y + u, w: cellOther, h: cell };
  });
  return rects;
}

/** lin（ECMA-376 §21.4.2.15）：沿主轴线性排布，超宽/超高时按权重比例收缩 */
function linearRects(inst: Inst, table: Map<Inst, Values>, selfVars: Values): Rect[] {
  const items = inst.children;
  const n = items.length;
  if (!n) return [];
  const box = inst.rect;
  const params = inst.props.alg!.params;
  const linDir = params.get('linDir') ?? 'fromL';
  const horiz = linDir === 'fromL' || linDir === 'fromR';
  const reversed = linDir === 'fromR' || linDir === 'fromB';
  const primaryTotal = horiz ? box.w : box.h;
  const crossTotal = horiz ? box.h : box.w;
  const primaryKey = horiz ? 'w' : 'h';
  const crossKey = horiz ? 'h' : 'w';
  const hasExplicitSpacers = items.some((ch) => ch.props.alg?.type === 'sp' && !ch.props.shape?.prst && ch.pts.length === 0);
  const implicitGap = hasExplicitSpacers ? 0 : (selfVars.get('sibSp') ?? selfVars.get('sp') ?? 0);
  const nonSpacers = Math.max(items.filter((ch) => ch.props.alg?.type !== 'sp' || ch.props.shape?.prst || ch.pts.length > 0).length, 1);

  const desired = items.map((ch) => {
    const v = table.get(ch)!;
    const explicit = v.get(primaryKey);
    if (explicit !== undefined && explicit > 0) return explicit;
    if (ch.props.alg?.type === 'sp' && !ch.props.shape?.prst && ch.pts.length === 0) return primaryTotal * 0.04;
    return (primaryTotal - implicitGap * Math.max(n - 1, 0)) / nonSpacers;
  });

  const rawSpan = desired.reduce((a, b) => a + b, 0) + implicitGap * Math.max(n - 1, 0);
  const scale = rawSpan > primaryTotal && rawSpan > 0 ? primaryTotal / rawSpan : 1;
  const sizes = desired.map((d) => d * scale);
  const gap = implicitGap * scale;
  const usedSpan = sizes.reduce((a, b) => a + b, 0) + gap * Math.max(n - 1, 0);

  const align = horiz ? (params.get('horzAlign') ?? 'l') : (params.get('vertAlign') ?? 't');
  let cursor =
    align === 'ctr' || align === 'mid'
      ? (primaryTotal - usedSpan) / 2
      : align === 'r' || align === 'b' || reversed
        ? primaryTotal - usedSpan
        : 0;
  if (reversed) cursor = primaryTotal - cursor;

  const crossAlign = horiz ? (params.get('nodeVertAlign') ?? 'mid') : (params.get('nodeHorzAlign') ?? 'ctr');
  return items.map((ch, i) => {
    const v = table.get(ch)!;
    const pSize = sizes[i];
    const pOrigin = reversed ? cursor - pSize : cursor;
    cursor += reversed ? -(pSize + gap) : pSize + gap;
    const rawCross = v.get(crossKey);
    const cSize = rawCross !== undefined && rawCross > 0 ? Math.min(rawCross, crossTotal) : crossTotal;
    let cOrigin =
      crossAlign === 'l' || crossAlign === 't'
        ? 0
        : crossAlign === 'r' || crossAlign === 'b'
          ? crossTotal - cSize
          : (crossTotal - cSize) / 2;
    if (horiz && v.has('t')) cOrigin = v.get('t')!;
    else if (horiz && v.has('ctrY')) cOrigin = v.get('ctrY')! - cSize / 2;
    else if (!horiz && v.has('l')) cOrigin = v.get('l')!;
    else if (!horiz && v.has('ctrX')) cOrigin = v.get('ctrX')! - cSize / 2;
    return horiz
      ? { x: box.x + pOrigin, y: box.y + cOrigin, w: pSize, h: cSize }
      : { x: box.x + cOrigin, y: box.y + pOrigin, w: cSize, h: pSize };
  });
}

interface PlacedConn {
  inst: Inst;
  from: [number, number];
  to: [number, number];
  prst: string;
}

/** cycle（ECMA-376 §21.4.2.8）：圆周分布，支持 ctrShpMap=fNode 中心映射与过渡连线 */
function layoutCycleInst(inst: Inst, table: Map<Inst, Values>, selfVars: Values, conns: PlacedConn[]): Rect[] {
  const box = inst.rect;
  const params = inst.props.alg!.params;
  const stAng = Number(params.get('stAng') ?? 0);
  const spanAng = Number(params.get('spanAng') ?? 360);
  const fNodeCenter = params.get('ctrShpMap') === 'fNode';
  const rotPath = params.get('rotPath') === 'alongPath';

  const nodeIndices: number[] = [];
  inst.children.forEach((ch, idx) => {
    if (ch.props.alg?.type !== 'conn') nodeIndices.push(idx);
  });
  const rects: Rect[] = inst.children.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
  if (!nodeIndices.length) return rects;

  const ringIndices = fNodeCenter && nodeIndices.length > 1 ? nodeIndices.slice(1) : nodeIndices;
  const count = ringIndices.length;
  const minSide = Math.min(box.w, box.h);
  const sampleV = table.get(inst.children[ringIndices[0]])!;
  const defaultW = minSide * (count <= 4 ? 0.32 : Math.max(0.18, 1.4 / count));
  const defaultH = defaultW * 0.65;
  const bw = Math.min(sampleV.get('w') ?? defaultW, box.w * 0.45);
  const bh = Math.min(sampleV.get('h') ?? defaultH, box.h * 0.45);

  if (fNodeCenter && nodeIndices.length > 0) {
    const cIdx = nodeIndices[0];
    const cv = table.get(inst.children[cIdx])!;
    const cw = Math.min(cv.get('w') ?? minSide * 0.3, box.w * 0.48);
    const ch = Math.min(cv.get('h') ?? cw, box.h * 0.48);
    rects[cIdx] = { x: box.x + (box.w - cw) / 2, y: box.y + (box.h - ch) / 2, w: cw, h: ch };
  }

  const diam = selfVars.get('diam');
  const rx = diam ? Math.min(diam / 2, (box.w - bw) / 2) : Math.max((box.w - bw) / 2, 0);
  const ry = diam ? Math.min(diam / 2, (box.h - bh) / 2) : Math.max((box.h - bh) / 2, 0);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const denom = Math.abs(spanAng) >= 360 ? Math.max(count, 1) : Math.max(count - 1, 1);

  const angles = new Map<number, number>();
  ringIndices.forEach((childIdx, k) => {
    const deg = stAng + (k * spanAng) / denom;
    angles.set(childIdx, deg);
    const rad = ((deg - 90) * Math.PI) / 180;
    rects[childIdx] = {
      x: cx + rx * Math.cos(rad) - bw / 2,
      y: cy + ry * Math.sin(rad) - bh / 2,
      w: bw,
      h: bh,
    };
    if (rotPath && inst.children[childIdx].props.shape) {
      inst.children[childIdx].props.shape = { ...inst.children[childIdx].props.shape!, rot: deg };
    }
  });

  // 圆周节点之间的 conn 连线：连接相邻节点边缘点
  inst.children.forEach((ch, idx) => {
    if (ch.props.alg?.type !== 'conn') return;
    const prevNode = [...ringIndices].reverse().find((nIdx) => nIdx < idx) ?? ringIndices[ringIndices.length - 1];
    const nextNode = ringIndices.find((nIdx) => nIdx > idx) ?? ringIndices[0];
    if (prevNode === undefined || nextNode === undefined || prevNode === nextNode) return;
    const a = rects[prevNode];
    const b = rects[nextNode];
    const acx = a.x + a.w / 2;
    const acy = a.y + a.h / 2;
    const bcx = b.x + b.w / 2;
    const bcy = b.y + b.h / 2;
    const dx = bcx - acx;
    const dy = bcy - acy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const from: [number, number] = [acx + ux * (a.w * 0.45), acy + uy * (a.h * 0.45)];
    const to: [number, number] = [bcx - ux * (b.w * 0.45), bcy - uy * (b.h * 0.45)];
    rects[idx] = {
      x: Math.min(from[0], to[0]),
      y: Math.min(from[1], to[1]),
      w: Math.max(Math.abs(to[0] - from[0]), 1),
      h: Math.max(Math.abs(to[1] - from[1]), 1),
    };
    conns.push({ inst: ch, from, to, prst: 'curvedConnector3' });
  });
  return rects;
}

/** pyra（ECMA-376 §21.4.2.19）：按层纵向切分棱锥梯形带，支持正置 fromT 与倒置 fromB */
function pyramidRects(inst: Inst, selfVars: Values): Rect[] {
  const items = inst.children;
  const n = items.length;
  if (!n) return [];
  const box = inst.rect;
  const params = inst.props.alg!.params;
  const inverted = params.get('linDir') === 'fromB';
  const gap = Math.min(selfVars.get('sibSp') ?? selfVars.get('sp') ?? box.h * 0.02, (box.h * 0.25) / Math.max(n, 1));
  const bandH = (box.h - gap * Math.max(n - 1, 0)) / n;
  return items.map((ch, i) => {
    const level = inverted ? n - 1 - i : i;
    // composite 子层（带侧边说明框）给全宽交子层约束拆分；纯层节点按梯形比例递增宽度
    const isCompositeBand = ch.props.alg?.type === 'composite' && ch.children.length > 1;
    const w = isCompositeBand ? box.w : box.w * ((level + 1) / n);
    return {
      x: box.x + (box.w - w) / 2,
      y: box.y + i * (bandH + gap),
      w,
      h: bandH,
    };
  });
}

// ---------- 层级算法：hierRoot / hierChild / conn（ECMA-376 §21.4.2.12–13, §21.4.2.7） ----------

interface HierBox {
  w: number;
  h: number;
  place: (ox: number, oy: number) => void;
}

interface HierMetrics {
  unitW: number;
  unitH: number;
  vGap: number;
  hGap: number;
}

function deriveHierMetrics(root: Inst, desScopes: DesScope[]): HierMetrics {
  const wScope = desScopes.find((s) => s.type === 'w' && s.forName?.startsWith('rootComposite'));
  const hScope = desScopes.find((s) => s.type === 'h' && s.forName?.startsWith('rootComposite'));
  const spScope = desScopes.find((s) => s.type === 'sp' && s.forName?.startsWith('hierRoot'));
  const sibScope = desScopes.find((s) => s.type === 'sibSp');
  const unitW = wScope && wScope.val > 0 ? wScope.val : 120;
  const unitH = hScope && hScope.val > 0 ? hScope.val : unitW * 0.5;
  const vGap = spScope && spScope.val > 0 ? spScope.val : unitW * 0.21;
  const hGap = sibScope && sibScope.val > 0 ? sibScope.val : unitW * 0.21;
  void root;
  return { unitW, unitH, vGap, hGap };
}

function isAssistantContainer(inst: Inst): boolean {
  if (inst.props.alg?.type !== 'hierChild') return false;
  return inst.children.some((c) => c.props.alg?.type === 'hierRoot' && pointTypeOf(c.point.pt) === 'asst');
}

function measureHier(inst: Inst, m: HierMetrics, placed: Map<Inst, Rect>): HierBox {
  const algType = inst.props.alg?.type;
  if (algType === 'hierChild') {
    const subtrees = inst.children.filter((c) => c.props.alg?.type !== 'conn');
    if (!subtrees.length) {
      return {
        w: 0,
        h: 0,
        place: (ox, oy) => {
          placed.set(inst, { x: ox, y: oy, w: 0, h: 0 });
        },
      };
    }
    const boxes = subtrees.map((sub) => measureHier(sub, m, placed));
    const params = inst.props.alg!.params;
    const linDir = params.get('linDir') ?? 'fromL';
    const secLinDir = params.get('secLinDir') ?? 'none';
    const vertical = linDir === 'fromT' || linDir === 'fromB' || secLinDir === 'fromT';
    if (vertical) {
      const w = Math.max(...boxes.map((b) => b.w));
      const h = boxes.reduce((s, b) => s + b.h, 0) + m.vGap * Math.max(boxes.length - 1, 0);
      const chAlign = params.get('chAlign') ?? 'l';
      return {
        w,
        h,
        place: (ox, oy) => {
          placed.set(inst, { x: ox, y: oy, w, h });
          let cy = oy;
          for (const b of boxes) {
            const cx = chAlign === 'r' ? ox + w - b.w : ox;
            b.place(cx, cy);
            cy += b.h + m.vGap;
          }
        },
      };
    }
    const ordered = linDir === 'fromR' ? [...boxes].reverse() : boxes;
    const w = ordered.reduce((s, b) => s + b.w, 0) + m.hGap * Math.max(ordered.length - 1, 0);
    const h = Math.max(...ordered.map((b) => b.h));
    return {
      w,
      h,
      place: (ox, oy) => {
        placed.set(inst, { x: ox, y: oy, w, h });
        let cx = ox;
        for (const b of ordered) {
          b.place(cx, oy);
          cx += b.w + m.hGap;
        }
      },
    };
  }

  if (algType === 'hierRoot') {
    const head = inst.children.find((c) => c.props.alg?.type !== 'hierChild' && c.props.alg?.type !== 'conn') ?? null;
    const childContainers = inst.children.filter((c) => c.props.alg?.type === 'hierChild');
    const asstContainers = childContainers.filter(isAssistantContainer);
    const normContainers = childContainers.filter((c) => !isAssistantContainer(c));

    const asstBoxes = asstContainers.map((c) => measureHier(c, m, placed)).filter((b) => b.w > 0 && b.h > 0);
    const normBoxes = normContainers.map((c) => measureHier(c, m, placed)).filter((b) => b.w > 0 && b.h > 0);

    const hierAlign = inst.props.alg!.params.get('hierAlign') ?? 'tCtrDes';
    const alignOffCon = inst.props.constraints.find((c) => c.type === 'alignOff' && c.val !== null);
    const alignOff = alignOffCon?.val ?? (hierAlign === 'tL' || hierAlign === 'tR' ? 0.25 : 0);

    const headW = head ? m.unitW : 0;
    const headH = head ? m.unitH : 0;
    const asstH = asstBoxes.reduce((s, b) => s + b.h, 0) + m.vGap * Math.max(asstBoxes.length - 1, 0);
    const asstW = asstBoxes.length ? Math.max(...asstBoxes.map((b) => b.w)) : 0;
    const normH = normBoxes.reduce((s, b) => s + b.h, 0) + m.vGap * Math.max(normBoxes.length - 1, 0);
    const normW = normBoxes.length ? Math.max(...normBoxes.map((b) => b.w)) : 0;

    // 计算相对水平区间 [minX, maxX]，以 head 左边缘为 0
    let minX = 0;
    let maxX = headW;
    const asstOffsetX = headW * 0.5 + m.hGap * 0.35;
    if (asstW > 0) maxX = Math.max(maxX, asstOffsetX + asstW);

    let normRelX = 0;
    if (normW > 0) {
      if (hierAlign === 'tL') {
        normRelX = headW * alignOff;
        maxX = Math.max(maxX, normRelX + normW);
      } else if (hierAlign === 'tR') {
        normRelX = headW * (1 - alignOff) - normW;
        minX = Math.min(minX, normRelX);
      } else {
        normRelX = headW / 2 - normW / 2;
        minX = Math.min(minX, normRelX);
        maxX = Math.max(maxX, normRelX + normW);
      }
    }

    const totalW = maxX - minX;
    let totalH = headH;
    if (asstH > 0) totalH += m.vGap + asstH;
    if (normH > 0) totalH += m.vGap + normH;

    return {
      w: totalW,
      h: totalH,
      place: (ox, oy) => {
        placed.set(inst, { x: ox, y: oy, w: totalW, h: totalH });
        const shiftX = ox - minX;
        let curY = oy;
        if (head) {
          placed.set(head, { x: shiftX, y: curY, w: headW, h: headH });
          curY += headH;
        }
        if (asstBoxes.length) {
          curY += m.vGap;
          for (const b of asstBoxes) {
            b.place(shiftX + asstOffsetX, curY);
            curY += b.h + m.vGap;
          }
          curY -= m.vGap;
        }
        if (normBoxes.length) {
          curY += m.vGap;
          for (const b of normBoxes) {
            b.place(shiftX + normRelX, curY);
            curY += b.h + m.vGap;
          }
        }
        // 空容器也登记零矩形
        for (const c of childContainers) {
          if (!placed.has(c)) placed.set(c, { x: shiftX, y: curY, w: 0, h: 0 });
        }
      },
    };
  }

  return {
    w: m.unitW,
    h: m.unitH,
    place: (ox, oy) => {
      placed.set(inst, { x: ox, y: oy, w: m.unitW, h: m.unitH });
    },
  };
}

function findNamedDescendant(root: Inst, prefix: string): Inst | null {
  if (root.name === prefix || root.name.startsWith(prefix)) return root;
  for (const ch of root.children) {
    if (ch.props.alg?.type === 'hierChild' || ch.props.alg?.type === 'hierRoot') continue;
    const hit = findNamedDescendant(ch, prefix);
    if (hit) return hit;
  }
  return null;
}

function headVisibleBox(hierRoot: Inst): Inst | null {
  const head = hierRoot.children.find((c) => c.props.alg?.type !== 'hierChild' && c.props.alg?.type !== 'conn');
  if (!head) return null;
  return head.children.find((c) => c.props.alg?.type === 'tx') ?? head;
}

/** 布局完整层级子树（入口可为 hierChild 或 hierRoot），再布局各节点的内部 composite 并路由 conn 连线 */
function layoutHierarchyTree(
  entry: Inst,
  box: Rect,
  parent: Inst | null,
  fontScopes: FontScope[],
  desScopes: DesScope[],
  conns: PlacedConn[],
): void {
  const selfVars = evalSelfValues(entry, desScopes);
  const nextDes = collectDesScopes(entry, selfVars, desScopes);
  const metrics = deriveHierMetrics(entry, nextDes);
  const rawPlaced = new Map<Inst, Rect>();
  const rootBox = measureHier(entry, metrics, rawPlaced);
  rawPlaced.clear();
  rootBox.place(0, 0);

  const scale = rootBox.w > 0 && rootBox.h > 0 ? Math.min(box.w / rootBox.w, box.h / rootBox.h) : 1;
  const offsetX = box.x + (box.w - rootBox.w * scale) / 2;
  const offsetY = box.y + (box.h - rootBox.h * scale) / 2;
  const scaleRect = (r: Rect): Rect => ({
    x: offsetX + r.x * scale,
    y: offsetY + r.y * scale,
    w: r.w * scale,
    h: r.h * scale,
  });

  // 递归写入缩放后的矩形，并对非层级子容器（如 rootComposite）执行常规约束布局
  const applyTree = (node: Inst, par: Inst | null, fScopes: FontScope[], dScopes: DesScope[]): void => {
    const placed = rawPlaced.get(node);
    if (placed) node.rect = scaleRect(placed);
    node.fontSz = fontFor(node, par, fScopes);
    const nestedFont = [...fScopes, ...desFonts(node)];
    const sv = evalSelfValues(node, dScopes);
    const nestedDes = collectDesScopes(node, sv, dScopes);
    const algType = node.props.alg?.type;
    if (algType === 'hierChild' || algType === 'hierRoot') {
      for (const ch of node.children) {
        if (ch.props.alg?.type === 'conn') {
          ch.fontSz = null;
          continue;
        }
        if (ch.props.alg?.type === 'hierChild' || ch.props.alg?.type === 'hierRoot') {
          applyTree(ch, node, nestedFont, nestedDes);
        } else {
          layout(ch, scaleRect(rawPlaced.get(ch) ?? { x: 0, y: 0, w: 0, h: 0 }), node, nestedFont, nestedDes, conns);
        }
      }
    }
  };
  applyTree(entry, parent, fontScopes, desScopes);

  // 路由所有 conn 实例：每个 conn 位于 hierChild 内，紧邻其后的 hierRoot 为目标子树，外层 hierRoot 为源节点
  const routeConns = (node: Inst, enclosingHierRoot: Inst | null): void => {
    const currentRoot = node.props.alg?.type === 'hierRoot' ? node : enclosingHierRoot;
    if (node.props.alg?.type === 'hierChild' && currentRoot) {
      for (let i = 0; i < node.children.length; i++) {
        const ch = node.children[i];
        if (ch.props.alg?.type !== 'conn') continue;
        const targetHierRoot = node.children.slice(i + 1).find((sib) => sib.props.alg?.type === 'hierRoot') ?? null;
        const srcBox = headVisibleBox(currentRoot);
        const dstBox = targetHierRoot ? headVisibleBox(targetHierRoot) : null;
        if (!srcBox || !dstBox) continue;
        const params = ch.props.alg.params;
        const srcNodeName = params.get('srcNode') ?? null;
        const srcAnchor = srcNodeName ? (findNamedDescendant(currentRoot, srcNodeName) ?? srcBox) : srcBox;
        const endPts = params.get('endPts') ?? 'tCtr';
        const sideEntry = endPts.includes('midL') || endPts.includes('midR');
        const fromX = srcAnchor.rect.x + srcAnchor.rect.w / 2;
        const fromY = srcBox.rect.y + srcBox.rect.h;
        if (sideEntry) {
          const enterLeft = dstBox.rect.x + dstBox.rect.w / 2 >= fromX;
          const toX = enterLeft ? dstBox.rect.x : dstBox.rect.x + dstBox.rect.w;
          const toY = dstBox.rect.y + dstBox.rect.h / 2;
          ch.rect = {
            x: Math.min(fromX, toX),
            y: Math.min(fromY, toY),
            w: Math.max(Math.abs(toX - fromX), 1),
            h: Math.max(Math.abs(toY - fromY), 1),
          };
          conns.push({ inst: ch, from: [fromX, fromY], to: [toX, toY], prst: 'bentConnector2' });
        } else {
          const toX = dstBox.rect.x + dstBox.rect.w / 2;
          const toY = dstBox.rect.y;
          ch.rect = {
            x: Math.min(fromX, toX),
            y: Math.min(fromY, toY),
            w: Math.max(Math.abs(toX - fromX), 1),
            h: Math.max(Math.abs(toY - fromY), 1),
          };
          conns.push({
            inst: ch,
            from: [fromX, fromY],
            to: [toX, toY],
            prst: params.get('connRout') === 'stra' ? 'straightConnector1' : 'bentConnector3',
          });
        }
      }
    }
    for (const ch of node.children) routeConns(ch, currentRoot);
  };
  routeConns(entry, null);
}

interface FontScope {
  forName: string | null;
  ptType: string | null;
  val: number;
}

const desFonts = (inst: Inst): FontScope[] =>
  inst.props.constraints
    .filter((con) => con.type === 'primFontSz' && con.for === 'des' && con.val !== null && !con.refType)
    .map((con) => ({ forName: con.forName, ptType: con.ptType, val: con.val! }));

function fontFor(inst: Inst, parent: Inst | null, scopes: FontScope[]): number | null {
  for (const con of inst.props.constraints) {
    if (con.type === 'primFontSz' && con.for === 'self' && con.val !== null && !con.refType) return con.val;
  }
  for (const con of parent?.props.constraints ?? []) {
    if (con.type !== 'primFontSz' || con.for !== 'ch' || con.val === null || con.refType) continue;
    if ((!con.forName || con.forName === inst.name) && typeMatches(con.ptType, instPoint(inst))) return con.val;
  }
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if ((!scope.forName || scope.forName === inst.name) && typeMatches(scope.ptType, instPoint(inst))) return scope.val;
  }
  return null;
}

function layout(inst: Inst, rect: Rect, parent: Inst | null, scopes: FontScope[], desScopes: DesScope[], conns: PlacedConn[]): void {
  const alg = inst.props.alg;
  if (alg?.type === 'hierChild' || alg?.type === 'hierRoot') {
    layoutHierarchyTree(inst, rect, parent, scopes, desScopes, conns);
    return;
  }
  const ar = Number(alg?.params.get('ar'));
  inst.rect = alg?.type === 'composite' && ar > 0 ? fitAspect(rect, ar) : rect;
  inst.fontSz = fontFor(inst, parent, scopes);
  if (!inst.children.length) return;
  const nestedFont = [...scopes, ...desFonts(inst)];
  const selfVars = evalSelfValues(inst, desScopes);
  const nestedDes = collectDesScopes(inst, selfVars, desScopes);

  if (alg?.type === 'snake') {
    snakeRects(inst).forEach((childRect, i) => layout(inst.children[i], childRect, inst, nestedFont, nestedDes, conns));
    return;
  }
  if (alg?.type === 'lin') {
    const table = childValues(inst, nestedDes, selfVars);
    linearRects(inst, table, selfVars).forEach((childRect, i) => layout(inst.children[i], childRect, inst, nestedFont, nestedDes, conns));
    return;
  }
  if (alg?.type === 'cycle') {
    const table = childValues(inst, nestedDes, selfVars);
    layoutCycleInst(inst, table, selfVars, conns).forEach((childRect, i) => {
      if (inst.children[i].props.alg?.type !== 'conn') layout(inst.children[i], childRect, inst, nestedFont, nestedDes, conns);
    });
    return;
  }
  if (alg?.type === 'pyra') {
    pyramidRects(inst, selfVars).forEach((childRect, i) => layout(inst.children[i], childRect, inst, nestedFont, nestedDes, conns));
    return;
  }
  // composite（及未声明算法的容器）：约束代数定位，并路由可能直接声明的 conn 子节点
  const table = childValues(inst, nestedDes, selfVars);
  for (const child of inst.children) {
    if (child.props.alg?.type === 'conn') {
      const r = compositeRect(table.get(child)!, inst.rect);
      child.rect = r;
      conns.push({ inst: child, from: [r.x, r.y + r.h / 2], to: [r.x + r.w, r.y + r.h / 2], prst: 'straightConnector1' });
    } else {
      layout(child, compositeRect(table.get(child)!, inst.rect), inst, nestedFont, nestedDes, conns);
    }
  }
}

// ---------- 文本与规则 ----------

type TextOf = (id: string) => TextBody | null;

function plainText(points: PointCtx[], textOf: TextOf): string {
  return points
    .map((point) => {
      const body = textOf(point.pt.id) ?? point.pt.text;
      return body ? body.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n') : '';
    })
    .filter(Boolean)
    .join('\n');
}

function shrinkFont(inst: Inst, textOf: TextOf): void {
  if (inst.fontSz === null) return;
  const text = plainText(inst.pts, textOf);
  if (!text) return;
  const rule = inst.props.rules.find((r) => r.type === 'primFontSz');
  const floor = rule?.val ?? 5;
  const step = (size: number): number => (rule && rule.fact > 0 && rule.fact < 1 ? size * rule.fact : size - 1);
  const limit = rule && Number.isFinite(rule.max) && rule.max > 0 ? rule.max : 200;
  const fits = (size: number): boolean => {
    const px = (size * 96) / 72;
    const width = Math.max(inst.rect.w * 0.84, 1);
    const lines = text.split('\n').reduce((sum, line) => sum + Math.max(Math.ceil(measure(line, px) / width), 1), 0);
    return lines * px * 1.2 <= inst.rect.h * 0.9;
  };
  let size = inst.fontSz;
  for (let i = 0; i < limit && size > floor && !fits(size); i++) size = Math.max(step(size), floor);
  inst.fontSz = size;
}

// ---------- 入口 ----------

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

function zOrdered(children: Inst[]): Inst[] {
  const offset = (inst: Inst): number => inst.props.shape?.zOrderOff ?? 0;
  return children
    .map((inst, index) => ({ inst, index, key: index + offset(inst) }))
    .sort((a, b) => a.key - b.key || offset(a.inst) - offset(b.inst) || a.index - b.index)
    .map((entry) => entry.inst);
}

const failed = (reason: EngineReason): EngineResult => ({ shapes: [], connectors: [], reason, fontSize: null });

export interface EvaluateOptions {
  dir?: 'norm' | 'rev';
  /** 数据点文本（parseDataModel 不解析文本）；用于溢出收缩的文字测量，缺省时不收缩 */
  textOf?: (id: string) => TextBody | null;
}

/**
 * 引擎主入口。`roots` 为数据点树，`w`/`h` 为 SmartArt frame 尺寸（px）。
 * 任何不支持的构造都终止求值并返回 reason；数据点未被文本形状全部承载时返回 incomplete-coverage。
 */
export function evaluateLayoutDef(
  layoutRoot: Element | null,
  roots: DiagramPoint[],
  w: number,
  h: number,
  options: EvaluateOptions = {},
): EngineResult {
  const textOf: TextOf = options.textOf ?? (() => null);
  if (!layoutRoot) return failed('no-layout-definition');
  if (!roots.length) return failed('no-points');
  const entry = kids(layoutRoot, 'layoutNode')[0] ?? null;
  if (!entry) return failed('no-layout-definition');
  if (!['layoutNode', 'forEach', 'choose'].some((name) => kids(entry, name).length)) return failed('minimal-layout-definition');
  const forEachMap = collectForEach(layoutRoot);
  const parsed = parseLayoutNode(entry, forEachMap, 0);
  if (isReason(parsed)) return failed(parsed);
  const forEachDefs = new Map<string, ForEach>();
  const indexForEach = (children: Child[]): void => {
    for (const child of children) {
      if (child.type === 'node') indexForEach(child.node.children);
      else if (child.type === 'forEach') {
        if (child.node.name && child.node.children.length && !forEachDefs.has(child.node.name)) {
          forEachDefs.set(child.node.name, child.node);
        }
        indexForEach(child.node.children);
      } else {
        for (const branch of child.branches) indexForEach(branch.children);
      }
    }
  };
  indexForEach(parsed.children);

  const doc: PointCtx = { pt: { id: '', text: null, children: roots, depth: -1, ptType: 'doc' }, parent: null };
  const tree = buildInst(parsed, doc, {
    doc,
    dir: options.dir ?? 'norm',
    vars: new Map(),
    iter: { index: 0, count: 1 },
    forEachDefs,
    depth: 0,
  });
  const placedConns: PlacedConn[] = [];
  layout(tree, { x: 0, y: 0, w, h }, null, [], [], placedConns);
  const connByInst = new Map(placedConns.map((c) => [c.inst, c]));

  // 文本收缩后同名节点取最小字号；当祖先声明 for="des" op="equ" primFontSz 时（如 orgChart1），全树统一字号
  const isText = (inst: Inst): boolean => inst.props.alg?.type === 'tx' && inst.pts.some((p) => !pointTypeOf(p.pt).endsWith('Trans'));
  const uniformAllFonts = tree.props.constraints.some(
    (c) => c.type === 'primFontSz' && c.for === 'des' && c.op === 'equ' && c.val === null,
  );
  const smallest = new Map<string, number>();
  let globalMinFont = Infinity;
  const shrink = (inst: Inst): void => {
    if (isText(inst)) {
      shrinkFont(inst, textOf);
      if (inst.fontSz !== null) {
        smallest.set(inst.name, Math.min(smallest.get(inst.name) ?? Infinity, inst.fontSz));
        globalMinFont = Math.min(globalMinFont, inst.fontSz);
      }
    }
    inst.children.forEach(shrink);
  };
  shrink(tree);

  const shapes: EngineShape[] = [];
  const connectors: EngineShape[] = [];
  let fontSize: number | null = null;
  const emit = (inst: Inst): void => {
    const connInfo = connByInst.get(inst);
    if (connInfo) {
      const connShape: EngineShape = {
        ...inst.rect,
        rot: 0,
        ptId: inst.pts[0]?.pt.id ?? null,
        ptIds: inst.pts.map((p) => p.pt.id),
        prst: connInfo.prst,
        hideGeom: false,
        name: inst.name || 'conn',
        fontSz: null,
        connector: { from: connInfo.from, to: connInfo.to },
      };
      shapes.push(connShape);
      connectors.push(connShape);
      return;
    }
    const text = isText(inst);
    if (text && inst.fontSz !== null) {
      inst.fontSz = uniformAllFonts && Number.isFinite(globalMinFont) ? globalMinFont : (smallest.get(inst.name) ?? inst.fontSz);
    }
    const geometry = inst.props.shape?.prst ?? null;
    if ((geometry && geometry !== 'conn') || text) {
      const ids = text ? inst.pts.filter((p) => !pointTypeOf(p.pt).endsWith('Trans')).map((p) => p.pt.id) : [];
      const rot = inst.props.shape?.rot ?? 0;
      const { x, y, w: rw, h: rh } = inst.rect;
      const swap = Math.abs(rot % 180) === 90;
      shapes.push({
        ...(swap ? { x: x + (rw - rh) / 2, y: y + (rh - rw) / 2, w: rh, h: rw } : inst.rect),
        rot,
        ptId: ids[0] ?? null,
        ptIds: ids,
        prst: geometry && geometry !== 'conn' ? geometry : 'rect',
        hideGeom: !geometry || inst.props.shape?.hideGeom === true,
        name: inst.name,
        fontSz: text ? inst.fontSz : null,
        connector: null,
      });
      if (text && inst.fontSz !== null) fontSize = inst.fontSz;
    }
    for (const child of zOrdered(inst.children)) emit(child);
  };
  emit(tree);

  const covered = new Set(shapes.filter((s) => !s.connector).flatMap((shape) => shape.ptIds));
  if (flattenPoints(roots).some((pt) => !covered.has(pt.id))) return failed('incomplete-coverage');
  return { shapes, connectors, reason: null, fontSize };
}

// ---------- 调用方辅助：引擎形状 → 统一 Schema ----------

export interface EngineRenderOptions {
  colors: string[];
  /**
   * 数据点文本。`fontPt` 是布局约束求出的字号（pt），调用方把它作为文本继承链的缺省字号解析，
   * 数据模型 run 上直设的 sz 因此优先（与 PowerPoint 缓存一致）；null = 不覆盖继承字号。
   */
  textOf: (id: string, fontPt: number | null) => TextBody | null;
}

function mergedText(ids: string[], textOf: (id: string) => TextBody | null): TextBody | null {
  const bodies = ids.map((id) => textOf(id)).filter((body): body is TextBody => body !== null);
  if (!bodies.length) return null;
  if (bodies.length === 1) return bodies[0];
  return { ...bodies[0], paragraphs: bodies.flatMap((body) => body.paragraphs) };
}

function connectorPath(shape: EngineShape): string {
  const { from, to } = shape.connector!;
  const x1 = from[0] - shape.x;
  const y1 = from[1] - shape.y;
  const x2 = to[0] - shape.x;
  const y2 = to[1] - shape.y;
  if (shape.prst === 'bentConnector2') {
    return `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
  }
  if (shape.prst === 'bentConnector3') {
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
  }
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

/** 引擎结果 → SlideElement[]。形状协议与 diagram.ts 一致。 */
export function engineShapesToElements(engine: EngineResult, roots: DiagramPoint[], options: EngineRenderOptions): SlideElement[] {
  const textById = new Map<string, TextBody | null>(flattenPoints(roots).map((pt) => [pt.id, pt.text]));
  let colorCursor = 0;
  return engine.shapes.map((shape): SlideElement => {
    if (shape.connector) {
      return {
        kind: 'shape',
        x: shape.x,
        y: shape.y,
        w: shape.w,
        h: shape.h,
        rot: 0,
        flipH: false,
        flipV: false,
        path: connectorPath(shape),
        fill: null,
        stroke: { color: options.colors[0] ?? 'rgb(68,114,196)', width: 1.5, dash: null },
        text: null,
        openGeom: true,
        name: 'SmartArt 连线',
      };
    }
    const text = mergedText(shape.ptIds, (id) => options.textOf(id, shape.fontSz) ?? textById.get(id) ?? null);
    const geom = presetGeom(shape.prst, shape.w, shape.h, {});
    const idx = colorCursor++;
    const fill: Fill | null = shape.hideGeom
      ? null
      : { type: 'solid', color: options.colors[idx % Math.max(options.colors.length, 1)] ?? 'rgb(68,114,196)' };
    const el: ShapeElement = {
      kind: 'shape',
      x: shape.x,
      y: shape.y,
      w: shape.w,
      h: shape.h,
      rot: shape.rot,
      flipH: false,
      flipV: false,
      path: geom.d,
      fill,
      stroke: null,
      text,
      name: 'SmartArt 节点',
    };
    return el;
  });
}
