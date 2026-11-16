/**
 * SmartArt 布局定义引擎（ECMA-376 Part 1 §21.4.2 的求值子集）。
 *
 * 与 diagram.ts 的「按算法族手工排布」不同，本文件读真实的 dgm:layoutDef，分两阶段求值：
 *
 * 1. 构建：layoutNode 树按 choose/if/else、forEach 轴选择展开成实例树；choose 分支里的
 *    alg / shape / presOf / constrLst / ruleLst 并入所在 layoutNode；presOf 的轴选择决定
 *    形状承载哪些数据点（一个形状可承载多个点）。
 * 2. 布局：自顶向下。父实例的矩形先定，再按父节点声明的 for="ch" 约束（forName 指目标子节点）
 *    求出子节点的 w/h/l/t/r/b/ctrX/ctrY 及偏移量，由父节点算法给子节点分配矩形。
 *
 * 算法只实现经过真值对照的四种：composite（约束代数）、snake（网格）、tx、sp。其余算法、轴、
 * 函数测试、约束或规则类型终止求值并返回稳定 reason（unsupported-*），由调用方回退启发式族布局。
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
  /** 首个承载的数据点 id；无文本的装饰形状为 null */
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
  /** 连线路径点；当前实现的算法不产出连线，保留给调用方的统一协议 */
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
}

interface LayoutNode {
  name: string;
  props: NodeProps;
  children: Child[];
}

