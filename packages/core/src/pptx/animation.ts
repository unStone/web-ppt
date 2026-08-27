import type { AnimEffect, AnimStep, Transition, TransitionType } from '../types';
import { transitionDefaultDirection } from '../transition';
import { attr, kid, numAttr } from '../xml';
import {
  MAX_TIMING_NODES, selectSlideTiming, timingHasUnsupportedContent,
} from './animation-timing';

/**
 * 幻灯片切换（p:transition）与元素动画（p:timing）解析。
 *
 * p:timing 的时间节点树非常深，但对预览而言只需要三件事：
 * 目标形状、效果类别、时序关系。因此这里做深度优先遍历，
 * 抓取所有带 presetClass 的 p:cTn 节点，其余结构忽略。
 */

const SPEED_MS: Record<string, number> = { slow: 1000, med: 750, fast: 500 };
const PRESENTATIONML_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const POWERPOINT_2010_NS = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const POWERPOINT_2015_NS = 'http://schemas.microsoft.com/office/powerpoint/2015/09/main';
const MARKUP_COMPATIBILITY_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const SUPPORTED_TRANSITION_NAMESPACES = new Set([
  POWERPOINT_2010_NS, POWERPOINT_2015_NS,
]);

const TRANSITION_TAGS: Record<string, TransitionType> = {
  fade: 'fade', cut: 'cut', push: 'push', pull: 'pull', cover: 'cover',
  wipe: 'wipe', split: 'split', zoom: 'zoom', dissolve: 'dissolve',
  checker: 'checker', blinds: 'blinds', comb: 'comb', wheel: 'wheel',
  circle: 'circle', diamond: 'diamond', plus: 'plus', wedge: 'wedge',
  newsflash: 'newsflash', randomBar: 'randomBar', strips: 'strips',
  random: 'dissolve', fadeThroughBlack: 'fade',
  // p14（PowerPoint 2010+）与 p159（morph）扩展。
  // findTransition 会钻进 mc:AlternateContent 的 Choice；expanded name 仍需校验，
  // 否则 mc:Ignorable 外部节点与 p:fade 同名时会被误当成标准效果。
  vortex: 'vortex', switch: 'switch', flip: 'flip', ripple: 'ripple',
  honeycomb: 'honeycomb', glitter: 'glitter', warp: 'warp', flythrough: 'flythrough',
  flash: 'flash', shred: 'shred', reveal: 'reveal', wheelReverse: 'wheelReverse',
  ferris: 'ferris', gallery: 'gallery', conveyor: 'conveyor', pan: 'pan',
  doors: 'doors', window: 'window', prism: 'prism', morph: 'morph',
};

const EXTENDED_TRANSITION_TAGS = new Set([
  'vortex', 'switch', 'flip', 'ripple', 'honeycomb', 'glitter', 'warp', 'flythrough',
  'flash', 'shred', 'reveal', 'wheelReverse', 'ferris', 'gallery', 'conveyor', 'pan',
  'doors', 'window', 'prism',
]);

function transitionType(element: Element): TransitionType | undefined {
  const mapped = TRANSITION_TAGS[element.localName];
  if (!mapped) return undefined;
  const namespace = element.namespaceURI;
  if (element.localName === 'morph') return namespace === POWERPOINT_2015_NS ? mapped : undefined;
  if (EXTENDED_TRANSITION_TAGS.has(element.localName)) {
    return namespace === POWERPOINT_2010_NS ? mapped : undefined;
  }
  return namespace === PRESENTATIONML_NS ? mapped : undefined;
}

function numberAttribute(
  element: Element,
  localName: string,
  namespaceURI: string | null,
): number | null {
  const attribute = Array.from(element.attributes).find((candidate) =>
    candidate.localName === localName && candidate.namespaceURI === namespaceURI);
  if (!attribute || attribute.value === '') return null;
  const value = Number(attribute.value);
  return Number.isFinite(value) ? value : null;
}

function childByName(
  parent: Element | null,
  namespaceURI: string,
  localName: string,
): Element | null {
  if (!parent) return null;
  for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
    if (child.namespaceURI === namespaceURI && child.localName === localName) return child;
  }
  return null;
}

function childrenByName(
  parent: Element | null,
  namespaceURI: string,
  localName: string,
): Element[] {
  const found: Element[] = [];
  if (!parent) return found;
  for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
    if (child.namespaceURI === namespaceURI && child.localName === localName) found.push(child);
  }
  return found;
}

function supportedChoice(choice: Element): boolean {
  const requires = choice.getAttribute('Requires')?.trim().split(/\s+/).filter(Boolean) ?? [];
  return requires.length > 0 && requires.every((prefix) => {
    const namespace = choice.lookupNamespaceURI(prefix);
    return namespace !== null && SUPPORTED_TRANSITION_NAMESPACES.has(namespace);
  });
}

