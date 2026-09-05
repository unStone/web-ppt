import type { CellBorders, Effects, Fill, Stroke, TableCell } from '@web-ppt/core';
import type {
  DesignTarget, EditIdentity, ElementId, ElementImageReplacement, ElementInsertionResource, ElementRecord, ImageCrop, LinkOverride, LinkTarget, ParagraphPropertyInput, ProjectionInvalidation,
  RunPropertyOverrides, SlideId, TextFragment, TextOverride,
  SlideRecord, TableCellAddress, TextBodyPropertyOverrides,
} from '../types';
import type { ElementClipboardPayload } from './clipboard-types';
import type { ElementHierarchyPatch, GroupCommand, UngroupCommand } from './group-types';
import type {
  ConvertToCustomGeometryCommand, ElementGeometryPatch, ElementPresetGeometryPatch,
  SetAdjCommand, SetGeometryCommand, SetPresetCommand,
} from './geometry-types';
import type {
  SetBackgroundCommand, SetBackgroundCropCommand, SetBackgroundImageCommand, SetHiddenCommand,
  SetAnimationsCommand, SetTransitionCommand,
  SetLayoutCommand, SetNotesCommand, LayoutPropertyPatch, MasterBackgroundPatch, SlideLayoutPatch,
  SlideNotesPatch, SlidePropertyPatch,
} from './slide-property-types';
import type { ApplyFormatCommand } from './format-painter-types';
import type { ReplaceTextCommand } from '../text-search-types';
import type { ElementTableStylePatch, SetTableStyleCommand } from './table-style-types';
import type {
  AddSectionCommand, DistributeElementsCommand, DocumentSizePatch, ElementAltTextPatch,
  MoveSectionCommand, RemoveSectionCommand, RenameSectionCommand, SectionStatePatch,
  SetAltTextCommand, SetSlideSizeCommand,
} from './common-object-slide-types';
import type { SetThemeCommand, ThemePatch } from './theme-types';
import type { MasterTextStylePatch, SetMasterTextStyleCommand } from './master-text-style-types';

export type {
  ClipboardElementRecord, ClipboardPortableLink, ClipboardRelationship, ClipboardResource,
  ClipboardTextLink, ClipboardXmlRoot, ElementClipboardPayload, ElementClipboardRecordMeta,
} from './clipboard-types';
export type {
  SetBackgroundCommand, SetBackgroundCropCommand, SetBackgroundImageCommand, SetHiddenCommand,
  SetAnimationsCommand, SetTransitionCommand, SetLayoutCommand, SlideAnimationsPatch, SlideBackgroundImagePatch, SlideBackgroundPatch, SlideHiddenPatch,
  SlideTransitionPatch, LayoutBackgroundPatch, LayoutTransitionPatch, LayoutPropertyPatch,
  MasterBackgroundPatch,
  SetNotesCommand, SlideLayoutPatch, SlideNotesPatch, SlidePropertyPatch,
} from './slide-property-types';
export type { ApplyFormatCommand, FormatMaskField } from './format-painter-types';
export type {
  ElementHierarchyPatch, ElementHierarchyState, GroupCommand, UngroupCommand,
} from './group-types';
export type { ReplaceTextCommand, ReplaceTextScope } from '../text-search-types';
export type { ElementTableStylePatch, SetTableStyleCommand } from './table-style-types';
export type {
  AddSectionCommand, DistributeElementsCommand, DocumentSizePatch, ElementAltTextPatch,
  MoveSectionCommand, RemoveSectionCommand, RenameSectionCommand, SectionStatePatch,
  SetAltTextCommand, SetSlideSizeCommand,
} from './common-object-slide-types';
export type { SetThemeCommand, ThemeColorPatch, ThemeFontPatch, ThemePatch } from './theme-types';
export type {
  MasterParagraphTextStylePatch, MasterRunTextStylePatch, MasterTextStylePatch,
  SetMasterTextStyleCommand,
} from './master-text-style-types';

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

export interface SetNameCommand {
  readonly type: 'SetName';
  readonly id: ElementId;
  /** null 删除本次会话的名称覆盖并恢复来源 cNvPr@name。 */
  readonly name: string | null;
}

export interface SetLockedCommand {
  readonly type: 'SetLocked';
  readonly id: ElementId;
  readonly locked: boolean;
}

