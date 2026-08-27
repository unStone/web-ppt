import type { Fill, ImageTilePlacement, Transition } from '@web-ppt/core';
import type { SlideTransitionInput } from '../slide-transition';
import type { ImageCrop, SlideId, SlideImageBackground, SlideNotesBinding } from '../types';

export interface SetBackgroundCommand {
  readonly type: 'SetBackground';
  readonly id: SlideId;
  /** null 恢复来源；显式无背景使用 { type: 'none' }。 */
  readonly fill: Exclude<Fill, { type: 'image' }> | null;
}

export interface SetBackgroundImageCommand {
  readonly type: 'SetBackgroundImage';
  readonly id: SlideId;
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly crop?: ImageCrop;
  readonly alpha?: number;
  /** 缺少 tile 表示拉伸铺满页面。 */
  readonly tile?: ImageTilePlacement;
}

export interface SetBackgroundCropCommand {
  readonly type: 'SetBackgroundCrop';
  readonly id: SlideId;
  /** null 只清除裁剪，仍保留当前图片背景。 */
  readonly crop: ImageCrop | null;
}

export interface SetHiddenCommand {
  readonly type: 'SetHidden';
  readonly id: SlideId;
  /** null 恢复来源；false 可覆盖来源隐藏页。 */
  readonly v: boolean | null;
}

export interface SetTransitionCommand {
  readonly type: 'SetTransition';
  readonly id: SlideId;
  /** null 恢复来源；type=none 明确关闭切换。 */
  readonly t: SlideTransitionInput | null;
}

export interface SetLayoutCommand {
  readonly type: 'SetLayout';
  readonly id: SlideId;
  readonly layoutId: string;
}

export interface SetNotesCommand {
  readonly type: 'SetNotes';
  readonly id: SlideId;
  readonly text: string;
}

export type SlideNotesPatch = {
  readonly op: 'set';
  readonly path: readonly ['slides', SlideId, 'ovr', 'notes'];
  readonly value: string;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['slides', SlideId, 'ovr', 'notes'];
  readonly origin: string;
} | {
  readonly op: 'set';
  readonly path: readonly ['slides', SlideId, 'notes'];
  readonly value: SlideNotesBinding;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['slides', SlideId, 'notes'];
  readonly origin: string;
};

export type SlideLayoutPatch = {
  readonly op: 'set';
  readonly path: readonly ['slides', SlideId, 'layoutId'];
  readonly value: string;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['slides', SlideId, 'layoutId'];
  readonly origin: string;
};

export type SlideBackgroundPatch = {
  readonly op: 'set';
  readonly path: readonly ['slides', SlideId, 'ovr', 'background'];
  readonly value: Fill;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['slides', SlideId, 'ovr', 'background'];
  readonly origin: string;
};

export type SlideBackgroundImagePatch = {
  readonly op: 'set';
  readonly path: readonly ['slides', SlideId, 'backgroundImage'];
  readonly value: SlideImageBackground;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['slides', SlideId, 'backgroundImage'];
  readonly origin: string;
};

export type SlideHiddenPatch = {
  readonly op: 'set';
  readonly path: readonly ['slides', SlideId, 'ovr', 'hidden'];
  readonly value: boolean;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['slides', SlideId, 'ovr', 'hidden'];
  readonly origin: string;
};

export type SlideTransitionPatch = {
  readonly op: 'set';
  readonly path: readonly ['slides', SlideId, 'ovr', 'transition'];
  readonly value: Transition;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['slides', SlideId, 'ovr', 'transition'];
  readonly origin: string;
};

export type SlidePropertyPatch = SlideBackgroundPatch | SlideBackgroundImagePatch | SlideHiddenPatch
  | SlideTransitionPatch;
