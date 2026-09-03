import type { MasterTextCategory } from '@web-ppt/core';
import type {
  MasterDesignTarget, MasterParagraphPropertyInput, MasterRunPropertyOverrides,
  MasterParagraphPropertyOverrides,
} from '../types';

export interface SetMasterTextStyleCommand {
  readonly type: 'SetMasterTextStyle';
  readonly target: MasterDesignTarget;
  readonly category: MasterTextCategory;
  readonly level: number;
  /** null 字段恢复母版来源；level 由命令路径决定，不能在段落值里重复声明。 */
  readonly paragraph?: MasterParagraphPropertyInput;
  /** 母版默认字符样式不承载超链接。 */
  readonly run?: MasterRunPropertyOverrides;
}

type SetPatch<S extends 'paragraph' | 'run', F extends string, V> = {
  readonly op: 'set';
  readonly path: readonly ['masters', string, 'ovr', 'textStyles', MasterTextCategory, number, S, F];
  readonly value: V;
  readonly origin: string;
};

type DeletePatch<S extends 'paragraph' | 'run', F extends string> = {
  readonly op: 'del';
  readonly path: readonly ['masters', string, 'ovr', 'textStyles', MasterTextCategory, number, S, F];
  readonly origin: string;
};

export type MasterParagraphTextStylePatch = SetPatch<
  'paragraph', keyof MasterParagraphPropertyOverrides & string,
  NonNullable<MasterParagraphPropertyOverrides[keyof MasterParagraphPropertyOverrides]>
> | DeletePatch<'paragraph', keyof MasterParagraphPropertyOverrides & string>;

export type MasterRunTextStylePatch = SetPatch<
  'run', keyof MasterRunPropertyOverrides & string,
  NonNullable<MasterRunPropertyOverrides[keyof MasterRunPropertyOverrides]>
> | DeletePatch<'run', keyof MasterRunPropertyOverrides & string>;

export type MasterTextStylePatch = MasterParagraphTextStylePatch | MasterRunTextStylePatch;
