import type { Fill, ImageTilePlacement } from '@web-ppt/core';
import type { ImageCrop, SlideId, SlideImageBackground } from '../types';

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

export type SlidePropertyPatch = SlideBackgroundPatch | SlideBackgroundImagePatch | SlideHiddenPatch;
