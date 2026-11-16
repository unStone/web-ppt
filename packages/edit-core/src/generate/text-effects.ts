import type { TextGradientFill, TextRun } from '@web-ppt/core';
import { appendVectorFill, removeDrawingFillChildren } from '../save/shape-format';
import { appendDrawingColor } from '../save/drawing-color';
import { appendShadow } from '../save/effects';
import { namespacedElement } from '../save/xml-element';
import { DRAWINGML_NS } from '../xml/qname';
import { insertXmlInOrder } from '../xml/order';
import { findXmlChild } from '../xml/query';
import { setXmlAttribute } from '../xml/mutate';
import type { XmlElement } from '../xml/types';

export const hasNativeText = (run: TextRun): boolean =>
  !!(
    run.field
    || run.math?.length
    || run.outline
    || run.gradient
    || run.gradientFill
    || run.shadow
    || run.shadowEffect
    || run.underlineColor
  );

const validGradient = (gradient: TextGradientFill): boolean =>
  Number.isFinite(gradient.angle)
  && gradient.angle >= 0
  && gradient.angle < 360
  && gradient.stops.length >= 2
  && gradient.stops.every((s) => Number.isFinite(s.pos) && s.pos >= 0 && s.pos <= 1);

function appendTextGradient(parent: XmlElement, gradient: TextGradientFill): void {
  appendVectorFill(parent, { type: 'gradient', ...gradient });
  const fill = findXmlChild(parent, { localName: 'gradFill' })!;
  setXmlAttribute(findXmlChild(fill, { localName: 'lin' })!, 'scaled', gradient.scaled ? '1' : '0');
}

export function validateNativeText(run: TextRun): void {
  if (run.generationIssues?.length) throw new Error(`文字来源语义无法重建：${run.generationIssues.join('、')}`);
  if (run.gradient && !run.gradientFill) throw new Error('文字渐变缺少 gradientFill 结构值');
  if (run.shadow && !run.shadowEffect) throw new Error('文字阴影缺少 shadowEffect 结构值');
  const gradient = run.gradientFill;
  if (gradient && !validGradient(gradient)) throw new Error('文字渐变角度或色标无效');
  const outlineGradient = run.outline?.gradientFill;
  if (outlineGradient && !validGradient(outlineGradient)) throw new Error('文字描边渐变角度或色标无效');
  if (outlineGradient && run.outline!.color !== outlineGradient.stops[0].color) throw new Error('文字描边代表色与渐变首个色标不一致');
  if (gradient && run.gradient) {
    const css = `linear-gradient(${Math.round(gradient.angle + 90)}deg,${gradient.stops.map((s) => `${s.color} ${Math.round(s.pos * 100)}%`).join(',')})`;
    if (run.gradient !== css) throw new Error('文字渐变 CSS 与结构值不一致');
  }
  if (run.outline && (!Number.isFinite(run.outline.width) || run.outline.width < 0)) throw new Error('文字描边宽度无效');
  const shadow = run.shadowEffect;
  if (shadow && (shadow.inner || ![shadow.dx, shadow.dy, shadow.blur].every(Number.isFinite) || shadow.blur < 0)) {
    throw new Error('文字仅支持有效的外阴影');
  }
  if (shadow && run.shadow && run.shadow !== `${shadow.dx}px ${shadow.dy}px ${shadow.blur}px ${shadow.color}`) {
    throw new Error('文字阴影 CSS 与结构值不一致');
  }
}

export function materializeNativeText(properties: XmlElement, run: TextRun): void {
  validateNativeText(run);
  const add = (parent: XmlElement, name: string): XmlElement => {
    const node = namespacedElement(parent, DRAWINGML_NS, name);
    insertXmlInOrder(parent, node);
    return node;
  };
  if (run.outline) {
    const line = add(properties, 'ln');
    setXmlAttribute(line, 'w', String(Math.round(run.outline.width * 9525)));
    if (run.outline.gradientFill) appendTextGradient(line, run.outline.gradientFill);
    else appendDrawingColor(add(line, 'solidFill'), run.outline.color);
  }
  if (run.gradientFill) {
    removeDrawingFillChildren(properties);
    appendTextGradient(properties, run.gradientFill);
  }
  if (run.shadowEffect) appendShadow(add(properties, 'effectLst'), run.shadowEffect);
  if (run.underlineColor) appendDrawingColor(add(add(properties, 'uFill'), 'solidFill'), run.underlineColor);
}
