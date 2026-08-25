import type { Fill } from '@web-ppt/core';
import type { SlideId } from '../types';

export interface SetBackgroundCommand {
  readonly type: 'SetBackground';
  readonly id: SlideId;
  /** null 恢复来源；显式无背景使用 { type: 'none' }。 */
  readonly fill: Exclude<Fill, { type: 'image' }> | null;
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
  readonly value: Exclude<Fill, { type: 'image' }>;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['slides', SlideId, 'ovr', 'background'];
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

export type SlidePropertyPatch = SlideBackgroundPatch | SlideHiddenPatch;
