import type { RecoveryFrame } from '@web-ppt/edit-core';
import type {
  RecoveryStore, RecoveryStoreAppend, RecoveryStoreJournal, RecoveryStoreReset,
} from './recovery-store';
import type { WebPptSourceIdentity } from './source-fingerprint';

const DATABASE_VERSION = 1;
const JOURNALS = 'journals';
const CHUNKS = 'chunks';
const JOURNAL_INDEX = 'journal';

interface JournalRow {
  readonly key: string;
  readonly namespace: string;
  readonly source: WebPptSourceIdentity;
  readonly idPrefix: string;
  readonly epoch: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly estimatedBytes: number;
  readonly frameCount: number;
  readonly lastSequence: number;
  readonly chunkCount: number;
  readonly lastChunkKey: string | null;
}

interface ChunkRow {
  readonly key: string;
  readonly journalKey: string;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly frames: readonly RecoveryFrame[];
}

export interface IndexedDbRecoveryStoreOptions {
  readonly databaseName?: string;
  readonly namespace?: string;
  readonly compactAfterChunks?: number;
  readonly compactToChunks?: number;
  readonly maxJournals?: number;
  readonly maxBytes?: number;
  readonly retentionMs?: number;
  /** 允许 Worker、测试或受控环境注入 IDBFactory；模块导入本身不读取 indexedDB。 */
  readonly factory?: IDBFactory;
  readonly now?: () => number;
}

export interface RecoveryStoreStats {
  readonly journalCount: number;
  readonly chunkCount: number;
  readonly frameCount: number;
  readonly estimatedBytes: number;
}

export interface RecoveryCleanupResult {
  readonly journalsRemoved: number;
  readonly estimatedBytesRemoved: number;
}

