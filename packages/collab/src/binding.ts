import { configureCollaborationIdentity } from '@web-ppt/edit-core';
import type {
  EditDoc, EditIdentity, Editor, EditorPatchEvent, Patch,
} from '@web-ppt/edit-core';
import { assertCollaborationCheckpoint } from './checkpoint';
import { assertCollabMessage, compareStamp, messageKey } from './message';
import { foldInsertedElementOverrides } from './atomic-patches';
import { evaluateRemoteMessage, patchAvailability, stageExternalPatches } from './evaluate';
import type { PatchAvailability } from './evaluate';
import { desiredSlideOrder, materializeSlideOrder } from './slide-order';
import { materializeSectionOrder } from './section-order';
import { checkpointSeen, cloneSeen, hasSeen, hasSequenceGap, markSeen, restoreSeen } from './seen';
import { recordPatches, slideLifecycle } from './state';
import type { CollaborationSession, DeferredPatch } from './state';
import type {
  CollabMessage, CollaborationBinding, CollaborationCheckpoint, CollaborationOptions,
} from './types';
import { canonicalRegisters } from './extension-addresses';

const sessions = new WeakMap<Editor, CollaborationSession>();
const MAX_DEFERRED_PATCHES = 10_000;

/** 按需适配器共享当前会话；不创建第二套时钟或重复绑定 provider。 */
export function collaborationSession(editor: Editor): CollaborationSession {
  const session = sessions.get(editor);
  if (!session) throw new Error('编辑器尚未绑定协同会话');
  return session;
}

function assertId(value: string, label: string): void {
  if (!value || value.length > 128 || /[\0-\x1f\x7f]/.test(value)) {
    throw new Error(`${label} 必须是 1–128 个不含控制字符的字符`);
  }
}

function createSession(
  editor: Editor,
  options: CollaborationOptions,
  checkpoint?: CollaborationCheckpoint,
): CollaborationSession {
  const allocation = editor.doc.identity.allocation!;
  checkpoint = structuredClone(checkpoint);
  return {
    documentId: options.documentId,
    replicaId: options.replicaId,
    replicaSlot: options.replicaSlot,
    registers: new Map(checkpoint?.registers),
    elementLifecycles: new Map(checkpoint?.elementLifecycles),
    slideLifecycles: new Map(checkpoint?.slideLifecycles),
    slideMoves: new Map(checkpoint?.slideMoves),
    sectionMoves: new Map(checkpoint?.sectionMoves),
    seen: restoreSeen(checkpoint?.seen),
    baseSlideOrder: [...(checkpoint?.baseSlideOrder ?? editor.doc.slideOrder)],
    baseSectionOrder: [...(checkpoint?.baseSectionOrder ?? editor.doc.sections.order)],
    deferred: [...checkpoint?.deferred ?? []],
    clock: allocation.clock,
    sequence: allocation.sequence,
    active: false,
  };
}

function createCheckpoint(session: CollaborationSession, doc: EditDoc): CollaborationCheckpoint {
  return structuredClone({
    version: 1,
    documentId: session.documentId,
    replicaId: session.replicaId,
    replicaSlot: session.replicaSlot,
    clock: session.clock,
    sequence: session.sequence,
    baseSlideOrder: session.baseSlideOrder,
    baseSectionOrder: session.baseSectionOrder,
    registers: [...canonicalRegisters(doc, session.registers)],
    elementLifecycles: [...session.elementLifecycles],
    slideLifecycles: [...session.slideLifecycles],
    slideMoves: [...session.slideMoves],
    sectionMoves: [...session.sectionMoves],
    seen: checkpointSeen(session.seen),
    deferred: session.deferred,
  });
}

function assertSession(session: CollaborationSession, options: CollaborationOptions): void {
  if (session.active) throw new Error('同一个 Editor 已经绑定协同 provider');
  if (session.documentId !== options.documentId || session.replicaId !== options.replicaId
    || session.replicaSlot !== options.replicaSlot) {
    throw new Error('同一个 Editor 不能切换协同文档或副本身份');
  }
}

export const bindWithEvaluator = bindCollaboration as (editor: Editor, options: CollaborationOptions,
  evaluate: typeof evaluateRemoteMessage) => CollaborationBinding;

