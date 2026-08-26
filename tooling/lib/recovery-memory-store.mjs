/** 可替换 RecoveryStore 的确定性参考实现；测试只通过公共 seam 观察行为。 */
export function createMemoryRecoveryStore() {
  const records = new Map();
  const store = {
    async load(identity) { return structuredClone(records.get(identity.fingerprint) ?? null); },
    async reset(request) {
      if (request.signal?.aborted) throw request.signal.reason;
      const time = Date.now();
      records.set(request.source.fingerprint, {
        version: 1, source: structuredClone(request.source), idPrefix: request.idPrefix,
        epoch: request.epoch, createdAt: time, updatedAt: time, estimatedBytes: 0, frames: [],
      });
    },
    async append(request) {
      const current = records.get(request.source.fingerprint);
      if (!current || current.idPrefix !== request.idPrefix || current.epoch !== request.epoch) {
        throw new Error('恢复日志代际冲突');
      }
      const frames = [...current.frames, ...structuredClone(request.frames)];
      records.set(request.source.fingerprint, {
        version: 1, source: structuredClone(request.source), idPrefix: request.idPrefix,
        epoch: request.epoch, createdAt: current.createdAt,
        updatedAt: Math.max(current.updatedAt, request.frames.at(-1).time),
        estimatedBytes: JSON.stringify(frames).length, frames,
      });
    },
    async remove(identity) { records.delete(identity.fingerprint); },
  };
  return { records, store };
}
