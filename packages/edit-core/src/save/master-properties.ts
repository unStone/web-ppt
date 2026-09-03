import { own } from '../data-validation';
import type { FlatTextParagraph, MasterRecord, TextMark } from '../types';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { findXmlChild, xmlElementChildren } from '../xml/query';
import type { XmlDocument, XmlElement } from '../xml/types';
import { removeXmlChild } from '../xml/nodes';
import { appendVectorFill, removeDrawingFillChildren } from './shape-format';
import { namespacedElement } from './xml-element';
import { applyParagraphOverrides } from './paragraph-overrides';
import { applyRunOverrides } from './run-overrides';
import { assertVectorFill } from '../shape-fill';

const STYLE_NAMES = {
  title: 'titleStyle', body: 'bodyStyle', other: 'otherStyle',
} as const;

export function hasMasterPropertyOverrides(record: MasterRecord): boolean {
  return own(record.ovr, 'background') || !!record.ovr.textStyles;
}

function patchBackground(document: XmlDocument, record: MasterRecord): void {
  if (!own(record.ovr, 'background')) return;
  const fill = record.ovr.background!;
  assertVectorFill(fill, `母版 ${record.id} 的背景覆盖`);
  const common = findXmlChild(document.root, {
    localName: 'cSld', namespaceUri: PRESENTATIONML_NS,
  });
  if (!common) throw new Error(`母版 ${record.id} 缺少 p:cSld`);
  let background = findXmlChild(common, { localName: 'bg', namespaceUri: PRESENTATIONML_NS });
  if (!background) {
    background = namespacedElement(common, PRESENTATIONML_NS, 'bg');
    insertXmlInOrder(common, background);
  }
  for (const child of [...xmlElementChildren(background)]) {
    if (child.namespaceUri === PRESENTATIONML_NS && child.localName === 'bgRef') {
      removeXmlChild(background, child);
    }
  }
  let properties = findXmlChild(background, { localName: 'bgPr', namespaceUri: PRESENTATIONML_NS });
  if (!properties) {
    properties = namespacedElement(background, PRESENTATIONML_NS, 'bgPr');
    insertXmlInOrder(background, properties);
  }
  removeDrawingFillChildren(properties);
  appendVectorFill(properties, fill);
}

function child(parent: XmlElement, namespaceUri: string, localName: string): XmlElement {
  let value = findXmlChild(parent, { localName, namespaceUri });
  if (!value) {
    value = namespacedElement(parent, namespaceUri, localName);
    insertXmlInOrder(parent, value);
  }
  return value;
}

function patchTextStyles(document: XmlDocument, record: MasterRecord): void {
  const overrides = record.ovr.textStyles;
  if (!overrides) return;
  const styles = child(document.root, PRESENTATIONML_NS, 'txStyles');
  for (const [category, levels] of Object.entries(overrides)) {
    const style = child(styles, PRESENTATIONML_NS, STYLE_NAMES[category as keyof typeof STYLE_NAMES]);
    for (const [levelText, level] of Object.entries(levels)) {
      const properties = child(style, DRAWINGML_NS, `lvl${Number(levelText) + 1}pPr`);
      if (level.paragraph) {
        applyParagraphOverrides(properties, {
          paragraphOverrides: level.paragraph,
        } as unknown as FlatTextParagraph, 0);
      }
      if (level.run) {
        const run = child(properties, DRAWINGML_NS, 'defRPr');
        applyRunOverrides(run, { runOverrides: level.run } as unknown as TextMark);
      }
    }
  }
}

/** 只触碰 cSld/bg 与 txStyles；hf、clrMap、extLst 以及未知扩展原位保留。 */
export function patchMasterProperties(document: XmlDocument, record: MasterRecord): void {
  patchBackground(document, record);
  patchTextStyles(document, record);
}
