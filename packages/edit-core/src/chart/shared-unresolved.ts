import type { SlideElement } from '@web-ppt/core';
import type { EditDoc, ElementId } from '../types';
import { chartPartForElement } from './locator';
import { sharedCacheSource, sharedCacheOverrides } from './shared-cache';
import { sharedChartTopology } from './shared-topology';

export function projectUnresolvedChart(doc: EditDoc, id: ElementId, element: SlideElement): SlideElement {
  if (element.kind !== 'group') return element;
  const part = chartPartForElement(doc, id);
  if (!part || (doc.extensions?.['chart-shared'] as Record<string, unknown> | undefined)?.[part] === undefined
    && !(sharedChartTopology(doc).frames.get(part) ?? [])
      .some(frame => doc.elements[frame].ovr.extensions?.['chart-data'] !== undefined)) return element;
  const source = sharedCacheSource(doc, part);
  if (!source) return element;
  try { sharedCacheOverrides(doc, source); return element; }
  catch { /* 与数据查询使用同一验证入口，失败只能投影占位。 */ }
  // 占位仅存在于投影中，原来的图表、旧编辑和恢复证据继续保留在模型里。
  const { children: _children, ...frame } = element;
  return { ...frame, kind: 'unsupported', label: '图表编辑未恢复' };
}
