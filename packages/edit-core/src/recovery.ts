import { applyPatches } from './commands/patch';
import type { Patch, Selection } from './commands/types';
import { bytesToBase64 } from './clipboard-binary';
import { releaseLayoutProjectionCache } from './layout-projection';
import { validateEditDoc } from './model-invariants';
import {
  assertRecoveryIdentity, assertRecoveryIdentityFloor, createRecoveryIdentityFloor,
} from './recovery-identity';
import { releaseProjectionCache } from './projection';
import type {
  RecoveryAssetReference, RecoveryFrame, RecoveryFrameSource, RecoveryRestoreResult, RecoverySubscriber,
} from './recovery-types';
import { cloneSelection, normalizeSelection } from './selection';
import { sessionAsset } from './session-assets';
import type { EditDoc, EditIdentity } from './types';

export const EDITOR_RECOVERY_VERSION = 1 as const;

const SOURCES = new Set<RecoveryFrameSource>([
  'transaction', 'undo', 'redo', 'selection', 'savepoint',
]);
const SELECTION_KINDS = new Set<Selection['kind']>(['none', 'elements', 'text', 'table']);
// NUL 不可能出现在 URL 或合法 OOXML 文本中，避免用户内容被误认成内部资源占位符。
const RECOVERY_ASSET_TOKEN = '\0web-ppt-recovery-asset:';

function reportSubscriberError(error: unknown): void {
  try {
    const reporter = (globalThis as typeof globalThis & { reportError?: (reason: unknown) => void }).reportError;
    if (reporter) reporter(error);
    else console.error('Editor 恢复订阅者执行失败', error);
  } catch { /* 持久化观察者不能把已经提交的模型变化伪装成失败。 */ }
}

export function cloneRecoveryFrame(frame: RecoveryFrame): RecoveryFrame {
  return structuredClone(frame);
}

function visitStrings(
  value: unknown,
  visit: (value: string) => string,
  mutate: boolean,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') return visit(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const next = visitStrings(child, visit, mutate, seen);
    if (mutate) (value as Record<string, unknown>)[key] = next;
  }
  return value;
}

function frameAssets(doc: EditDoc, patches: readonly Patch[]): RecoveryAssetReference[] {
  const found = new Map<string, RecoveryAssetReference>();
  visitStrings(patches, (url) => {
    const asset = sessionAsset(doc, url);
    if (!asset || found.has(url)) return url;
    found.set(url, {
      url, mime: asset.mime,
      ...(asset.sourcePart ? { sourcePart: asset.sourcePart } : { data: bytesToBase64(asset.bytes) }),
    });
    return url;
  }, false);
  return [...found.values()];
}

const recoveryAssetToken = (url: string): string => `${RECOVERY_ASSET_TOKEN}${url}`;

function persistentPatches(
  patches: readonly Patch[],
  assets: readonly RecoveryAssetReference[],
): Patch[] {
  const clone = structuredClone([...patches]);
  if (!assets.length) return clone;
  const tokens = new Map(assets.map((asset) => [asset.url, recoveryAssetToken(asset.url)]));
  visitStrings(clone, (value) => tokens.get(value) ?? value, true);
  return clone;
}

function assertAssets(frame: RecoveryFrame): void {
  if (frame.assets === undefined) return;
  if (!Array.isArray(frame.assets)) throw new Error(`恢复帧 ${frame.sequence} 的资源引用无效`);
  const urls = new Set<string>();
  const mimeType = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;
  const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  for (const asset of frame.assets) {
    if (!asset || typeof asset !== 'object' || typeof asset.url !== 'string' || !asset.url
      || typeof asset.mime !== 'string' || !mimeType.test(asset.mime) || urls.has(asset.url)
      || (asset.sourcePart !== undefined && (typeof asset.sourcePart !== 'string' || !asset.sourcePart))
      || (asset.data !== undefined && (typeof asset.data !== 'string' || !asset.data || !base64.test(asset.data)))
      || (asset.sourcePart === undefined) === (asset.data === undefined)) {
      throw new Error(`恢复帧 ${frame.sequence} 的资源引用无效`);
    }
    urls.add(asset.url);
  }
}

