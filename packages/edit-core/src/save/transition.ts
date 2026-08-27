import type { Transition, TransitionType } from '@web-ppt/core';
import {
  cloneXmlNodeWithNamespaceClosure, createXmlElement, insertXmlChildUnchecked,
  removeXmlChild, reorderXmlChildren, replaceXmlChildren,
} from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import {
  MARKUP_COMPATIBILITY_NS, PRESENTATIONML_NS, POWERPOINT_2010_NS,
} from '../xml/qname';
import { xmlElementChildren } from '../xml/query';
import { elementState } from '../xml/state';
import type { XmlDocument, XmlElement, XmlNode } from '../xml/types';
import { namespacedElement } from './xml-element';

const POWERPOINT_2015_NS = 'http://schemas.microsoft.com/office/powerpoint/2015/09/main';
const EXTENDED = new Set<TransitionType>([
  'vortex', 'switch', 'flip', 'ripple', 'honeycomb', 'glitter', 'warp', 'flythrough',
  'flash', 'shred', 'reveal', 'wheelReverse', 'ferris', 'gallery', 'conveyor', 'pan',
  'doors', 'window', 'prism',
]);
const STANDARD_EFFECTS = new Set<string>([
  'fade', 'cut', 'push', 'pull', 'cover', 'wipe', 'split', 'zoom', 'dissolve',
  'checker', 'blinds', 'comb', 'wheel', 'circle', 'diamond', 'plus', 'wedge',
  'newsflash', 'randomBar', 'strips', 'random', 'fadeThroughBlack',
]);

const SUPPORTED_CHOICE_NAMESPACES = new Set([POWERPOINT_2010_NS, POWERPOINT_2015_NS]);

function speed(durationMs: number): string {
  return durationMs <= 625 ? 'fast' : durationMs <= 875 ? 'med' : 'slow';
}

function removeAttributes(
  element: XmlElement,
  predicate: (attribute: XmlElement['attributes'][number]) => boolean,
): void {
  for (const attribute of [...element.attributes]) {
    if (predicate(attribute)) removeXmlAttribute(element, attribute.name);
  }
}

function effectNamespace(prefix: 'p' | 'p14' | 'p159'): string {
  return prefix === 'p' ? PRESENTATIONML_NS
    : prefix === 'p14' ? POWERPOINT_2010_NS : POWERPOINT_2015_NS;
}

function sourceEffect(
  source: XmlElement | undefined,
  type: TransitionType,
  prefix: 'p' | 'p14' | 'p159',
): XmlElement | undefined {
  const namespace = effectNamespace(prefix);
  return source && xmlElementChildren(source).find((child) =>
    child.namespaceUri === namespace && publicEffectType(child) === type);
}

function publicEffectType(element: XmlElement): TransitionType | undefined {
  if (element.namespaceUri === PRESENTATIONML_NS) {
    if (element.localName === 'random') return 'dissolve';
    if (element.localName === 'fadeThroughBlack') return 'fade';
    return STANDARD_EFFECTS.has(element.localName) ? element.localName as TransitionType : undefined;
  }
  if (element.namespaceUri === POWERPOINT_2010_NS
    && EXTENDED.has(element.localName as TransitionType)) return element.localName as TransitionType;
  if (element.namespaceUri === POWERPOINT_2015_NS && element.localName === 'morph') return 'morph';
  return undefined;
}

function isManagedEffect(element: XmlElement): boolean {
  return publicEffectType(element) !== undefined;
}

function effectElement(
  value: Transition,
  prefix: 'p' | 'p14' | 'p159',
  parent: XmlElement,
  source?: XmlElement,
): XmlElement {
  const previous = sourceEffect(source, value.type, prefix);
  const effect = previous
    ? cloneXmlNodeWithNamespaceClosure(previous)
    : namespacedElement(parent, effectNamespace(prefix), value.type);
  removeAttributes(effect, (attribute) =>
    attribute.namespaceUri === null && ['dir', 'orient', 'option'].includes(attribute.localName));
  if (value.type === 'split' && value.dir) {
    const [orient, dir] = value.dir.split('-');
    setXmlAttribute(effect, 'orient', orient);
    setXmlAttribute(effect, 'dir', dir);
  } else if (value.dir) setXmlAttribute(effect, 'dir', value.dir);
  if (value.type === 'morph') setXmlAttribute(effect, 'option', value.morphBy ?? 'byObject');
  return effect;
}

