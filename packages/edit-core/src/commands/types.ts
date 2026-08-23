import type { ElementId, ProjectionInvalidation, SlideId } from '../types';

export type NumericXfrmField = 'x' | 'y' | 'w' | 'h' | 'rot';
export type FlipField = 'flipH' | 'flipV';
export type XfrmField = NumericXfrmField | FlipField;
export interface XfrmValueByField {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
}
export type ElementXfrmPath<F extends XfrmField = XfrmField> =
  readonly ['elements', ElementId, 'ovr', F];

export interface SetXfrmCommand {
  readonly type: 'SetXfrm';
  readonly id: ElementId;
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
  readonly rot?: number;
}

export interface SetFlipCommand {
  readonly type: 'SetFlip';
  readonly id: ElementId;
  readonly h?: boolean;
  readonly v?: boolean;
}

export type Command = SetXfrmCommand | SetFlipCommand;

type SetXfrmPatch = { [F in XfrmField]: {
  readonly op: 'set';
  readonly path: ElementXfrmPath<F>;
  readonly value: XfrmValueByField[F];
  readonly origin: string;
} }[XfrmField];
type DeleteXfrmPatch = { [F in XfrmField]: {
  readonly op: 'del';
  readonly path: ElementXfrmPath<F>;
  readonly origin: string;
} }[XfrmField];
export type Patch = SetXfrmPatch | DeleteXfrmPatch;

export interface CommandPatches {
  readonly forward: Patch[];
  readonly inverse: Patch[];
}

export interface TextPosition {
  readonly p: number;
  readonly r: number;
  readonly off: number;
}

export type Selection =
  | { readonly kind: 'none' }
  | { readonly kind: 'elements'; readonly ids: readonly ElementId[]; readonly enteredGroup: ElementId | null }
  | { readonly kind: 'text'; readonly id: ElementId; readonly anchor: TextPosition; readonly focus: TextPosition }
  | { readonly kind: 'table'; readonly id: ElementId; readonly cells: readonly { r: number; c: number }[] };

export interface HistoryEntry extends CommandPatches {
  readonly selectionBefore: Selection;
  readonly selectionAfter: Selection;
  readonly label: string;
  readonly time: number;
  readonly mergeKey?: string;
  readonly affectedSlides: readonly SlideId[];
}

export interface History {
  readonly undoCount: number;
  readonly redoCount: number;
  readonly byteSize: number;
  readonly undoEntries: readonly HistoryEntry[];
  readonly redoEntries: readonly HistoryEntry[];
  clear(): void;
}

export interface TransactionResult extends ProjectionInvalidation, CommandPatches {
  readonly selection: Selection;
}

export interface EditorChange extends ProjectionInvalidation {
  readonly source: 'transaction' | 'undo' | 'redo' | 'selection';
  readonly selection: Selection;
  /** dirtyElements 含投影缓存祖先；DOM 增量分区必须以真正被 patch 的元素为准。 */
  readonly touchedElements: Set<ElementId>;
}

export type EditorSubscriber = (change: EditorChange) => void;

export interface Transaction {
  exec(...commands: Command[]): void;
  select(selection: Selection): void;
}

export interface TransactionOptions {
  readonly origin?: string;
  readonly recordHistory?: boolean;
  readonly mergeKey?: string;
  readonly time?: number;
}

export interface EditorOptions {
  readonly origin?: string;
  readonly historyLimit?: number;
  readonly historyByteLimit?: number;
}
