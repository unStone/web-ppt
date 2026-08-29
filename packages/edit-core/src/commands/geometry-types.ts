import type { CustomGeometry } from '@web-ppt/core';
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