function transitionElement(
  value: Transition,
  effectPrefix: 'p' | 'p14' | 'p159',
  exact: boolean,
  parent: XmlElement,
  source?: XmlElement,
): XmlElement {
  const transition = source
    ? cloneXmlNodeWithNamespaceClosure(source)
    : namespacedElement(parent, PRESENTATIONML_NS, 'transition');
  const oldEffects = xmlElementChildren(transition).filter(isManagedEffect);
  for (const child of oldEffects.slice(1)) removeXmlChild(transition, child);
  removeAttributes(transition, (attribute) =>
    (attribute.namespaceUri === null && ['spd', 'advTm', 'dur'].includes(attribute.localName))
      || (attribute.namespaceUri === POWERPOINT_2010_NS && attribute.localName === 'dur'));
  if (!exact) {
    // Fallback 只携带 ISO 属性；否则旧版消费者仍无法理解所谓的兼容分支。
    removeAttributes(transition, (attribute) =>
      attribute.namespaceUri === POWERPOINT_2010_NS
        || attribute.namespaceUri === POWERPOINT_2015_NS);
  }
  setXmlAttribute(transition, 'spd', speed(value.durationMs));
  if (exact) {
    setXmlAttribute(transition, 'xmlns:p14', POWERPOINT_2010_NS);
    setXmlAttribute(transition, 'p14:dur', String(value.durationMs));
  }
  if (value.advanceAfterMs !== undefined) {
    setXmlAttribute(transition, 'advTm', String(value.advanceAfterMs));
  }
  const effect = effectElement(value, effectPrefix, transition, source);
  if (oldEffects[0]) replaceXmlChildren(transition, oldEffects[0], [effect]);
  else {
    const before = transition.children.find((child): child is XmlNode => child.type === 'element') ?? null;
    insertXmlChildUnchecked(transition, effect, before);
  }
  return transition;
}

function fallbackTransition(value: Transition): Transition {
  if (!EXTENDED.has(value.type) && value.type !== 'morph') return value;
  const type = ['gallery', 'conveyor', 'pan', 'reveal'].includes(value.type) ? 'push' : 'fade';
  return {
    type,
    durationMs: value.durationMs,
    ...(type === 'push' && value.dir && ['l', 'r', 'u', 'd'].includes(value.dir)
      ? { dir: value.dir } : {}),
    ...(value.advanceAfterMs !== undefined ? { advanceAfterMs: value.advanceAfterMs } : {}),
  };
}

function branchTransition(branch: XmlElement | undefined): XmlElement | undefined {
  return branch && xmlElementChildren(branch).find((child) =>
    child.namespaceUri === PRESENTATIONML_NS && child.localName === 'transition');
}

function supportedChoice(choice: XmlElement): boolean {
  const requires = choice.attributes.find((attribute) =>
    attribute.namespaceUri === null && attribute.localName === 'Requires')?.value
    .trim().split(/\s+/).filter(Boolean) ?? [];
  const namespaces = elementState(choice).namespaces;
  return requires.length > 0 && requires.every((prefix) =>
    SUPPORTED_CHOICE_NAMESPACES.has(namespaces.get(prefix) ?? ''));
}

function alternateBranches(alternate: XmlElement): {
  choice?: XmlElement; fallback?: XmlElement;
} {
  const branches = xmlElementChildren(alternate);
  return {
    choice: branches.find((branch) => branch.namespaceUri === MARKUP_COMPATIBILITY_NS
      && branch.localName === 'Choice' && supportedChoice(branch)),
    fallback: branches.find((branch) => branch.namespaceUri === MARKUP_COMPATIBILITY_NS
      && branch.localName === 'Fallback'),
  };
}

function replaceBranchTransition(
  branch: XmlElement, next: XmlElement,
): void {
  const current = branchTransition(branch);
  if (current) replaceXmlChildren(branch, current, [next]);
  else {
    const firstElement = branch.children.find((child): child is XmlNode => child.type === 'element') ?? null;
    insertXmlChildUnchecked(branch, next, firstElement);
  }
}

