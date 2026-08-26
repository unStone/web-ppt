import { TEXT_BODY_PROPERTY_BITS } from '@web-ppt/core';
import type { TextBodyEditInfo, TextBodyLayoutProperties } from '@web-ppt/core';
import { textTargetContext } from './commands/text-target';
import type {
  EditDoc, TableCellAddress, TextBodyOverride, TextBodyProperties, TextBodyPropertyOverrides, TextOverride,
} from './types';

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

function properties(body: TextBodyLayoutProperties): TextBodyProperties {
  return {
    anchor: body.anchor,
    insets: [...body.insets],
    wrap: body.wrap,
    vert: body.vert ?? 'horz',
    anchorCtr: body.anchorCtr ?? false,
    columns: body.columns ?? 1,
    columnGap: body.columnGap ?? 0,
    autoFit: body.autoFitShape ? 'shape'
      : body.autoFitNormal || body.autoFitCompute ? 'normal' : 'none',
  };
}

export function queryBodyProps(
  doc: EditDoc,
  id: string,
  cell?: TableCellAddress,
): TextBodyProperties {
  const { body: source, before } = textTargetContext(
    doc, { id, ...(cell !== undefined ? { cell } : {}) },
  );
  return properties(before?.body ?? source);
}

export function applyBodyProps(
  initial: Extract<TextOverride, { kind: 'flat' }>,
  props: TextBodyPropertyOverrides,
  sourceEditInfo?: TextBodyEditInfo,
): Extract<TextOverride, { kind: 'flat' }> {
  const body: TextBodyOverride = {
    ...initial.body,
    insets: [...initial.body.insets] as [number, number, number, number],
  };
  const overrides: Record<string, unknown> = { ...initial.bodyOverrides };
  const current = properties(body);
  const inherited = properties(sourceEditInfo?.inherited ?? {
    anchor: 'top', insets: [4.8, 9.6, 4.8, 9.6], wrap: true, fontScale: 1,
  });
  const direct = sourceEditInfo?.direct ?? 0;
  const assign = <F extends keyof TextBodyPropertyOverrides>(
    field: F,
    apply: (value: NonNullable<TextBodyProperties[F]>) => void,
  ): void => {
    const requested = props[field];
    if (requested === undefined) return;
    const value = (requested === null ? inherited[field] : requested) as NonNullable<TextBodyProperties[F]>;
    if (requested === null) {
      if (!(direct & TEXT_BODY_PROPERTY_BITS[field])) delete overrides[field];
      else overrides[field] = null;
    } else overrides[field] = value;
    if (!same(current[field], value)) apply(value);
  };
  assign('anchor', (value) => { body.anchor = value; });
  assign('insets', (value) => { body.insets = [...value]; });
  assign('wrap', (value) => { body.wrap = value; });
  assign('vert', (value) => {
    if (value === 'horz') delete body.vert;
    else body.vert = value;
  });
  assign('anchorCtr', (value) => {
    if (value) body.anchorCtr = true;
    else delete body.anchorCtr;
  });
  assign('columns', (value) => {
    if (value > 1) body.columns = value;
    else delete body.columns;
  });
  assign('columnGap', (value) => {
    if (value) body.columnGap = value;
    else delete body.columnGap;
  });
  assign('autoFit', (value) => {
    delete body.autoFitShape;
    delete body.autoFitNormal;
    delete body.autoFitCompute;
    delete body.lnSpcReduction;
    body.fontScale = 1;
    if (value === 'shape') body.autoFitShape = true;
    else if (value === 'normal') {
      body.autoFitNormal = true;
      body.autoFitCompute = true;
    }
    if (props.autoFit === null && sourceEditInfo?.inherited) {
      const source = sourceEditInfo.inherited;
      body.fontScale = source.fontScale;
      if (source.autoFitShape) body.autoFitShape = true;
      if (source.autoFitNormal) body.autoFitNormal = true;
      if (source.autoFitCompute) body.autoFitCompute = true;
      if (source.lnSpcReduction) body.lnSpcReduction = source.lnSpcReduction;
    }
  });
  const { bodyOverrides: _previous, ...base } = initial;
  return {
    ...base,
    body,
    ...(Reflect.ownKeys(overrides).length ? { bodyOverrides: overrides as TextBodyPropertyOverrides } : {}),
  };
}
