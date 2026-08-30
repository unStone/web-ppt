import { cloneSelection } from './selection';
import type { History, HistoryEntry, Patch } from './commands/types';

const encoder = new TextEncoder();

interface StoredHistoryEntry extends HistoryEntry {
  readonly beforeState: number;
  readonly afterState: number;
  readonly links: readonly StoredPatchLink[];
}

interface StoredPatchLink { readonly trigger: string; readonly related: readonly string[] }

export interface HistoryPatchLink {
  readonly trigger: Patch['path'];
  readonly related: readonly Patch['path'][];
}

export interface HistoryStoreHooks {
  /** 不复制进 Patch、但仅因历史可达而常驻的外部资源字节。 */
  readonly externalByteSize?: (entries: readonly HistoryEntry[]) => number;
  /** 历史驱逐/清空后通知资源所有者做可达性回收。 */
  readonly changed?: (entries: readonly HistoryEntry[]) => void;
}

const clonePatch = <P extends Patch>(patch: P): P => ({
  ...patch,
  path: [...patch.path],
  ...('value' in patch && typeof patch.value === 'object'
    ? { value: structuredClone(patch.value) } : {}),
} as P);

export function cloneHistoryEntry(entry: HistoryEntry): HistoryEntry {
  // 一对结构 patch 共用同一快照；一次 structuredClone 才能保留资源闭包的共享身份。
  const patches = structuredClone({ forward: entry.forward, inverse: entry.inverse });
  return {
    forward: patches.forward,
    inverse: patches.inverse,
    selectionBefore: cloneSelection(entry.selectionBefore),
    selectionAfter: cloneSelection(entry.selectionAfter),
    label: entry.label,
    time: entry.time,
    ...(entry.mergeKey ? { mergeKey: entry.mergeKey } : {}),
    affectedSlides: [...entry.affectedSlides],
  };
}

const pathKey = (patch: Patch): string => JSON.stringify(patch.path);

function pathContains(left: Patch['path'], right: Patch['path']): boolean {
  return left.length <= right.length && left.every((segment, index) => segment === right[index]);
}

const pathsConflict = (left: Patch['path'], right: Patch['path']): boolean =>
  pathContains(left, right) || pathContains(right, left);

function affectedPatchPaths(patch: Patch): Patch['path'][] {
  const affected: Patch['path'][] = [patch.path];
  const value = 'value' in patch && patch.value && typeof patch.value === 'object'
    ? patch.value as { records?: Readonly<Record<string, unknown>>; affected?: readonly string[] }
    : null;
  if (patch.path[0] === 'slides' && patch.path.length === 2) {
    affected.push(['slideOrder', patch.path[1]]);
    for (const id of Object.keys(value?.records ?? {})) affected.push(['elements', id]);
  } else if (patch.path[0] === 'elements' && patch.path.length === 2) {
    for (const id of Object.keys(value?.records ?? {})) affected.push(['elements', id]);
  } else if (patch.path[0] === 'elements' && patch.path[2] === 'hierarchy') {
    for (const id of value?.affected ?? Object.keys(value?.records ?? {})) affected.push(['elements', id]);
  }
  return affected;
}

/** Patch 是绝对 set/del；同一路径的连续编辑只需最终正向值与最初逆向值。 */
function compactPatches(patches: readonly Patch[]): Patch[] {
  const output: Patch[] = [];
  const positions = new Map<string, number>();
  for (const patch of patches) {
    const key = pathKey(patch);
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, output.length);
      output.push(clonePatch(patch));
    } else output[position] = clonePatch(patch);
  }
  return output;
}

function canMerge(previous: HistoryEntry, next: HistoryEntry): boolean {
  if (!previous.mergeKey || previous.mergeKey !== next.mergeKey) return false;
  if (previous.affectedSlides.length !== 1 || next.affectedSlides.length !== 1) return false;
  const elapsed = next.time - previous.time;
  if (elapsed < 0 || elapsed > 500) return false;
  if (previous.affectedSlides.length !== next.affectedSlides.length
    || previous.affectedSlides.some((slide, index) => slide !== next.affectedSlides[index])) return false;
  const previousPaths = new Set(previous.forward.map(pathKey));
  return next.forward.some((patch) => previousPaths.has(pathKey(patch)));
}

