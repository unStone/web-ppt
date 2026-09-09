import type { EditDoc } from './types';
import type { DocumentExtensionPatch, Patch } from './commands/types';
import { assertPatchCount } from './commands/patch-count';
import { assertExtensionLeaf } from './extension-runtime';
import { canonicalExtensionPatch, EXTENSION_ADDRESSES, readExtensionAddress } from './extension-addresses';

export const EXTENSION_MIGRATIONS = 'edit-migrations';
export interface ExtensionMigrationInput {
  readonly path: readonly string[];
  readonly op: 'set' | 'del';
  readonly value?: string | number | boolean | null;
  readonly stamp?: { readonly clock: number; readonly replicaId: string };
}
export interface ExtensionMigrationReceipt {
  readonly version: 1;
  readonly routes: readonly { readonly source: readonly [string, string]; readonly address: string }[];
  readonly inputs: readonly ExtensionMigrationInput[];
  readonly winners: readonly number[];
}
type ApplyField = (doc: EditDoc, patch: DocumentExtensionPatch) => void;
type ValidateField = (doc: EditDoc, patch: DocumentExtensionPatch, index: number) => void;
const key = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 1024
  && !['__proto__', 'prototype', 'constructor'].includes(value);
const object = (value: unknown, keys: readonly string[]): boolean => !!value && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).every(name => keys.includes(name));
const fail = (): never => { throw new Error('扩展迁移凭据无效'); };

export const isExtensionMigrationPatch = (patch: { path: readonly unknown[] }): patch is DocumentExtensionPatch =>
  patch.path[0] === 'document' && patch.path[1] === 'extensions' && patch.path[2] === EXTENSION_MIGRATIONS;

/** stamp 只是一次裁决的原始证据；编辑核心不据此创建或推进协同寄存器。 */
export function readExtensionMigration(value: unknown): ExtensionMigrationReceipt {
  if (typeof value !== 'string' || value.length > 1_000_000) fail();
  const receipt = JSON.parse(value as string) as ExtensionMigrationReceipt;
  if (!object(receipt, ['version', 'routes', 'inputs', 'winners']) || receipt.version !== 1
    || !Array.isArray(receipt.routes) || !receipt.routes.length || !Array.isArray(receipt.inputs)
    || !Array.isArray(receipt.winners)) fail();
  assertPatchCount(receipt.routes.length + receipt.inputs.length + 1);
  const sources = new Set<string>(), fields = new Set<string>();
  let target: string | undefined;
  for (const route of receipt.routes) {
    if (!object(route, ['source', 'address']) || !Array.isArray(route.source) || route.source.length !== 2
      || !route.source.every(key) || !/^[a-z][a-z0-9-]{0,63}$/.test(route.source[1])) fail();
    const encoded = JSON.stringify(route.source);
    if (sources.has(encoded)) fail();
    sources.add(encoded);
    const address = readExtensionAddress(route.address), next = JSON.stringify(address.target);
    if (address.target[2] === EXTENSION_MIGRATIONS || target !== undefined && target !== next) fail();
    target = next;
  }
  for (const input of receipt.inputs) {
    if (!object(input, ['path', 'op', 'value', 'stamp']) || !Array.isArray(input.path)
      || input.path.length > 21 || !input.path.every(key)
      || !(input.path[0] === 'elements' && input.path[2] === 'ovr' && input.path[3] === 'extensions'
        && input.path.length >= 6 && sources.has(JSON.stringify([input.path[1], input.path[4]]))
        || input.path[0] === 'document' && input.path[1] === 'extensions' && input.path.length >= 4)) fail();
    const encoded = JSON.stringify(input.path);
    if (fields.has(encoded)) fail();
    fields.add(encoded);
    if (input.op === 'set') assertExtensionLeaf(input.value);
    else if (input.op !== 'del' || Object.prototype.hasOwnProperty.call(input, 'value')) fail();
    if (input.stamp !== undefined && (!object(input.stamp, ['clock', 'replicaId'])
      || !Number.isSafeInteger(input.stamp.clock) || input.stamp.clock <= 0
      || typeof input.stamp.replicaId !== 'string' || !input.stamp.replicaId || input.stamp.replicaId.length > 128
      || /[\0-\x1f\x7f]/.test(input.stamp.replicaId))) fail();
  }
  if (receipt.winners.some(index => !Number.isSafeInteger(index) || index < 0 || index >= receipt.inputs.length)
    || new Set(receipt.winners).size !== receipt.winners.length) fail();
  return receipt;
}

export function canonicalExtensionMigrationInputs(doc: EditDoc,
  receipt: Pick<ExtensionMigrationReceipt, 'routes' | 'inputs'>): ExtensionMigrationInput[] {
  // 每个元素输入都已被限定在本凭据的来源内，无需逐凭据复制文稿的完整地址表。
  const addresses: Record<string, Record<string, string>> = Object.create(null);
  for (const route of receipt.routes) {
    const namespaces = addresses[route.source[0]] ??= Object.create(null) as Record<string, string>;
    namespaces[route.source[1]] = route.address;
  }
  const view = { ...doc, extensions: { ...doc.extensions, [EXTENSION_ADDRESSES]: addresses } };
  return receipt.inputs.map(input => {
    const mapped = canonicalExtensionPatch(view, { ...input, origin: 'migration' } as Patch);
    return { path: mapped.path as readonly string[], ...(mapped.op === 'set'
      ? { op: 'set', value: mapped.value as ExtensionMigrationInput['value'] } : { op: 'del' }),
    ...(input.stamp ? { stamp: input.stamp } : {}) };
  });
}

