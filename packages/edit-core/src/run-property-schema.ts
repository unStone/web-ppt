import { assertDataObject, own } from './data-validation';
import {
  TEXT_CAPS_STYLES, TEXT_STRIKE_STYLES, TEXT_UNDERLINE_STYLES,
} from '@web-ppt/core';
import type { RunPropertyOverrides } from './types';
import { assertLinkOverride } from './hyperlink';
import { assertDrawingColor } from './shape-fill';
import { RUN_PROPERTY_FIELDS } from './run-property-fields';

export { RUN_PROPERTY_FIELDS } from './run-property-fields';

export { TEXT_CAPS_STYLES, TEXT_STRIKE_STYLES, TEXT_UNDERLINE_STYLES };

export function assertRunPropertyOverrides(
  value: unknown,
  label: string,
  allowEmpty = false,
): asserts value is RunPropertyOverrides {
  assertDataObject(value, RUN_PROPERTY_FIELDS, label);
  if (!allowEmpty && !RUN_PROPERTY_FIELDS.some((field) => own(value, field))) {
    throw new Error(`${label} 不能为空`);
  }
  const props = value as RunPropertyOverrides;
  if (own(props, 'font') && props.font !== null
    && (typeof props.font !== 'string' || !props.font.trim() || props.font !== props.font.trim()
      || /[\u0000-\u001f]/.test(props.font))) {
    throw new Error(`${label}.font 必须是非空字体名或 null`);
  }
  if (own(props, 'size') && props.size !== null
    && (typeof props.size !== 'number' || !Number.isFinite(props.size) || props.size <= 0)) {
    throw new Error(`${label}.size 必须是有限正数或 null`);
  }
  if (own(props, 'color') && props.color !== null) {
    assertDrawingColor(props.color, `${label}.color`);
  }
  for (const field of ['b', 'i', 'u', 'strike'] as const) {
    if (own(props, field) && props[field] !== null && typeof props[field] !== 'boolean') {
      throw new Error(`${label}.${field} 必须是布尔值或 null`);
    }
  }
  if (own(props, 'underline') && props.underline !== null
    && !(TEXT_UNDERLINE_STYLES as readonly unknown[]).includes(props.underline)) {
    throw new Error(`${label}.underline 必须是 DrawingML 下划线类型或 null`);
  }
  if (own(props, 'strikeType') && props.strikeType !== null
    && !(TEXT_STRIKE_STYLES as readonly unknown[]).includes(props.strikeType)) {
    throw new Error(`${label}.strikeType 必须是 DrawingML 删除线类型或 null`);
  }
  if (own(props, 'caps') && props.caps !== null
    && !(TEXT_CAPS_STYLES as readonly unknown[]).includes(props.caps)) {
    throw new Error(`${label}.caps 必须是 none、all、small 或 null`);
  }
  if (own(props, 'spacing') && props.spacing !== null
    && (typeof props.spacing !== 'number' || !Number.isFinite(props.spacing)
      || Math.abs(props.spacing * 75) > 400000)) {
    throw new Error(`${label}.spacing 必须是可写入 DrawingML 的有限 CSS px 或 null`);
  }
  if (own(props, 'baseline') && props.baseline !== null
    && (typeof props.baseline !== 'number' || !Number.isFinite(props.baseline)
      || props.baseline * 1000 < -2147483648 || props.baseline * 1000 > 2147483647)) {
    throw new Error(`${label}.baseline 必须是可写入 DrawingML 的有限百分比或 null`);
  }
  if (own(props, 'highlight') && props.highlight !== null) {
    assertDrawingColor(props.highlight, `${label}.highlight`);
  }
  if (own(props, 'u') && own(props, 'underline')) {
    throw new Error(`${label}.u 与 underline 不能同时设置`);
  }
  if (own(props, 'strike') && own(props, 'strikeType')) {
    throw new Error(`${label}.strike 与 strikeType 不能同时设置`);
  }
  if (own(props, 'link') && props.link !== null) {
    assertLinkOverride(props.link, `${label}.link`);
  }
}
