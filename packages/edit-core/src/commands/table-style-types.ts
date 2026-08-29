import type { TableStyleSettings } from '@web-ppt/core';
import type { ElementId } from '../types';

type TableStyleSwitches = Omit<TableStyleSettings, 'styleId'>;

export type SetTableStyleCommand = {
  readonly type: 'SetTableStyle';
  readonly id: ElementId;
} & ({
  readonly styleId: null;
  readonly firstRow?: never;
  readonly lastRow?: never;
  readonly bandRow?: never;
  readonly firstCol?: never;
  readonly lastCol?: never;
  readonly bandCol?: never;
} | ({ readonly styleId: string } & TableStyleSwitches));

export type ElementTableStylePatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'tableStyle'];
  readonly value: TableStyleSettings;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'tableStyle'];
  readonly origin: string;
};
