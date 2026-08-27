const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const XML = 'http://www.w3.org/XML/1998/namespace';

const MAX_NODES = 4096;

function children(parent: Element | null, namespace: string, localName?: string): Element[] {
  const found: Element[] = [];
  for (let child = parent?.firstElementChild ?? null; child; child = child.nextElementSibling) {
    if (child.namespaceURI === namespace && (!localName || child.localName === localName)) {
      found.push(child);
    }
  }
  return found;
}

export interface SlideTimingSelection {
  readonly timing: Element | null;
  /** MCE、多载体或未选中分支都不能伪装成完整可编辑时间线。 */
  readonly readonly: boolean;
}

export function selectSlideTiming(root: Element | null): SlideTimingSelection {
  if (!root) return { timing: null, readonly: false };
  const direct = children(root, P, 'timing');
  const alternates = children(root, MC, 'AlternateContent').filter((alternate) =>
    children(alternate, MC).some((branch) => children(branch, P, 'timing').length > 0));
  if (direct.length) {
    return { timing: direct[0], readonly: direct.length > 1 || alternates.length > 0 };
  }
  if (!alternates.length) return { timing: null, readonly: false };
  // timing parser 只理解基础 PresentationML；p14/p159 Choice 不能沿用切换效果的能力声明。
  const fallback = children(alternates[0], MC, 'Fallback')[0] ?? null;
  const timings = children(fallback, P, 'timing');
  return { timing: timings[0] ?? null, readonly: true };
}

interface ValidationContext {
  nodes: number;
  readonly ids: Set<number>;
}

function take(context: ValidationContext): boolean {
  context.nodes++;
  return context.nodes <= MAX_NODES;
}

function pChildren(element: Element, context: ValidationContext): Element[] | null {
  if (!take(context)) return null;
  const result: Element[] = [];
  for (let child = element.firstElementChild; child; child = child.nextElementSibling) {
    if (child.namespaceURI !== P) return null;
    result.push(child);
  }
  return result;
}

function exactChildren(
  element: Element, names: readonly string[], context: ValidationContext,
): Element[] | null {
  const found = pChildren(element, context);
  return found && found.length === names.length
    && found.every((child, index) => child.localName === names[index]) ? found : null;
}

function attributes(element: Element, allowed: readonly string[]): boolean {
  const names = new Set(allowed);
  return Array.from(element.attributes).every((attribute) => {
    if (attribute.namespaceURI === XMLNS || attribute.namespaceURI === XML) return true;
    return attribute.namespaceURI === null && names.has(attribute.localName);
  });
}

function integer(value: string | null, min: number, max: number): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function timeId(element: Element, context: ValidationContext): boolean {
  const id = integer(element.getAttribute('id'), 1, 2_147_483_647);
  if (id === null || context.ids.has(id)) return false;
  context.ids.add(id);
  return true;
}

function conditionList(
  element: Element, delay: string | number, context: ValidationContext,
): boolean {
  if (element.localName !== 'stCondLst' || !attributes(element, [])) return false;
  const found = exactChildren(element, ['cond'], context);
  return !!found && attributes(found[0], ['delay'])
    && found[0].getAttribute('delay') === String(delay)
    && (pChildren(found[0], context)?.length ?? -1) === 0;
}

function targetElement(element: Element, context: ValidationContext): number | null {
  if (element.localName !== 'tgtEl' || !attributes(element, [])) return null;
  const found = exactChildren(element, ['spTgt'], context);
  if (!found || !attributes(found[0], ['spid'])
    || (pChildren(found[0], context)?.length ?? -1) !== 0) return null;
  return integer(found[0].getAttribute('spid'), 1, 2_147_483_647);
}

function attributeNames(
  element: Element, expected: readonly string[], context: ValidationContext,
): boolean {
  if (element.localName !== 'attrNameLst' || !attributes(element, [])) return false;
  const found = pChildren(element, context);
  return !!found && found.length === expected.length && found.every((child, index) =>
    child.localName === 'attrName' && attributes(child, [])
      && (pChildren(child, context)?.length ?? -1) === 0
      && child.textContent === expected[index]);
}

function commonBehavior(
  element: Element, duration: number, names: readonly string[], context: ValidationContext,
  startDelay?: number,
): number | null {
  if (element.localName !== 'cBhvr' || !attributes(element, [])) return null;
  const expected = names.length ? ['cTn', 'tgtEl', 'attrNameLst'] : ['cTn', 'tgtEl'];
  const found = exactChildren(element, expected, context);
  if (!found) return null;
  const time = found[0];
  if (!attributes(time, ['id', 'dur', 'fill']) || !timeId(time, context)
    || time.getAttribute('dur') !== String(duration) || time.getAttribute('fill') !== 'hold') return null;
  const timeChildren = pChildren(time, context);
  if (!timeChildren || (startDelay === undefined ? timeChildren.length !== 0
    : timeChildren.length !== 1 || !conditionList(timeChildren[0], startDelay, context))) return null;
  const target = targetElement(found[1], context);
  if (target === null || (names.length && !attributeNames(found[2], names, context))) return null;
  return target;
}