export interface SetElementHiddenCommand {
  readonly type: 'SetElementHidden';
  readonly id: ElementId;
  readonly hidden: boolean;
}

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export interface AlignElementsCommand {
  readonly type: 'AlignElements';
  readonly ids: readonly ElementId[];
  readonly edge: AlignEdge;
}

export interface PasteElementsCommand {
  readonly type: 'PasteElements';
  readonly payload: ElementClipboardPayload;
  readonly at: { readonly parentId: SlideId | ElementId; readonly x: number; readonly y: number };
}

interface AddShapeFields {
  readonly type: 'AddShape';
  readonly preset: string;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export type AddShapeCommand = AddShapeFields & ({
  readonly slideId: SlideId;
  readonly target?: never;
} | {
  readonly target: DesignTarget;
  readonly slideId?: never;
});

interface AddImageFields {
  readonly type: 'AddImage';
  /** 空图片占位符可由同一历史单元原子替换。 */
  readonly placeholderId?: ElementId;
  readonly bytes: Uint8Array;
  readonly mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export type AddImageCommand = AddImageFields & ({
  readonly slideId: SlideId;
  readonly target?: never;
} | {
  readonly target: DesignTarget;
  readonly slideId?: never;
});

export interface ReplaceImageCommand {
  readonly type: 'ReplaceImage';
  readonly id: ElementId;
  readonly bytes: Uint8Array;
  readonly mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

export interface SetCropCommand {
  readonly type: 'SetCrop';
  readonly id: ElementId;
  /** null 恢复来源；全零对象明确写出不裁剪。 */
  readonly crop: ImageCrop | null;
}

interface AddTableFields {
  readonly type: 'AddTable';
  readonly rows: number;
  readonly cols: number;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** 空内容占位符可由同一历史单元原子替换。 */
  readonly placeholderId?: ElementId;
}

export type AddTableCommand = AddTableFields & ({
  readonly slideId: SlideId;
  readonly target?: never;
} | {
  readonly target: DesignTarget;
  readonly slideId?: never;
});

export interface AddSlideCommand {
  readonly type: 'AddSlide';
  readonly layoutId: string;
  /** null 表示插入到第一位；稳定页身份比瞬时数组下标更适合框架与协同边界。 */
  readonly at: { readonly after: SlideId | null };
}

export interface MoveSlideCommand {
  readonly type: 'MoveSlide';
  readonly id: SlideId;
  /** null 表示置首；稳定身份锚点避免页下标在插入后漂移。 */
  readonly at: { readonly after: SlideId | null };
}

export interface RemoveSlideCommand {
  readonly type: 'RemoveSlide';
  readonly id: SlideId;
}

export interface DuplicateSlideCommand {
  readonly type: 'DuplicateSlide';
  readonly id: SlideId;
}

export interface SetFillCommand {
  readonly type: 'SetFill';
  readonly id: ElementId;
  /** null 删除直接覆盖；显式无填充使用 { type: 'none' }。 */
  readonly fill: Exclude<Fill, { type: 'image' }> | null;
}

export interface SetStrokeCommand {
  readonly type: 'SetStroke';
  readonly id: ElementId;
  /** null 恢复来源；{type:'none'} 形成显式无描边。 */
  readonly stroke: Stroke | { readonly type: 'none' } | null;
}

export interface SetEffectsCommand {
  readonly type: 'SetEffects';
  readonly id: ElementId;
  /** null 恢复继承；空对象明确写出无效果。 */
  readonly effects: Effects | null;
}

export interface SetLinkCommand {
  readonly type: 'SetLink';
  readonly id: ElementId;
  /** null 恢复来源；{kind:'none'} 明确移除当前元素链接。 */
  readonly target: LinkTarget | { readonly kind: 'none' } | null;
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

export interface ClearFormatCommand {
  readonly type: 'ClearFormat';
  readonly id: ElementId;
  readonly cell?: TableCellAddress;
  readonly range: TextRange;
}

export interface SetParaPropsCommand {
  readonly type: 'SetParaProps';
  readonly id: ElementId;
  readonly cell?: TableCellAddress;
  readonly range: TextRange;
  readonly props: ParagraphPropertyInput;
}

export interface FitTextShapeCommand {
  readonly type: 'FitTextShape';
  readonly id: ElementId;
}

export interface SetBodyPropsCommand {
  readonly type: 'SetBodyProps';
  readonly id: ElementId;
  readonly cell?: TableCellAddress;
  readonly props: TextBodyPropertyOverrides;
}

/** 子路径只用纯数据命令接入主历史；payload 的语义由已加载命名空间校验。 */
export interface ExtensionCommand {
  readonly type: 'Extension';
  readonly namespace: string;
  readonly id: ElementId;
  readonly payload: unknown;
}

export interface InsertRowCommand {
  readonly type: 'InsertRow';
  readonly id: ElementId;
  /** 省略仍兼容尾部追加；null 也表示尾部。 */
  readonly at?: { readonly before: import('../types').TableRowId | null };
}

export interface InsertColumnCommand {
  readonly type: 'InsertColumn';
  readonly id: ElementId;
  readonly at?: { readonly before: import('../types').TableColumnId | null };
}

export interface RemoveRowCommand {
  readonly type: 'RemoveRow';
  readonly id: ElementId;
  readonly row: import('../types').TableRowId;
}

export interface RemoveColumnCommand {
  readonly type: 'RemoveColumn';
  readonly id: ElementId;
  readonly column: import('../types').TableColumnId;
}

export interface SetRowHeightCommand {
  readonly type: 'SetRowHeight';
  readonly id: ElementId;
  readonly row: import('../types').TableRowId;
  readonly height: number;
}

export interface SetColumnWidthCommand {
  readonly type: 'SetColumnWidth';
  readonly id: ElementId;
  readonly column: import('../types').TableColumnId;
  readonly width: number;
}

export interface MergeCellsCommand {
  readonly type: 'MergeCells';
  readonly id: ElementId;
  readonly from: import('../types').TableCellRef;
  readonly to: import('../types').TableCellRef;
}

export interface SplitCellCommand {
  readonly type: 'SplitCell';
  readonly id: ElementId;
  readonly cell: import('../types').TableCellRef;
}

export interface SetCellPropsCommand {
  readonly type: 'SetCellProps';
  readonly id: ElementId;
  readonly cell: import('../types').TableCellRef;
  readonly props: {
    readonly fill?: Exclude<Fill, { type: 'image' }> | null;
    readonly borders?: CellBorders | null;
    readonly margins?: [number, number, number, number] | null;
    readonly vAlign?: TableCell['vAlign'] | null;
    readonly vert?: TableCell['vert'] | null;
  };
}

export type Command = SetXfrmCommand | SetFlipCommand | RemoveElementCommand | SetZCommand | SetNameCommand | SetAltTextCommand
  | ExtensionCommand
  | SetLockedCommand | SetElementHiddenCommand
  | ApplyFormatCommand | ReplaceTextCommand
  | AlignElementsCommand | DistributeElementsCommand | GroupCommand | UngroupCommand | PasteElementsCommand | AddShapeCommand | AddImageCommand | ReplaceImageCommand | SetCropCommand | SetGeometryCommand | ConvertToCustomGeometryCommand | SetPresetCommand | SetAdjCommand | AddTableCommand | AddSlideCommand | MoveSlideCommand | RemoveSlideCommand | DuplicateSlideCommand | EditTextCommand | SetRunPropsCommand | ClearFormatCommand | SetParaPropsCommand
  | AddSectionCommand | RenameSectionCommand | MoveSectionCommand | RemoveSectionCommand
  | SetSlideSizeCommand
  | FitTextShapeCommand | SetBodyPropsCommand | InsertRowCommand | InsertColumnCommand
  | RemoveRowCommand | RemoveColumnCommand | SetRowHeightCommand | SetColumnWidthCommand
  | MergeCellsCommand | SplitCellCommand | SetCellPropsCommand | SetFillCommand | SetStrokeCommand
  | SetEffectsCommand | SetLinkCommand | SetBackgroundCommand | SetBackgroundCropCommand
  | SetBackgroundImageCommand
  | SetHiddenCommand | SetTransitionCommand | SetAnimationsCommand | SetLayoutCommand | SetNotesCommand
  | SetTableStyleCommand | SetThemeCommand | SetMasterTextStyleCommand;

type PageOnlyCommand = AddSlideCommand | MoveSlideCommand | RemoveSlideCommand | DuplicateSlideCommand
  | AddSectionCommand | RenameSectionCommand | MoveSectionCommand | RemoveSectionCommand
  | SetSlideSizeCommand | SetBackgroundCropCommand | SetBackgroundImageCommand | SetHiddenCommand
  | SetAnimationsCommand | SetLayoutCommand | SetNotesCommand | SetThemeCommand
  | AddShapeCommand | AddImageCommand | AddTableCommand | PasteElementsCommand | ReplaceTextCommand;

/** 版式命令沿用元素命令语言；只有画布属性命令显式携带 DesignTarget。 */
export type DesignCommand = Exclude<Command, PageOnlyCommand | SetBackgroundCommand | SetTransitionCommand>
  | Extract<SetBackgroundCommand, { readonly target: import('../types').DesignTarget }>
  | Extract<SetTransitionCommand, { readonly target: import('../types').DesignTarget }>
  | Extract<AddShapeCommand, { readonly target: import('../types').DesignTarget }>
  | Extract<AddImageCommand, { readonly target: import('../types').DesignTarget }>
  | Extract<AddTableCommand, { readonly target: import('../types').DesignTarget }>;

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

export type ElementFillPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'fill'];
  readonly value: Exclude<Fill, { type: 'image' }>;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'fill'];
  readonly origin: string;
};

export type ElementStrokePatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'stroke'];
  readonly value: Stroke | null;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'stroke'];
  readonly origin: string;
};