function moveChoiceFirst(alternate: XmlElement, choice: XmlElement): void {
  const elements = xmlElementChildren(alternate);
  const firstChoice = elements.findIndex((element) =>
    element.namespaceUri === MARKUP_COMPATIBILITY_NS && element.localName === 'Choice');
  const choiceIndex = elements.indexOf(choice);
  if (firstChoice < 0 || choiceIndex <= firstChoice) return;
  const ordered = [...elements];
  ordered.splice(choiceIndex, 1);
  ordered.splice(firstChoice, 0, choice);
  // 支持更新格式的消费者必然先命中新分支，不能让旧的更高版本 Choice 遮住编辑结果。
  reorderXmlChildren(alternate, ordered);
}

function alternateCarrier(value: Transition, source?: XmlElement): XmlElement {
  const directSource = source?.namespaceUri === PRESENTATIONML_NS ? source : undefined;
  const alternate = source?.namespaceUri === MARKUP_COMPATIBILITY_NS
    ? cloneXmlNodeWithNamespaceClosure(source)
    : createXmlElement('mc:AlternateContent', { selfClosing: false });
  setXmlAttribute(alternate, 'xmlns:mc', MARKUP_COMPATIBILITY_NS);
  const morph = value.type === 'morph';
  let { choice, fallback: fallbackBranch } = alternateBranches(alternate);
  if (!choice || !branchTransition(choice)) {
    choice = createXmlElement('mc:Choice', { selfClosing: false });
    const firstElement = alternate.children.find((child): child is XmlNode => child.type === 'element') ?? null;
    insertXmlChildUnchecked(alternate, choice, firstElement);
  }
  const mainSource = branchTransition(choice) ?? directSource;
  setXmlAttribute(choice, 'xmlns:p14', POWERPOINT_2010_NS);
  if (morph) setXmlAttribute(choice, 'xmlns:p159', POWERPOINT_2015_NS);
  setXmlAttribute(choice, 'Requires', morph ? 'p159' : 'p14');
  moveChoiceFirst(alternate, choice);
  replaceBranchTransition(choice, transitionElement(
    value, morph ? 'p159' : EXTENDED.has(value.type) ? 'p14' : 'p', true, choice, mainSource,
  ));
  if (!fallbackBranch) {
    fallbackBranch = createXmlElement('mc:Fallback', { selfClosing: false });
    insertXmlChildUnchecked(alternate, fallbackBranch);
  }
  const fallbackSource = branchTransition(fallbackBranch) ?? directSource;
  const fallback = fallbackTransition(value);
  replaceBranchTransition(fallbackBranch, transitionElement(
    fallback, 'p', false, fallbackBranch, fallbackSource,
  ));
  return alternate;
}

function isTransitionAlternate(element: XmlElement): boolean {
  if (element.namespaceUri !== MARKUP_COMPATIBILITY_NS || element.localName !== 'AlternateContent') {
    return false;
  }
  return xmlElementChildren(element).some((branch) =>
    branch.namespaceUri === MARKUP_COMPATIBILITY_NS
      && (branch.localName === 'Choice' || branch.localName === 'Fallback')
      && branchTransition(branch) !== undefined);
}

function carriers(root: XmlElement): XmlElement[] {
  return xmlElementChildren(root).filter((child) =>
    (child.namespaceUri === PRESENTATIONML_NS && child.localName === 'transition')
      || isTransitionAlternate(child));
}

function noneTransition(source: XmlElement, value: Transition): XmlElement {
  const transition = cloneXmlNodeWithNamespaceClosure(source);
  for (const child of xmlElementChildren(transition).filter(isManagedEffect)) {
    removeXmlChild(transition, child);
  }
  removeAttributes(transition, (attribute) =>
    (attribute.namespaceUri === null && ['spd', 'dur', 'advTm'].includes(attribute.localName))
      || (attribute.namespaceUri === POWERPOINT_2010_NS && attribute.localName === 'dur'));
  if (value.advanceAfterMs !== undefined) {
    setXmlAttribute(transition, 'advTm', String(value.advanceAfterMs));
  }
  return transition;
}