function visibility(
  element: Element, value: 'visible' | 'hidden', delay: number, context: ValidationContext,
): number | null {
  if (element.localName !== 'set' || !attributes(element, [])) return null;
  const found = exactChildren(element, ['cBhvr', 'to'], context);
  const target = found ? commonBehavior(found[0], 1, ['style.visibility'], context, delay) : null;
  const to = found && attributes(found[1], [])
    ? exactChildren(found[1], ['strVal'], context) : null;
  if (target === null || !to || !attributes(to[0], ['val'])
    || to[0].getAttribute('val') !== value
    || (pChildren(to[0], context)?.length ?? -1) !== 0) return null;
  return target;
}

const FILTERS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  '2': Object.freeze({ '8': 'slide(fromLeft)', '2': 'slide(fromRight)', '1': 'slide(fromTop)', '4': 'slide(fromBottom)' }),
  '22': Object.freeze({ '8': 'wipe(right)', '2': 'wipe(left)', '1': 'wipe(down)', '4': 'wipe(up)' }),
  '23': Object.freeze({ '16': 'box(in)', '32': 'box(out)' }),
});

function visualBehavior(
  element: Element, preset: string, subtype: string | null, kind: string,
  duration: number, context: ValidationContext,
): number | null {
  if (element.localName !== 'animEffect' || !attributes(element, ['transition', 'filter'])) return null;
  const filter = preset === '10' ? 'fade' : preset === '9' ? 'dissolve'
    : subtype ? FILTERS[preset]?.[subtype] : undefined;
  if (!filter || element.getAttribute('filter') !== filter
    || element.getAttribute('transition') !== (kind === 'exit' ? 'out' : 'in')) return null;
  const found = exactChildren(element, ['cBhvr'], context);
  return found ? commonBehavior(found[0], duration, [], context) : null;
}

function emphasisBehavior(
  element: Element, preset: string, duration: number, context: ValidationContext,
): number | null {
  if (preset === '61') {
    if (element.localName !== 'animRot' || !attributes(element, ['by'])
      || element.getAttribute('by') !== '21600000') return null;
    const found = exactChildren(element, ['cBhvr'], context);
    return found ? commonBehavior(found[0], duration, ['r'], context) : null;
  }
  if (element.localName !== 'animScale' || !attributes(element, [])) return null;
  const found = exactChildren(element, ['cBhvr', 'by'], context);
  if (!found || !attributes(found[1], ['x', 'y'])
    || found[1].getAttribute('x') !== '125000' || found[1].getAttribute('y') !== '125000'
    || (pChildren(found[1], context)?.length ?? -1) !== 0) return null;
  return commonBehavior(found[0], duration, ['ppt_w', 'ppt_h'], context);
}

