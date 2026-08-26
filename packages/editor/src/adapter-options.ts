import type { OpenEditorOptions } from './session';
import type { SlideEditorOptions } from './slide-editor-types';
import type { WebPptViewOptions } from './framework-adapter-types';

const recoveryLogKeys = new WeakMap<object, number>();
const recoveryStoreKeys = new WeakMap<object, number>();
const recoverySignalKeys = new WeakMap<object, number>();
let nextRecoveryLogKey = 1;
let nextRecoveryStoreKey = 1;
let nextRecoverySignalKey = 1;

function objectKey(
  value: object | undefined,
  keys: WeakMap<object, number>,
  next: () => number,
): number {
  if (!value) return 0;
  let key = keys.get(value);
  if (key === undefined) {
    key = next();
    keys.set(value, key);
  }
  return key;
}

export function openOptionsKey(options: OpenEditorOptions | undefined): string {
  return JSON.stringify({
    password: options?.password, idPrefix: options?.idPrefix, origin: options?.origin,
    historyLimit: options?.historyLimit, historyByteLimit: options?.historyByteLimit,
    // 大日志与存储对象采用不可变引用语义，框架 render 不得扫描其全部内容。
    recoveryLog: objectKey(options?.recoveryFrames, recoveryLogKeys, () => nextRecoveryLogKey++),
    recoveryStore: objectKey(options?.recovery?.store, recoveryStoreKeys, () => nextRecoveryStoreKey++),
    recoverySignal: objectKey(
      options?.recovery?.signal, recoverySignalKeys, () => nextRecoverySignalKey++,
    ),
  });
}

export function validateViewOptions(options: WebPptViewOptions): void {
  if (options.mode !== undefined && options.mode !== 'view' && options.mode !== 'edit') {
    throw new Error(`未知编辑器模式：${String(options.mode)}`);
  }
  if (options.zoom !== undefined && (!Number.isFinite(options.zoom) || options.zoom <= 0)) {
    throw new Error('缩放必须是有限正数');
  }
  if (options.textMode !== undefined
    && options.textMode !== 'auto' && options.textMode !== 'html' && options.textMode !== 'svg') {
    throw new Error(`未知文字模式：${String(options.textMode)}`);
  }
  if (options.snapping !== undefined && typeof options.snapping !== 'boolean') {
    throw new Error('吸附开关必须是布尔值');
  }
  const margins = options.snapMargins;
  if (margins && ![margins.left, margins.right, margins.top, margins.bottom]
    .every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error('吸附页边距必须是有限非负值');
  }
}

export function sameMargins(
  left: SlideEditorOptions['snapMargins'],
  right: SlideEditorOptions['snapMargins'],
): boolean {
  return left === right || !!left && !!right
    && left.left === right.left && left.right === right.right
    && left.top === right.top && left.bottom === right.bottom;
}
