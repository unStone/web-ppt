import { assertDataObject, assertTextRange, own } from '../data-validation';
import { slideOfElement } from '../projection';
import { findText } from '../text-search';
import type {
  FindTextRequest, ReplaceTextCommand, TextSearchMatch, TextSearchTarget,
} from '../text-search-types';
import { assertTableCellAddress } from '../table-cell';
import { TEXT_ATOM } from '../text-position';
import type { EditDoc, TableCellAddress } from '../types';
import { editTextPatches } from './edit-text';
import { assertElementUnlocked } from './element-interaction';
import type { CommandPatches, EditTextCommand, TextRange } from './types';

function sameCell(left: TableCellAddress | undefined, right: TableCellAddress | undefined): boolean {
  return left === undefined ? right === undefined
    : right !== undefined && left.r === right.r && left.c === right.c;
}

function sameRange(left: TextRange, right: TextRange): boolean {
  return left.from.p === right.from.p && left.from.r === right.from.r && left.from.off === right.from.off
    && left.to.p === right.to.p && left.to.r === right.to.r && left.to.off === right.to.off;
}

function assertTarget(doc: EditDoc, value: unknown): asserts value is TextSearchTarget {
  assertDataObject(value, ['slideId', 'id', 'cell', 'range'], 'ReplaceText.scope.match');
  const target = value as TextSearchTarget;
  if (typeof target.slideId !== 'string' || !doc.slides[target.slideId]) {
    throw new Error(`ReplaceText 命中页面不存在：${String(target.slideId)}`);
  }
  if (typeof target.id !== 'string' || !doc.elements[target.id]) {
    throw new Error(`ReplaceText 命中元素不存在：${String(target.id)}`);
  }
  if (slideOfElement(doc, target.id) !== target.slideId) throw new Error('ReplaceText 命中页与元素身份不一致');
  if (own(target, 'cell')) assertTableCellAddress(target.cell, 'ReplaceText.scope.match.cell');
  assertTextRange(target.range, 'ReplaceText.scope.match.range');
}

function requestOf(command: ReplaceTextCommand, scope: FindTextRequest['scope']): FindTextRequest {
  return {
    query: command.from, scope,
    ...(own(command, 'matchCase') ? { matchCase: command.matchCase } : {}),
    ...(own(command, 'wholeWord') ? { wholeWord: command.wholeWord } : {}),
  };
}

function assertReplacement(command: ReplaceTextCommand): void {
  if (typeof command.to !== 'string' || command.to.includes('\r') || command.to.includes('\n')
    || command.to.includes(TEXT_ATOM)) {
    throw new Error('ReplaceText.to 必须是不含换行与公式占位符的字符串');
  }
}

function resolveMatches(doc: EditDoc, command: ReplaceTextCommand): readonly TextSearchMatch[] {
  assertReplacement(command);
  const scope = command.scope as ReplaceTextCommand['scope'] | undefined;
  if (scope?.kind !== 'match') {
    return findText(doc, requestOf(command, scope as FindTextRequest['scope']));
  }
  assertDataObject(scope, ['kind', 'match'], 'ReplaceText.scope');
  assertTarget(doc, scope.match);
  const request = requestOf(command, { kind: 'slide', slideId: scope.match.slideId });
  const match = findText(doc, request).find((candidate) => candidate.id === scope.match.id
    && sameCell(candidate.cell, scope.match.cell) && sameRange(candidate.range, scope.match.range));
  if (!match) throw new Error('ReplaceText 精确命中已经失效');
  return [match];
}

interface TargetMatches {
  readonly id: string;
  readonly cell?: TableCellAddress;
  readonly matches: TextSearchMatch[];
}

function groupedMatches(matches: readonly TextSearchMatch[]): TargetMatches[] {
  const groups: TargetMatches[] = [];
  for (const match of matches) {
    let group = groups.find((candidate) => candidate.id === match.id
      && sameCell(candidate.cell, match.cell));
    if (!group) {
      group = { id: match.id, ...(match.cell ? { cell: { ...match.cell } } : {}), matches: [] };
      groups.push(group);
    }
    group.matches.push(match);
  }
  return groups;
}

export function replaceTextTargetIds(doc: EditDoc, command: ReplaceTextCommand): readonly string[] {
  return [...new Set(resolveMatches(doc, command).map((match) => match.id))];
}

export function replaceTextPatches(
  doc: EditDoc,
  command: ReplaceTextCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能替换文字');
  const groups = groupedMatches(resolveMatches(doc, command));
  for (const group of groups) assertElementUnlocked(doc, group.id);
  const forward: CommandPatches['forward'] = [];
  const inverse: CommandPatches['inverse'] = [];
  for (const group of groups) {
    const edit: EditTextCommand = {
      type: 'EditText', id: group.id,
      ...(group.cell ? { cell: { ...group.cell } } : {}),
      ops: [...group.matches].reverse().map((match) => ({
        type: 'replace' as const,
        from: { ...match.range.from }, to: { ...match.range.to }, text: command.to,
      })),
    };
    const patches = editTextPatches(doc, edit, origin);
    forward.push(...patches.forward);
    inverse.unshift(...patches.inverse);
  }
  return { forward, inverse };
}