export type ElementEffectsPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'effects'];
  readonly value: Effects;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'effects'];
  readonly origin: string;
};

export type ElementLinkPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'link'];
  readonly value: LinkOverride;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'link'];
  readonly origin: string;
};

export type ElementCropPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'crop'];
  readonly value: ImageCrop;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'crop'];
  readonly origin: string;
};

export type ElementImageReplacementPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'meta', 'imageReplacement'];
  readonly value: ElementImageReplacement;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'meta', 'imageReplacement'];
  readonly origin: string;
};

export type ImageResourcePatch = {
  readonly op: 'set';
  readonly path: readonly ['imageResources', string];
  readonly value: ElementInsertionResource;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['imageResources', string];
  readonly origin: string;
};

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
  readonly path: readonly ['elements', ElementId, 'ovr', 'tableCells', import('../types').TableCellRowRef, import('../types').TableCellColumnRef, 'text'];
  readonly value: TextOverride;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'tableCells', import('../types').TableCellRowRef, import('../types').TableCellColumnRef, 'text'];
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

export type ElementNamePatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'name'];
  readonly value: string;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'name'];
  readonly origin: string;
};

export type ElementInteractionField = 'locked' | 'hiddenByUser';
export type ElementInteractionPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'meta', ElementInteractionField];
  readonly value: true;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'meta', ElementInteractionField];
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

