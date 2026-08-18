import type { AnimEffect, AnimStep, Transition, TransitionType } from '../types';
import { findAll, findRec, progBinaryBlobs, Rec, records, RT, TIME, utf16 } from './records';

/**
 * .ppt 的放映信息：
 * - 切换效果与隐藏标记在 SSSlideInfoAtom（幻灯片容器直属）；
 * - 元素动画在 ___PPT10 二进制扩展块里的时间节点树（[MS-PPT] 2.8），
 *   结构与 OOXML 的 p:timing 一一对应，只是换成了记录树。
 */

// ---------------- 幻灯片切换 ----------------

/**
 * [MS-PPT] SlideShowEffectTypeEnum → 统一 Schema 的切换类型。
 * 编号已用 showcase 对照过（4=覆盖、5=溶解、10=擦除、13=劈裂、20=推入、23=淡出），
 * 未列出的一律退回 fade，宁可平淡也不要张冠李戴。
 *
 * 0 不在表里：它既是「切出」也是转换器遇到不认识的效果时的兜底值，
 * sample-chart.ppt 每页都写了 0 而源 .pptx 根本没有切换——按「无切换」处理。
 */
const EFFECT_TYPE: Record<number, TransitionType> = {
  1: 'dissolve', 2: 'blinds', 3: 'checker', 4: 'cover', 5: 'dissolve',
  6: 'fade', 7: 'pull', 8: 'randomBar', 9: 'strips', 10: 'wipe', 11: 'zoom',
  12: 'zoom', 13: 'split', 17: 'zoom', 18: 'blinds', 19: 'blinds',
  20: 'push', 21: 'comb', 22: 'newsflash', 23: 'fade', 26: 'wedge',
  27: 'wheel', 28: 'circle', 29: 'diamond', 30: 'plus',
};

/** 方位型效果的 effectDirection：0=左 1=上 2=右 3=下 */
const SIDE_DIR: Record<number, string> = { 0: 'l', 1: 'u', 2: 'r', 3: 'd' };
/** 劈裂 / 缩放类：0=水平向外 1=水平向内 2=垂直向外 3=垂直向内 */
const SPLIT_DIR: Record<number, string> = { 0: 'horz-out', 1: 'horz-in', 2: 'vert-out', 3: 'vert-in' };
const INOUT_DIR: Record<number, string> = { 0: 'out', 1: 'in' };

/** 该类型是否真的用到方向；淡出 / 溶解这类写了方向也没有意义 */
function transitionDir(type: TransitionType, dir: number): string | undefined {
  if (type === 'split') return SPLIT_DIR[dir];
  if (type === 'zoom' || type === 'circle' || type === 'diamond' || type === 'plus' || type === 'wedge') {
    return INOUT_DIR[dir];
  }
  if (type === 'push' || type === 'pull' || type === 'cover' || type === 'wipe' || type === 'strips'
    || type === 'blinds' || type === 'comb' || type === 'wheel' || type === 'randomBar') {
    return SIDE_DIR[dir];
  }
  return undefined;
}

/** speed：0 = 慢，1 = 中，2 = 快 */
const SPEED_MS: Record<number, number> = { 0: 1000, 1: 750, 2: 500 };

/** [MS-PPT] 2.5.7 SlideShowSlideInfoAtom */
export interface SlideShowInfo {
  hidden: boolean;
  transition?: Transition;
}

const F_HIDDEN = 0x0004;
const F_AUTO_ADVANCE = 0x0400;

export function parseSlideShowInfo(dv: DataView, slideRec: Rec): SlideShowInfo | null {
  const rec = findRec(dv, slideRec.start, slideRec.start + slideRec.len, RT.SSSlideInfoAtom);
  if (!rec || rec.len < 13) return null;
  const slideTime = dv.getInt32(rec.start, true);
  const dir = dv.getUint8(rec.start + 8);
  const type = dv.getUint8(rec.start + 9);
  const flags = dv.getUint16(rec.start + 10, true);
  const speed = dv.getUint8(rec.start + 12);

  const kind = EFFECT_TYPE[type];
  const transition: Transition | undefined = kind === undefined ? undefined : {
    type: kind,
    dir: transitionDir(kind, dir),
    durationMs: SPEED_MS[speed] ?? 750,
    advanceAfterMs: (flags & F_AUTO_ADVANCE) !== 0 && slideTime > 0 ? slideTime : undefined,
  };
  return { hidden: (flags & F_HIDDEN) !== 0, transition };
}

// ---------------- 元素动画 ----------------

/** TimePropertyList 里用到的属性 id（[MS-PPT] TimePropertyID4TimeNode） */
const TP = { effectId: 9, effectDir: 10, effectClass: 11, nodeType: 20 } as const;

/** TL_TNET_*：节点在时间树里的角色 */
const NODE_CLICK = 1;
const NODE_WITH = 2;
const NODE_AFTER = 3;