function reboundPatches(doc: EditDoc, frame: RecoveryFrame): Patch[] {
  const current = Object.entries(doc.package?.assets ?? {});
  const bindings = new Map((frame.assets ?? []).map((asset) => {
    const exact = asset.sourcePart ? current.find(([, candidate]) =>
      candidate.sourcePart === asset.sourcePart && candidate.mime === asset.mime) : undefined;
    const matched = exact ?? (asset.sourcePart
      ? current.find(([, candidate]) => candidate.sourcePart === asset.sourcePart) : undefined);
    if (asset.sourcePart && !matched) {
      throw new Error(`恢复资源在当前原包中不存在：${asset.sourcePart}`);
    }
    return [recoveryAssetToken(asset.url), matched?.[0] ?? `data:${asset.mime};base64,${asset.data}`] as const;
  }));
  const referenced = new Set<string>();
  visitStrings(frame.patches, (value) => {
    if (!value.startsWith(RECOVERY_ASSET_TOKEN)) return value;
    if (!bindings.has(value)) throw new Error(`恢复帧 ${frame.sequence} 缺少资源闭包`);
    referenced.add(value);
    return value;
  }, false);
  if (referenced.size !== bindings.size) throw new Error(`恢复帧 ${frame.sequence} 含未引用的资源闭包`);
  if (!referenced.size) return frame.patches;
  const patches = structuredClone(frame.patches);
  visitStrings(patches, (value) => bindings.get(value) ?? value, true);
  return patches;
}

function assertFrame(frame: RecoveryFrame, previousSequence: number, prefix: string): void {
  const value = frame as Partial<RecoveryFrame>;
  if (!value || typeof value !== 'object' || value.version !== EDITOR_RECOVERY_VERSION) {
    throw new Error('恢复帧版本不受支持');
  }
  if (!Number.isSafeInteger(value.sequence) || value.sequence! <= previousSequence) {
    throw new Error('恢复帧序号必须严格递增');
  }
  if (!SOURCES.has(value.source as RecoveryFrameSource) || !Array.isArray(value.patches)
    || !value.selection || typeof value.selection !== 'object'
    || !SELECTION_KINDS.has((value.selection as Partial<Selection>).kind as Selection['kind'])
    || typeof value.dirty !== 'boolean' || typeof value.label !== 'string'
    || !Number.isFinite(value.time)) {
    throw new Error(`恢复帧 ${String(value.sequence)} 的结构无效`);
  }
  assertRecoveryIdentity(value.identity, prefix, value.sequence!);
  if ((value.source === 'selection' || value.source === 'savepoint') && value.patches.length) {
    throw new Error(`恢复帧 ${value.sequence} 的元数据事件不能携带 Patch`);
  }
  if (value.source === 'savepoint' && value.dirty) {
    throw new Error(`恢复帧 ${value.sequence} 的保存点不能标记为脏`);
  }
  assertAssets(frame);
}

/** 原包与保存基线只读共享；可变模型写时复制，坏日志因此无法污染目标文档。 */
function stageDoc(doc: EditDoc): EditDoc {
  return {
    meta: structuredClone(doc.meta),
    identity: structuredClone(doc.identity),
    slides: structuredClone(doc.slides),
    slideOrder: [...doc.slideOrder],
    layouts: doc.layouts,
    layoutOrder: doc.layoutOrder,
    elements: structuredClone(doc.elements),
    removedElements: structuredClone(doc.removedElements),
    imageResources: structuredClone(doc.imageResources),
    package: doc.package,
    saveState: doc.saveState,
  };
}