export interface SlideTreeSnapshot {
  readonly slide: SlideRecord;
  readonly after: SlideId | null;
  /** 删除视图优先切到原后继；插入 patch 不依赖它定位。 */
  readonly before: SlideId | null;
  readonly records: Readonly<Record<ElementId, ElementRecord>>;
  /** 页面结构 Patch 同步维护稳定节成员；省略表示该页不属于任何节。 */
  readonly sectionId?: import('../types').SectionId;
}

export type SlideTreePatch = {
  readonly op: 'remove' | 'insert';
  readonly path: readonly ['slides', SlideId];
  readonly value: SlideTreeSnapshot;
  readonly origin: string;
};

export type SlideOrderPatch = {
  readonly op: 'move';
  readonly path: readonly ['slideOrder', SlideId];
  readonly value: { readonly after: SlideId | null };
  readonly origin: string;
};

export type TableRowPatch = {
  readonly op: 'insert' | 'remove';
  readonly path: readonly ['elements', ElementId, 'ovr', 'tableRows', string];
  readonly value: import('../types').TableRowInsertion;
  readonly origin: string;
};

export type TableColumnPatch = {
  readonly op: 'insert' | 'remove';
  readonly path: readonly ['elements', ElementId, 'ovr', 'tableColumns', string];
  readonly value: import('../types').TableColumnInsertion;
  readonly origin: string;
};

export type TableGridEntryPatch = {
  readonly op: 'set' | 'del';
  readonly path: readonly ['elements', ElementId, 'ovr',
    'tableRemovedRows' | 'tableRemovedColumns' | 'tableRowHeights' | 'tableColumnWidths', string];
  readonly value?: true | number;
  readonly origin: string;
};

export type TableMergePatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'tableMerges'];
  readonly value: readonly import('../types').TableMergeRegion[];
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'tableMerges'];
  readonly origin: string;
};

