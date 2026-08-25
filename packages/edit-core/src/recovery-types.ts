import type { EditIdentity } from './types';
import type { Patch, Selection } from './commands/types';

export type RecoveryFrameSource = 'transaction' | 'undo' | 'redo' | 'selection' | 'savepoint';

/** Patch 里的 blob URL 会被保留 token 取代；这里保存 token 可重绑的原包身份或字节。 */
export interface RecoveryAssetReference {
  readonly url: string;
  readonly mime: string;
  readonly sourcePart?: string;
  /** 无原包 part 的派生资源才内联；普通源图片不会把字节重复写进每帧。 */
  readonly data?: string;
}

/** 一帧只描述已经生效的结果；资源 URL 已 token 化，存储层不需要理解命令或历史内部状态。 */
export interface RecoveryFrame {
  readonly version: 1;
  readonly sequence: number;
  readonly source: RecoveryFrameSource;
  readonly patches: Patch[];
  readonly assets?: readonly RecoveryAssetReference[];
  readonly identity: EditIdentity;
  readonly selection: Selection;
  readonly dirty: boolean;
  readonly label: string;
  readonly time: number;
}

export type RecoverySubscriber = (frame: RecoveryFrame) => void;

export interface RecoveryRestoreResult {
  readonly selection: Selection;
  readonly dirty: boolean;
  readonly sequence: number;
}
