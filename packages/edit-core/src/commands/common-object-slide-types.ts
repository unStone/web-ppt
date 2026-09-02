import type { ElementId, SectionId, SectionState, SlideId } from '../types';

export interface SetAltTextCommand {
  readonly type: 'SetAltText';
  readonly id: ElementId;
  /** null 单独恢复该字段的来源属性。 */
  readonly title: string | null;
  readonly descr: string | null;
}

export interface DistributeElementsCommand {
  readonly type: 'DistributeElements';
  readonly ids: readonly ElementId[];
  readonly axis: 'horizontal' | 'vertical';
}

export interface AddSectionCommand {
  readonly type: 'AddSection';
  readonly name: string;
  readonly slideIds: readonly SlideId[];
  readonly at: { readonly after: SectionId | null };
}

export interface RenameSectionCommand {
  readonly type: 'RenameSection';
  readonly id: SectionId;
  readonly name: string;
}

export interface MoveSectionCommand {
  readonly type: 'MoveSection';
  readonly id: SectionId;
  readonly at: { readonly after: SectionId | null };
}

export interface RemoveSectionCommand {
  readonly type: 'RemoveSection';
  readonly id: SectionId;
}

export interface SetSlideSizeCommand {
  readonly type: 'SetSlideSize';
  /** null 恢复对应来源尺寸；数值只改变画布，不重排元素。 */
  readonly w: number | null;
  readonly h: number | null;
}

export type ElementAltTextPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'altText', 'title' | 'descr'];
  readonly value: string;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'altText', 'title' | 'descr'];
  readonly origin: string;
};

export type SectionStatePatch = {
  readonly op: 'set';
  /** 完整快照保证本地撤销精确；末两段让协同按节、按意图独立仲裁。 */
  readonly path: readonly ['document', 'sections', SectionId, 'state' | 'name' | 'order'];
  readonly value: SectionState;
  readonly origin: string;
};

export type DocumentSizePatch = {
  readonly op: 'set';
  readonly path: readonly ['document', 'size', 'w' | 'h'];
  readonly value: number;
  readonly origin: string;
};