function storeLinks(links: readonly HistoryPatchLink[]): StoredPatchLink[] {
  const byTrigger = new Map<string, Set<string>>();
  for (const link of links) {
    const trigger = JSON.stringify(link.trigger);
    const related = byTrigger.get(trigger) ?? new Set<string>();
    link.related.forEach((path) => related.add(JSON.stringify(path)));
    byTrigger.set(trigger, related);
  }
  return [...byTrigger].map(([trigger, related]) => ({ trigger, related: [...related] }));
}

function mergeLinks(...groups: readonly (readonly StoredPatchLink[])[]): StoredPatchLink[] {
  const byTrigger = new Map<string, Set<string>>();
  for (const links of groups) for (const link of links) {
    const related = byTrigger.get(link.trigger) ?? new Set<string>();
    link.related.forEach((path) => related.add(path));
    byTrigger.set(link.trigger, related);
  }
  return [...byTrigger].map(([trigger, related]) => ({ trigger, related: [...related] }));
}

function survivingLinks(links: readonly StoredPatchLink[], forward: readonly Patch[]): StoredPatchLink[] {
  const paths = new Set(forward.map(pathKey));
  return links.flatMap((link) => {
    if (!paths.has(link.trigger)) return [];
    const related = link.related.filter((path) => paths.has(path));
    return related.length ? [{ trigger: link.trigger, related }] : [];
  });
}

export class HistoryStore implements History {
  private readonly undoList: StoredHistoryEntry[] = [];
  private readonly redoList: StoredHistoryEntry[] = [];
  private readonly limit: number;
  private readonly byteLimit: number;
  private readonly hooks: HistoryStoreHooks;
  private bytes = 0;
  private externalBytes = 0;
  private mergeBarrier = false;

  constructor(limit = 200, byteLimit = 8 * 1024 * 1024, hooks: HistoryStoreHooks = {}) {
    if (!Number.isInteger(limit) || limit < 0) throw new Error('历史深度必须是非负整数');
    if (!Number.isInteger(byteLimit) || byteLimit < 0) throw new Error('历史字节上限必须是非负整数');
    this.limit = limit;
    this.byteLimit = byteLimit;
    this.hooks = hooks;
  }

  get undoCount(): number { return this.undoList.length; }
  get redoCount(): number { return this.redoList.length; }
  get byteSize(): number { return this.bytes + this.externalBytes; }
  get undoEntries(): readonly HistoryEntry[] { return this.undoList.map(cloneHistoryEntry); }
  get redoEntries(): readonly HistoryEntry[] { return this.redoList.map(cloneHistoryEntry); }

  clear(): void {
    this.undoList.length = 0;
    this.redoList.length = 0;
    this.bytes = 0;
    this.externalBytes = 0;
    this.hooks.changed?.([]);
  }

  breakMerge(): void { this.mergeBarrier = true; }

  /** 后到的非记录写入胜出；旧历史只保留未冲突路径，避免撤销覆盖远端或系统改动。 */
  rebaseUnrecorded(patches: readonly Patch[], currentState: number, allocateState: () => number): void {
    const patchPaths = patches.flatMap(affectedPatchPaths);
    const paths = new Set(patchPaths.map((path) => JSON.stringify(path)));
    if (!paths.size) return;
    const strip = (list: StoredHistoryEntry[]): void => {
      for (let index = list.length - 1; index >= 0; index--) {
        const entry = list[index];
        const linked = new Set(entry.links
          .filter((link) => paths.has(link.trigger))
          .flatMap((link) => link.related));
        const conflicts = (patch: Patch): boolean => patchPaths.some((path) => pathsConflict(path, patch.path))
          || linked.has(pathKey(patch));
        const forward = entry.forward.filter((patch) => !conflicts(patch));
        if (forward.length === entry.forward.length) continue;
        const inverse = entry.inverse.filter((patch) => !conflicts(patch));
        this.bytes -= this.sizeOf(entry);
        if (!forward.length) list.splice(index, 1);
        else {
          list[index] = { ...entry, forward, inverse, links: survivingLinks(entry.links, forward) };
          this.bytes += this.sizeOf(list[index]);
        }
      }
    };
    strip(this.undoList);
    strip(this.redoList);
    let state = currentState;
    for (let index = this.undoList.length - 1; index >= 0; index--) {
      const beforeState = allocateState();
      this.undoList[index] = { ...this.undoList[index], beforeState, afterState: state };
      state = beforeState;
    }
    state = currentState;
    for (let index = this.redoList.length - 1; index >= 0; index--) {
      const afterState = allocateState();
      this.redoList[index] = { ...this.redoList[index], beforeState: state, afterState };
      state = afterState;
    }
    this.rebudget();
    this.breakMerge();
  }