function noneCarrier(source: XmlElement, value: Transition): XmlElement {
  if (source.namespaceUri === PRESENTATIONML_NS) return noneTransition(source, value);
  const alternate = cloneXmlNodeWithNamespaceClosure(source);
  let branches = alternateBranches(alternate);
  let selected = branches.choice;
  if (!selected || !branchTransition(selected)) {
    selected = createXmlElement('mc:Choice', { selfClosing: false });
    const firstElement = alternate.children.find((child): child is XmlNode => child.type === 'element') ?? null;
    insertXmlChildUnchecked(alternate, selected, firstElement);
  }
  setXmlAttribute(selected, 'xmlns:p14', POWERPOINT_2010_NS);
  setXmlAttribute(selected, 'Requires', 'p14');
  const selectedTransition = branchTransition(selected);
  const fallbackTransition = branchTransition(branches.fallback);
  const sourceTransition = selectedTransition ?? fallbackTransition;
  if (sourceTransition) {
    replaceBranchTransition(selected, noneTransition(sourceTransition, value));
  } else {
    replaceBranchTransition(selected, namespacedElement(selected, PRESENTATIONML_NS, 'transition'));
  }
  moveChoiceFirst(alternate, selected);
  branches = alternateBranches(alternate);
  if (branches.fallback) {
    const transition = branchTransition(branches.fallback);
    if (transition) {
      replaceXmlChildren(branches.fallback, transition, [noneTransition(transition, value)]);
    } else {
      replaceBranchTransition(
        branches.fallback, namespacedElement(branches.fallback, PRESENTATIONML_NS, 'transition'),
      );
    }
  } else {
    const fallback = createXmlElement('mc:Fallback', { selfClosing: false });
    insertXmlChildUnchecked(alternate, fallback);
    insertXmlChildUnchecked(fallback, namespacedElement(fallback, PRESENTATIONML_NS, 'transition'));
  }
  return alternate;
}

function hasNonePayload(carrier: XmlElement): boolean {
  const materialAttributes = (element: XmlElement, ignored: readonly string[] = []): boolean =>
    element.attributes.some((attribute) =>
      attribute.name !== 'xmlns' && attribute.prefix !== 'xmlns'
        && !(attribute.namespaceUri === null && ignored.includes(attribute.localName)));
  const transitionPayload = (transition: XmlElement): boolean =>
    materialAttributes(transition)
    || transition.children.some((child) =>
      child.type === 'element' || (child.type === 'text' && child.value.trim())
        || (child.type !== 'text'));
  if (carrier.namespaceUri === PRESENTATIONML_NS) return transitionPayload(carrier);
  return materialAttributes(carrier) || xmlElementChildren(carrier).some((branch) =>
    materialAttributes(branch, ['Requires']) || branch.children.some((child) => {
      if (child.type !== 'element') return child.type !== 'text' || !!child.value.trim();
      if (child.namespaceUri === PRESENTATIONML_NS && child.localName === 'transition') {
        return transitionPayload(child);
      }
      return true;
    }));
}

/** 只替换 transition 自己占据的 schema 槽位；无关 MCE、timing 与扩展原地保留。 */
export function patchSlideTransition(
  document: XmlDocument,
  value: Transition,
  blockInherited = false,
): void {
  const existing = carriers(document.root);
  if (value.type === 'none') {
    if (existing[0]) {
      const next = noneCarrier(existing[0], value);
      const replacements = blockInherited || value.advanceAfterMs !== undefined || hasNonePayload(next)
        ? [next] : [];
      replaceXmlChildren(document.root, existing[0], replacements);
      for (const duplicate of existing.slice(1)) removeXmlChild(document.root, duplicate);
    } else if (blockInherited || value.advanceAfterMs !== undefined) {
      const transition = namespacedElement(document.root, PRESENTATIONML_NS, 'transition');
      if (value.advanceAfterMs !== undefined) {
        setXmlAttribute(transition, 'advTm', String(value.advanceAfterMs));
      }
      insertXmlInOrder(document.root, transition);
    }
    return;
  }
  const next = alternateCarrier(value, existing[0]);
  if (existing[0]) {
    replaceXmlChildren(document.root, existing[0], [next]);
    for (const duplicate of existing.slice(1)) removeXmlChild(document.root, duplicate);
    return;
  }
  // AlternateContent 自身不在 p:sld XSD；先占用合法 transition 槽，再原槽替换。
  const slot = namespacedElement(document.root, PRESENTATIONML_NS, 'transition');
  insertXmlInOrder(document.root, slot);
  replaceXmlChildren(document.root, slot, [next]);
}
