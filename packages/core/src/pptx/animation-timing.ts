const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const P159 = 'http://schemas.microsoft.com/office/powerpoint/2015/09/main';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

const SUPPORTED_MCE = new Set([P14, P159]);
const BEHAVIORS = new Set(['set', 'animEffect', 'animRot', 'animScale', 'animMotion']);
const PRESET_CLASSES = new Set(['entr', 'exit', 'emph', 'path']);
const ATTRS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  timing: new Set<string>(), tnLst: new Set<string>(), par: new Set<string>(), childTnLst: new Set<string>(),
  cTn: new Set(['id', 'dur', 'restart', 'nodeType', 'fill', 'presetID', 'presetClass', 'presetSubtype']),
  seq: new Set(['concurrent', 'nextAc']), stCondLst: new Set<string>(), cond: new Set(['delay']),
  set: new Set<string>(), cBhvr: new Set<string>(), tgtEl: new Set<string>(), spTgt: new Set(['spid']),
  attrNameLst: new Set<string>(), attrName: new Set<string>(), to: new Set<string>(), strVal: new Set(['val']),
  animEffect: new Set(['transition', 'filter']), animRot: new Set(['by']),
  animScale: new Set<string>(), by: new Set(['x', 'y']),
  animMotion: new Set(['origin', 'path', 'pathEditMode']),
});

function children(parent: Element | null, namespace: string, localName?: string): Element[] {
  const found: Element[] = [];
  for (let child = parent?.firstElementChild ?? null; child; child = child.nextElementSibling) {
    if (child.namespaceURI === namespace && (!localName || child.localName === localName)) {
      found.push(child);
    }
  }
  return found;
}

function supportedChoice(choice: Element): boolean {
  const requires = choice.getAttribute('Requires')?.trim().split(/\s+/).filter(Boolean) ?? [];
  return requires.length > 0 && requires.every((prefix) => {
    const namespace = choice.lookupNamespaceURI(prefix);
    return namespace !== null && SUPPORTED_MCE.has(namespace);
  });
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
  const alternate = alternates[0];
  const choice = children(alternate, MC, 'Choice').find(supportedChoice);
  const selected = choice ?? children(alternate, MC, 'Fallback')[0] ?? null;
  const timings = children(selected, P, 'timing');
  return {
    timing: timings[0] ?? null,
    readonly: true,
  };
}

function hasUnsupportedAttribute(element: Element): boolean {
  const supported = ATTRS[element.localName];
  if (!supported) return true;
  return Array.from(element.attributes).some((attribute) => {
    if (attribute.namespaceURI === XMLNS
      || attribute.namespaceURI === 'http://www.w3.org/XML/1998/namespace') return false;
    return attribute.namespaceURI === null && !supported.has(attribute.localName);
  });
}

/** 只承认可被当前 writer 无损重建的规范子集；其余内容仍由原包直通。 */
export function timingHasUnsupportedContent(timing: Element): boolean {
  let unsupported = false;
  const visit = (element: Element, inPreset: boolean): void => {
    if (unsupported) return;
    if (element.namespaceURI !== P || !ATTRS[element.localName] || hasUnsupportedAttribute(element)) {
      unsupported = true;
      return;
    }
    const preset = element.localName === 'cTn' && element.getAttribute('presetClass');
    if (preset && !PRESET_CLASSES.has(preset)) {
      unsupported = true;
      return;
    }
    const inside = inPreset || !!preset;
    if (BEHAVIORS.has(element.localName) && !inside) {
      unsupported = true;
      return;
    }
    for (let child = element.firstElementChild; child; child = child.nextElementSibling) {
      visit(child, inside);
    }
  };
  for (let child = timing.firstElementChild; child; child = child.nextElementSibling) {
    if (child.namespaceURI !== P || child.localName !== 'tnLst') {
      unsupported = true;
      continue;
    }
    visit(child, false);
  }
  return unsupported;
}
