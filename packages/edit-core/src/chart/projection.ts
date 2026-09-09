import type { SlideElement } from '@web-ppt/core';
import { renderChartXml } from '@web-ppt/core/chart-edit';
import type { EditDoc, ElementId } from '../types';
import { currentChartDatasetState } from './source';
import { chartRenderContext, chartSourceBytes } from './context';
import { chartFrameKey } from './locator';
import { materializeChartProjectionXml } from './materialize';

export function chartProjection(doc: EditDoc, id: ElementId) {
  const state = currentChartDatasetState(doc, id);
  if (state.binding.unresolved) throw new Error(state.binding.reason);
  // 数据读取已经验证来源；同步投影期间没有异步换包，不必再读取一次绑定。
  const part = state.binding.chartPart, source = chartSourceBytes(doc, part)!;
  return { xml: materializeChartProjectionXml(source, id, state, chartFrameKey(doc, id)),
    context: chartRenderContext(doc, id, part), part };
}

export function projectChartElement(doc: EditDoc, id: ElementId, element: SlideElement): SlideElement {
  if (element.kind !== 'group') return element;
  const projected = chartProjection(doc, id);
  return { ...element, children: renderChartXml(projected.xml, element.w, element.h, projected.context) };
}