function compile(doc: EditDoc, patch: DocumentExtensionPatch, receipt: ExtensionMigrationReceipt) {
  const routes: DocumentExtensionPatch[] = receipt.routes.map(route => ({ op: 'set', origin: patch.origin,
    path: ['document', 'extensions', EXTENSION_ADDRESSES, ...route.source], value: route.address }));
  const target = readExtensionAddress(receipt.routes[0].address).target;
  if (patch.op !== 'set' || patch.path.length !== 4 || patch.path[3] !== JSON.stringify(target)) fail();
  const inputs = canonicalExtensionMigrationInputs(doc, receipt).map(({ stamp, ...input }) =>
    ({ ...input, origin: patch.origin }) as DocumentExtensionPatch);
  if (inputs.some(input => input.path.length <= target.length
    || target.some((part, index) => input.path[index] !== part))) fail();
  const fields = receipt.winners.map(index => inputs[index]);
  const targets = new Set(inputs.map(input => JSON.stringify(input.path)));
  if (fields.length !== targets.size || new Set(fields.map(field => JSON.stringify(field.path))).size !== targets.size) fail();
  for (const field of fields) {
    for (let length = target.length + 1; length < field.path.length; length++) {
      if (targets.has(JSON.stringify(field.path.slice(0, length)))) throw new Error('扩展迁移赢家路径冲突');
    }
  }
  const originalPaths = new Set(receipt.inputs.map(input => JSON.stringify(input.path))), seen = new Set<object>();
  const covered = (value: unknown, path: string[]): void => {
    if (value && typeof value === 'object') {
      if (Array.isArray(value) || seen.has(value) || path.length > 21) fail();
      seen.add(value);
      for (const [name, child] of Object.entries(value)) {
        if (!key(name)) fail();
        covered(child, [...path, name]);
      }
    } else if (!originalPaths.has(JSON.stringify(path))) throw new Error('扩展迁移凭据缺少参与来源字段');
  };
  for (const { source: [id, namespace] } of receipt.routes) {
    const value = doc.elements[id]?.ovr.extensions?.[namespace];
    if (value !== undefined) covered(value, ['elements', id, 'ovr', 'extensions', namespace]);
  }
  return { routes, fields };
}

function materialize(doc: EditDoc, receipt: ExtensionMigrationReceipt,
  compiled: ReturnType<typeof compile>, apply: ApplyField, validate?: ValidateField): void {
  for (const field of compiled.fields) {
    let current: unknown = doc.extensions;
    for (const name of field.path.slice(2)) {
      if (current === undefined) break;
      if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('扩展迁移字段父路径不是容器');
      current = (current as Record<string, unknown>)[name];
    }
    if (current && typeof current === 'object') throw new Error('扩展迁移字段不能覆盖已有容器');
  }
  // 先清空所有参与来源，再安装不可变路由；不能让逐个等值合并覆盖已裁决的跨来源冲突。
  for (const { source: [id, namespace] } of receipt.routes) {
    const record = doc.elements[id];
    if (!record?.ovr.extensions) continue;
    delete record.ovr.extensions[namespace];
    if (!Object.keys(record.ovr.extensions).length) delete record.ovr.extensions;
  }
  for (const [index, field] of [...compiled.routes, ...compiled.fields].entries()) {
    validate?.(doc, field, index); apply(doc, field);
  }
}

function unchanged(doc: EditDoc, patch: DocumentExtensionPatch): boolean {
  return patch.op === 'set' && patch.path.length === 4
    && (doc.extensions?.[EXTENSION_MIGRATIONS] as Record<string, unknown> | undefined)?.[patch.path[3]] === patch.value;
}

export function validateExtensionMigration(doc: EditDoc, patch: DocumentExtensionPatch,
  validate: ValidateField, apply: ApplyField): void {
  const receipt = readExtensionMigration(patch.op === 'set' ? patch.value : undefined);
  const compiled = compile(doc, patch, receipt);
  if (unchanged(doc, patch)) return;
  const preview = { ...doc, extensions: structuredClone(doc.extensions), elements: { ...doc.elements } };
  for (const { source: [id] } of receipt.routes) {
    if (preview.elements[id]) preview.elements[id] = structuredClone(preview.elements[id]);
  }
  materialize(preview, receipt, compiled, apply, validate);
}

export function applyExtensionMigration(doc: EditDoc, patch: DocumentExtensionPatch, apply: ApplyField): void {
  if (unchanged(doc, patch)) return;
  const receipt = readExtensionMigration(patch.op === 'set' ? patch.value : undefined);
  const compiled = compile(doc, patch, receipt);
  materialize(doc, receipt, compiled, apply);
}

export function extensionMigrationReceipts(doc: EditDoc, origin: string): DocumentExtensionPatch[] {
  return Object.entries(doc.extensions?.[EXTENSION_MIGRATIONS] ?? {}).map(([key, value]) => ({
    op: 'set', path: ['document', 'extensions', EXTENSION_MIGRATIONS, key], origin, value,
  }));
}

export function validateExtensionMigrationReceipts(doc: EditDoc): void {
  for (const patch of extensionMigrationReceipts(doc, 'validate')) {
    const receipt = readExtensionMigration(patch.op === 'set' ? patch.value : undefined);
    compile(doc, patch, receipt);
    const addresses = doc.extensions?.[EXTENSION_ADDRESSES] as Record<string, Record<string, string>> | undefined;
    for (const route of receipt.routes) {
      if (addresses?.[route.source[0]]?.[route.source[1]] !== route.address) fail();
    }
  }
}
