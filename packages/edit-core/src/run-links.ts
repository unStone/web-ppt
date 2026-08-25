import { own } from './data-validation';
import {
  linkValueFollowable, sourceLinkReadonly, sourceLinkValue,
} from './hyperlink';
import { textMarksInRange, textBodyFromOverride } from './text-model';
import { textTargetContext } from './commands/text-target';
import type { TextRange } from './commands/types';
import type {
  EditDoc, LinkSourceValue, RunLinkState, TableCellAddress, TextMark,
} from './types';

function markSourceValue(doc: EditDoc, mark: TextMark): LinkSourceValue | null {
  return mark.sourceLinkReadonly ? { kind: 'unsupported' } : sourceLinkValue(doc, mark.props.link);
}

function effectiveValue(doc: EditDoc, mark: TextMark): LinkSourceValue | null {
  const source = markSourceValue(doc, mark);
  if (!own(mark.runOverrides ?? {}, 'link') || mark.runOverrides?.link === null) return source;
  const override = mark.runOverrides!.link!;
  return override.kind === 'none' ? null : structuredClone(override);
}

export function queryRunLink(
  doc: EditDoc,
  id: string,
  range: TextRange,
  cell?: TableCellAddress,
): RunLinkState {
  const { body: source, before: override } = textTargetContext(
    doc, { id, ...(cell !== undefined ? { cell } : {}) },
  );
  const body = override?.kind === 'flat' ? textBodyFromOverride(override, source) : source;
  const marks = textMarksInRange(body, range, override?.kind === 'flat' ? override : undefined);
  const values = marks.map((mark) => effectiveValue(doc, mark));
  const sources = marks.map((mark) => markSourceValue(doc, mark));
  const signature = JSON.stringify(values[0]);
  const sourceSignature = JSON.stringify(sources[0]);
  const mixed = values.some((value) => JSON.stringify(value) !== signature);
  return {
    value: structuredClone(values[0] ?? null),
    source: structuredClone(sources[0] ?? null),
    mixed,
    sourceMixed: sources.some((value) => JSON.stringify(value) !== sourceSignature),
    direct: marks.some((mark) => own(mark.runOverrides ?? {}, 'link')),
    sourceReadonly: sources.some(sourceLinkReadonly),
    followable: !mixed && linkValueFollowable(doc, values[0] ?? null),
  };
}