export type TableCellPropsPatch = {
  readonly op: 'set' | 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'tableCells', string,
    'fill' | 'borders' | 'margins' | 'vAlign' | 'vert'];
  readonly value?: import('../types').TableCellOverrides[keyof Omit<import('../types').TableCellOverrides, 'text'>];
  readonly origin: string;
};

export type ExtensionPatch = {
  readonly op: 'set';
  readonly path: readonly ['elements', ElementId, 'ovr', 'extensions', string, ...string[]];
  readonly value: unknown;
  readonly origin: string;
} | {
  readonly op: 'del';
  readonly path: readonly ['elements', ElementId, 'ovr', 'extensions', string, ...string[]];
  readonly origin: string;
};

/** 单个事务必须能作为一条协同消息原子传输。 */
export const MAX_PATCHES_PER_TRANSACTION = 10_000;

export type Patch = ElementTransformPatch | ElementFillPatch | ElementStrokePatch | ElementEffectsPatch | ElementLinkPatch | ElementCropPatch | ElementGeometryPatch | ElementPresetGeometryPatch | ElementImageReplacementPatch | ImageResourcePatch | ElementTextPatch | ElementOrderPatch | ElementNamePatch | ElementAltTextPatch | ElementInteractionPatch
  | ExtensionPatch
  | ElementTreePatch | ElementHierarchyPatch | SlideTreePatch | SlideOrderPatch | SectionStatePatch | DocumentSizePatch | SlidePropertyPatch | SlideLayoutPatch
  | SlideNotesPatch | TableRowPatch | TableColumnPatch | TableGridEntryPatch | TableMergePatch
  | TableCellPropsPatch | ElementTableStylePatch | ThemePatch | LayoutPropertyPatch
  | MasterBackgroundPatch | MasterTextStylePatch;

export interface CommandPatches {
  readonly forward: Patch[];
  readonly inverse: Patch[];
  readonly selection?: Selection;
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

export interface SlideChangeSets {
  readonly createdSlides: Set<SlideId>;
  readonly removedSlides: Set<SlideId>;
  readonly movedSlides: Set<SlideId>;
  readonly notesSlides: Set<SlideId>;
  readonly removedSlideFallbacks: Map<SlideId, SlideId>;
}

export interface TransactionResult extends ProjectionInvalidation, CommandPatches, SlideChangeSets {
  readonly selection: Selection;
  readonly renderSlides: Set<SlideId>;
}

export interface EditorChange extends ProjectionInvalidation, SlideChangeSets {
  readonly source: 'transaction' | 'undo' | 'redo' | 'external' | 'selection';
  readonly selection: Selection;
  /** dirtyElements 含投影缓存祖先；DOM 增量分区必须以真正被 patch 的元素为准。 */
  readonly touchedElements: Set<ElementId>;
  /** 需要重新生成 markup/defs 的元素；纯层级 patch 不进入这里。 */
  readonly renderElements: Set<ElementId>;
  /** 页面级视觉属性需要重建整个 SVG；隐藏等纯目录元数据不进入这里。 */
  readonly renderSlides: Set<SlideId>;
  /** bodyPr 有效值变化；活动文字面必须同步刷新被延迟的静态分区。 */
  readonly bodyPropsElements: Set<ElementId>;
  /** 只需移动既有 DOM 分区的元素；可与 renderElements 重叠。 */
  readonly reorderedElements: Set<ElementId>;
  /** 名称与会话交互状态改变；选择窗格只消费这一集合，避免文字输入重建目录 DOM。 */
  readonly paneElements: Set<ElementId>;
}

export type EditorSubscriber = (change: EditorChange) => void;

export interface EditorPatchEvent {
  readonly source: Exclude<EditorChange['source'], 'selection'>;
  readonly patches: readonly Patch[];
  readonly identity: EditIdentity;
  readonly origin: string;
  readonly label: string;
  readonly time: number;
}

export type EditorPatchSubscriber = (event: EditorPatchEvent) => void;

export interface EditorPatchSubscribeOptions {
  /** 协同 checkpoint 必须先于 recovery 观察者看到同一事务；该阶段的订阅者不得重入编辑器。 */
  readonly phase?: 'before-recovery' | 'after-observers';
}

export interface ExternalPatchOptions {
  readonly identity?: EditIdentity;
  readonly origin?: string;
  readonly label?: string;
  readonly time?: number;
}

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
  /** 新解析文档的恢复日志；构造期间原子回放，不进入历史或再次广播。 */
  readonly recoveryFrames?: readonly import('../recovery-types').RecoveryFrame[];
}
