import { canonicalExtensionMigrationInputs, canonicalExtensionPatch, EXTENSION_MIGRATIONS, readExtensionAddress } from '@web-ppt/edit-core';
import type { EditDoc, DocumentExtensionPatch, ExtensionMigrationInput, ExtensionMigrationReceipt, Patch } from '@web-ppt/edit-core';
import { compareStamp } from '../message';
import type { Register } from '../state';
import { evidence } from './evidence';

const sameOperation = (left: ExtensionMigrationInput, right: ExtensionMigrationInput): boolean =>
  left.op === right.op && (left.op === 'del' || left.value === right.value);
const prefix = (path: readonly unknown[], root: readonly string[]): boolean =>
  path.length > root.length && root.every((part, index) => path[index] === part);

/** 只有实际原操作可以裁决矛盾值；模型值和复制消息时钟都不能补造缺失的字段证据。 */
export function resolveMigration(doc: EditDoc, declarations: readonly DocumentExtensionPatch[],
  registers: ReadonlyMap<string, Register>, arriving: readonly ExtensionMigrationInput[] = [],
  force = false): DocumentExtensionPatch[] | undefined {
  if (!declarations.length) return;
  const routes = declarations.map(patch => ({ source: [patch.path[3], patch.path[4]] as const,
    address: patch.op === 'set' && typeof patch.value === 'string' ? patch.value : '' }));
  const target = readExtensionAddress(routes[0].address).target;
  const sources = new Set(routes.map(route => JSON.stringify(route.source)));
  const relevant = (path: readonly string[]): boolean => prefix(path, target) || path[0] === 'elements'
    && path[2] === 'ovr' && path[3] === 'extensions' && sources.has(JSON.stringify([path[1], path[4]]));
  const arrivals = new Map<string, ExtensionMigrationInput>();
  for (const input of arriving.filter(input => relevant(input.path))) {
    const key = JSON.stringify(input.path), previous = arrivals.get(key);
    if (previous && compareStamp(input.stamp!, previous.stamp!) === 0 && !sameOperation(input, previous)) return [];
    if (!previous || compareStamp(input.stamp!, previous.stamp!) > 0) arrivals.set(key, input);
  }
  const original = new Map<string, ExtensionMigrationInput>();
  const canonical = new Map<string, ExtensionMigrationInput>();
  const unknown: ExtensionMigrationInput[] = [];
  for (const [key, register] of registers) {
    const operation = evidence.get(register);
    if (register.kind !== 'field') continue;
    let path: string[];
    try { path = JSON.parse(key); } catch { continue; }
    if (!Array.isArray(path) || !relevant(path)) continue;
    if (!operation) {
      // 这里只借 del 的无值结构批量寻址，不把未知操作写入凭据或寄存器。
      unknown.push({ path, op: 'del', stamp: register.stamp });
      continue;
    }
    const input: ExtensionMigrationInput = { path, ...operation, stamp: register.stamp };
    original.set(key, input);
    const mapped = canonicalExtensionPatch(doc, { ...input, origin: 'migration' } as Patch);
    const mappedInput = { path: mapped.path as readonly string[], ...operation,
      ...(mapped.op === 'set' ? { value: mapped.value as ExtensionMigrationInput['value'] } : {}), stamp: register.stamp };
    const canonicalKey = JSON.stringify(mapped.path), current = canonical.get(canonicalKey);
    if (!current || compareStamp(register.stamp, current.stamp!) > 0) canonical.set(canonicalKey, mappedInput);
  }
  if (unknown.length) {
    const known = new Map<string, ExtensionMigrationInput>();
    for (const input of canonicalExtensionMigrationInputs(doc, { routes, inputs: [...arrivals.values()] })) {
      const key = JSON.stringify(input.path), previous = known.get(key);
      if (!previous || compareStamp(input.stamp!, previous.stamp!) > 0) known.set(key, input);
    }
    for (const input of canonicalExtensionMigrationInputs(doc, { routes, inputs: unknown })) {
      const replacement = known.get(JSON.stringify(input.path));
      if (!replacement || compareStamp(replacement.stamp!, input.stamp!) <= 0) return [];
    }
  }
  let complete = true;
  const covered = (value: unknown, path: string[], entries: ReadonlyMap<string, ExtensionMigrationInput>): void => {
    if (value === undefined) return;
    if (value && typeof value === 'object') {
      for (const [name, child] of Object.entries(value)) covered(child, [...path, name], entries);
    } else {
      const input = entries.get(JSON.stringify(path));
      if (!input || input.op !== 'set' || input.value !== value) {
        const key = JSON.stringify(path), replacement = arrivals.get(key), current = registers.get(key);
        if (!replacement || current && compareStamp(replacement.stamp!, current.stamp) <= 0) complete = false;
      }
    }
  };
  for (const route of routes) covered(doc.elements[route.source[0]]?.ovr.extensions?.[route.source[1]],
    ['elements', route.source[0], 'ovr', 'extensions', route.source[1]], original);
  let destination: unknown = doc.extensions;
  for (const part of target.slice(2)) destination = (destination as Record<string, unknown> | undefined)?.[part];
  covered(destination, [...target], canonical);
  if (!complete) return [];
  for (const [key, input] of arrivals) {
    const previous = original.get(key);
    if (previous && compareStamp(input.stamp!, previous.stamp!) === 0 && !sameOperation(input, previous)) return [];
    if (!previous || compareStamp(input.stamp!, previous.stamp!) > 0) original.set(key, input);
  }
  if (!original.size) return;
  const inputs = [...original.values()].sort((left, right) => JSON.stringify(left.path) < JSON.stringify(right.path) ? -1 : 1);
  const mapped = canonicalExtensionMigrationInputs(doc, { routes, inputs }), winners = new Map<string, number>();
  let conflicting = false;
  for (const [index, input] of mapped.entries()) {
    const key = JSON.stringify(input.path), previous = winners.get(key);
    if (previous === undefined) { winners.set(key, index); continue; }
    const comparison = compareStamp(input.stamp!, mapped[previous].stamp!);
    if (!sameOperation(input, mapped[previous])) {
      if (!comparison) return [];
      conflicting = true;
    }
    if (comparison > 0) winners.set(key, index);
  }
  if (!conflicting && !force && !arrivals.size) return;
  const receipt: ExtensionMigrationReceipt = { version: 1, routes, inputs, winners: [...winners.values()] };
  return [{ op: 'set', origin: 'chart-shared',
    path: ['document', 'extensions', EXTENSION_MIGRATIONS, JSON.stringify(target)], value: JSON.stringify(receipt) }];
}
