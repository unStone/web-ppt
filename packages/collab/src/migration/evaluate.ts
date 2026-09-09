import { canonicalExtensionMigrationInputs, canonicalExtensionPatch, extensionMigrationPatches, isExtensionAddressPatch,
  isExtensionMigrationPatch, readExtensionAddress, readExtensionMigration, stageExternalPatches } from '@web-ppt/edit-core';
import type { DocumentExtensionPatch, EditDoc, ExtensionMigrationInput, Patch, SlideTreeSnapshot } from '@web-ppt/edit-core';
import { evaluateRemoteMessage } from '../evaluate';
import type { EvaluatedMessage, PatchAvailability } from '../evaluate';
import type { CollaborationSession } from '../state';
import type { CollabMessage } from '../types';
import { resolveMigration } from './resolve';
import { recordReceiptWinners } from './receipt-registers';
import { canonicalRegisters } from '../extension-addresses';
import { compareStamp } from '../message';
import { copiedInputs, rebaseCopiedPatches } from './copies';
import { recordPatches, slideLifecycle } from '../state';
import { desiredSlideOrder, materializeSlideOrder } from '../slide-order';

const metadata = (patch: Patch): boolean => isExtensionAddressPatch(patch) || isExtensionMigrationPatch(patch);
const extension = (patch: Patch): boolean => !metadata(patch) && (patch.path[0] === 'document' && patch.path[1] === 'extensions'
  || patch.path[0] === 'elements' && patch.path[2] === 'ovr' && patch.path[3] === 'extensions');
interface MigrationGroup {
  routes: DocumentExtensionPatch[];
  paths: Map<string, unknown>;
  inputs: ExtensionMigrationInput[];
  remote: boolean;
}