export function parseTransition(root: Element | null): Transition | undefined {
  // p:transition 可能在 p:sld 直属，也可能在 mc:AlternateContent 里的 p14 变体
  const el = findTransition(root);
  if (!el) return undefined;

  let type: TransitionType = 'none';
  let dir: string | undefined;
  let morphBy: Transition['morphBy'];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    const mapped = transitionType(c);
    if (!mapped) continue;
    type = mapped;
    dir = c.getAttribute('dir') ?? c.getAttribute('orient') ?? undefined;
    if (c.localName === 'morph') {
      const opt = c.getAttribute('option');
      morphBy = opt === 'byWord' || opt === 'byChar' ? opt : 'byObject';
    }
    if (c.localName === 'split') {
      const orient = c.getAttribute('orient') ?? 'horz';
      const d = c.getAttribute('dir') ?? 'out';
      dir = `${orient}-${d}`;
    }
    break;
  }

  const exactMs = numberAttribute(el, 'dur', POWERPOINT_2010_NS)
    ?? numberAttribute(el, 'dur', null);
  const durationMs = type === 'none'
    ? 0 : exactMs ?? SPEED_MS[el.getAttribute('spd') ?? 'fast'] ?? 500;
  const advTm = numberAttribute(el, 'advTm', null);
  dir ??= transitionDefaultDirection(type);

  return {
    type,
    dir,
    durationMs: type === 'none' ? 0 : Math.max(80, Math.min(5000, durationMs)),
    advanceAfterMs: advTm !== null && advTm !== undefined ? advTm : undefined,
    morphBy,
  };
}

function findTransition(root: Element | null): Element | null {
  if (!root) return null;
  const direct = childByName(root, PRESENTATIONML_NS, 'transition');
  if (direct) return direct;
  for (const alternate of childrenByName(root, MARKUP_COMPATIBILITY_NS, 'AlternateContent')) {
    // MCE 先原子选择一个分支，再解释其内容；不能因所选 Choice 无 transition 改投 Fallback。
    const selected = childrenByName(alternate, MARKUP_COMPATIBILITY_NS, 'Choice')
      .find(supportedChoice)
      ?? childByName(alternate, MARKUP_COMPATIBILITY_NS, 'Fallback');
    const transition = childByName(selected, PRESENTATIONML_NS, 'transition');
    if (transition) return transition;
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
  51: 'swivel', 52: 'stretch', 53: 'grow', 59: 'grow', 61: 'spin',
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
/**
 * p:animMotion@path —— 语法源自 VML，与 SVG 的 d 不同：
 * 只有 M / L / C / Z 四个几何命令，外加一个 E 表示「路径结束」；
 * 坐标是幻灯片宽高的比例（0-1），且相对形状**起始中心**而非画布原点。
 *
 * 返回位移折线（px）。顶点是几何，匀速由播放层的关键帧 offset 表达；
 * 预先重采样会切掉尖角，也会让“保存后重开”改变用户输入的路径。
 */
export function parseMotionPath(
  path: string, slideW: number, slideH: number, maxPoints = 256,
): [number, number][] | undefined {
  const tokens = path.match(/[MLCZEmlcze]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!tokens) return undefined;

  const pts: [number, number][] = [];
  let cur: [number, number] = [0, 0];
  let startPt: [number, number] = [0, 0];
  let i = 0;
  const num = (): number => {
    const v = Number(tokens[i++]);
    return Number.isFinite(v) ? v : 0;
  };
  const push = (p: [number, number]): void => { pts.push(p); cur = p; };

  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case 'M': case 'm': {
        const p: [number, number] = [num(), num()];
        startPt = p; pts.length = 0; push(p);
        break;
      }
      case 'L': case 'l':
        push([num(), num()]);
        break;
      case 'C': case 'c': {
        const [x1, y1, x2, y2, x, y] = [num(), num(), num(), num(), num(), num()];
        const [x0, y0] = cur;
        // 固定 16 段折线化：运动路径的曲率很低，再细也看不出差别
        for (let k = 1; k <= 16; k++) {
          const t = k / 16, u = 1 - t;
          pts.push([
            u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
            u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
          ]);
        }
        cur = [x, y];
        break;
      }
      case 'Z': case 'z':
        push([startPt[0], startPt[1]]);
        break;
      default:
        // E（结束）与任何未知命令都终止解析；散落的数字被 num() 吃掉
        i = tokens.length;
    }
  }

  if (pts.length < 2) return undefined;

  // 换算成 px 并以首点为原点——路径描述的是位移，不是绝对坐标
  const [ox, oy] = pts[0];
  const abs = pts.map(([x, y]): [number, number] => [(x - ox) * slideW, (y - oy) * slideH]);

  if (abs.length <= maxPoints) return abs;

  // 极端来源路径只为守住内存上界而降采样；常规折线及编辑器写回始终保留顶点。
  const seg: number[] = [0];
  for (let k = 1; k < abs.length; k++) {
    seg.push(seg[k - 1] + Math.hypot(abs[k][0] - abs[k - 1][0], abs[k][1] - abs[k - 1][1]));
  }
  const total = seg[seg.length - 1];
  if (!(total > 0)) return undefined;

  const out: [number, number][] = [];
  let j = 1;
  for (let k = 0; k < maxPoints; k++) {
    const want = (total * k) / (maxPoints - 1);
    while (j < seg.length - 1 && seg[j] < want) j++;
    const span = seg[j] - seg[j - 1];
    const t = span > 0 ? (want - seg[j - 1]) / span : 0;
    out.push([
      abs[j - 1][0] + (abs[j][0] - abs[j - 1][0]) * t,
      abs[j - 1][1] + (abs[j][1] - abs[j - 1][1]) * t,
    ]);
  }
  return out;
}