export function bindCollaboration(editor: Editor, options: CollaborationOptions): CollaborationBinding;
export function bindCollaboration(editor: Editor, options: CollaborationOptions,
  evaluate = evaluateRemoteMessage): CollaborationBinding {
  if (!editor || typeof editor.subscribePatches !== 'function'
    || typeof editor.applyExternalPatches !== 'function') {
    throw new Error('协同绑定需要支持外部补丁的 Editor');
  }
  assertId(options.documentId, 'documentId');
  assertId(options.replicaId, 'replicaId');
  if (!options.provider || typeof options.provider.send !== 'function'
    || typeof options.provider.subscribe !== 'function') throw new Error('provider 接口无效');
  if (!Number.isSafeInteger(options.replicaSlot) || options.replicaSlot < 0 || options.replicaSlot >= 4096) {
    throw new Error('replicaSlot 必须是 0–4095 的整数');
  }

  let session = sessions.get(editor);
  const isNewSession = !session;
  let identityBefore: EditIdentity | null = null;
  if (session) assertSession(session, options);
  else {
    const allocation = editor.doc.identity.allocation;
    const restoredSession = allocation?.replicaId === options.replicaId
      && allocation.slot === options.replicaSlot && allocation.count === 4096;
    if (editor.history.undoCount || editor.history.redoCount || editor.isDirty() && !restoredSession) {
      throw new Error('协同绑定必须在本地编辑开始前建立');
    }
    identityBefore = structuredClone(editor.doc.identity);
    try {
      configureCollaborationIdentity(editor.doc, options.replicaId, options.replicaSlot);
      const configured = editor.doc.identity.allocation!;
      const hasPriorCollaboration = configured.clock > 0 || configured.sequence > 0;
      if (hasPriorCollaboration && !options.checkpoint) {
        throw new Error('恢复协同文档必须同时提供 CollaborationCheckpoint');
      }
      if (options.checkpoint) {
        assertCollaborationCheckpoint(options.checkpoint, options, configured);
      }
      session = createSession(editor, options, options.checkpoint);
      sessions.set(editor, session);
    } catch (error) {
      editor.doc.identity = identityBefore;
      throw error;
    }
  }
  const activeSession = session;

  const report = (error: unknown): void => {
    try { options.onError?.(error); } catch { /* 错误观察者不能打断已提交的编辑。 */ }
  };
  const snapshotSession = () => ({
    registers: new Map(activeSession.registers),
    elementLifecycles: new Map(activeSession.elementLifecycles),
    slideLifecycles: new Map(activeSession.slideLifecycles),
    slideMoves: new Map(activeSession.slideMoves),
    sectionMoves: new Map(activeSession.sectionMoves),
    seen: cloneSeen(activeSession.seen),
    deferred: [...activeSession.deferred],
    clock: activeSession.clock,
  });
  const restoreSession = (snapshot: ReturnType<typeof snapshotSession>): void => {
    // 快照仅属于当前同步接收批次；一次交换所有字段，新增寄存器类型也不会漏回滚。
    Object.assign(activeSession, snapshot);
  };

  const materializeAcceptedPatches = (patches: readonly Patch[]): Patch[] => {
    const folded = foldInsertedElementOverrides(patches);
    const members = new Set(editor.doc.slideOrder);
    for (const patch of folded) {
      const slide = slideLifecycle(patch);
      if (!slide) continue;
      if (slide.state === 'present') members.add(slide.id);
      else members.delete(slide.id);
    }
    const desired = desiredSlideOrder(
      activeSession.baseSlideOrder, members, activeSession.slideMoves,
    );
    return materializeSectionOrder(
      activeSession.baseSectionOrder, activeSession.sectionMoves,
      materializeSlideOrder(editor.doc.slideOrder, desired, folded),
    );
  };

  const collectReadyDeferred = (
    seed: PatchAvailability,
    baseAccepted: readonly Patch[],
  ): {
    patches: Patch[];
    errors: unknown[];
  } => {
    const accepted: Patch[] = [];
    const errors: unknown[] = [];
    let available = seed;
    let preview = stageExternalPatches(
      editor.doc, materializeAcceptedPatches(baseAccepted),
    );
    let progressed = true;
    while (progressed) {
      progressed = false;
      const ordered = [...activeSession.deferred].sort((left, right) =>
        compareStamp(left.message.stamp, right.message.stamp) || left.ordinal - right.ordinal);
      const groups = new Map<string, DeferredPatch[]>();
      for (const deferred of ordered) {
        const key = messageKey(deferred.message);
        const group = groups.get(key) ?? [];
        group.push(deferred);
        groups.set(key, group);
      }
      const blockedReplicas = new Set<string>();
      for (const group of groups.values()) {
        const message = group[0].message;
        if (blockedReplicas.has(message.replicaId)) continue;
        if (hasSequenceGap(activeSession.seen, message)) {
          blockedReplicas.add(message.replicaId);
          continue;
        }
        const sessionBeforeGroup = snapshotSession();
        const completed = new Set(group);
        try {
          const evaluated = evaluate(preview, activeSession, message, available);
          if (evaluated.missingDependency) {
            // 同一副本的后续消息必然观察过此前消息；前序依赖未落模时不能越过它消费后续字段/删除。
            blockedReplicas.add(message.replicaId);
            continue;
          }
          recordPatches(activeSession, evaluated.recorded, message.stamp);
          const nextPreview = stageExternalPatches(editor.doc, materializeAcceptedPatches([
            ...baseAccepted, ...accepted, ...evaluated.accepted,
          ]));
          const nextAvailable = patchAvailability(evaluated.accepted, available);
          accepted.push(...evaluated.accepted);
          preview = nextPreview;
          available = nextAvailable;
        } catch (error) {
          restoreSession(sessionBeforeGroup);
          errors.push(error);
        }
        // 无论成功或隔离坏组，都保留 seen 并移除该组延迟体；合法前序与其他组继续提交。
        activeSession.deferred = activeSession.deferred.filter((entry) => !completed.has(entry));
        progressed = true;
      }
    }
    return { patches: accepted, errors };
  };

  const acceptRemote = (raw: CollabMessage): void => {
    try {
      assertCollabMessage(raw);
      if (raw.documentId !== options.documentId || raw.replicaId === options.replicaId) return;
      if (raw.identity.prefix !== editor.doc.identity.prefix) {
        throw new Error('协同消息的文档身份前缀与本地基线不一致');
      }
      if (hasSeen(activeSession.seen, raw)) return;
      const evaluated = evaluate(editor.doc, activeSession, raw);
      const causallyBlocked = hasSequenceGap(activeSession.seen, raw)
        || activeSession.deferred.some((entry) =>
          entry.message.replicaId === raw.replicaId && entry.message.sequence < raw.sequence);
      const deferred = causallyBlocked || evaluated.missingDependency
        ? raw.patches.map((patch, ordinal) => ({ message: raw, patch, ordinal })) : [];
      if (activeSession.deferred.length + deferred.length > MAX_DEFERRED_PATCHES) {
        throw new Error('协同延迟补丁超过安全上限');
      }
      const allocation = editor.doc.identity.allocation!;
      const sessionBefore = snapshotSession();
      const previousPersistentClock = allocation.clock;
      let isolatedErrors: unknown[] = [];
      try {
        const nextClock = Math.max(activeSession.clock, raw.stamp.clock);
        activeSession.clock = nextClock;
        allocation.clock = nextClock;
        markSeen(activeSession.seen, raw);
        if (deferred.length) activeSession.deferred.push(...deferred);
        else recordPatches(activeSession, evaluated.recorded, raw.stamp);
        if (!deferred.length) {
          stageExternalPatches(
            editor.doc, materializeAcceptedPatches(evaluated.accepted),
          );
        }
        const ready = deferred.length ? { patches: [] as Patch[], errors: [] as unknown[] }
          : collectReadyDeferred(patchAvailability(evaluated.accepted), evaluated.accepted);
        isolatedErrors = ready.errors;
        const accepted = deferred.length ? [] : [...evaluated.accepted, ...ready.patches];
        const atomicPatches = materializeAcceptedPatches(accepted);
        if (atomicPatches.length) editor.applyExternalPatches(atomicPatches, {
          identity: raw.identity,
          origin: `collab:${raw.replicaId}`,
          label: raw.label,
          time: raw.time,
        });
        else editor.applyExternalPatches([], {
          identity: raw.identity, origin: `collab:${raw.replicaId}`,
        });
      } catch (error) {
        restoreSession(sessionBefore);
        allocation.clock = previousPersistentClock;
        throw error;
      }
      isolatedErrors.forEach(report);
    } catch (error) { report(error); }
  };

  const pendingLocalMessages = new Map<number, CollabMessage>();
  const observeLocal = (event: EditorPatchEvent): void => {
    if (!activeSession.active || event.source === 'external' || !event.patches.length) return;
    const allocation = event.identity.allocation;
    if (!allocation || allocation.replicaId !== options.replicaId
      || allocation.slot !== options.replicaSlot) {
      report(new Error('本地补丁缺少匹配的协同身份版本'));
      return;
    }
    if (allocation.clock <= activeSession.clock || allocation.sequence <= activeSession.sequence) {
      report(new Error('协同逻辑时钟或消息序号已耗尽'));
      return;
    }
    activeSession.clock = allocation.clock;
    activeSession.sequence = allocation.sequence;
    const stamp = { clock: allocation.clock, replicaId: options.replicaId };
    const sequence = allocation.sequence;
    recordPatches(activeSession, event.patches, stamp);
    const message: CollabMessage = {
      version: 1,
      documentId: options.documentId,
      replicaId: options.replicaId,
      sequence,
      stamp,
      patches: event.patches,
      identity: event.identity,
      label: event.label,
      time: event.time,
    };
    markSeen(activeSession.seen, message);
    pendingLocalMessages.set(sequence, message);
  };

  const sendLocal = (event: EditorPatchEvent): void => {
    if (!activeSession.active || event.source === 'external' || !event.patches.length) return;
    const sequence = event.identity.allocation?.sequence;
    const message = sequence === undefined ? undefined : pendingLocalMessages.get(sequence);
    if (!message) {
      report(new Error('本地补丁缺少 recovery 前协同 checkpoint'));
      return;
    }
    pendingLocalMessages.delete(message.sequence);
    try {
      const sent = options.provider.send(structuredClone(message));
      if (sent && typeof sent.then === 'function') void sent.catch(report);
    } catch (error) { report(error); }
  };

  let unsubscribeBeforeRecovery: (() => void) | null = null;
  let unsubscribeEditor: (() => void) | null = null;
  let unsubscribeProvider: (() => void) | null = null;
  const buffered: CollabMessage[] = [];
  let accepting = false;
  let disposed = false;
  try {
    unsubscribeBeforeRecovery = editor.subscribePatches(observeLocal, { phase: 'before-recovery' });
    unsubscribeEditor = editor.subscribePatches(sendLocal);
    const candidate = options.provider.subscribe((message) => {
      if (disposed) return;
      if (accepting) acceptRemote(message);
      else buffered.push(structuredClone(message));
    });
    if (typeof candidate !== 'function') throw new Error('provider.subscribe 必须返回取消订阅函数');
    unsubscribeProvider = candidate;
    activeSession.active = true;
    accepting = true;
    for (const message of buffered) acceptRemote(message);
  } catch (error) {
    try { unsubscribeBeforeRecovery?.(); } catch { /* 失败绑定只保留原始错误。 */ }
    try { unsubscribeEditor?.(); } catch { /* 失败绑定只保留原始错误。 */ }
    try { unsubscribeProvider?.(); } catch { /* 失败绑定只保留原始错误。 */ }
    if (isNewSession && identityBefore) {
      editor.doc.identity = identityBefore;
      sessions.delete(editor);
    }
    throw error;
  }

  return {
    documentId: options.documentId,
    replicaId: options.replicaId,
    editor,
    checkpoint: () => createCheckpoint(activeSession, editor.doc),
    dispose() {
      if (disposed) return;
      disposed = true;
      activeSession.active = false;
      accepting = false;
      buffered.length = 0;
      pendingLocalMessages.clear();
      try { unsubscribeBeforeRecovery?.(); } catch (error) { report(error); }
      try { unsubscribeEditor?.(); } catch (error) { report(error); }
      try { unsubscribeProvider?.(); } catch (error) { report(error); }
    },
  };
}
