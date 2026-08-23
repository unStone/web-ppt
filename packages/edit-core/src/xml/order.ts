import { namespaceUriOnAttach } from './namespace';
import { insertXmlChildUnchecked } from './nodes';
import { DRAWINGML_NS, MARKUP_COMPATIBILITY_NS, PRESENTATIONML_NS } from './qname';
import type { XmlElement, XmlNode } from './types';

type OrderGroups = readonly (readonly string[])[];
interface ChildOrderSchema {
  readonly childNamespaceUri: string;
  readonly groups: OrderGroups;
}
const group = (...names: string[]): readonly string[] => names;
const FILL = group('noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill');
const EFFECT = group('effectLst', 'effectDag');
const expandedName = (namespaceUri: string, localName: string): string => `{${namespaceUri}}${localName}`;
const shapeProperties = [group('xfrm'), group('custGeom', 'prstGeom'), FILL, group('ln'), EFFECT,
  group('scene3d'), group('sp3d'), group('extLst')];
const textBody = [group('bodyPr'), group('lstStyle'), group('p')];

/** ECMA-376 中编辑路径会触及的复杂类型 sequence；展开名允许任意前缀且不会误伤同名 XML。 */
export const OOXML_CHILD_ORDER: Readonly<Record<string, ChildOrderSchema>> = {
  [expandedName(DRAWINGML_NS, 'spPr')]: { childNamespaceUri: DRAWINGML_NS, groups: shapeProperties },
  [expandedName(PRESENTATIONML_NS, 'spPr')]: { childNamespaceUri: DRAWINGML_NS, groups: shapeProperties },
  [expandedName(DRAWINGML_NS, 'ln')]: {
    childNamespaceUri: DRAWINGML_NS,
    groups: [FILL, group('prstDash', 'custDash'), group('round', 'bevel', 'miter'),
      group('headEnd'), group('tailEnd')],
  },
  [expandedName(DRAWINGML_NS, 'rPr')]: {
    childNamespaceUri: DRAWINGML_NS,
    groups: [group('ln'), FILL, EFFECT, group('highlight'), group('uLnTx', 'uLn'),
      group('uFillTx', 'uFill'), group('latin'), group('ea'), group('cs'), group('sym'),
      group('hlinkClick'), group('hlinkMouseOver'), group('rtl'), group('extLst')],
  },
  [expandedName(DRAWINGML_NS, 'pPr')]: {
    childNamespaceUri: DRAWINGML_NS,
    groups: [group('lnSpc'), group('spcBef'), group('spcAft'), group('buClrTx', 'buClr'),
      group('buSzTx', 'buSzPct', 'buSzPts'), group('buFontTx', 'buFont'),
      group('buNone', 'buAutoNum', 'buChar', 'buBlip'), group('tabLst'), group('defRPr'), group('extLst')],
  },
  [expandedName(DRAWINGML_NS, 'txBody')]: { childNamespaceUri: DRAWINGML_NS, groups: textBody },
  [expandedName(PRESENTATIONML_NS, 'txBody')]: { childNamespaceUri: DRAWINGML_NS, groups: textBody },
  [expandedName(PRESENTATIONML_NS, 'sp')]: {
    childNamespaceUri: PRESENTATIONML_NS,
    groups: [group('nvSpPr'), group('spPr'), group('style'), group('txBody')],
  },
  [expandedName(PRESENTATIONML_NS, 'cSld')]: {
    childNamespaceUri: PRESENTATIONML_NS,
    groups: [group('bg'), group('spTree'), group('custDataLst'), group('controls'), group('extLst')],
  },
  [expandedName(PRESENTATIONML_NS, 'sld')]: {
    childNamespaceUri: PRESENTATIONML_NS,
    groups: [group('cSld'), group('clrMapOvr'), group('transition'), group('timing'), group('extLst')],
  },
};

