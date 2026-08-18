import type { AnimEffect, AnimStep, Transition, TransitionType } from '../types';
import { attr, kid, kids, numAttr } from '../xml';

/**
 * 幻灯片切换（p:transition）与元素动画（p:timing）解析。
 *
 * p:timing 的时间节点树非常深，但对预览而言只需要三件事：
 * 目标形状、效果类别、时序关系。因此这里做深度优先遍历，
 * 抓取所有带 presetClass 的 p:cTn 节点，其余结构忽略。
 */

const SPEED_MS: Record<string, number> = { slow: 1000, med: 750, fast: 500 };

const TRANSITION_TAGS: Record<string, TransitionType> = {
  fade: 'fade', cut: 'cut', push: 'push', pull: 'pull', cover: 'cover',
  wipe: 'wipe', split: 'split', zoom: 'zoom', dissolve: 'dissolve',
  checker: 'checker', blinds: 'blinds', comb: 'comb', wheel: 'wheel',
  circle: 'circle', diamond: 'diamond', plus: 'plus', wedge: 'wedge',
  newsflash: 'newsflash', randomBar: 'randomBar', strips: 'strips',
  random: 'dissolve', fadeThroughBlack: 'fade',
};

export function parseTransition(root: Element | null): Transition | undefined {
  // p:transition 可能在 p:sld 直属，也可能在 mc:AlternateContent 里的 p14 变体
  const el = findTransition(root);
  if (!el) return undefined;

  let type: TransitionType = 'fade';
  let dir: string | undefined;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    const mapped = TRANSITION_TAGS[c.localName];
    if (!mapped) continue;
    type = mapped;
    dir = attr(c, 'dir') ?? attr(c, 'orient') ?? undefined;
    if (c.localName === 'split') {
      const orient = attr(c, 'orient') ?? 'horz';
      const d = attr(c, 'dir') ?? 'out';
      dir = `${orient}-${d}`;
    }
    break;
  }

  const exactMs = numAttr(el, 'p14:dur') ?? numAttr(el, 'dur');
  const durationMs = exactMs ?? SPEED_MS[attr(el, 'spd') ?? 'med'] ?? 750;
  const advTm = numAttr(el, 'advTm');

  return {
    type,
    dir,
    durationMs: Math.max(80, Math.min(5000, durationMs)),
    advanceAfterMs: advTm !== null && advTm !== undefined ? advTm : undefined,
  };
}

function findTransition(root: Element | null): Element | null {
  if (!root) return null;
  const direct = kid(root, 'transition');
  if (direct) return direct;
  for (const alt of kids(root, 'AlternateContent')) {
    for (const branch of [kid(alt, 'Choice'), kid(alt, 'Fallback')]) {
      const t = kid(branch, 'transition');
      if (t) return t;
    }
  }
  return null;
}

// ---------------- 元素动画 ----------------

/** presetID → 效果。未列出的按类别退化为淡入/淡出。 */
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

/** presetSubtype → 方向（值表示「来自」的方位） */
const SUBTYPE_DIR: Record<number, string> = {
  1: 'u', 2: 'r', 4: 'd', 8: 'l',
  3: 'rd', 6: 'ru', 9: 'lu', 12: 'ld',
  5: 'horz', 10: 'vert',
  16: 'in', 32: 'out',
};

const CLASS_KIND: Record<string, AnimStep['kind']> = {
  entr: 'entrance', exit: 'exit', emph: 'emphasis', path: 'motion', mediacall: 'emphasis', verb: 'emphasis',
};

/** p:animEffect@filter 形如 "wipe(up)" / "barn(inVertical)" / "fade" */
function effectFromFilter(filter: string): { effect: AnimEffect; dir?: string } | null {
  const m = filter.match(/^([a-zA-Z]+)(?:\(([^)]*)\))?/);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const arg = (m[2] ?? '').toLowerCase();
  // "from*" 描述元素的来源方位，"up/down/left/right" 描述擦除推进方向，二者语义相反
  const from = arg.startsWith('from');
  const side = arg.includes('left') ? 'l' : arg.includes('right') ? 'r'
    : arg.includes('top') || arg.includes('up') ? 'u'
    : arg.includes('bottom') || arg.includes('down') ? 'd' : null;
  const flip: Record<string, string> = { l: 'r', r: 'l', u: 'd', d: 'u' };
  const dirFromArg = side
    ? (from ? side : flip[side])
    : arg.includes('vertical') ? 'vert' : arg.includes('horizontal') ? 'horz'
    : arg.includes('in') ? 'in' : arg.includes('out') ? 'out' : undefined;
  const table: Record<string, AnimEffect> = {
    fade: 'fade', wipe: 'wipe', barn: 'split', blinds: 'blinds', box: 'zoom',
    checkerboard: 'blinds', circle: 'zoom', diamond: 'zoom', dissolve: 'dissolve',
    plus: 'zoom', randombar: 'blinds', slide: 'fly', strips: 'blinds',
    wedge: 'wheel', wheel: 'wheel', image: 'fade',
  };
  const effect = table[name];
  return effect ? { effect, dir: dirFromArg } : null;
}

