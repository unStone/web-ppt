import type { Fill, SlideLayoutTemplate, Transition } from '@web-ppt/core';
import type { ElementId } from './identities';

/** 设计来源必须带领域种类，调用方不能把 OPC part 冒充普通 SlideId。 */
export type LayoutDesignTarget = { readonly kind: 'layout'; readonly id: string };
export type MasterDesignTarget = { readonly kind: 'master'; readonly id: string };
export type DesignTarget = LayoutDesignTarget | MasterDesignTarget;

export interface LayoutOverrides {
  /** 缺少字段表示来源；显式无背景使用 Fill.none。 */
  background?: Exclude<Fill, { type: 'image' }>;
  /** 缺少字段表示来源；Transition.none 表示明确关闭。 */
  transition?: Transition;
}

/** 保留原目录字段以兼容新增页调用方；编辑状态只进入 children / ovr。 */
export interface LayoutRecord extends SlideLayoutTemplate {
  children: ElementId[];
  ovr: LayoutOverrides;
}

export interface LayoutCatalogItem {
  readonly id: string;
  readonly name: string;
  readonly masterId: string;
  readonly themeId?: string;
  readonly target: LayoutDesignTarget;
}

export interface LayoutPropertyState<T> {
  readonly value: T;
  readonly source: T;
  readonly direct: boolean;
}

/** 面板只读取求值结果与稀疏覆盖状态，不暴露可变的 LayoutRecord。 */
export interface LayoutDesignState extends LayoutCatalogItem {
  readonly background: LayoutPropertyState<Fill | null>;
  readonly transition: LayoutPropertyState<Transition | null>;
}
