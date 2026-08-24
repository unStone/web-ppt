import { namespaceUriOnAttach } from './namespace';
import { insertXmlChildUnchecked } from './nodes';
import {
  DRAWINGML_NS, MARKUP_COMPATIBILITY_NS, OFFICE_MATH_NS, POWERPOINT_2010_NS, PRESENTATIONML_NS,
} from './qname';
import type { XmlElement, XmlNode } from './types';

type OrderGroups = readonly (readonly string[])[];
interface ChildOrderSchema {
  readonly groups: OrderGroups;
}
const expandedName = (namespaceUri: string, localName: string): string => `{${namespaceUri}}${localName}`;
const group = (namespaceUri: string, ...names: string[]): readonly string[] =>
  names.map((name) => expandedName(namespaceUri, name));
const a = (...names: string[]): readonly string[] => group(DRAWINGML_NS, ...names);
const p = (...names: string[]): readonly string[] => group(PRESENTATIONML_NS, ...names);
const p14 = (...names: string[]): readonly string[] => group(POWERPOINT_2010_NS, ...names);
const m = (...names: string[]): readonly string[] => group(OFFICE_MATH_NS, ...names);
const FILL = a('noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill');
const EFFECT = a('effectLst', 'effectDag');
const shapeProperties = [a('xfrm'), a('custGeom', 'prstGeom'), FILL, a('ln'), EFFECT,
  a('scene3d'), a('sp3d'), a('extLst')];
const textBody = [a('bodyPr'), a('lstStyle'), a('p')];
const textBodyProperties = [
  a('prstTxWarp'), a('noAutofit', 'normAutofit', 'spAutoFit'),
  a('scene3d'), a('sp3d'), a('flatTx'), a('extLst'),
];

/** ECMA-376 中编辑路径会触及的复杂类型 sequence；展开名允许任意前缀且不会误伤同名 XML。 */
export const OOXML_CHILD_ORDER: Readonly<Record<string, ChildOrderSchema>> = {
  [expandedName(DRAWINGML_NS, 'spPr')]: { groups: shapeProperties },
  [expandedName(PRESENTATIONML_NS, 'spPr')]: { groups: shapeProperties },
  [expandedName(PRESENTATIONML_NS, 'grpSpPr')]: { groups: shapeProperties },
  [expandedName(DRAWINGML_NS, 'xfrm')]: { groups: [a('off'), a('ext'), a('chOff'), a('chExt')] },
  [expandedName(PRESENTATIONML_NS, 'xfrm')]: { groups: [a('off'), a('ext')] },
  [expandedName(POWERPOINT_2010_NS, 'xfrm')]: { groups: [a('off'), a('ext')] },
  [expandedName(DRAWINGML_NS, 'ln')]: {
    groups: [FILL, a('prstDash', 'custDash'), a('round', 'bevel', 'miter'),
      a('headEnd'), a('tailEnd')],
  },
  [expandedName(DRAWINGML_NS, 'rPr')]: {
    groups: [a('ln'), FILL, EFFECT, a('highlight'), a('uLnTx', 'uLn'),
      a('uFillTx', 'uFill'), a('latin'), a('ea'), a('cs'), a('sym'),
      a('hlinkClick'), a('hlinkMouseOver'), a('rtl'), a('extLst')],
  },
  [expandedName(DRAWINGML_NS, 'pPr')]: {
    groups: [a('lnSpc'), a('spcBef'), a('spcAft'), a('buClrTx', 'buClr'),
      a('buSzTx', 'buSzPct', 'buSzPts'), a('buFontTx', 'buFont'),
      a('buNone', 'buAutoNum', 'buChar', 'buBlip'), a('tabLst'), a('defRPr'), a('extLst')],
  },
  [expandedName(DRAWINGML_NS, 'p')]: {
    groups: [a('pPr'), [...a('r', 'br', 'fld'), ...m('oMath', 'oMathPara')], a('endParaRPr')],
  },
  [expandedName(DRAWINGML_NS, 'bodyPr')]: { groups: textBodyProperties },
  [expandedName(DRAWINGML_NS, 'txBody')]: { groups: textBody },
  [expandedName(PRESENTATIONML_NS, 'txBody')]: { groups: textBody },
  [expandedName(PRESENTATIONML_NS, 'sp')]: {
    groups: [p('nvSpPr'), p('spPr'), p('style'), p('txBody')],
  },
  [expandedName(PRESENTATIONML_NS, 'spTree')]: {
    groups: [p('nvGrpSpPr'), p('grpSpPr'),
      [...p('sp', 'grpSp', 'graphicFrame', 'cxnSp', 'pic'), ...p14('contentPart')], p('extLst')],
  },
  [expandedName(PRESENTATIONML_NS, 'graphicFrame')]: {
    groups: [p('nvGraphicFramePr'), p('xfrm'), a('graphic'), p('extLst')],
  },
  [expandedName(POWERPOINT_2010_NS, 'contentPart')]: {
    groups: [p14('nvContentPartPr'), p14('xfrm'), p14('extLst')],
  },
  [expandedName(PRESENTATIONML_NS, 'cSld')]: {
    groups: [p('bg'), p('spTree'), p('custDataLst'), p('controls'), p('extLst')],
  },
  [expandedName(PRESENTATIONML_NS, 'sld')]: {
    groups: [p('cSld'), p('clrMapOvr'), p('transition'), p('timing'), p('extLst')],
  },
};

function rank(groups: OrderGroups, namespaceUri: string | null, localName: string): number {
  return namespaceUri === null ? -1
    : groups.findIndex((names) => names.includes(expandedName(namespaceUri, localName)));
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
      const elementRank = rank(schema.groups, element.namespaceUri, element.localName);
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
  const candidateRank = rank(schema.groups, candidate.namespaceUri, candidate.localName);
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
  const childRank = rank(schema.groups, childNamespaceUri, child.localName);
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
