import type { RecoveryFrame } from '@web-ppt/edit-core';
import type { WebPptSourceIdentity } from './source-fingerprint';

export interface RecoveryStoreJournal {
  readonly version: 1;
  readonly source: WebPptSourceIdentity;
  readonly idPrefix: string;
  readonly epoch: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly estimatedBytes: number;
  readonly frames: readonly RecoveryFrame[];
}

export interface RecoveryStoreAppend {
  readonly source: WebPptSourceIdentity;
  readonly idPrefix: string;
  readonly epoch: string;
  readonly frames: readonly RecoveryFrame[];
}

export interface RecoveryStoreReset {
  readonly source: WebPptSourceIdentity;
  readonly idPrefix: string;
  /** 每次放弃/清理旧链都会换代，使旧页面的晚到追加必然失败。 */
  readonly epoch: string;
  /** store 必须在原子提交前响应取消，避免过期打开覆盖新会话代际。 */
  readonly signal?: AbortSignal;
}

/** 宿主可替换此 seam；存储实现必须在 append Promise 完成前原子提交整批帧。 */
export interface RecoveryStore {
  load(source: WebPptSourceIdentity): Promise<RecoveryStoreJournal | null>;
  reset(request: RecoveryStoreReset): Promise<void>;
  append(request: RecoveryStoreAppend): Promise<void>;
  remove(source: WebPptSourceIdentity): Promise<void>;
}

export interface RecoveryCandidate {
  readonly fingerprint: WebPptSourceIdentity['fingerprint'];
  readonly sourceByteLength: number;
  readonly idPrefix: string;
  readonly frameCount: number;
  readonly estimatedBytes: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly dirty: true;
  readonly latestLabel: string;
}

export type RecoveryDecision = 'restore' | 'discard' | 'cancel';
export type RecoveryDecisionHandler = (
  candidate: RecoveryCandidate,
) => RecoveryDecision | Promise<RecoveryDecision>;

export interface RecoveryOptions {
  readonly store: RecoveryStore;
  /** adapter 可改由 onRecovery 提供；直接 openEditor 在发现候选时必须提供。 */
  readonly decide?: RecoveryDecisionHandler;
  readonly onError?: (error: unknown) => void;
  /** 框架适配器用它取消过期候选与占位；宿主也可直接控制打开流程。 */
  readonly signal?: AbortSignal;
}

export interface EditorRecovery {
  readonly source: WebPptSourceIdentity;
  readonly pending: number;
  readonly error: unknown | null;
  flush(): Promise<void>;
}

export class RecoveryOpenCancelledError extends Error {
  readonly candidate: RecoveryCandidate;

  constructor(candidate: RecoveryCandidate) {
    super('用户取消了演示文稿恢复');
    this.name = 'RecoveryOpenCancelledError';
    this.candidate = candidate;
  }
}
