import type {
  ElementId, ElementRecord, RemovedElementRecord, SlideId,
} from '../types';

export interface GroupCommand {
  readonly type: 'Group';
  readonly ids: readonly ElementId[];
}

export interface UngroupCommand {
  readonly type: 'Ungroup';
  readonly id: ElementId;
}

export interface ElementHierarchyState {
  /** 结构变化发生前后都存在的外部父级，用于精确失效所属页或祖先。 */
  readonly parent: SlideId | ElementId;
  readonly affected: readonly ElementId[];
  readonly records: Readonly<Record<ElementId, ElementRecord | null>>;
  readonly children: Readonly<Record<SlideId | ElementId, readonly ElementId[]>>;
  readonly removed: Readonly<Record<ElementId, RemovedElementRecord | null>>;
}

/** 组合/解组同时改变多个父链，必须作为一个不可见中间态的结构原子落模。 */
export type ElementHierarchyPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'hierarchy'];
  readonly value: ElementHierarchyState;
  readonly origin: string;
};