/** 在节点子树里找第一个 spTgt 的 spid */
function findTargetId(el: Element, depth = 8): number | null {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === 'spTgt') {
      const id = numAttr(c, 'spid');
      if (id !== null) return id;
    }
    if (depth > 0) {
      const hit = findTargetId(c, depth - 1);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/** 真正承载视觉变化的行为节点；p:set 只是瞬时置位，其 dur=1 不代表动画时长 */
const BEHAVIOR_TAGS = new Set(['animEffect', 'anim', 'animRot', 'animScale', 'animClr', 'animMotion']);

/** 取子树里最能代表动画时长的 dur（毫秒） */
function findDuration(el: Element, depth = 8, inBehavior = false): number | null {
  let best: number | null = null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    const behavior = inBehavior || BEHAVIOR_TAGS.has(c.localName);
    if (c.localName === 'cTn') {
      const raw = attr(c, 'dur');
      if (raw && raw !== 'indefinite') {
        const n = Number(raw);
        // dur<=1 是瞬时置位，不作为动画时长
        if (Number.isFinite(n) && n > 1 && inBehavior) return n;
        if (Number.isFinite(n) && n > 1 && (best === null || n > best)) best = n;
      }
    }
    if (depth > 0) {
      const hit = findDuration(c, depth - 1, behavior);
      if (hit !== null && behavior) return hit;
      if (hit !== null && (best === null || hit > best)) best = hit;
    }
  }
  return best;
}

function findFilter(el: Element, depth = 8): string | null {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === 'animEffect') {
      const f = attr(c, 'filter');
      if (f) return f;
    }
    if (depth > 0) {
      const hit = findFilter(c, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

function startDelay(cTn: Element): number {
  const cond = kid(kid(cTn, 'stCondLst'), 'cond');
  const raw = attr(cond, 'delay');
  if (!raw || raw === 'indefinite') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function parseTiming(timing: Element | null): AnimStep[] | undefined {
  if (!timing) return undefined;
  const steps: AnimStep[] = [];

  const visit = (el: Element, depth: number): void => {
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName === 'cTn' && attr(c, 'presetClass')) {
        const step = buildStep(c);
        if (step) steps.push(step);
        // 效果节点内部不会再嵌套别的效果，跳过其子树
        continue;
      }
      if (depth > 0) visit(c, depth - 1);
    }
  };
  visit(timing, 24);

  if (!steps.length) return undefined;

  // 按点击批次编号：第一个效果与其后所有 withPrev/afterPrev 归为同一批
  let group = -1;
  for (const s of steps) {
    if (s.trigger === 'click' || group < 0) group++;
    s.clickGroup = group;
  }
  return steps;
}

function buildStep(cTn: Element): AnimStep | null {
  const target = findTargetId(cTn);
  if (target === null) return null;

  const presetClass = attr(cTn, 'presetClass') ?? 'entr';
  const kind = CLASS_KIND[presetClass] ?? 'entrance';
  const presetID = numAttr(cTn, 'presetID') ?? 10;
  const subtype = numAttr(cTn, 'presetSubtype') ?? 0;
  const nodeType = attr(cTn, 'nodeType') ?? 'clickEffect';

  // filter 字符串比 presetID 更贴近实际呈现，优先采用
  const filter = findFilter(cTn);
  const fromFilter = filter ? effectFromFilter(filter) : null;
  const effect: AnimEffect = fromFilter?.effect ?? PRESET_EFFECT[presetID] ?? 'fade';
  const dir = fromFilter?.dir ?? SUBTYPE_DIR[subtype];

  const trigger: AnimStep['trigger'] =
    nodeType === 'withEffect' ? 'withPrev' : nodeType === 'afterEffect' ? 'afterPrev' : 'click';

  const dur = findDuration(cTn) ?? 500;

  return {
    target,
    effect,
    dir,
    delayMs: startDelay(cTn),
    durationMs: Math.max(60, Math.min(10000, dur)),
    trigger,
    kind,
  };
}
