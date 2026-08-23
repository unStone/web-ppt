import type { ElementRecord } from '../types';
import { isFrameXfrmField, XFRM_FIELDS } from '../commands/xfrm';
import { createXmlElement } from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS, POWERPOINT_2010_NS, PRESENTATIONML_NS } from '../xml/qname';
import { findXmlAttribute, findXmlChild, xmlElementChildren } from '../xml/query';
import { elementState } from '../xml/state';
import { removeXmlAttribute, setXmlAttribute } from '../xml/mutate';
import type { XmlDocument, XmlElement } from '../xml/types';

const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);

interface HostSpec {
  readonly namespaceUri: string;
  readonly nonVisual: string;
  readonly properties: string | null;
  readonly frame: boolean;
}

const HOSTS: Readonly<Record<string, HostSpec>> = {
  sp: { namespaceUri: PRESENTATIONML_NS, nonVisual: 'nvSpPr', properties: 'spPr', frame: false },
  pic: { namespaceUri: PRESENTATIONML_NS, nonVisual: 'nvPicPr', properties: 'spPr', frame: false },
  cxnSp: { namespaceUri: PRESENTATIONML_NS, nonVisual: 'nvCxnSpPr', properties: 'spPr', frame: false },
  grpSp: { namespaceUri: PRESENTATIONML_NS, nonVisual: 'nvGrpSpPr', properties: 'grpSpPr', frame: false },
  graphicFrame: {
    namespaceUri: PRESENTATIONML_NS, nonVisual: 'nvGraphicFramePr', properties: null, frame: true,
  },
  contentPart: {
    namespaceUri: POWERPOINT_2010_NS, nonVisual: 'nvContentPartPr', properties: null, frame: true,
  },
};

function numericId(element: XmlElement): number | null {
  const value = findXmlAttribute(element, { localName: 'id', namespaceUri: null })?.value;
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}

function hostSpid(host: XmlElement, spec: HostSpec): number | null {
  const nonVisual = findXmlChild(host, { localName: spec.nonVisual, namespaceUri: spec.namespaceUri });
  const properties = nonVisual && findXmlChild(nonVisual, {
    localName: 'cNvPr', namespaceUri: spec.namespaceUri,
  });
  return properties ? numericId(properties) : null;
}

function collectHosts(parent: XmlElement, spid: number, output: XmlElement[]): void {
  for (const child of xmlElementChildren(parent)) {
    const spec = HOSTS[child.localName];
    const supported = spec?.namespaceUri === child.namespaceUri ? spec : undefined;
    if (supported && hostSpid(child, supported) === spid) output.push(child);
    collectHosts(child, spid, output);
  }
}

function locateHost(document: XmlDocument, record: ElementRecord): { host: XmlElement; spec: HostSpec } {
  const origin = record.meta.origin;
  if (!origin) throw new Error(`元素 ${record.id} 缺少 OOXML 回写锚点`);
  const matches: XmlElement[] = [];
  collectHosts(document.root, origin.spid, matches);
  if (matches.length !== 1) {
    throw new Error(matches.length
      ? `元素 ${record.id} 的 spid ${origin.spid} 在 ${origin.part} 中存在歧义`
      : `元素 ${record.id} 的 spid ${origin.spid} 在 ${origin.part} 中不存在`);
  }
  return { host: matches[0], spec: HOSTS[matches[0].localName] };
}

function namespacedElement(parent: XmlElement, namespaceUri: string, localName: string): XmlElement {
  const namespaces = elementState(parent).namespaces;
  const bound = [...namespaces].find(([, uri]) => uri === namespaceUri)?.[0];
  if (bound !== undefined) return createXmlElement(bound ? `${bound}:${localName}` : localName);

  const base = namespaceUri === DRAWINGML_NS ? 'a' : namespaceUri === PRESENTATIONML_NS ? 'p' : 'ns';
  let prefix = base;
  let serial = 1;
  while (namespaces.has(prefix)) prefix = `${base}${serial++}`;
  return createXmlElement(`${prefix}:${localName}`, {
    attributes: [[`xmlns:${prefix}`, namespaceUri]],
  });
}

