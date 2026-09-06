import type { Shape3D } from '@web-ppt/core';
import type { ElementId } from '../types';

export interface PictureFx {
  /** 不透明度，0–1；省略为 1。 */
  readonly alpha?: number;
  readonly grayscale?: boolean;
  /** 暗部、亮部颜色；使用不透明的 #RRGGBB 或 rgb()。 */
  readonly duotone?: readonly [string, string];
}

export interface SetPictureFxCommand {
  readonly type: 'SetPictureFx';
  readonly id: ElementId;
  /** null 恢复来源，{} 显式清除这三种效果。 */
  readonly effects: PictureFx | null;
}

export interface SetScene3DCommand {
  readonly type: 'SetScene3D';
  readonly id: ElementId;
  /** 挤出与斜角单位为 px，旋转为度；null 恢复来源，{} 清除立体效果。 */
  readonly scene: Shape3D | null;
}

export type AppearanceCommand = SetPictureFxCommand | SetScene3DCommand;
export interface AppearanceState { picture?: string; scene?: string }