function motionPath(value: string | null): boolean {
  if (!value) return false;
  const tokens = value.trim().split(/\s+/);
  if (tokens.length < 7 || tokens[0] !== 'M' || tokens[tokens.length - 1] !== 'E') return false;
  let points = 0;
  for (let index = 0; index < tokens.length - 1;) {
    const command = tokens[index++];
    if ((points === 0 ? command !== 'M' : command !== 'L') || index + 1 >= tokens.length) return false;
    const x = Number(tokens[index++]);
    const y = Number(tokens[index++]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (points === 0 && (x !== 0 || y !== 0)) return false;
    points++;
  }
  return points >= 2 && points <= 256;
}

function motionBehavior(
  element: Element, duration: number, context: ValidationContext,
): number | null {
  if (element.localName !== 'animMotion'
    || !attributes(element, ['origin', 'path', 'pathEditMode'])
    || element.getAttribute('origin') !== 'layout'
    || element.getAttribute('pathEditMode') !== 'relative'
    || !motionPath(element.getAttribute('path'))) return null;
  const found = exactChildren(element, ['cBhvr'], context);
  return found ? commonBehavior(found[0], duration, ['ppt_x', 'ppt_y'], context) : null;
}

function effect(element: Element, context: ValidationContext): string | null {
  if (element.localName !== 'par' || !attributes(element, [])) return null;
  const wrapper = exactChildren(element, ['cTn'], context)?.[0];
  if (!wrapper || !attributes(wrapper, [
    'id', 'presetID', 'presetClass', 'presetSubtype', 'dur', 'fill', 'nodeType',
  ]) || !timeId(wrapper, context)) return null;
  const preset = wrapper.getAttribute('presetID');
  const kind = wrapper.getAttribute('presetClass');
  const subtype = wrapper.getAttribute('presetSubtype');
  const duration = integer(wrapper.getAttribute('dur'), 60, 10_000);
  const nodeType = wrapper.getAttribute('nodeType');
  if (!preset || !kind || duration === null || wrapper.getAttribute('fill') !== 'hold'
    || !['clickEffect', 'withEffect', 'afterEffect'].includes(nodeType ?? '')) return null;
  const body = exactChildren(wrapper, ['stCondLst', 'childTnLst'], context);
  const delay = body ? integer(body[0].firstElementChild?.getAttribute('delay') ?? null, 0, 300_000) : null;
  if (!body || delay === null || !conditionList(body[0], delay, context)
    || !attributes(body[1], [])) return null;
  const behaviors = pChildren(body[1], context);
  if (!behaviors) return null;

  let targets: Array<number | null> = [];
  if (kind === 'path' && preset === '0' && subtype === null && behaviors.length === 1) {
    targets = [motionBehavior(behaviors[0], duration, context)];
  } else if (kind === 'emph' && ['59', '61'].includes(preset) && subtype === null
    && behaviors.length === 1) {
    targets = [emphasisBehavior(behaviors[0], preset, duration, context)];
  } else if (['entr', 'exit'].includes(kind) && ['1', '2', '9', '10', '22', '23'].includes(preset)) {
    const needsSubtype = ['2', '22', '23'].includes(preset);
    if (needsSubtype !== (subtype !== null)) return null;
    const visible = kind === 'entr' ? 'visible' : 'hidden';
    const visibilityDelay = kind === 'entr' ? 0 : duration;
    if (preset === '1' && behaviors.length === 1) {
      targets = [visibility(behaviors[0], visible, visibilityDelay, context)];
    } else if (behaviors.length === 2) {
      const visualIndex = kind === 'entr' ? 1 : 0;
      const visibilityIndex = 1 - visualIndex;
      targets = [
        visualBehavior(behaviors[visualIndex], preset, subtype, kind, duration, context),
        visibility(behaviors[visibilityIndex], visible, visibilityDelay, context),
      ];
    }
  }
  if (!targets.length || targets.some((target) => target === null)
    || targets.some((target) => target !== targets[0])) return null;
  return nodeType;
}

function clickGroup(element: Element, context: ValidationContext): boolean {
  if (element.localName !== 'par' || !attributes(element, [])) return false;
  const wrapper = exactChildren(element, ['cTn'], context)?.[0];
  if (!wrapper || !attributes(wrapper, ['id', 'fill', 'nodeType']) || !timeId(wrapper, context)
    || wrapper.getAttribute('fill') !== 'hold' || wrapper.getAttribute('nodeType') !== 'clickEffect') return false;
  const body = exactChildren(wrapper, ['stCondLst', 'childTnLst'], context);
  if (!body || !conditionList(body[0], 'indefinite', context) || !attributes(body[1], [])) return false;
  const effects = pChildren(body[1], context);
  if (!effects?.length) return false;
  const nodeTypes = effects.map((candidate) => effect(candidate, context));
  return nodeTypes[0] === 'clickEffect'
    && nodeTypes.slice(1).every((nodeType) => nodeType === 'withEffect' || nodeType === 'afterEffect');
}

function canonicalTiming(timing: Element): boolean {
  const context: ValidationContext = { nodes: 0, ids: new Set() };
  if (timing.namespaceURI !== P || timing.localName !== 'timing' || !attributes(timing, [])) return false;
  const list = exactChildren(timing, ['tnLst'], context)?.[0];
  if (!list || !attributes(list, [])) return false;
  const rootPar = exactChildren(list, ['par'], context)?.[0];
  if (!rootPar || !attributes(rootPar, [])) return false;
  const root = exactChildren(rootPar, ['cTn'], context)?.[0];
  if (!root || !attributes(root, ['id', 'dur', 'restart', 'nodeType']) || !timeId(root, context)
    || root.getAttribute('dur') !== 'indefinite' || root.getAttribute('restart') !== 'never'
    || root.getAttribute('nodeType') !== 'tmRoot') return false;
  const rootList = exactChildren(root, ['childTnLst'], context)?.[0];
  if (!rootList || !attributes(rootList, [])) return false;
  const sequence = exactChildren(rootList, ['seq'], context)?.[0];
  if (!sequence || !attributes(sequence, ['concurrent', 'nextAc'])
    || sequence.getAttribute('concurrent') !== '1' || sequence.getAttribute('nextAc') !== 'seek') return false;
  const main = exactChildren(sequence, ['cTn'], context)?.[0];
  if (!main || !attributes(main, ['id', 'dur', 'nodeType']) || !timeId(main, context)
    || main.getAttribute('dur') !== 'indefinite' || main.getAttribute('nodeType') !== 'mainSeq') return false;
  const groups = exactChildren(main, ['childTnLst'], context)?.[0];
  if (!groups || !attributes(groups, [])) return false;
  const found = pChildren(groups, context);
  return !!found?.length && found.every((group) => clickGroup(group, context));
}

/** 只有当前 writer 可逐语义重建的规范子集才允许产品呈现为完整可编辑。 */
export function timingHasUnsupportedContent(timing: Element): boolean {
  return !canonicalTiming(timing);
}
