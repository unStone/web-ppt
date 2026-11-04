import {
  EDITOR_RECOVERY_VERSION, restoreRecoveryFrames,
  type EditDoc, type Editor, type ExtensionMigrationReceipt, type RecoveryFrame, type RecoveryRestoreResult,
} from '@web-ppt/edit-core';
import type { RecoveryStore, RecoveryStoreJournal, WebPptSourceIdentity } from '@web-ppt/editor';
import {
  bindCollaboration,
  type CollabMessage, type CollabProvider, type CollaborationCheckpoint, type CollaborationOptions,
} from '@web-ppt/collab';
import { bindCollaboration as bindMigration, type CollabExtensionOperation } from '@web-ppt/collab/migration';

export function recoveryFrameContract(doc: EditDoc): RecoveryRestoreResult {
  const frame: RecoveryFrame = {
    version: EDITOR_RECOVERY_VERSION, sequence: 1, source: 'transaction', patches: [],
    identity: doc.identity, selection: { kind: 'none' }, dirty: false, label: '恢复', time: 0,
  };
  const version: 1 = frame.version;
  void version;
  return restoreRecoveryFrames(doc, [frame]);
}

export async function recoveryStoreContract(store: RecoveryStore, source: WebPptSourceIdentity): Promise<RecoveryStoreJournal | null> {
  await store.reset({ source, idPrefix: 'contract-', epoch: 'epoch' });
  await store.append({ source, idPrefix: 'contract-', epoch: 'epoch', frames: [] });
  const journal = await store.load(source);
  if (journal) {
    const version: 1 = journal.version;
    const frames: readonly RecoveryFrame[] = journal.frames;
    void [version, frames];
  }
  return journal;
}

export function collaborationContract(editor: Editor, provider: CollabProvider): CollaborationCheckpoint {
  const options: CollaborationOptions = { documentId: 'deck', replicaId: 'replica', replicaSlot: 0, provider };
  const binding = bindCollaboration(editor, options);
  const checkpoint: CollaborationCheckpoint = binding.checkpoint();
  const version: 1 = checkpoint.version;
  binding.dispose();
  bindMigration(editor, { ...options, checkpoint }).dispose();
  const deleted: CollabExtensionOperation = { op: 'del' };
  const set: CollabExtensionOperation = { op: 'set', value: null };
  const receipt: ExtensionMigrationReceipt = { version: 1, routes: [], inputs: [], winners: [] };
  void [version, deleted, set, receipt];
  return checkpoint;
}

export function protocolFailures(frame: RecoveryFrame, message: CollabMessage, checkpoint: CollaborationCheckpoint, editor: Editor): void {
  // @ts-expect-error 新版恢复帧必须经过明确的协议演进。
  const nextFrame: RecoveryFrame = { ...frame, version: 2 };
  // @ts-expect-error 协同消息不能把未知协议伪装成当前版本。
  const nextMessage: CollabMessage = { ...message, version: 2 };
  // @ts-expect-error checkpoint 与消息一样只有版本 1 的读取契约。
  const nextCheckpoint: CollaborationCheckpoint = { ...checkpoint, version: 2 };
  // @ts-expect-error provider 订阅必须返回清理函数。
  const provider: CollabProvider = { send() {}, subscribe() {} };
  // @ts-expect-error 身份分配必须提供 replicaSlot，不能省略以免复用身份。
  bindCollaboration(editor, { documentId: 'deck', replicaId: 'replica', provider });
  // @ts-expect-error 扩展迁移原操作只接受标量值。
  const operation: CollabExtensionOperation = { op: 'set', value: { text: '不允许对象值' } };
  // @ts-expect-error 扩展迁移凭据只支持版本 1。
  const receipt: ExtensionMigrationReceipt = { version: 2, routes: [], inputs: [], winners: [] };
  void [nextFrame, nextMessage, nextCheckpoint, operation, receipt];
}