export interface IndexedDbRecoveryStore extends RecoveryStore {
  stats(): Promise<RecoveryStoreStats>;
  cleanup(preserveFingerprint?: WebPptSourceIdentity['fingerprint']): Promise<RecoveryCleanupResult>;
  close(): Promise<void>;
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
});

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务已中止'));
    transaction.onerror = () => { /* abort 会携带最终错误，避免同一事务重复 rejection。 */ };
  });

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`);
  return value;
}

function sourceKey(namespace: string, fingerprint: string): string {
  return `${namespace}\0${fingerprint}`;
}

function chunkKey(journalKey: string, sequence: number): string {
  return `${journalKey}\0${sequence.toString().padStart(16, '0')}`;
}

function assertSource(source: WebPptSourceIdentity): void {
  if (!source || !/^sha256:[0-9a-f]{64}$/.test(source.fingerprint)
    || !Number.isSafeInteger(source.byteLength) || source.byteLength < 0) {
    throw new Error('恢复日志的源身份无效');
  }
}

function assertFrames(frames: readonly RecoveryFrame[], after = 0): void {
  if (!Array.isArray(frames) || !frames.length) throw new Error('恢复追加批次不能为空');
  let sequence = after;
  for (const frame of frames) {
    if (!frame || !Number.isSafeInteger(frame.sequence) || frame.sequence <= sequence) {
      throw new Error('恢复追加帧必须严格递增');
    }
    sequence = frame.sequence;
  }
}

function validatedChunkFrames(journalKey: string, chunks: ChunkRow[]): RecoveryFrame[] {
  chunks.sort((left, right) => left.firstSequence - right.firstSequence);
  const frames: RecoveryFrame[] = [];
  let after = 0;
  for (const chunk of chunks) {
    if (chunk.journalKey !== journalKey || !Array.isArray(chunk.frames) || !chunk.frames.length) {
      throw new Error('恢复分块身份或内容无效');
    }
    assertFrames(chunk.frames, after);
    const first = chunk.frames[0].sequence;
    const last = chunk.frames[chunk.frames.length - 1].sequence;
    if (chunk.key !== chunkKey(journalKey, first)
      || chunk.firstSequence !== first || chunk.lastSequence !== last) {
      throw new Error('恢复分块元数据无效');
    }
    frames.push(...chunk.frames);
    after = last;
  }
  return frames;
}

function partitionChunks(
  journalKey: string,
  frames: readonly RecoveryFrame[],
  count: number,
): ChunkRow[] {
  const size = Math.max(1, Math.ceil(frames.length / count));
  const chunks: ChunkRow[] = [];
  for (let index = 0; index < frames.length; index += size) {
    const group = frames.slice(index, index + size);
    const firstSequence = group[0].sequence;
    chunks.push({
      key: chunkKey(journalKey, firstSequence), journalKey, firstSequence,
      lastSequence: group[group.length - 1].sequence, frames: group,
    });
  }
  return chunks;
}

function compactMetadataFrames(frames: readonly RecoveryFrame[]): RecoveryFrame[] {
  const compacted: RecoveryFrame[] = [];
  for (const frame of frames) {
    const previous = compacted[compacted.length - 1];
    // 连续元数据帧之间没有模型变化，只需保留最终选区与 dirty/savepoint 状态。
    if (previous && !previous.patches.length && !frame.patches.length) compacted[compacted.length - 1] = frame;
    else compacted.push(frame);
  }
  return compacted;
}

class BrowserIndexedDbRecoveryStore implements IndexedDbRecoveryStore {
  private readonly databaseName: string;
  private readonly namespace: string;
  private readonly compactAfterChunks: number;
  private readonly compactToChunks: number;
  private readonly maxJournals: number;
  private readonly maxBytes: number;
  private readonly retentionMs: number;
  private readonly factory: IDBFactory;
  private readonly now: () => number;
  private database: Promise<IDBDatabase> | null = null;
  private closed = false;

  constructor(options: IndexedDbRecoveryStoreOptions) {
    this.databaseName = options.databaseName ?? 'web-ppt-editor-recovery';
    this.namespace = options.namespace ?? 'default';
    this.compactAfterChunks = positiveInteger(options.compactAfterChunks ?? 64, 'compactAfterChunks');
    this.compactToChunks = positiveInteger(options.compactToChunks ?? 32, 'compactToChunks');
    this.maxJournals = positiveInteger(options.maxJournals ?? 20, 'maxJournals');
    this.maxBytes = positiveInteger(options.maxBytes ?? 16 * 1024 * 1024, 'maxBytes');
    this.retentionMs = positiveInteger(options.retentionMs ?? 30 * 24 * 60 * 60 * 1000, 'retentionMs');
    if (!this.databaseName || !this.namespace || this.namespace.includes('\0')) {
      throw new Error('IndexedDB 恢复存储名称或命名空间无效');
    }
    if (this.compactToChunks >= this.compactAfterChunks) {
      throw new Error('compactToChunks 必须小于 compactAfterChunks');
    }
    const factory = options.factory ?? globalThis.indexedDB;
    if (!factory) throw new Error('当前环境不支持 IndexedDB');
    this.factory = factory;
    this.now = options.now ?? Date.now;
  }

  async load(source: WebPptSourceIdentity): Promise<RecoveryStoreJournal | null> {
    assertSource(source);
    const database = await this.activeDatabase();
    const key = sourceKey(this.namespace, source.fingerprint);
    const transaction = database.transaction([JOURNALS, CHUNKS], 'readonly');
    const completed = transactionDone(transaction);
    const [row, chunks] = await Promise.all([
      requestResult(transaction.objectStore(JOURNALS).get(key) as IDBRequest<JournalRow | undefined>),
      requestResult(transaction.objectStore(CHUNKS).index(JOURNAL_INDEX)
        .getAll(key) as IDBRequest<ChunkRow[]>),
      completed,
    ]);
    if (!row) {
      if (chunks.length) throw new Error('恢复存储存在孤立分块');
      return null;
    }
    if (row.source.fingerprint !== source.fingerprint || row.source.byteLength !== source.byteLength) {
      throw new Error('恢复存储源身份冲突');
    }
    const frames = validatedChunkFrames(key, chunks);
    const lastChunk = chunks[chunks.length - 1];
    if (typeof row.idPrefix !== 'string'
      || typeof row.epoch !== 'string' || !row.epoch
      || frames.length !== row.frameCount || chunks.length !== row.chunkCount
      || (frames.length
        ? frames[frames.length - 1].sequence !== row.lastSequence
          || lastChunk?.key !== row.lastChunkKey
        : row.lastSequence !== 0 || row.lastChunkKey !== null)) {
      throw new Error('恢复存储元数据与分块不一致');
    }
    return {
      version: 1, source: structuredClone(row.source), idPrefix: row.idPrefix, epoch: row.epoch,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
      estimatedBytes: row.estimatedBytes, frames: structuredClone(frames),
    };
  }

  async append(request: RecoveryStoreAppend): Promise<void> {
    assertSource(request.source);
    if (typeof request.idPrefix !== 'string'
      || typeof request.epoch !== 'string' || !request.epoch) {
      throw new Error('恢复日志身份无效');
    }
    assertFrames(request.frames);
    const frames = structuredClone([...request.frames]);
    const addedBytes = JSON.stringify(frames).length;
    const database = await this.activeDatabase();
    const journalKey = sourceKey(this.namespace, request.source.fingerprint);
    const transaction = database.transaction([JOURNALS, CHUNKS], 'readwrite');
    const completed = transactionDone(transaction);
    try {
      const journalStore = transaction.objectStore(JOURNALS);
      const chunkStore = transaction.objectStore(CHUNKS);
      const row = await requestResult(journalStore.get(journalKey) as IDBRequest<JournalRow | undefined>);
      if (!row || row.idPrefix !== request.idPrefix || row.epoch !== request.epoch
        || row.source.byteLength !== request.source.byteLength) {
        throw new Error('恢复追加与现有日志身份冲突');
      }
      assertFrames(frames, row.lastSequence);
      if (row.frameCount) {
        if (!row.lastChunkKey) throw new Error('恢复追加前缺少尾分块');
        const tail = await requestResult(
          chunkStore.get(row.lastChunkKey) as IDBRequest<ChunkRow | undefined>,
        );
        const tailFrames = tail ? validatedChunkFrames(journalKey, [tail]) : [];
        if (!tail || tailFrames[tailFrames.length - 1]?.sequence !== row.lastSequence) {
          throw new Error('恢复追加前尾分块元数据不一致');
        }
      } else if (row.lastSequence !== 0 || row.chunkCount !== 0 || row.lastChunkKey !== null) {
        throw new Error('空恢复日志元数据不一致');
      }
      const incoming: ChunkRow = {
        key: chunkKey(journalKey, frames[0].sequence), journalKey,
        firstSequence: frames[0].sequence,
        lastSequence: frames[frames.length - 1].sequence,
        frames,
      };
      let frameCount = row.frameCount + frames.length;
      let estimatedBytes = row.estimatedBytes + addedBytes;
      let chunkCount = row.chunkCount + 1;
      let lastChunkKey = incoming.key;
      if (chunkCount > this.compactAfterChunks) {
        const existing = await requestResult(chunkStore.index(JOURNAL_INDEX)
          .getAll(journalKey) as IDBRequest<ChunkRow[]>);
        const existingFrames = validatedChunkFrames(journalKey, existing);
        if (existing.length !== row.chunkCount || existingFrames.length !== row.frameCount
          || existingFrames[existingFrames.length - 1]?.sequence !== row.lastSequence) {
          throw new Error('恢复压缩前分块元数据不一致');
        }
        for (const chunk of existing) chunkStore.delete(chunk.key);
        const compacted = compactMetadataFrames([...existingFrames, ...frames]);
        const nextChunks = partitionChunks(journalKey, compacted, this.compactToChunks);
        frameCount = compacted.length;
        estimatedBytes = JSON.stringify(compacted).length;
        chunkCount = nextChunks.length;
        lastChunkKey = nextChunks[nextChunks.length - 1].key;
        for (const chunk of nextChunks) chunkStore.put(chunk);
      } else {
        chunkStore.add(incoming);
      }
      const now = this.now();
      if (!Number.isFinite(now)) throw new Error('恢复存储时钟无效');
      // 系统时钟可能被校准回拨；日志时间必须保持单调，才能继续作为恢复候选。
      const timestamp = Math.max(row.updatedAt, now);
      journalStore.put({
        key: journalKey, namespace: this.namespace, source: structuredClone(request.source),
        idPrefix: request.idPrefix, epoch: request.epoch,
        createdAt: row.createdAt, updatedAt: timestamp,
        estimatedBytes, frameCount,
        lastSequence: frames[frames.length - 1].sequence,
        chunkCount, lastChunkKey,
      } satisfies JournalRow);
      await completed;
    } catch (error) {
      try { transaction.abort(); } catch { /* 已中止或已提交。 */ }
      await completed.catch(() => undefined);
      throw error;
    }
    await this.cleanup(request.source.fingerprint);
  }

  async reset(request: RecoveryStoreReset): Promise<void> {
    assertSource(request.source);
    if (typeof request.idPrefix !== 'string'
      || typeof request.epoch !== 'string' || !request.epoch) {
      throw new Error('恢复日志身份无效');
    }
    if (request.signal?.aborted) throw request.signal.reason ?? new Error('恢复占位已取消');
    const database = await this.activeDatabase();
    const key = sourceKey(this.namespace, request.source.fingerprint);
    const transaction = database.transaction([JOURNALS, CHUNKS], 'readwrite');
    const completed = transactionDone(transaction);
    const abort = () => { try { transaction.abort(); } catch { /* 已结束。 */ } };
    request.signal?.addEventListener('abort', abort, { once: true });
    try {
      const journalStore = transaction.objectStore(JOURNALS);
      const chunkStore = transaction.objectStore(CHUNKS);
      const chunkKeys = await requestResult(chunkStore.index(JOURNAL_INDEX).getAllKeys(key));
      if (request.signal?.aborted) throw request.signal.reason ?? new Error('恢复占位已取消');
      for (const chunk of chunkKeys) chunkStore.delete(chunk);
      const timestamp = this.now();
      if (!Number.isFinite(timestamp)) throw new Error('恢复存储时钟无效');
      journalStore.put({
        key, namespace: this.namespace, source: structuredClone(request.source),
        idPrefix: request.idPrefix, epoch: request.epoch,
        createdAt: timestamp, updatedAt: timestamp, estimatedBytes: 0,
        frameCount: 0, lastSequence: 0, chunkCount: 0, lastChunkKey: null,
      } satisfies JournalRow);
      await completed;
    } catch (error) {
      try { transaction.abort(); } catch { /* 已中止或已提交。 */ }
      await completed.catch(() => undefined);
      throw error;
    } finally {
      request.signal?.removeEventListener('abort', abort);
    }
    await this.cleanup(request.source.fingerprint);
  }

  async remove(source: WebPptSourceIdentity): Promise<void> {
    assertSource(source);
    await this.removeKeys([sourceKey(this.namespace, source.fingerprint)]);
  }

  async stats(): Promise<RecoveryStoreStats> {
    const database = await this.activeDatabase();
    const transaction = database.transaction([JOURNALS, CHUNKS], 'readonly');
    const completed = transactionDone(transaction);
    const [allRows, allChunks] = await Promise.all([
      requestResult(transaction.objectStore(JOURNALS).getAll() as IDBRequest<JournalRow[]>),
      requestResult(transaction.objectStore(CHUNKS).getAll() as IDBRequest<ChunkRow[]>),
      completed,
    ]);
    const rows = allRows.filter((row) => row.namespace === this.namespace);
    const keys = new Set(rows.map((row) => row.key));
    return {
      journalCount: rows.length,
      chunkCount: allChunks.filter((chunk) => keys.has(chunk.journalKey)).length,
      frameCount: rows.reduce((total, row) => total + row.frameCount, 0),
      estimatedBytes: rows.reduce((total, row) => total + row.estimatedBytes, 0),
    };
  }

  async cleanup(
    preserveFingerprint?: WebPptSourceIdentity['fingerprint'],
  ): Promise<RecoveryCleanupResult> {
    const database = await this.activeDatabase();
    const transaction = database.transaction([JOURNALS, CHUNKS], 'readwrite');
    const completed = transactionDone(transaction);
    try {
      const journalStore = transaction.objectStore(JOURNALS);
      const chunkStore = transaction.objectStore(CHUNKS);
      const chunkIndex = chunkStore.index(JOURNAL_INDEX);
      const allRows = await requestResult(journalStore.getAll() as IDBRequest<JournalRow[]>);
      const preserveKey = preserveFingerprint
        ? sourceKey(this.namespace, preserveFingerprint) : null;
      const rows = allRows.filter((row) => row.namespace === this.namespace)
        .sort((left, right) => right.updatedAt - left.updatedAt || left.key.localeCompare(right.key));
      const expiredBefore = this.now() - this.retentionMs;
      const remove = new Set(rows.filter((row) => row.key !== preserveKey && row.updatedAt < expiredBefore));
      const preserved = rows.find((row) => row.key === preserveKey);
      let journals = preserved ? 1 : 0;
      let bytes = preserved?.estimatedBytes ?? 0;
      for (const row of rows) {
        if (remove.has(row) || row === preserved) continue;
        if (journals + 1 > this.maxJournals || bytes + row.estimatedBytes > this.maxBytes) {
          remove.add(row);
          continue;
        }
        journals++;
        bytes += row.estimatedBytes;
      }
      const removed = [...remove];
      for (const row of removed) {
        const chunkKeys = await requestResult(chunkIndex.getAllKeys(row.key));
        for (const key of chunkKeys) chunkStore.delete(key);
        journalStore.delete(row.key);
      }
      await completed;
      return {
        journalsRemoved: removed.length,
        estimatedBytesRemoved: removed.reduce((total, row) => total + row.estimatedBytes, 0),
      };
    } catch (error) {
      try { transaction.abort(); } catch { /* 已中止或已提交。 */ }
      await completed.catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    (await this.database)?.close();
  }

  private async open(): Promise<IDBDatabase> {
    const request = this.factory.open(this.databaseName, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(JOURNALS)) {
        database.createObjectStore(JOURNALS, { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains(CHUNKS)) {
        database.createObjectStore(CHUNKS, { keyPath: 'key' })
          .createIndex(JOURNAL_INDEX, 'journalKey', { unique: false });
      }
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      request.onsuccess = () => {
        if (settled) request.result.close();
        else { settled = true; resolve(request.result); }
      };
      request.onerror = () => {
        if (!settled) { settled = true; reject(request.error ?? new Error('无法打开恢复 IndexedDB')); }
      };
      request.onblocked = () => {
        if (!settled) { settled = true; reject(new Error('恢复 IndexedDB 升级被其它页面阻塞')); }
      };
    });
    database.onversionchange = () => {
      this.closed = true;
      database.close();
    };
    return database;
  }

  private async activeDatabase(): Promise<IDBDatabase> {
    if (this.closed) throw new Error('IndexedDB 恢复存储已经关闭');
    this.database ??= this.open();
    return this.database;
  }

  private async removeKeys(keys: readonly string[]): Promise<void> {
    if (!keys.length) return;
    const database = await this.activeDatabase();
    const transaction = database.transaction([JOURNALS, CHUNKS], 'readwrite');
    const completed = transactionDone(transaction);
    try {
      const journalStore = transaction.objectStore(JOURNALS);
      const chunkStore = transaction.objectStore(CHUNKS);
      const index = chunkStore.index(JOURNAL_INDEX);
      for (const key of keys) {
        const chunkKeys = await requestResult(index.getAllKeys(key));
        for (const chunk of chunkKeys) chunkStore.delete(chunk);
        journalStore.delete(key);
      }
      await completed;
    } catch (error) {
      try { transaction.abort(); } catch { /* 已中止或已提交。 */ }
      await completed.catch(() => undefined);
      throw error;
    }
  }
}

export function createIndexedDbRecoveryStore(
  options: IndexedDbRecoveryStoreOptions = {},
): IndexedDbRecoveryStore {
  return new BrowserIndexedDbRecoveryStore(options);
}
