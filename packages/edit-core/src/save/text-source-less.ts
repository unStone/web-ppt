import type { FlatTextParagraph, TextMark } from '../types';
import { insertXmlChildUnchecked } from '../xml/nodes';
import { insertXmlInOrder } from '../xml/order';
import { DRAWINGML_NS } from '../xml/qname';
import { setXmlAttribute } from '../xml/mutate';
import type { XmlElement } from '../xml/types';
import { appendDrawingColor } from './drawing-color';
import { namespacedElement } from './xml-element';

/** 无来源段落没有可克隆的 pPr；生成/插入路径必须把有效列表语义固定下来。 */
export function materializeParagraphLayout(
  properties: XmlElement,
  paragraph: FlatTextParagraph,
): void {
  const props = paragraph.props;
  if (props.lvl) setXmlAttribute(properties, 'lvl', String(props.lvl));
  if (props.rtl) setXmlAttribute(properties, 'rtl', '1');
  const bullet = namespacedElement(properties, DRAWINGML_NS,
    props.bullet === null ? 'buNone' : 'buChar');
  if (props.bullet !== null) setXmlAttribute(bullet, 'char', props.bullet);
  insertXmlInOrder(properties, bullet);
  if (props.bulletColor) {
    const color = namespacedElement(properties, DRAWINGML_NS, 'buClr');
    appendDrawingColor(color, props.bulletColor);
    insertXmlInOrder(properties, color);
  }
  if (props.bulletFont) {
    const font = namespacedElement(properties, DRAWINGML_NS, 'buFont');
    setXmlAttribute(font, 'typeface', props.bulletFont);
    insertXmlInOrder(properties, font);
  }
  if (props.bulletSize !== null && props.bulletSize !== undefined) {
    const size = namespacedElement(properties, DRAWINGML_NS, 'buSzPct');
    setXmlAttribute(size, 'val', String(Math.round(props.bulletSize * 100000)));
    insertXmlInOrder(properties, size);
  }
}

/** 生成式文字没有来源 rPr；只在这一条边界把有效字符外观摊平。 */
export function materializeRunProperties(properties: XmlElement, mark: TextMark): void {
  setXmlAttribute(properties, 'sz', String(Math.round(mark.props.size * 75)));
  if (mark.props.b) setXmlAttribute(properties, 'b', '1');
  if (mark.props.i) setXmlAttribute(properties, 'i', '1');
  if (mark.props.u) setXmlAttribute(properties, 'u', 'sng');
  if (mark.props.strike) setXmlAttribute(properties, 'strike', 'sngStrike');
  if (mark.props.baseline) {
    setXmlAttribute(properties, 'baseline', String(Math.round(mark.props.baseline * 1000)));
  }
  if (mark.props.spacing) {
    setXmlAttribute(properties, 'spc', String(Math.round(mark.props.spacing * 75)));
  }
  if (mark.props.color) {
    const fill = namespacedElement(properties, DRAWINGML_NS, 'solidFill');
    appendDrawingColor(fill, mark.props.color);
    insertXmlChildUnchecked(properties, fill);
  }
  if (!mark.props.fonts[0]) return;
  const slots = [
    ['latin', mark.props.fonts[0]],
    ['ea', mark.props.fonts[1] ?? mark.props.fonts[0]],
    ['cs', mark.props.fonts[2] ?? mark.props.fonts[1] ?? mark.props.fonts[0]],
  ] as const;
  for (const [name, typeface] of slots) {
    const font = namespacedElement(properties, DRAWINGML_NS, name);
    setXmlAttribute(font, 'typeface', typeface);
    insertXmlChildUnchecked(properties, font);
  }
}