function commitStage(doc: EditDoc, staged: EditDoc): void {
  releaseLayoutProjectionCache(doc);
  releaseProjectionCache(doc);
  doc.meta = staged.meta;
  doc.identity = staged.identity;
  doc.slides = staged.slides;
  doc.slideOrder = staged.slideOrder;
  doc.elements = staged.elements;
  doc.removedElements = staged.removedElements;
  doc.imageResources = staged.imageResources;
}

/** 只应在新解析文档建立 Editor 前调用；成功时一次性交换模型，失败时目标保持原样。 */
export function restoreRecoveryFrames(
  doc: EditDoc,
  frames: readonly RecoveryFrame[],
): RecoveryRestoreResult {
  if (!Array.isArray(frames)) throw new Error('恢复日志必须是数组');
  const staged = stageDoc(doc);
  const prefix = staged.identity.prefix;
  const floor = createRecoveryIdentityFloor(staged);
  let sequence = 0;
  let selection: Selection = { kind: 'none' };
  let dirty = false;
  for (const raw of frames) {
    assertFrame(raw, sequence, prefix);
    const frame = cloneRecoveryFrame(raw);
    const patches = reboundPatches(staged, frame);
    assertRecoveryIdentityFloor(staged, floor, frame.identity, patches, frame.sequence);
    if (patches.length) applyPatches(staged, patches);
    staged.identity = structuredClone(frame.identity) as EditIdentity;
    const normalized = normalizeSelection(staged, frame.selection);
    if (JSON.stringify(normalized) !== JSON.stringify(cloneSelection(frame.selection))) {
      throw new Error(`恢复帧 ${frame.sequence} 的选区不是规范状态`);
    }
    selection = normalized;
    dirty = frame.dirty;
    sequence = frame.sequence;
  }
  validateEditDoc(staged);
  const result = { selection: cloneSelection(selection), dirty, sequence };
  commitStage(doc, staged);
  return result;
}

interface EmitRecoveryFrame {
  readonly source: RecoveryFrameSource;
  readonly patches: readonly Patch[];
  readonly doc: EditDoc;
  readonly identity: EditIdentity;
  readonly selection: Selection;
  readonly dirty: boolean;
  readonly label: string;
  readonly time: number;
}

/** 序号在调用观察者前分配；同步重入编辑也不会颠倒日志因果顺序。 */
export class RecoveryJournal {
  private readonly subscribers = new Set<RecoverySubscriber>();
  private readonly pending: RecoveryFrame[] = [];
  private dispatching = false;
  private sequence: number;

  constructor(sequence = 0) { this.sequence = sequence; }

  subscribe(subscriber: RecoverySubscriber): () => void {
    if (typeof subscriber !== 'function') throw new Error('恢复订阅者必须是函数');
    this.subscribers.add(subscriber);
    return () => { this.subscribers.delete(subscriber); };
  }

  emit(input: EmitRecoveryFrame): void {
    // 默认编辑路径没有持久化观察者，不能为未启用的能力深拷贝结构 Patch。
    if (!this.subscribers.size) return;
    if (this.sequence >= Number.MAX_SAFE_INTEGER) {
      reportSubscriberError(new Error('恢复日志序号已耗尽'));
      return;
    }
    const assets = frameAssets(input.doc, input.patches);
    const frame: RecoveryFrame = {
      version: EDITOR_RECOVERY_VERSION,
      sequence: ++this.sequence,
      source: input.source,
      patches: persistentPatches(input.patches, assets),
      ...(assets.length ? { assets } : {}),
      identity: structuredClone(input.identity),
      selection: cloneSelection(input.selection),
      dirty: input.dirty,
      label: input.label,
      time: input.time,
    };
    this.pending.push(frame);
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      while (this.pending.length) {
        const batch = this.pending.splice(0, this.pending.length);
        for (const pending of batch) for (const subscriber of [...this.subscribers]) {
          try { subscriber(cloneRecoveryFrame(pending)); } catch (error) { reportSubscriberError(error); }
        }
      }
    } finally {
      this.dispatching = false;
    }
  }
}