/** effectId 即 OOXML 的 presetID，沿用同一张表 */
const PRESET_EFFECT: Record<number, AnimEffect> = {
  1: 'appear', 2: 'fly', 3: 'blinds', 4: 'wipe', 5: 'dissolve', 6: 'zoom',
  7: 'fly', 8: 'zoom', 9: 'dissolve', 10: 'fade', 11: 'appear', 12: 'fly',
  13: 'zoom', 14: 'blinds', 15: 'spin', 16: 'split', 17: 'stretch', 18: 'blinds',
  19: 'wheel', 20: 'wheel', 21: 'wipe', 22: 'zoom', 23: 'random', 24: 'spin',
  25: 'bounce', 28: 'fade', 29: 'float', 30: 'grow', 31: 'fly', 32: 'spin',
  33: 'float', 34: 'swivel', 35: 'fly', 36: 'stretch', 37: 'stretch', 38: 'fly',
  39: 'float', 40: 'spin', 41: 'swivel', 42: 'float', 43: 'fly', 44: 'spin',
  45: 'stretch', 46: 'stretch', 47: 'float', 48: 'zoom', 49: 'fly', 50: 'stretch',
  51: 'swivel', 52: 'stretch', 53: 'grow',
};

/** effectDir 即 OOXML 的 presetSubtype */
const SUBTYPE_DIR: Record<number, string> = {
  1: 'u', 2: 'r', 4: 'd', 8: 'l',
  3: 'rd', 6: 'ru', 9: 'lu', 12: 'ld',
  5: 'horz', 10: 'vert',
  16: 'in', 32: 'out',
};

const CLASS_KIND: Record<number, AnimStep['kind']> = {
  1: 'entrance', 2: 'exit', 3: 'emphasis', 4: 'motion', 5: 'emphasis', 6: 'emphasis',
};

const FILTER_EFFECT: Record<string, AnimEffect> = {
  fade: 'fade', wipe: 'wipe', barn: 'split', blinds: 'blinds', box: 'zoom',
  checkerboard: 'blinds', circle: 'zoom', diamond: 'zoom', dissolve: 'dissolve',
  plus: 'zoom', randombar: 'blinds', slide: 'fly', strips: 'blinds',
  wedge: 'wheel', wheel: 'wheel', image: 'fade',
};

/** animEffect 的 filter 串，如 "slide(fromLeft)" / "wipe(up)" / "box(in)" */
function effectFromFilter(filter: string): { effect: AnimEffect; dir?: string } | null {
  const m = /^([a-zA-Z]+)(?:\(([^)]*)\))?/.exec(filter);
  if (!m) return null;
  const effect = FILTER_EFFECT[m[1].toLowerCase()];
  if (!effect) return null;
  const arg = (m[2] ?? '').toLowerCase();
  // "from*" 说的是元素来源方位，"up/down/left/right" 说的是擦除推进方向，二者相反
  const from = arg.startsWith('from');
  const side = arg.includes('left') ? 'l' : arg.includes('right') ? 'r'
    : arg.includes('top') || arg.includes('up') ? 'u'
      : arg.includes('bottom') || arg.includes('down') ? 'd' : null;
  const flip: Record<string, string> = { l: 'r', r: 'l', u: 'd', d: 'u' };
  const dir = side
    ? (from ? side : flip[side])
    : arg.includes('vertical') ? 'vert' : arg.includes('horizontal') ? 'horz'
      : arg.includes('in') ? 'in' : arg.includes('out') ? 'out' : undefined;
  return { effect, dir };
}

/** TimeVariant：1 字节类型 + 值（0 = 布尔，1 = 整数，2 = 浮点，3 = UTF-16 串） */
function variantInt(dv: DataView, rec: Rec): number | null {
  if (rec.len < 5) return null;
  const kind = dv.getUint8(rec.start);
  if (kind !== 1 && kind !== 0) return null;
  return kind === 1 ? dv.getInt32(rec.start + 1, true) : dv.getUint8(rec.start + 1);
}

function variantString(dv: DataView, rec: Rec): string | null {
  if (rec.len < 3 || dv.getUint8(rec.start) !== 3) return null;
  return utf16(dv, rec.start + 1, rec.len - 1).replace(/\0+$/, '');
}

/** 本层 TimePropertyList 里的属性（recInstance 即属性 id） */
function nodeProps(dv: DataView, node: Rec): Map<number, number> {
  const out = new Map<number, number>();
  const list = findRec(dv, node.start, node.start + node.len, TIME.TimePropertyList);
  if (!list) return out;
  for (const v of findAll(dv, list.start, list.start + list.len, TIME.TimeVariant)) {
    const n = variantInt(dv, v);
    if (n !== null) out.set(v.instance, n);
  }
  return out;
}

