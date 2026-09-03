import type { Fill, MasterTextCategory, SlideMasterTemplate } from '@web-ppt/core';
import type { ElementId } from './identities';
import type { MasterDesignTarget } from './layout-types';
import type { LayoutPropertyState } from './layout-types';
import type {
  ParagraphBullet, ParagraphProperties, ParagraphPropertyInput, ParagraphPropertyOverrides,
  RunProperties, RunPropertyOverrides,
} from './types';

export type MasterRunPropertyOverrides = Omit<RunPropertyOverrides, 'link'>;
export type MasterParagraphPropertyOverrides = Omit<ParagraphPropertyOverrides, 'level'>;
export type MasterParagraphPropertyInput = Omit<ParagraphPropertyInput, 'level'>;

export interface MasterTextLevelOverrides {
  paragraph?: MasterParagraphPropertyOverrides;
  run?: MasterRunPropertyOverrides;
}

export type MasterTextStyleOverrides = Partial<Record<MasterTextCategory,
  Record<number, MasterTextLevelOverrides>>>;

export interface MasterOverrides {
  /** 缺少字段表示来源；显式无背景使用 Fill.none。 */
  background?: Exclude<Fill, { type: 'image' }>;
  /** txStyles 三类九级分别稀疏覆盖；字段粒度是协同合并边界。 */
  textStyles?: MasterTextStyleOverrides;
}

/** src 字段继承自解析目录；编辑状态只进入 children / ovr。 */
export interface MasterRecord extends SlideMasterTemplate {
  children: ElementId[];
  ovr: MasterOverrides;
}

export interface MasterCatalogItem {
  readonly id: string;
  readonly name: string;
  readonly themeId?: string;
  readonly layoutIds: readonly string[];
  readonly target: MasterDesignTarget;
}

export interface MasterDesignState extends MasterCatalogItem {
  readonly background: LayoutPropertyState<Fill | null>;
  readonly textStyles: Readonly<Record<MasterTextCategory, readonly MasterTextLevelState[]>>;
}

export interface MasterParagraphStyle extends ParagraphProperties {
  readonly bullet: ParagraphBullet;
}

export interface MasterTextLevelState {
  readonly level: number;
  readonly value: { readonly paragraph: MasterParagraphStyle; readonly run: RunProperties };
  readonly source: { readonly paragraph: MasterParagraphStyle; readonly run: RunProperties };
  readonly direct: {
    readonly paragraph: readonly (keyof MasterParagraphPropertyOverrides)[];
    readonly run: readonly (keyof MasterRunPropertyOverrides)[];
  };
}