function rank(groups: OrderGroups, localName: string): number {
  return groups.findIndex((names) => names.includes(localName));
}

function schemaFor(parent: XmlElement): ChildOrderSchema | undefined {
  return parent.namespaceUri
    ? OOXML_CHILD_ORDER[expandedName(parent.namespaceUri, parent.localName)]
    : undefined;
}

function alternateContentRelation(
  candidate: XmlElement,
  schema: ChildOrderSchema,
  childRank: number,
): 'before' | 'after' {
  const branches = candidate.children.filter((node): node is XmlElement => node.type === 'element'
    && node.namespaceUri === MARKUP_COMPATIBILITY_NS
    && (node.localName === 'Choice' || node.localName === 'Fallback'));
  if (!branches.length) throw new Error('mc:AlternateContent 没有可判断序位的 Choice/Fallback');
  const ranks: number[] = [];
  for (const branch of branches) {
    const elements = branch.children.filter((node): node is XmlElement => node.type === 'element');
    if (!elements.length) throw new Error(`mc:${branch.localName} 没有可判断序位的元素`);
    for (const element of elements) {
      const elementRank = element.namespaceUri === schema.childNamespaceUri
        ? rank(schema.groups, element.localName)
        : -1;
      if (elementRank < 0) {
        throw new Error(`无法判断 mc:${branch.localName}/${element.name} 的 OOXML 序位`);
      }
      ranks.push(elementRank);
    }
  }
  if (ranks.every((value) => value > childRank)) return 'after';
  if (ranks.every((value) => value <= childRank)) return 'before';
  throw new Error('mc:AlternateContent 各分支横跨插入位置，拒绝猜测');
}

function relationToChild(
  candidate: XmlElement,
  schema: ChildOrderSchema,
  childRank: number,
): 'before' | 'after' | 'ignore' {
  if (candidate.namespaceUri === MARKUP_COMPATIBILITY_NS && candidate.localName === 'AlternateContent') {
    return alternateContentRelation(candidate, schema, childRank);
  }
  if (candidate.namespaceUri !== schema.childNamespaceUri) return 'ignore';
  const candidateRank = rank(schema.groups, candidate.localName);
  if (candidateRank < 0) return 'ignore';
  return candidateRank > childRank ? 'after' : 'before';
}

/**
 * 按 OOXML sequence 插入元素。已知容器遇到未知子元素会拒绝，避免静默生成 PowerPoint 要修复的包。
 * 同一互斥组的替换由调用方先删除旧节点；这里只保证位置，不猜测用户意图。
 */
export function insertXmlInOrder(parent: XmlElement, child: XmlElement): number {
  const schema = schemaFor(parent);
  if (!schema) return insertXmlChildUnchecked(parent, child);
  const childNamespaceUri = namespaceUriOnAttach(parent, child);
  const childRank = childNamespaceUri === schema.childNamespaceUri
    ? rank(schema.groups, child.localName)
    : -1;
  if (childRank < 0) {
    throw new Error(`OOXML 顺序表缺少 ${parent.name}/${child.name}，拒绝无依据追加`);
  }
  let before: XmlElement | null = null;
  for (const candidate of parent.children) {
    if (candidate.type !== 'element') continue;
    if (relationToChild(candidate, schema, childRank) === 'after') {
      before = candidate;
      break;
    }
  }
  return insertXmlChildUnchecked(parent, child, before);
}

/** 通用节点入口；已登记的 OOXML 容器会强制元素走 schema 顺序，不能由调用方绕过。 */
export function insertXmlChild(
  parent: XmlElement,
  child: XmlNode,
  before: XmlNode | null = null,
): number {
  if (child.type !== 'element' || !schemaFor(parent)) {
    return insertXmlChildUnchecked(parent, child, before);
  }
  if (before !== null) throw new Error('已知 OOXML 容器不接受手工 before；请使用 schema 有序插入');
  return insertXmlInOrder(parent, child);
}