/** 本层 begin 条件（recInstance = 1）的延时；-1 表示等待点击 */
function beginDelay(dv: DataView, node: Rec): number {
  for (const c of findAll(dv, node.start, node.start + node.len, TIME.TimeConditionContainer)) {
    if (c.instance !== 1) continue;
    const atom = findRec(dv, c.start, c.start + c.len, TIME.TimeConditionAtom);
    if (!atom || atom.len < 16) continue;
    const delay = dv.getInt32(atom.start + 12, true);
    return delay > 0 ? delay : 0;
  }
  return 0;
}

/** TimeNodeAtom 的 duration 在第 7 个 u32；-1 表示无限 */
function nodeDuration(dv: DataView, node: Rec): number | null {
  const atom = findRec(dv, node.start, node.start + node.len, TIME.TimeNodeAtom);
  if (!atom || atom.len < 32) return null;
  const d = dv.getInt32(atom.start + 24, true);
  return d > 1 ? d : null;
}

/** 在子树里找行为节点携带的信息：目标形状、filter 串、真实时长 */
interface Behavior {
  target?: number;
  filter?: string;
  duration?: number;
}

function findBehavior(dv: DataView, start: number, end: number, out: Behavior, depth = 12): void {
  for (const r of records(dv, start, end)) {
    if (r.type === TIME.ClientVisualElement) {
      // 内含 VisualShapeAtom：type / refType / shapeIdRef / data0 / data1
      const shape = findRec(dv, r.start, r.start + r.len, TIME.VisualShapeAtom);
      if (shape && shape.len >= 12 && out.target === undefined) {
        out.target = dv.getUint32(shape.start + 8, true);
      }
      continue;
    }
    if (r.type === TIME.TimeVariant && out.filter === undefined) {
      const s = variantString(dv, r);
      if (s) out.filter = s;
      continue;
    }
    if (r.type === TIME.TimeNodeAtom && r.len >= 32 && out.duration === undefined) {
      const d = dv.getInt32(r.start + 24, true);
      if (d > 1) out.duration = d;
      continue;
    }
    // 效果节点内不会再嵌套别的效果，遇到子效果节点就停
    if (r.type === TIME.ExtTimeNodeContainer) {
      const props = nodeProps(dv, r);
      if (props.has(TP.effectId)) continue;
    }
    if (r.isContainer && depth > 0) findBehavior(dv, r.start, r.start + r.len, out, depth - 1);
  }
}

/**
 * ___PPT10 扩展块 → AnimStep[]。
 * 带 effectId 属性的 ExtTimeNodeContainer 就是一个效果，其余层级只负责时序分组。
 */
export function parseAnimations(dv: DataView, slideRec: Rec): AnimStep[] | undefined {
  const steps: AnimStep[] = [];

  const visit = (start: number, end: number, depth: number): void => {
    for (const node of findAll(dv, start, end, TIME.ExtTimeNodeContainer)) {
      const props = nodeProps(dv, node);
      if (props.has(TP.effectId)) {
        const step = buildStep(dv, node, props);
        if (step) steps.push(step);
        continue;
      }
      if (depth > 0) visit(node.start, node.start + node.len, depth - 1);
    }
  };

  for (const blob of progBinaryBlobs(dv, slideRec, '___PPT10')) {
    visit(blob.start, blob.start + blob.len, 16);
  }
  if (!steps.length) return undefined;

  // 第一个效果与其后所有 withPrev / afterPrev 归为同一个点击批次
  let group = -1;
  for (const s of steps) {
    if (s.trigger === 'click' || group < 0) group++;
    s.clickGroup = group;
  }
  return steps;
}

function buildStep(dv: DataView, node: Rec, props: Map<number, number>): AnimStep | null {
  const behavior: Behavior = {};
  findBehavior(dv, node.start, node.start + node.len, behavior);
  if (behavior.target === undefined) return null;

  const fromFilter = behavior.filter ? effectFromFilter(behavior.filter) : null;
  const effect = fromFilter?.effect ?? PRESET_EFFECT[props.get(TP.effectId) ?? 10] ?? 'fade';
  const dir = fromFilter?.dir ?? SUBTYPE_DIR[props.get(TP.effectDir) ?? 0];
  const nodeType = props.get(TP.nodeType) ?? NODE_CLICK;
  const dur = behavior.duration ?? nodeDuration(dv, node) ?? 500;

  return {
    target: behavior.target,
    effect,
    dir,
    delayMs: beginDelay(dv, node),
    durationMs: Math.max(60, Math.min(10000, dur)),
    trigger: nodeType === NODE_WITH ? 'withPrev' : nodeType === NODE_AFTER ? 'afterPrev' : 'click',
    kind: CLASS_KIND[props.get(TP.effectClass) ?? 1] ?? 'entrance',
  };
}