/** 子树里第一个带 path 的 p:animMotion */
function findMotion(el: Element, depth = 8): string | null {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === 'animMotion') {
      const p = attr(c, 'path');
      if (p) return p;
    }
    if (depth > 0) {
      const hit = findMotion(c, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

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

export function parseTiming(timing: Element | null, slideW = 0, slideH = 0): AnimStep[] | undefined {
  return parseTimingDetailed(timing, slideW, slideH).animations;
}

interface ParsedTiming {
  readonly animations?: AnimStep[];
  readonly readonly: boolean;
}

/**
 * 解析预算按真实 DOM 节点计数；即使来源已经判为只读，也不能再无界扫描宽树。
 * preset 子树仍参与计数，但不会把嵌套 cTn 重复解释成第二个效果。
 */
function presetTimeNodes(timing: Element): Element[] | null {
  const found: Element[] = [];
  interface Cursor {
    next: Element | null;
    readonly depth: number;
    readonly insidePreset: boolean;
  }
  const parents: Cursor[] = [];
  let current: { element: Element; depth: number; insidePreset: boolean } | null = {
    element: timing, depth: 0, insidePreset: false,
  };
  let visited = 0;
  while (current) {
    if (++visited > MAX_TIMING_NODES) return null;
    const preset: boolean = !current.insidePreset && current.depth <= 25
      && current.element.localName === 'cTn' && !!attr(current.element, 'presetClass');
    if (preset) found.push(current.element);
    const insidePreset: boolean = current.insidePreset || preset;
    const child: Element | null = current.element.firstElementChild;
    if (child) {
      parents.push({
        next: child.nextElementSibling,
        depth: current.depth + 1,
        insidePreset,
      });
      current = { element: child, depth: current.depth + 1, insidePreset };
      continue;
    }
    current = null;
    while (parents.length && !current) {
      const cursor = parents[parents.length - 1];
      const sibling = cursor.next;
      if (!sibling) {
        parents.pop();
        continue;
      }
      cursor.next = sibling.nextElementSibling;
      current = {
        element: sibling,
        depth: cursor.depth,
        insidePreset: cursor.insidePreset,
      };
    }
  }
  return found;
}

function parseTimingDetailed(timing: Element | null, slideW = 0, slideH = 0): ParsedTiming {
  if (!timing) return { readonly: false };
  const steps: AnimStep[] = [];
  let readonly = timingHasUnsupportedContent(timing);
  const timeNodes = presetTimeNodes(timing);
  if (!timeNodes) return { readonly: true };
  for (const time of timeNodes) {
    const step = buildStep(time, slideW, slideH);
    if (step) steps.push(step);
    else readonly = true;
  }

  if (!steps.length) return { readonly };

  // 按点击批次编号：第一个效果与其后所有 withPrev/afterPrev 归为同一批
  let group = -1;
  for (const s of steps) {
    if (s.trigger === 'click' || group < 0) group++;
    s.clickGroup = group;
  }
  return { animations: steps, readonly };
}

export function parseSlideTiming(root: Element | null, slideW = 0, slideH = 0): ParsedTiming {
  const selected = selectSlideTiming(root);
  const parsed = parseTimingDetailed(selected.timing, slideW, slideH);
  return { ...parsed, readonly: selected.readonly || parsed.readonly };
}

function buildStep(cTn: Element, slideW: number, slideH: number): AnimStep | null {
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

  const dur = numAttr(cTn, 'dur') ?? findDuration(cTn) ?? 500;

  // 运动路径优先于 presetID 推出来的效果：路径本身就完整描述了位移
  const rawPath = kind === 'motion' ? findMotion(cTn) : null;
  const motionPath = rawPath && slideW > 0 && slideH > 0
    ? parseMotionPath(rawPath, slideW, slideH)
    : undefined;

  return {
    target,
    effect,
    dir,
    delayMs: startDelay(cTn),
    durationMs: Math.max(60, Math.min(10000, dur)),
    trigger,
    kind,
    motionPath,
  };
}
