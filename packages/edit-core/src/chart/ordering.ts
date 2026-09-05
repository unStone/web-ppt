import { compareFractionalIndex } from '@web-ppt/edit-core';
import type { FractionalIndex } from '../types';

interface OrderedChartRecord {
  readonly id: string;
  readonly order: FractionalIndex;
}

/** 并发插入可能得到相同分数序；稳定身份是跨副本必须共享的最终裁决。 */
export function compareChartOrder(left: OrderedChartRecord, right: OrderedChartRecord): number {
  const order = compareFractionalIndex(left.order, right.order);
  if (order) return order;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function orderedChartRecords<T extends OrderedChartRecord>(values: Iterable<T>): T[] {
  return [...values].sort(compareChartOrder);
}
