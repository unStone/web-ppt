import { cloneSelection } from './selection';
import type { History, HistoryEntry, Patch } from './commands/types';

const encoder = new TextEncoder();

interface StoredHistoryEntry extends HistoryEntry {
  readonly beforeState: number;
  readonly afterState: number;
}

const clonePatch = <P extends Patch>(patch: P): P => ({
  ...patch,
  path: [...patch.path],
  ...('value' in patch && typeof patch.value === 'object'
    ? { value: structuredClone(patch.value) } : {}),
} as P);

export function cloneHistoryEntry(entry: HistoryEntry): HistoryEntry {
  return {
    forward: entry.forward.map(clonePatch),
    inverse: entry.inverse.map(clonePatch),
    selectionBefore: cloneSelection(entry.selectionBefore),
    selectionAfter: cloneSelection(entry.selectionAfter),
    label: entry.label,
    time: entry.time,
    ...(entry.mergeKey ? { mergeKey: entry.mergeKey } : {}),
    affectedSlides: [...entry.affectedSlides],
  };
}

const pathKey = (patch: Patch): string => JSON.stringify(patch.path);

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

export class HistoryStore implements History {
  private readonly undoList: StoredHistoryEntry[] = [];
  private readonly redoList: StoredHistoryEntry[] = [];
  private readonly limit: number;
  private readonly byteLimit: number;
  private bytes = 0;
  private mergeBarrier = false;

  constructor(limit = 200, byteLimit = 8 * 1024 * 1024) {
    if (!Number.isInteger(limit) || limit < 0) throw new Error('历史深度必须是非负整数');
    if (!Number.isInteger(byteLimit) || byteLimit < 0) throw new Error('历史字节上限必须是非负整数');
    this.limit = limit;
    this.byteLimit = byteLimit;
  }

  get undoCount(): number { return this.undoList.length; }
  get redoCount(): number { return this.redoList.length; }
  get byteSize(): number { return this.bytes; }
  get undoEntries(): readonly HistoryEntry[] { return this.undoList.map(cloneHistoryEntry); }
  get redoEntries(): readonly HistoryEntry[] { return this.redoList.map(cloneHistoryEntry); }

  clear(): void {
    this.undoList.length = 0;
    this.redoList.length = 0;
    this.bytes = 0;
  }

  breakMerge(): void { this.mergeBarrier = true; }

  /** 后到的非记录写入胜出；旧历史只保留未冲突路径，避免撤销覆盖远端或系统改动。 */
  rebaseUnrecorded(patches: readonly Patch[], currentState: number, allocateState: () => number): void {
    const paths = new Set(patches.map(pathKey));
    if (!paths.size) return;
    const strip = (list: StoredHistoryEntry[]): void => {
      for (let index = list.length - 1; index >= 0; index--) {
        const entry = list[index];
        const forward = entry.forward.filter((patch) => !paths.has(pathKey(patch)));
        if (forward.length === entry.forward.length) continue;
        const inverse = entry.inverse.filter((patch) => !paths.has(pathKey(patch)));
        this.bytes -= this.sizeOf(entry);
        if (!forward.length) list.splice(index, 1);
        else {
          list[index] = { ...entry, forward, inverse };
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
    this.breakMerge();
  }

  push(entry: HistoryEntry, beforeState: number, afterState: number): void {
    const next: StoredHistoryEntry = { ...cloneHistoryEntry(entry), beforeState, afterState };
    const previous = this.peekUndo();
    if (!this.mergeBarrier && previous && canMerge(previous, next)) {
      const merged: StoredHistoryEntry = {
        ...next,
        forward: compactPatches([...previous.forward, ...next.forward]),
        inverse: compactPatches([...next.inverse, ...previous.inverse]),
        selectionBefore: cloneSelection(previous.selectionBefore),
        beforeState: previous.beforeState,
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
    while (this.undoList.length > this.limit || this.bytes > this.byteLimit) {
      const removed = this.undoList.shift();
      if (!removed) break;
      this.bytes -= this.sizeOf(removed);
    }
  }

  peekUndo(): StoredHistoryEntry | null { return this.undoList[this.undoList.length - 1] ?? null; }
  peekRedo(): StoredHistoryEntry | null { return this.redoList[this.redoList.length - 1] ?? null; }

  moveToRedo(): void {
    const entry = this.undoList.pop();
    if (entry) this.redoList.push(entry);
    this.breakMerge();
  }

  moveToUndo(): void {
    const entry = this.redoList.pop();
    if (entry) this.undoList.push(entry);
    this.breakMerge();
  }

  private sizeOf(entry: HistoryEntry): number {
    return encoder.encode(JSON.stringify(cloneHistoryEntry(entry))).length;
  }
}
