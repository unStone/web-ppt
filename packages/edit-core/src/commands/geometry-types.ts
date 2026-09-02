import type { CustomGeometry, GeomSpec } from '@web-ppt/core';
import type { ElementId } from '../types';

export interface SetGeometryCommand {
  readonly type: 'SetGeometry';
  readonly id: ElementId;
  /** null 恢复来源几何；预设形状必须先走显式自由形状转换命令。 */
  readonly geometry: CustomGeometry | null;
}

export interface ConvertToCustomGeometryCommand {
  readonly type: 'ConvertToCustomGeometry';
  readonly id: ElementId;
}

export interface SetPresetCommand {
  readonly type: 'SetPreset';
  readonly id: ElementId;
  /** 切换预设会按规范清空旧 avLst；其它形状属性不进入该命令。 */
  readonly preset: string;
}

export interface SetAdjCommand {
  readonly type: 'SetAdj';
  readonly id: ElementId;
  readonly name: string;
  readonly value: number;
}

export type ElementGeometryPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'geometry'];
  readonly value: CustomGeometry;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'geometry'];
  readonly origin: string;
};

export type ElementPresetGeometryPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'presetGeometry'];
  readonly value: GeomSpec;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'presetGeometry'];
  readonly origin: string;
};