/** 只在实际消费时裁决；延迟消息不能复用首次接收时已经过期的模型或寄存器。 */
export function evaluateMigrationMessage(doc: EditDoc, session: CollaborationSession, raw: CollabMessage,
  seed?: PatchAvailability): EvaluatedMessage {
  if (copiedInputs(raw.patches).some(input => input.stamp.clock > raw.stamp.clock)) {
    throw new Error('扩展复制的原操作超过运输因果水位');
  }
  raw = { ...raw, patches: rebaseCopiedPatches(doc, raw.patches, session.registers) };
  const incoming = raw.patches.filter(isExtensionMigrationPatch);
  const groups = new Map<string, MigrationGroup>();
  const groupFor = (routes: readonly DocumentExtensionPatch[], remote = false) => {
    const first = routes[0], target = readExtensionAddress(first.op === 'set' ? first.value : undefined).target;
    const key = JSON.stringify(target), group: MigrationGroup = groups.get(key) ?? { routes: [], paths: new Map(), inputs: [], remote };
    for (const route of routes) {
      const path = JSON.stringify(route.path), previous = group.paths.get(path);
      if (route.op !== 'set' || previous !== undefined && previous !== route.value) throw new Error('迁移凭据地址冲突');
      if (previous === undefined) { group.routes.push(route); group.paths.set(path, route.value); }
    }
    group.remote ||= remote; groups.set(key, group); return group;
  };
  let ordinary = false;
  for (const patch of raw.patches) {
    if (!metadata(patch)) ordinary = true;
    else if (ordinary) throw new Error('协同迁移声明必须先于字段和结构补丁');
  }
  for (const patch of incoming) {
    try {
      const receipt = readExtensionMigration(patch.op === 'set' ? patch.value : undefined);
      const target = readExtensionAddress(receipt.routes[0].address).target;
      if (patch.path.length !== 4 || patch.path[3] !== JSON.stringify(target)
        || receipt.inputs.some(input => !input.stamp || input.stamp.clock > raw.stamp.clock)) throw new Error('缺少原版本');
      const mapped = canonicalExtensionMigrationInputs(doc, receipt);
      if (mapped.some(input => input.path.length <= target.length || target.some((part, index) => input.path[index] !== part))) {
        throw new Error('字段超出目标');
      }
      groupFor(receipt.routes.map(route => ({ op: 'set', origin: patch.origin,
        path: ['document', 'extensions', 'edit-addresses', ...route.source], value: route.address })), true).inputs.push(...receipt.inputs);
    } catch (error) { throw new Error(`迁移凭据无法本地裁决：${String(error)}`); }
  }
  let candidate = doc;
  const copyProbes: Patch[] = [], copies: ExtensionMigrationInput[] = [];
  if (raw.patches.some(patch => patch.op === 'insert' && patch.path[0] === 'slides')) {
    const preview = evaluateRemoteMessage(doc, session,
      { ...raw, patches: raw.patches.filter(patch => !isExtensionMigrationPatch(patch)) }, seed, []);
    if (preview.missingDependency && !incoming.length) return preview;
    if (!preview.missingDependency) {
      const structure = preview.accepted.filter(patch => !extension(patch) && !metadata(patch));
      const virtual = { ...session, registers: new Map(session.registers), elementLifecycles: new Map(session.elementLifecycles),
        slideLifecycles: new Map(session.slideLifecycles), slideMoves: new Map(session.slideMoves),
        sectionMoves: new Map(session.sectionMoves), onRecord: undefined };
      recordPatches(virtual, preview.recorded, raw.stamp);
      const members = new Set(doc.slideOrder);
      for (const patch of structure) {
        const slide = slideLifecycle(patch);
        if (slide?.state === 'present') members.add(slide.id);
        else if (slide) members.delete(slide.id);
      }
      candidate = stageExternalPatches(doc, materializeSlideOrder(doc.slideOrder,
        desiredSlideOrder(session.baseSlideOrder, members, virtual.slideMoves), structure));
      for (const patch of structure) {
        if (patch.op !== 'insert' || patch.path[0] !== 'slides' || patch.path.length !== 2) continue;
        for (const record of Object.values((patch.value as SlideTreeSnapshot).records)) {
          for (const namespace of Object.keys(record.ovr.extensions ?? {})) copyProbes.push({ op: 'del', origin: 'migration',
            path: ['elements', record.id, 'ovr', 'extensions', namespace, 'probe'] });
        }
      }
      copies.push(...copiedInputs(structure).map(({ source, ...input }) => input));
    }
  }
  // 嵌在插入快照中的旧值也参与本批裁决；前置凭据让实际插入直接读取已经获胜的共享值。
  const probes = [...raw.patches, ...copyProbes, ...[...groups.values()].flatMap(group => group.routes.map(route => ({
    op: 'del', origin: 'migration', path: ['elements', route.path[3], 'ovr', 'extensions', route.path[4], 'probe'],
  }) as Patch))];
  let routingError: unknown;
  extensionMigrationPatches(candidate, probes, (_doc, routes) => {
    try { groupFor(routes); } catch (error) { routingError = error; }
    return [];
  });
  if (routingError) throw routingError;
  const rawInputs = raw.patches.filter(patch => extension(patch) && (patch.op === 'set' || patch.op === 'del'))
    .map(patch => ({ path: patch.path as readonly string[], op: patch.op as 'set' | 'del', stamp: raw.stamp,
      ...(patch.op === 'set' ? { value: patch.value as ExtensionMigrationInput['value'] } : {}) }));
  const arriving = [...new Map(rawInputs.map(input => [JSON.stringify(input.path), input])).values()];
  const migrations: DocumentExtensionPatch[] = [];
  for (const group of groups.values()) {
    const resolved = resolveMigration(candidate, group.routes, session.registers, [...group.inputs, ...copies, ...arriving], group.remote);
    if (group.remote && !resolved?.length) throw new Error('迁移凭据无法本地裁决：原操作证据不足或矛盾');
    if (resolved) migrations.push(...resolved);
  }
  if (!migrations.length && !incoming.length) return groups.size
    ? evaluateRemoteMessage(doc, session, raw, seed, []) : evaluateRemoteMessage(doc, session, raw, seed);
  const addresses = raw.patches.filter(isExtensionAddressPatch), prefix = [...migrations, ...addresses];
  const staged = stageExternalPatches(doc, prefix), registers = new Map(session.registers);
  recordReceiptWinners(staged, registers, migrations);
  const previous = canonicalRegisters(staged, session.registers), current = canonicalRegisters(staged, registers);
  // 本次真实写入仍须进入普通补丁流，才能标脏并重基历史；凭据不能吞掉它的语义足迹。
  for (const input of raw.patches.filter(extension)) {
    const mapped = canonicalExtensionPatch(staged, input), key = JSON.stringify(mapped.path);
    const winner = current.get(key), old = previous.get(key);
    if (winner && compareStamp(winner.stamp, raw.stamp) === 0 && (!old || compareStamp(raw.stamp, old.stamp) > 0)) current.delete(key);
  }
  const evaluated = evaluateRemoteMessage(staged, { ...session, registers: current },
    { ...raw, patches: raw.patches.filter(patch => !metadata(patch)) }, seed, []);
  return { ...evaluated, accepted: [...prefix, ...evaluated.accepted], recorded: [...prefix, ...evaluated.recorded] };
}