  push(
    entry: HistoryEntry,
    beforeState: number,
    afterState: number,
    links: readonly HistoryPatchLink[] = [],
  ): void {
    const next: StoredHistoryEntry = {
      ...cloneHistoryEntry(entry), beforeState, afterState, links: storeLinks(links),
    };
    const previous = this.peekUndo();
    if (!this.mergeBarrier && previous && canMerge(previous, next)) {
      const merged: StoredHistoryEntry = {
        ...next,
        forward: compactPatches([...previous.forward, ...next.forward]),
        inverse: compactPatches([...next.inverse, ...previous.inverse]),
        selectionBefore: cloneSelection(previous.selectionBefore),
        beforeState: previous.beforeState,
        links: mergeLinks(previous.links, next.links),
      };
      this.bytes -= this.sizeOf(previous);
      this.undoList[this.undoList.length - 1] = merged;
      this.bytes += this.sizeOf(merged);
    } else {
      this.undoList.push(next);
      this.bytes += this.sizeOf(next);
    }
    this.mergeBarrier = false;
    for (const redo of this.redoList) this.bytes -= this.sizeOf(redo);
    this.redoList.length = 0;
    this.rebudget();
  }

  peekUndo(): StoredHistoryEntry | null { return this.undoList[this.undoList.length - 1] ?? null; }
  peekRedo(): StoredHistoryEntry | null { return this.redoList[this.redoList.length - 1] ?? null; }

  moveToRedo(): void {
    const entry = this.undoList.pop();
    if (entry) this.redoList.push(entry);
    this.rebudget();
    this.breakMerge();
  }

  moveToUndo(): void {
    const entry = this.redoList.pop();
    if (entry) this.undoList.push(entry);
    this.rebudget();
    this.breakMerge();
  }

  private entries(): readonly StoredHistoryEntry[] {
    return [...this.undoList, ...this.redoList];
  }

  private rebudget(): void {
    const measure = (): void => {
      const value = this.hooks.externalByteSize?.(this.entries()) ?? 0;
      this.externalBytes = Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
    };
    measure();
    while (this.undoList.length + this.redoList.length > this.limit
      || this.bytes + this.externalBytes > this.byteLimit) {
      const removed = this.undoList.shift() ?? this.redoList.shift();
      if (!removed) break;
      this.bytes -= this.sizeOf(removed);
      measure();
    }
    this.hooks.changed?.(this.entries());
  }

  private sizeOf(entry: HistoryEntry): number {
    const stored = entry as Partial<StoredHistoryEntry>;
    const seen = new WeakSet<object>();
    // 计量只读遍历即可；结构历史可能携带整页 XML，先深拷贝会把一次提交放大成双份峰值内存。
    return encoder.encode(JSON.stringify({
      forward: entry.forward,
      inverse: entry.inverse,
      selectionBefore: entry.selectionBefore,
      selectionAfter: entry.selectionAfter,
      label: entry.label,
      time: entry.time,
      ...(entry.mergeKey ? { mergeKey: entry.mergeKey } : {}),
      affectedSlides: entry.affectedSlides,
      links: stored.links ?? [],
    }, (_key, value) => {
      if (!value || typeof value !== 'object') return value;
      if (seen.has(value)) return null;
      seen.add(value);
      return value;
    })).length;
  }
}
