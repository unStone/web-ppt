import {
  queryBodyProps,
  queryElementCrop,
  queryElementEffects,
  queryElementFill,
  queryElementLink,
  queryElementStroke,
  queryParaProps,
  queryRunProps,
} from '@web-ppt/edit-core';
import type { EditDoc } from '@web-ppt/edit-core';
import { describePresentation } from '../describe/index';
import { AgentToolError } from './errors';
import type { AgentElementInput, AgentElementResult } from './types';

export function queryElement(doc: EditDoc, input: AgentElementInput): AgentElementResult {
  if (!doc.elements[input.id]) {
    throw new AgentToolError('target-not-found', `找不到元素：${input.id}`, null, input.id);
  }
  if ((input.query === 'run' || input.query === 'paragraph') && !input.range) {
    throw new AgentToolError('invalid-input', `${input.query} 查询必须提供 range`);
  }
  let value: unknown;
  switch (input.query) {
    case 'describe': {
      value =
        describePresentation(doc)
          .slides.flatMap((slide) => slide.elements)
          .find((element) => element.id === input.id) ?? null;
      if (!value) throw new AgentToolError('target-not-found', `元素不在普通页面投影中：${input.id}`, null, input.id);
      break;
    }
    case 'fill':
      value = queryElementFill(doc, [input.id]);
      break;
    case 'stroke':
      value = queryElementStroke(doc, [input.id]);
      break;
    case 'effects':
      value = queryElementEffects(doc, [input.id]);
      break;
    case 'crop':
      value = queryElementCrop(doc, [input.id]);
      break;
    case 'link':
      value = queryElementLink(doc, [input.id]);
      break;
    case 'run':
      value = queryRunProps(doc, input.id, input.range!, input.cell);
      break;
    case 'paragraph':
      value = queryParaProps(doc, input.id, input.range!, input.cell);
      break;
    case 'body':
      value = queryBodyProps(doc, input.id, input.cell);
      break;
  }
  return { id: input.id, query: input.query, value };
}
