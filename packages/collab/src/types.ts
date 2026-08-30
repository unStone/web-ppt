import type {
  EditIdentity, Editor, EditorPatchEvent, Patch,
} from '@web-ppt/edit-core';

export interface CollabStamp {
  readonly clock: number;
  readonly replicaId: string;
}

export interface CollabLifecycleCheckpoint {
  readonly stamp: CollabStamp;
  readonly state: 'present' | 'removed';
}

export interface CollabRegisterCheckpoint {
  readonly stamp: CollabStamp;
  readonly kind: 'field' | 'hierarchy';
}

export interface CollabSlideMoveCheckpoint {
  readonly stamp: CollabStamp;
  readonly after: string | null;
  /** 同一消息内多次页序意图共用 stamp，以原 Patch 次序补足全序。 */
  readonly ordinal: number;
}

export interface CollabDeferredCheckpoint {
  readonly message: CollabMessage;
  readonly patch: Patch;
  readonly ordinal: number;
}

export interface CollabSeenCheckpoint {
  readonly replicaId: string;
  /** 已连续接收的最大消息序号；之前的消息无需逐条常驻。 */
  readonly contiguous: number;
  /** 高水位之后已收到的乱序消息；缺口闭合时会自动压缩。 */
  readonly sparse: readonly number[];
}

/** 与 Editor recovery frames 同步持久化；模型快照本身无法重建 LWW 裁决元数据。 */
export interface CollaborationCheckpoint {
  readonly version: 1;
  readonly documentId: string;
  readonly replicaId: string;
  readonly replicaSlot: number;
  readonly clock: number;
  readonly sequence: number;
  readonly baseSlideOrder: readonly string[];
  readonly registers: readonly (readonly [string, CollabRegisterCheckpoint])[];
  readonly elementLifecycles: readonly (readonly [string, CollabLifecycleCheckpoint])[];
  readonly slideLifecycles: readonly (readonly [string, CollabLifecycleCheckpoint])[];
  readonly slideMoves: readonly (readonly [string, CollabSlideMoveCheckpoint])[];
  readonly seen: readonly CollabSeenCheckpoint[];
  readonly deferred: readonly CollabDeferredCheckpoint[];
}

/** 一条消息对应一个已经原子落模的 Editor 补丁批次。 */
export interface CollabMessage {
  readonly version: 1;
  readonly documentId: string;
  readonly replicaId: string;
  readonly sequence: number;
  readonly stamp: CollabStamp;
  readonly patches: readonly Patch[];
  readonly identity: EditIdentity;
  readonly label: string;
  readonly time: number;
}

export type CollabMessageListener = (message: CollabMessage) => void;

/** provider 只搬运可结构化克隆的消息；鉴权、持久化和拓扑不进入模型层。 */
export interface CollabProvider {
  send(message: CollabMessage): void | Promise<void>;
  subscribe(listener: CollabMessageListener): () => void;
}

export interface CollaborationOptions {
  readonly documentId: string;
  readonly replicaId: string;
  /** provider 在同一文档内分配的唯一整数；隔离逻辑 id 与全部 OOXML 数值身份，范围 0–4095。 */
  readonly replicaSlot: number;
  readonly provider: CollabProvider;
  /** 恢复过的 EditDoc 必须同时提供；新文档与同一 Editor 的 dispose/rebind 不需要。 */
  readonly checkpoint?: CollaborationCheckpoint;
  readonly onError?: (error: unknown) => void;
}

export interface CollaborationBinding {
  readonly documentId: string;
  readonly replicaId: string;
  readonly editor: Editor;
  checkpoint(): CollaborationCheckpoint;
  dispose(): void;
}

export type LocalPatchEvent = EditorPatchEvent;
