import type { EditAnimationStep, EditDoc, SlideRecord } from '../types';
import { animationEffectSpec, animationFilter } from '../animation-catalog';
import { createXmlText, insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { setXmlAttribute } from '../xml/mutate';
import { MARKUP_COMPATIBILITY_NS, PRESENTATIONML_NS, XMLNS_NS } from '../xml/qname';
import { xmlElementChildren } from '../xml/query';
import { nodeState } from '../xml/state';
import type { XmlDocument, XmlElement } from '../xml/types';
import { namespacedElement } from './xml-element';

const SUBTYPE: Readonly<Record<string, number>> = Object.freeze({
  u: 1, r: 2, d: 4, l: 8, rd: 3, ru: 6, lu: 9, ld: 12,
  horz: 5, vert: 10, in: 16, out: 32,
});

function child(
  parent: XmlElement,
  localName: string,
  attributes: Readonly<Record<string, string | number>> = {},
): XmlElement {
  const element = namespacedElement(parent, PRESENTATIONML_NS, localName);
  for (const [name, value] of Object.entries(attributes)) setXmlAttribute(element, name, String(value));
  insertXmlChildUnchecked(parent, element);
  return element;
}

function commonTimeNode(
  parent: XmlElement,
  nextId: () => number,
  attributes: Readonly<Record<string, string | number>> = {},
): XmlElement {
  return child(parent, 'cTn', { id: nextId(), ...attributes });
}

function startCondition(parent: XmlElement, delay: string | number): void {
  const list = child(parent, 'stCondLst');
  child(list, 'cond', { delay });
}

function commonBehavior(
  parent: XmlElement,
  target: number,
  durationMs: number,
  nextId: () => number,
  attributes: readonly string[] = [],
): void {
  const behavior = child(parent, 'cBhvr');
  commonTimeNode(behavior, nextId, { dur: durationMs, fill: 'hold' });
  const targetElement = child(behavior, 'tgtEl');
  child(targetElement, 'spTgt', { spid: target });
  if (attributes.length) {
    const list = child(behavior, 'attrNameLst');
    for (const name of attributes) {
      const attribute = child(list, 'attrName');
      insertXmlChildUnchecked(attribute, createXmlText(name));
    }
  }
}

function visibility(
  parent: XmlElement,
  target: number,
  value: 'visible' | 'hidden',
  delayMs: number,
  nextId: () => number,
): void {
  const set = child(parent, 'set');
  const behavior = child(set, 'cBhvr');
  const time = commonTimeNode(behavior, nextId, { dur: 1, fill: 'hold' });
  startCondition(time, delayMs);
  const targetElement = child(behavior, 'tgtEl');
  child(targetElement, 'spTgt', { spid: target });
  const attributes = child(behavior, 'attrNameLst');
  const name = child(attributes, 'attrName');
  insertXmlChildUnchecked(name, createXmlText('style.visibility'));
  const to = child(set, 'to');
  child(to, 'strVal', { val: value });
}

function visualBehavior(
  parent: XmlElement,
  step: Exclude<EditAnimationStep, { readonly kind: 'motion' }>,
  target: number,
  nextId: () => number,
): void {
  if (step.kind === 'emphasis' && step.effect === 'spin') {
    const rotate = child(parent, 'animRot', { by: 21600000 });
    commonBehavior(rotate, target, step.durationMs, nextId, ['r']);
    return;
  }
  if (step.kind === 'emphasis' && step.effect === 'grow') {
    const scale = child(parent, 'animScale');
    commonBehavior(scale, target, step.durationMs, nextId, ['ppt_w', 'ppt_h']);
    child(scale, 'by', { x: 125000, y: 125000 });
    return;
  }
  if (step.effect === 'appear') return;
  const filter = animationFilter(step.effect, step.dir);
  if (!filter) throw new Error(`动画 ${step.effect} 缺少可保存 filter`);
  const effect = child(parent, 'animEffect', {
    transition: step.kind === 'exit' ? 'out' : 'in',
    filter,
  });
  commonBehavior(effect, target, step.durationMs, nextId);
}

function decimal(value: number): string {
  const normalized = Math.abs(value) < 5e-10 ? 0 : Math.round(value * 1e9) / 1e9;
  return String(normalized);
}

function motionBehavior(
  parent: XmlElement,
  step: Extract<EditAnimationStep, { readonly kind: 'motion' }>,
  target: number,
  doc: EditDoc,
  nextId: () => number,
): void {
  const points = step.motionPath.map(([x, y], index) =>
    `${index ? 'L' : 'M'} ${decimal(x / doc.meta.width)} ${decimal(y / doc.meta.height)}`).join(' ');
  const motion = child(parent, 'animMotion', {
    origin: 'layout', path: `${points} E`, pathEditMode: 'relative',
  });
  commonBehavior(motion, target, step.durationMs, nextId, ['ppt_x', 'ppt_y']);
}

function appendEffect(
  parent: XmlElement,
  step: EditAnimationStep,
  doc: EditDoc,
  nextId: () => number,
): void {
  const record = doc.elements[step.target];
  const target = record?.meta.origin?.spid ?? record?.src.id;
  if (target === undefined) throw new Error(`动画目标缺少 OOXML spid：${step.target}`);
  const effectPar = child(parent, 'par');
  const preset = commonTimeNode(effectPar, nextId, {
    presetID: step.kind === 'motion' ? 0 : animationEffectSpec(step.effect).preset,
    presetClass: step.kind === 'motion' ? 'path'
      : step.kind === 'entrance' ? 'entr' : step.kind === 'exit' ? 'exit' : 'emph',
    ...(step.kind !== 'motion' && step.dir !== undefined ? { presetSubtype: SUBTYPE[step.dir] ?? 0 } : {}),
    dur: step.durationMs, fill: 'hold',
    nodeType: step.trigger === 'click' ? 'clickEffect'
      : step.trigger === 'withPrev' ? 'withEffect' : 'afterEffect',
  });
  startCondition(preset, step.delayMs);
  const behaviors = child(preset, 'childTnLst');
  if (step.kind === 'entrance') visibility(behaviors, target, 'visible', 0, nextId);
  if (step.kind === 'motion') motionBehavior(behaviors, step, target, doc, nextId);
  else visualBehavior(behaviors, step, target, nextId);
  if (step.kind === 'exit') visibility(behaviors, target, 'hidden', step.durationMs, nextId);
}

function appendTimeTree(
  list: XmlElement,
  steps: readonly EditAnimationStep[],
  doc: EditDoc,
): void {
  let serial = 0;
  const nextId = (): number => ++serial;
  const rootPar = child(list, 'par');
  const root = commonTimeNode(rootPar, nextId, {
    dur: 'indefinite', restart: 'never', nodeType: 'tmRoot',
  });
  const rootChildren = child(root, 'childTnLst');
  const sequence = child(rootChildren, 'seq', { concurrent: 1, nextAc: 'seek' });
  const main = commonTimeNode(sequence, nextId, { dur: 'indefinite', nodeType: 'mainSeq' });
  const mainChildren = child(main, 'childTnLst');
  let group: XmlElement | null = null;
  for (const step of steps) {
    if (!group || step.trigger === 'click') {
      const wrapper = child(mainChildren, 'par');
      const wrapperTime = commonTimeNode(wrapper, nextId, { fill: 'hold', nodeType: 'clickEffect' });
      startCondition(wrapperTime, 'indefinite');
      group = child(wrapperTime, 'childTnLst');
    }
    appendEffect(group, step, doc, nextId);
  }
}

function materialAttribute(element: XmlElement): boolean {
  return element.attributes.some((attribute) => attribute.namespaceUri !== XMLNS_NS);
}

interface TimingSlot {
  readonly parent: XmlElement;
  readonly timing?: XmlElement;
}

function directTimings(parent: XmlElement): XmlElement[] {
  return xmlElementChildren(parent).filter((element) =>
    element.namespaceUri === PRESENTATIONML_NS && element.localName === 'timing');
}

function alternateTimingSlots(alternate: XmlElement): TimingSlot[] {
  if (alternate.namespaceUri !== MARKUP_COMPATIBILITY_NS
    || alternate.localName !== 'AlternateContent') return [];
  const branches = xmlElementChildren(alternate).filter((element) =>
    element.namespaceUri === MARKUP_COMPATIBILITY_NS
      && (element.localName === 'Choice' || element.localName === 'Fallback'));
  const timings = branches.map((parent) => ({ parent, timings: directTimings(parent) }));
  if (timings.some(({ timings: found }) => found.length > 1)) {
    throw new Error('mc:AlternateContent 分支包含多个 p:timing');
  }
  if (!timings.some(({ timings: found }) => found.length)) return [];
  return timings.map(({ parent, timings: found }) => ({ parent, timing: found[0] }));
}

function timingSlots(root: XmlElement): TimingSlot[] {
  const direct = directTimings(root);
  const alternates = xmlElementChildren(root).map(alternateTimingSlots).filter((slots) => slots.length);
  if (direct.length > 1 || alternates.length > 1 || (direct.length && alternates.length)) {
    throw new Error('幻灯片包含多个 p:timing 载体');
  }
  if (direct.length) return [{ parent: root, timing: direct[0] }];
  return alternates[0] ?? [];
}

const TARGET_BEHAVIORS = new Set([
  'set', 'anim', 'animClr', 'animEffect', 'animMotion', 'animRot', 'animScale',
  'audio', 'video', 'cmd',
]);

function parentElement(element: XmlElement): XmlElement | null {
  const parent = nodeState(element).parent;
  return parent?.type === 'element' ? parent : null;
}

function attributeValue(element: XmlElement, localName: string): string | undefined {
  return element.attributes.find((attribute) =>
    attribute.namespaceUri === null && attribute.localName === localName)?.value;
}

function walkElements(root: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  const stack = [root];
  while (stack.length) {
    const element = stack.pop()!;
    result.push(element);
    if (result.length > 100_000) throw new Error('动画时间树节点超过保存安全上限');
    const children = xmlElementChildren(element);
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }
  return result;
}

function referencesTarget(root: XmlElement, spids: ReadonlySet<number>): boolean {
  return walkElements(root).some((element) => {
    const value = attributeValue(element, 'spid');
    return value !== undefined && spids.has(Number(value));
  });
}

function targetOwner(target: XmlElement): XmlElement | null {
  let current: XmlElement | null = parentElement(target);
  let fallback: XmlElement | null = current?.localName === 'tgtEl' ? current : target;
  while (current) {
    // cBhvr / cond 是最小语义所有者；直接删整个 preset 会误伤同组的其他目标。
    if (current.namespaceUri === PRESENTATIONML_NS
      && (current.localName === 'cBhvr' || current.localName === 'cond')) return current;
    if (TARGET_BEHAVIORS.has(current.localName)) return current;
    current = parentElement(current);
  }
  return fallback;
}

function presetTime(owner: XmlElement): XmlElement | undefined {
  if (owner.namespaceUri !== PRESENTATIONML_NS || owner.localName !== 'par') return undefined;
  return xmlElementChildren(owner).find((child) =>
    child.namespaceUri === PRESENTATIONML_NS && child.localName === 'cTn'
      && !!attributeValue(child, 'presetClass'));
}

function preserveClickBoundaries(timing: XmlElement, removals: ReadonlySet<XmlElement>): void {
  const owners = walkElements(timing).filter((element) => !!presetTime(element));
  let nextSurvivor: XmlElement | null = null;
  for (let index = owners.length - 1; index >= 0; index--) {
    const owner = owners[index];
    const time = presetTime(owner)!;
    if (!removals.has(owner)) {
      nextSurvivor = owner;
      continue;
    }
    if (attributeValue(time, 'nodeType') === 'clickEffect' && nextSurvivor) {
      setXmlAttribute(presetTime(nextSurvivor)!, 'nodeType', 'clickEffect');
    }
  }
}

function pruneEmptyTimeContainers(timing: XmlElement): void {
  for (let pass = 0; pass < 64; pass++) {
    let changed = false;
    const nodes = walkElements(timing).reverse();
    for (const node of nodes) {
      if (node.namespaceUri !== PRESENTATIONML_NS
        || (node.localName !== 'par' && node.localName !== 'seq')) continue;
      const time = xmlElementChildren(node).find((child) =>
        child.namespaceUri === PRESENTATIONML_NS && child.localName === 'cTn');
      const list = time && xmlElementChildren(time).find((child) =>
        child.namespaceUri === PRESENTATIONML_NS && child.localName === 'childTnLst');
      const parent = parentElement(node);
      if (list && xmlElementChildren(list).length === 0 && parent) {
        removeXmlChild(parent, node);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const node of walkElements(timing).reverse()) {
    if (node.namespaceUri !== PRESENTATIONML_NS
      || (node.localName !== 'tnLst' && node.localName !== 'bldLst')
      || xmlElementChildren(node).length !== 0 || materialAttribute(node)) continue;
    const parent = parentElement(node);
    if (parent) removeXmlChild(parent, node);
  }
}

function spTargets(root: XmlElement): XmlElement[] {
  return walkElements(root).filter((element) =>
    element.namespaceUri === PRESENTATIONML_NS && element.localName === 'spTgt');
}

function removeTargetNode(target: XmlElement): void {
  const parent = parentElement(target);
  if (!parent) return;
  removeXmlChild(parent, target);
  if (parent.localName === 'tgtEl' && xmlElementChildren(parent).length === 0
    && !materialAttribute(parent)) {
    const grandparent = parentElement(parent);
    if (grandparent) removeXmlChild(grandparent, parent);
  }
}

const STRUCTURAL_BEHAVIOR_PARENTS = new Set([
  'timing', 'tnLst', 'childTnLst', 'subTnLst', 'par', 'seq', 'cTn',
]);

function behaviorContainer(
  behavior: XmlElement, removals: ReadonlySet<XmlElement>,
): XmlElement | null {
  const parent = parentElement(behavior);
  if (!parent || STRUCTURAL_BEHAVIOR_PARENTS.has(parent.localName)) return null;
  const behaviors = xmlElementChildren(parent).filter((child) =>
    child.namespaceUri === PRESENTATIONML_NS && child.localName === 'cBhvr');
  return behaviors.length && behaviors.every((child) => removals.has(child)) ? parent : null;
}

function conditionTimeContainer(
  condition: XmlElement, removals: ReadonlySet<XmlElement>,
): XmlElement | null {
  const list = parentElement(condition);
  if (!list || (list.localName !== 'stCondLst' && list.localName !== 'endCondLst')) return null;
  const conditions = xmlElementChildren(list).filter((child) =>
    child.namespaceUri === PRESENTATIONML_NS && child.localName === 'cond');
  if (!conditions.length || !conditions.every((child) => removals.has(child))) return null;
  const time = parentElement(list);
  const container = time && parentElement(time);
  return container && container.namespaceUri === PRESENTATIONML_NS
    && (container.localName === 'par' || container.localName === 'seq') ? container : null;
}

function insideRemoval(element: XmlElement, removals: ReadonlySet<XmlElement>): boolean {
  for (let current = parentElement(element); current; current = parentElement(current)) {
    if (removals.has(current)) return true;
  }
  return false;
}

function emptyPresetOwners(timing: XmlElement): XmlElement[] {
  return walkElements(timing).filter((owner) => {
    const time = presetTime(owner);
    const list = time && xmlElementChildren(time).find((child) =>
      child.namespaceUri === PRESENTATIONML_NS && child.localName === 'childTnLst');
    return !!list && xmlElementChildren(list).length === 0;
  });
}

function removePlanned(nodes: ReadonlySet<XmlElement>): void {
  for (const node of nodes) {
    const parent = parentElement(node);
    if (parent) removeXmlChild(parent, node);
  }
}

function allTimingSlots(root: XmlElement): TimingSlot[] {
  const slots: TimingSlot[] = directTimings(root).map((timing) => ({ parent: root, timing }));
  for (const alternate of xmlElementChildren(root)) {
    if (alternate.namespaceUri !== MARKUP_COMPATIBILITY_NS
      || alternate.localName !== 'AlternateContent') continue;
    for (const branch of xmlElementChildren(alternate)) {
      if (branch.namespaceUri !== MARKUP_COMPATIBILITY_NS
        || (branch.localName !== 'Choice' && branch.localName !== 'Fallback')) continue;
      for (const timing of directTimings(branch)) slots.push({ parent: branch, timing });
    }
  }
  return slots;
}

/** 删除对象必须保留式清理所有已知/未知行为和 build 对该 spid 的引用。 */
export function removeSlideAnimationTargets(
  document: XmlDocument, sourceSpids: readonly number[],
): void {
  if (!sourceSpids.length) return;
  const spids = new Set(sourceSpids);
  for (const slot of allTimingSlots(document.root)) {
    const timing = slot.timing!;
    const removals = new Set<XmlElement>();
    const surgicalTargets = new Set<XmlElement>();
    const targetsByOwner = new Map<XmlElement, XmlElement[]>();
    for (const element of walkElements(timing)) {
      if (element.namespaceUri === PRESENTATIONML_NS && element.localName === 'spTgt'
        && spids.has(Number(attributeValue(element, 'spid')))) {
        const owner = targetOwner(element);
        if (owner) targetsByOwner.set(owner, [...(targetsByOwner.get(owner) ?? []), element]);
      }
    }
    for (const [owner, targets] of targetsByOwner) {
      const retained = spTargets(owner).some((target) =>
        !spids.has(Number(attributeValue(target, 'spid'))));
      if (retained) targets.forEach((target) => surgicalTargets.add(target));
      else removals.add(owner);
    }
    surgicalTargets.forEach(removeTargetNode);

    const behaviorContainers = new Set<XmlElement>();
    const timeContainers = new Set<XmlElement>();
    for (const node of removals) {
      if (node.namespaceUri !== PRESENTATIONML_NS) continue;
      if (node.localName === 'cBhvr') {
        const container = behaviorContainer(node, removals);
        if (container) behaviorContainers.add(container);
      } else if (node.localName === 'cond') {
        const container = conditionTimeContainer(node, removals);
        if (container) timeContainers.add(container);
      }
    }
    behaviorContainers.forEach((node) => removals.add(node));
    const immediate = new Set([...removals].filter((node) => !timeContainers.has(node)));
    removePlanned(immediate);

    const presetRemovals = new Set<XmlElement>(emptyPresetOwners(timing));
    for (const owner of walkElements(timing).filter((element) => !!presetTime(element))) {
      if (timeContainers.has(owner) || insideRemoval(owner, timeContainers)) presetRemovals.add(owner);
    }
    preserveClickBoundaries(timing, presetRemovals);
    removePlanned(timeContainers);

    for (const buildList of walkElements(timing).filter((element) =>
      element.namespaceUri === PRESENTATIONML_NS && element.localName === 'bldLst')) {
      for (const build of [...xmlElementChildren(buildList)]) {
        if (referencesTarget(build, spids)) removeXmlChild(buildList, build);
      }
    }
    pruneEmptyTimeContainers(timing);
    if (spTargets(timing).some((target) => spids.has(Number(attributeValue(target, 'spid'))))) {
      throw new Error('删除动画目标后仍存在悬空 spTgt');
    }
    if (!materialAttribute(timing) && xmlElementChildren(timing).length === 0) {
      removeXmlChild(slot.parent, timing);
    }
  }
}

function patchTiming(
  parent: XmlElement,
  timing: XmlElement,
  steps: readonly EditAnimationStep[],
  doc: EditDoc,
): void {
  for (const element of [...xmlElementChildren(timing)]) {
    if (element.namespaceUri === PRESENTATIONML_NS && element.localName === 'tnLst') {
      removeXmlChild(timing, element);
    }
  }
  if (steps.length) {
    const list = namespacedElement(timing, PRESENTATIONML_NS, 'tnLst');
    const before = xmlElementChildren(timing).find((element) =>
      element.namespaceUri === PRESENTATIONML_NS
        && (element.localName === 'bldLst' || element.localName === 'extLst')) ?? null;
    insertXmlChildUnchecked(timing, list, before);
    appendTimeTree(list, steps, doc);
  } else if (!materialAttribute(timing) && xmlElementChildren(timing).length === 0) {
    removeXmlChild(parent, timing);
  }
}

/** bldLst 按 spid/grpId 描述图表/SmartArt build，不依赖 cTn id；本票只替换 tnLst。 */
export function patchSlideAnimations(
  document: XmlDocument,
  doc: EditDoc,
  record: SlideRecord,
  steps: readonly EditAnimationStep[],
): void {
  let slots = timingSlots(document.root);
  if (!slots.length && steps.length) {
    const timing = namespacedElement(document.root, PRESENTATIONML_NS, 'timing');
    insertXmlInOrder(document.root, timing);
    slots = [{ parent: document.root, timing }];
  }
  for (const slot of slots) {
    let timing = slot.timing;
    if (!timing && steps.length) {
      timing = namespacedElement(slot.parent, PRESENTATIONML_NS, 'timing');
      insertXmlInOrder(slot.parent, timing);
    }
    if (timing) patchTiming(slot.parent, timing, steps, doc);
  }
}
