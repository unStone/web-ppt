import type { GeomSpec, SlideElement } from '@web-ppt/core';
import type {
  EditableKind, ElementId, ElementRecord, ParagraphPropertyOverrides, ProjectionInvalidation,
  RunPropertyOverrides, SlideId, TextFragment, TextOverride,
  TableCellAddress, TextBodyPropertyOverrides,
} from '../types';
import type { AffineMatrix } from '../space';

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

export interface RemoveElementCommand {
  readonly type: 'RemoveElement';
  readonly id: ElementId;
}

export type ElementLayerTarget = 'front' | 'back' | 'forward' | 'backward';

export interface SetZCommand {
  readonly type: 'SetZ';
  readonly id: ElementId;
  readonly to: ElementLayerTarget;
}

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export interface AlignElementsCommand {
  readonly type: 'AlignElements';
  readonly ids: readonly ElementId[];
  readonly edge: AlignEdge;
}

export interface ElementClipboardRecordMeta {
  /** 同一次复制操作的来源证明；粘贴时用来拒绝拼接多个来源的伪造树。 */
  readonly copyBatchId: string;
  readonly editable: EditableKind;
  readonly anchored: boolean;
  readonly sourceSpid?: number;
  readonly geom?: GeomSpec;
  /** 复制时根元素的 frame → slide 视觉矩阵；后代不需要重复携带。 */
  readonly frameToSlide?: AffineMatrix;
}

export interface ClipboardXmlRoot {
  readonly markup: string;
  readonly namespaces: Readonly<Record<string, string>>;
  readonly hostSpids: readonly string[];
  readonly relationships?: readonly ClipboardRelationship[];
}

export interface ClipboardRelationship {
  /** 宿主片段中原始的 r:id / r:embed / r:link 值。 */
  readonly sourceId: string;
  readonly type: string;
  readonly target?: string;
  readonly targetMode?: 'External';
  readonly resourceHash?: string;
  /** 复杂 OOXML 对象只在目标包拥有同一闭包时复用，不把未知格式静默扁平化。 */
  readonly packageTarget?: {
    /** 根内容与关系图都不包含 part 路径，目标包据此重新定位等价闭包。 */
    readonly rootHash: string;
    readonly closureHash: string;
  };
}

export interface ClipboardElementRecord {
  readonly id: string;
  readonly parent: string | null;
  readonly src: SlideElement;
  readonly meta: ElementClipboardRecordMeta;
  readonly children: readonly string[];
}

export interface ClipboardResource {
  readonly hash: string;
  readonly mime: string;
  readonly extension: string;
  readonly bytes: string;
}

export interface ElementClipboardPayload {
  readonly format: 'web-ppt-elements';
  readonly version: 1;
  readonly source: { readonly width: number; readonly height: number; readonly copyBatchId: string };
  readonly bounds: { readonly left: number; readonly top: number };
  readonly roots: readonly string[];
  readonly records: Readonly<Record<string, ClipboardElementRecord>>;
  readonly ooxml: { readonly roots: Readonly<Record<string, ClipboardXmlRoot>> };
  readonly resources: readonly ClipboardResource[];
}

export interface PasteElementsCommand {
  readonly type: 'PasteElements';
  readonly payload: ElementClipboardPayload;
  readonly at: { readonly parentId: SlideId | ElementId; readonly x: number; readonly y: number };
}

export type TextEditOp = {
  readonly type: 'replace';
  readonly from: TextPosition;
  readonly to: TextPosition;
  readonly text: string;
} | {
  readonly type: 'splitParagraph';
  readonly at: TextPosition;
} | {
  readonly type: 'insertLineBreak';
  readonly at: TextPosition;
} | {
  readonly type: 'replaceFragment';
  readonly from: TextPosition;
  readonly to: TextPosition;
  readonly fragment: TextFragment;
};

export interface EditTextCommand {
  readonly type: 'EditText';
  readonly id: ElementId;
  readonly cell?: TableCellAddress;
  /** 操作按数组顺序作用于前一个操作的结果，便于 beforeinput 批量提交。 */
  readonly ops: readonly TextEditOp[];
}

export interface TextRange {
  readonly from: TextPosition;
  readonly to: TextPosition;
}

export interface SetRunPropsCommand {
  readonly type: 'SetRunProps';
  readonly id: ElementId;
  readonly cell?: TableCellAddress;
  readonly range: TextRange;
  readonly props: RunPropertyOverrides;
}

export interface SetParaPropsCommand {
  readonly type: 'SetParaProps';
  readonly id: ElementId;
  readonly cell?: TableCellAddress;
  readonly range: TextRange;
  readonly props: ParagraphPropertyOverrides;
}

export interface FitTextShapeCommand {
  readonly type: 'FitTextShape';
  readonly id: ElementId;
}

export interface SetBodyPropsCommand {
  readonly type: 'SetBodyProps';
  readonly id: ElementId;
  readonly props: TextBodyPropertyOverrides;
}

export type Command = SetXfrmCommand | SetFlipCommand | RemoveElementCommand | SetZCommand
  | AlignElementsCommand | PasteElementsCommand | EditTextCommand | SetRunPropsCommand | SetParaPropsCommand
  | FitTextShapeCommand | SetBodyPropsCommand;

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
export type ElementTransformPatch = SetXfrmPatch | DeleteXfrmPatch;

export type ElementTextPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'text'];
  readonly value: TextOverride;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'text'];
  readonly origin: string;
} | {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'tableCells', number, number, 'text'];
  readonly value: TextOverride;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'tableCells', number, number, 'text'];
  readonly origin: string;
};

export type ElementOrderPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'order'];
  readonly value: string;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'order'];
  readonly origin: string;
};

export interface ElementTreeSnapshot {
  readonly root: ElementId;
  readonly parent: SlideId | ElementId;
  readonly records: Readonly<Record<ElementId, ElementRecord>>;
}

export type ElementTreePatch = {
  readonly op: 'remove' | 'insert';
  readonly path: readonly ['elements', ElementId];
  readonly value: ElementTreeSnapshot;
  readonly origin: string;
};

export type Patch = ElementTransformPatch | ElementTextPatch | ElementOrderPatch | ElementTreePatch;

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
  | { readonly kind: 'text'; readonly id: ElementId; readonly cell?: TableCellAddress; readonly anchor: TextPosition; readonly focus: TextPosition }
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
  /** 需要重新生成 markup/defs 的元素；纯层级 patch 不进入这里。 */
  readonly renderElements: Set<ElementId>;
  /** bodyPr 有效值变化；活动文字面必须同步刷新被延迟的静态分区。 */
  readonly bodyPropsElements: Set<ElementId>;
  /** 只需移动既有 DOM 分区的元素；可与 renderElements 重叠。 */
  readonly reorderedElements: Set<ElementId>;
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