interface ForEach {
  name: string;
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

const SUPPORTED_ALGORITHMS = new Set(['composite', 'snake', 'tx', 'sp']);
const SUPPORTED_AXES = new Set(['self', 'ch', 'des', 'desOrSelf', 'sib', 'precedSib', 'followSib', 'anc', 'ancOrSelf', 'par', 'root']);
const POSITIONS = ['l', 't', 'r', 'b', 'ctrX', 'ctrY'];
const OFFSETS = ['lOff', 'tOff', 'rOff', 'bOff', 'ctrXOff', 'ctrYOff', 'wOff', 'hOff'];
const SUPPORTED_CONSTRAINTS = new Set([
  'w',
  'h',
  ...POSITIONS,
  ...OFFSETS,
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
]);
const TEST_OPS = new Set(['equ', 'neq', 'gte', 'lte', 'gt', 'lt']);

type Parsed<T> = T | EngineReason;
const isReason = (value: unknown): value is EngineReason => typeof value === 'string';

const emptyProps = (): NodeProps => ({ alg: null, shape: undefined, presOf: undefined, constraints: [], rules: [] });

/** 空格分隔的多段轴（axis="ch ch desOrSelf"），ptType / st / cnt 按段对应 */
function parseSteps(el: Element): Parsed<AxisStep[]> | null {
  const axisAttr = attr(el, 'axis');
  if (!axisAttr || !axisAttr.trim() || axisAttr.trim() === 'none') return null;
  const axes = axisAttr.trim().split(/\s+/);
  const list = (name: string): string[] => (attr(el, name) ?? '').trim().split(/\s+/).filter(Boolean);
  const types = list('ptType');
  const starts = list('st');
  const counts = list('cnt');
  const steps: AxisStep[] = [];
  for (const [i, axis] of axes.entries()) {
    if (!SUPPORTED_AXES.has(axis)) return 'unsupported-axis';
    steps.push({ axis, ptType: types[i] ?? 'all', st: Number(starts[i] ?? 1), cnt: Number(counts[i] ?? 0) });
  }
  return steps;
}

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

const finiteOr = (value: number | null, fallback: number): number => (value !== null && Number.isFinite(value) ? value : fallback);

/** 读取元素的直接属性子元素（alg / shape / presOf / constrLst / ruleLst）到 props */
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
        props.constraints.push(parsed);
      }
    } else if (c.localName === 'ruleLst') {
      for (const rule of kids(c, 'rule')) {
        if (attr(rule, 'type') !== 'primFontSz') return 'unsupported-rule';
        props.rules.push({
          type: 'primFontSz',
          val: numAttr(rule, 'val'),
          fact: finiteOr(numAttr(rule, 'fact'), NaN),
          max: finiteOr(numAttr(rule, 'max'), NaN),
        });
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
  // ref 复用另一个 forEach 的轴选择与内容（目标可在 choose 的兄弟分支里）
  const ref = attr(el, 'ref');
  const source = ref ? forEachByName.get(ref) : el;
  if (!source) return 'unsupported-axis';
  const steps = parseSteps(source);
  if (isReason(steps)) return steps;
  const body = el.firstElementChild ? el : source;
  const children = parseChildren(body, forEachByName, depth);
  if (isReason(children)) return children;
  return { name: attr(el, 'name') ?? '', steps: steps ?? [], children };
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
      if (!['var', 'cnt', 'depth', 'maxDepth'].includes(func) || !TEST_OPS.has(op)) return 'unsupported-function';
      if (func === 'var' && arg !== 'dir' && arg !== 'hierBranch') return 'unsupported-function';
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

const typeMatches = (ptType: string | null, point: PointCtx): boolean => {
  if (!ptType || ptType === 'all') return true;
  const actual = pointTypeOf(point.pt);
  if (ptType === 'nonAsst') return actual !== 'asst';
  if (ptType === 'nonNorm') return actual !== 'node';
  return actual === ptType;
};

/** 约束的 ptType 按实例承载的点判定（presOf 选中的首个点），无承载点时按上下文点 */
const instPoint = (inst: Inst): PointCtx => inst.pts[0] ?? inst.point;

const childrenOf = (point: PointCtx): PointCtx[] => point.pt.children.map((pt) => ({ pt, parent: point }));

const descendantsOf = (point: PointCtx): PointCtx[] => {
  const out: PointCtx[] = [];
  const walk = (list: PointCtx[]): void => {
    for (const item of list) {
      out.push(item);
      walk(childrenOf(item));
    }
  };
  walk(childrenOf(point));
  return out;
};

function axisOf(axis: string, point: PointCtx, doc: PointCtx): PointCtx[] {
  switch (axis) {
    case 'self':
      return [point];
    case 'ch':
      return childrenOf(point);
    case 'des':
      return descendantsOf(point);
    case 'desOrSelf':
      return [point, ...descendantsOf(point)];
    case 'par':
      return point.parent ? [point.parent] : [];
    case 'anc':
    case 'ancOrSelf': {
      const chain: PointCtx[] = axis === 'ancOrSelf' ? [point] : [];
      for (let walk = point.parent; walk; walk = walk.parent) chain.push(walk);
      return chain;
    }
    case 'sib':
    case 'precedSib':
    case 'followSib': {
      if (!point.parent) return [];
      const sibs = childrenOf(point.parent);
      const at = sibs.findIndex((s) => s.pt.id === point.pt.id);
      if (axis === 'sib') return sibs;
      return axis === 'precedSib' ? sibs.slice(0, Math.max(at, 0)) : sibs.slice(at + 1);
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
    const pool = set.flatMap((point) => axisOf(step.axis, point, doc)).filter((point) => typeMatches(step.ptType, point));
    const start = step.st < 0 ? Math.max(pool.length + step.st, 0) : Math.max(step.st - 1, 0);
    const sliced = pool.slice(start);
    set = step.cnt > 0 ? sliced.slice(0, step.cnt) : sliced;
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

const compare = (op: string, actual: number | string, expected: number | string): boolean => {
  switch (op) {
    case 'equ':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'gte':
      return actual >= expected;
    case 'lte':
      return actual <= expected;
    case 'gt':
      return actual > expected;
    default:
      return actual < expected;
  }
};

interface BuildEnv {
  doc: PointCtx;
  dir: 'norm' | 'rev';
}

function testMatches(test: IfTest, point: PointCtx, env: BuildEnv): boolean {
  if (test.func === 'var') return compare(test.op, test.arg === 'dir' ? env.dir : 'std', test.val);
  if (test.func === 'cnt') {
    const count = test.steps ? selectSteps(test.steps, point, env.doc).length : point.parent ? point.parent.pt.children.length : 1;
    return compare(test.op, count, Number(test.val));
  }
  const actual = test.func === 'depth' ? Math.max(point.pt.depth, 0) : maxDepthOf(point);
  return compare(test.op, actual, Number(test.val));
}

function mergeProps(into: NodeProps, from: NodeProps): void {
  if (from.alg) into.alg = from.alg;
  if (from.shape !== undefined) into.shape = from.shape;
  if (from.presOf !== undefined) into.presOf = from.presOf;
  into.constraints.push(...from.constraints);
  into.rules.push(...from.rules);
}

function buildInst(node: LayoutNode, point: PointCtx, env: BuildEnv): Inst {
  const inst: Inst = {
    name: node.name,
    props: { ...node.props, constraints: [...node.props.constraints], rules: [...node.props.rules] },
    point,
    pts: [],
    children: [],
    rect: { x: 0, y: 0, w: 0, h: 0 },
    fontSz: null,
  };
  const expand = (children: Child[], at: PointCtx): void => {
    for (const child of children) {
      if (child.type === 'node') inst.children.push(buildInst(child.node, at, env));
      else if (child.type === 'forEach') {
        for (const selected of selectSteps(child.node.steps, at, env.doc)) expand(child.node.children, selected);
      } else {
        const branch = child.branches.find((b) => !b.test || testMatches(b.test, at, env));
        if (!branch) continue;
        mergeProps(inst.props, branch.props);
        expand(branch.children, at);
      }
    }
  };
  expand(node.children, point);
  inst.pts = inst.props.presOf ? selectSteps(inst.props.presOf, point, env.doc) : [];
  return inst;
}

// ---------- 布局：约束代数与算法 ----------

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

/** 未显式约束的量的缺省值：子节点缺省铺满父矩形，位置从父矩形原点起 */
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

/** 父节点自身的量（refFor 缺省 / self 引用） */
function selfValue(type: string, inst: Inst): number | null {
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
    case 'primFontSz':
      return inst.fontSz;
    default:
      return null;
  }
}

const SIZE_TYPES = new Set(['w', 'h', 'wOff', 'hOff']);

/**
 * 父节点 for="ch" 约束 → 每个子实例的量表。按文档序求值；refForName 引用同批兄弟已求出的量
 * （未约束时取缺省值），refFor 缺省引用父节点自身。
 */
function childValues(inst: Inst): Map<Inst, Values> {
  const table = new Map<Inst, Values>(inst.children.map((child) => [child, new Map()]));
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
      } else value = selfValue(con.refType, inst);
      if (value === null) continue;
      value *= con.fact;
    } else if (con.val !== null) value = con.val;
    else
      value = SIZE_TYPES.has(con.type)
        ? (selfValue(con.type === 'wOff' ? 'w' : con.type === 'hOff' ? 'h' : con.type, inst) ?? 0) * con.fact
        : 0;
    for (const child of inst.children) {
      if (con.forName && child.name !== con.forName) continue;
      if (!typeMatches(con.ptType, instPoint(child))) continue;
      const values = table.get(child)!;
      const current = values.get(con.type);
      if (con.op === 'gte' && current !== undefined) values.set(con.type, Math.max(current, value));
      else if (con.op === 'lte' && current !== undefined) values.set(con.type, Math.min(current, value));
      else values.set(con.type, value);
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

/** 子实例自身声明的 for="self" w/h（无量纲时只决定宽高比），供 snake 求单元宽高比 */
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

/** snake 的间距：sp 引用子节点尺寸时按单元宽的比例，否则为绝对值 */
function snakeGap(inst: Inst): { rel: number; abs: number } {
  for (const con of inst.props.constraints) {
    if ((con.type !== 'sp' && con.type !== 'sibSp') || con.for !== 'self') continue;
    if (con.refForName && con.refType === 'w') return { rel: con.fact, abs: 0 };
    if (con.val !== null) return { rel: 0, abs: con.val };
  }
  return { rel: 0, abs: 0 };
}

function snakeRects(inst: Inst): Rect[] {
  const items = inst.children;
  const n = items.length;
  const box = inst.rect;
  const params = inst.props.alg!.params;
  const aspect = items.map(selfAspect).find((a) => a !== null) ?? 1;
  const gap = snakeGap(inst);
  const byRow = (params.get('flowDir') ?? 'row') === 'row';
  const W = byRow ? box.w : box.h;
  const H = byRow ? box.h : box.w;
  const a = byRow ? aspect : 1 / aspect;
  // 选择使单元最大的每行个数（同尺寸时取行数少者）
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
  return items.map((_, i) => {
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
    return byRow ? { x: box.x + u, y: box.y + v, w: cell, h: cellOther } : { x: box.x + v, y: box.y + u, w: cellOther, h: cell };
  });
}

interface FontScope {
  forName: string | null;
  ptType: string | null;
  val: number;
}

/** 声明在 inst 上、作用于后代的 primFontSz（for="des"） */
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

function layout(inst: Inst, rect: Rect, parent: Inst | null, scopes: FontScope[]): void {
  const alg = inst.props.alg;
  const ar = Number(alg?.params.get('ar'));
  inst.rect = alg?.type === 'composite' && ar > 0 ? fitAspect(rect, ar) : rect;
  inst.fontSz = fontFor(inst, parent, scopes);
  if (!inst.children.length) return;
  const nested = [...scopes, ...desFonts(inst)];
  if (alg?.type === 'snake') {
    snakeRects(inst).forEach((childRect, i) => layout(inst.children[i], childRect, inst, nested));
    return;
  }
  // composite（及未声明算法的容器）：约束代数定位
  const table = childValues(inst);
  for (const child of inst.children) layout(child, compositeRect(table.get(child)!, inst.rect), inst, nested);
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

/**
 * SmartArt 文本溢出时缩小：从约束字号逐步收缩，下限取 ruleLst primFontSz 的 val（缺省 5pt），
 * 步进取 rule fact（0–1 之间按比例，否则每步 1pt），步数上限取 rule max。
 */
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

/**
 * 兄弟绘制顺序：键 = 文档序 + zOrderOff，稳定排序；键相同时偏移大的画在后面。
 * 同偏移的一组（如 cycle4 的背景与文本都是 -2）因此保持组内相对顺序。
 */
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
  // 极简版式：入口节点没有任何子树（第三方工具只写算法名），交启发式族布局处理
  if (!['layoutNode', 'forEach', 'choose'].some((name) => kids(entry, name).length)) return failed('minimal-layout-definition');
  const parsed = parseLayoutNode(entry, collectForEach(layoutRoot), 0);
  if (isReason(parsed)) return failed(parsed);

  const doc: PointCtx = { pt: { id: '', text: null, children: roots, depth: -1, ptType: 'doc' }, parent: null };
  const tree = buildInst(parsed, doc, { doc, dir: options.dir ?? 'norm' });
  layout(tree, { x: 0, y: 0, w, h }, null, []);

  // 文本收缩后同名节点取最小字号（PowerPoint 让同一布局节点的各实例字号一致）
  const isText = (inst: Inst): boolean => inst.props.alg?.type === 'tx' && inst.pts.length > 0;
  const smallest = new Map<string, number>();
  const shrink = (inst: Inst): void => {
    if (isText(inst)) {
      shrinkFont(inst, textOf);
      if (inst.fontSz !== null) smallest.set(inst.name, Math.min(smallest.get(inst.name) ?? Infinity, inst.fontSz));
    }
    inst.children.forEach(shrink);
  };
  shrink(tree);

  const shapes: EngineShape[] = [];
  let fontSize: number | null = null;
  const emit = (inst: Inst): void => {
    const text = isText(inst);
    if (text && inst.fontSz !== null) inst.fontSz = smallest.get(inst.name) ?? inst.fontSz;
    const geometry = inst.props.shape?.prst ?? null;
    if (geometry || text) {
      const ids = text ? inst.pts.map((p) => p.pt.id) : [];
      const rot = inst.props.shape?.rot ?? 0;
      // 旋转 90° / 270° 时与 PowerPoint 缓存一致：宽高对调、中心不变，旋转后的视觉外框等于布局矩形
      const { x, y, w, h } = inst.rect;
      const swap = Math.abs(rot % 180) === 90;
      shapes.push({
        ...(swap ? { x: x + (w - h) / 2, y: y + (h - w) / 2, w: h, h: w } : inst.rect),
        rot,
        ptId: ids[0] ?? null,
        ptIds: ids,
        prst: geometry ?? 'rect',
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

  // 覆盖守恒：数据点未被文本形状全部承载时（某些分支在缺省条件下不展开），不输出不完整结果
  const covered = new Set(shapes.flatMap((shape) => shape.ptIds));
  if (flattenPoints(roots).some((pt) => !covered.has(pt.id))) return failed('incomplete-coverage');
  return { shapes, connectors: [], reason: null, fontSize };
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

/** 多个数据点的文本按点序合并为一个文本框（presOf 选中多个点时，如 cycle4 的 C2-1…C2-4） */
function mergedText(ids: string[], textOf: (id: string) => TextBody | null): TextBody | null {
  const bodies = ids.map((id) => textOf(id)).filter((body): body is TextBody => body !== null);
  if (!bodies.length) return null;
  if (bodies.length === 1) return bodies[0];
  return { ...bodies[0], paragraphs: bodies.flatMap((body) => body.paragraphs) };
}

/** 引擎结果 → SlideElement[]。形状协议与 diagram.ts 一致。 */
export function engineShapesToElements(engine: EngineResult, roots: DiagramPoint[], options: EngineRenderOptions): SlideElement[] {
  const textById = new Map<string, TextBody | null>(flattenPoints(roots).map((pt) => [pt.id, pt.text]));
  return engine.shapes.map((shape, shapeIndex): SlideElement => {
    const text = mergedText(shape.ptIds, (id) => options.textOf(id, shape.fontSz) ?? textById.get(id) ?? null);
    const geom = presetGeom(shape.prst, shape.w, shape.h, {});
    const fill: Fill | null = shape.hideGeom
      ? null
      : { type: 'solid', color: options.colors[shapeIndex % Math.max(options.colors.length, 1)] ?? 'rgb(68,114,196)' };
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