function safeInteger(value: number, scale: number, label: string): string {
  const result = Math.round(value * scale);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} 超出 OOXML 安全整数范围`);
  return String(result);
}

const emu = (value: number, label: string): string => safeInteger(value, 9525, label);
const angle = (value: number, label: string): string => safeInteger(value, 60000, label);

function childOrInsert(parent: XmlElement, localName: string): XmlElement {
  let child = findXmlChild(parent, { localName, namespaceUri: DRAWINGML_NS });
  if (child) return child;
  child = namespacedElement(parent, DRAWINGML_NS, localName);
  insertXmlInOrder(parent, child);
  return child;
}

function materializeTransform(xfrm: XmlElement, record: ElementRecord): void {
  const effective = { ...record.src, ...record.ovr };
  const off = childOrInsert(xfrm, 'off');
  const ext = childOrInsert(xfrm, 'ext');
  setXmlAttribute(off, 'x', emu(effective.x, `${record.id}.x`));
  setXmlAttribute(off, 'y', emu(effective.y, `${record.id}.y`));
  setXmlAttribute(ext, 'cx', emu(effective.w, `${record.id}.w`));
  setXmlAttribute(ext, 'cy', emu(effective.h, `${record.id}.h`));
  if (effective.rot !== 0) setXmlAttribute(xfrm, 'rot', angle(effective.rot, `${record.id}.rot`));
  if (effective.flipH) setXmlAttribute(xfrm, 'flipH', '1');
  if (effective.flipV) setXmlAttribute(xfrm, 'flipV', '1');
}

function transformNode(document: XmlDocument, record: ElementRecord): { xfrm: XmlElement; created: boolean } {
  const { host, spec } = locateHost(document, record);
  const container = spec.properties
    ? findXmlChild(host, { localName: spec.properties, namespaceUri: spec.namespaceUri })
    : host;
  if (!container) throw new Error(`元素 ${record.id} 缺少 ${spec.properties} 容器`);
  const namespaceUri = spec.frame ? host.namespaceUri : DRAWINGML_NS;
  if (!namespaceUri) throw new Error(`元素 ${record.id} 的 xfrm 命名空间无法确定`);
  let xfrm = findXmlChild(container, { localName: 'xfrm', namespaceUri });
  if (xfrm) return { xfrm, created: false };
  xfrm = namespacedElement(container, namespaceUri, 'xfrm');
  insertXmlInOrder(container, xfrm);
  return { xfrm, created: true };
}

export function hasXfrmOverrides(record: ElementRecord): boolean {
  return XFRM_FIELDS.some((field) => own(record.ovr, field));
}

/** 把一个元素的显式覆盖写到自己的宿主变换节点，不读取或改写框架内部内容。 */
export function patchElementXfrm(document: XmlDocument, record: ElementRecord): void {
  if (!hasXfrmOverrides(record)) return;
  if (record.meta.editable === 'none') throw new Error(`元素 ${record.id} 不可写回`);
  if (record.meta.editable === 'frame'
    && XFRM_FIELDS.some((field) => own(record.ovr, field) && !isFrameXfrmField(field))) {
    throw new Error(`框架对象 ${record.id} 只允许写回位置与尺寸`);
  }
  const { xfrm, created } = transformNode(document, record);
  if (created) materializeTransform(xfrm, record);

  const effective = { ...record.src, ...record.ovr };
  const hasOff = own(record.ovr, 'x') || own(record.ovr, 'y');
  const hasExt = own(record.ovr, 'w') || own(record.ovr, 'h');
  if (hasOff) {
    const off = childOrInsert(xfrm, 'off');
    if (own(record.ovr, 'x')) setXmlAttribute(off, 'x', emu(effective.x, `${record.id}.x`));
    if (own(record.ovr, 'y')) setXmlAttribute(off, 'y', emu(effective.y, `${record.id}.y`));
    // 一个缺失的坐标对必须完整物化，否则另一个轴会从继承值坍缩到零。
    if (!findXmlAttribute(off, { localName: 'x', namespaceUri: null })) {
      setXmlAttribute(off, 'x', emu(effective.x, `${record.id}.x`));
    }
    if (!findXmlAttribute(off, { localName: 'y', namespaceUri: null })) {
      setXmlAttribute(off, 'y', emu(effective.y, `${record.id}.y`));
    }
  }
  if (hasExt) {
    const ext = childOrInsert(xfrm, 'ext');
    if (own(record.ovr, 'w')) setXmlAttribute(ext, 'cx', emu(effective.w, `${record.id}.w`));
    if (own(record.ovr, 'h')) setXmlAttribute(ext, 'cy', emu(effective.h, `${record.id}.h`));
    if (!findXmlAttribute(ext, { localName: 'cx', namespaceUri: null })) {
      setXmlAttribute(ext, 'cx', emu(effective.w, `${record.id}.w`));
    }
    if (!findXmlAttribute(ext, { localName: 'cy', namespaceUri: null })) {
      setXmlAttribute(ext, 'cy', emu(effective.h, `${record.id}.h`));
    }
  }
  if (own(record.ovr, 'rot')) setXmlAttribute(xfrm, 'rot', angle(effective.rot, `${record.id}.rot`));
  for (const field of ['flipH', 'flipV'] as const) {
    if (!own(record.ovr, field)) continue;
    if (effective[field]) setXmlAttribute(xfrm, field, '1');
    else removeXmlAttribute(xfrm, field);
  }
}
