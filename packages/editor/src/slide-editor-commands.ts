import { querySlideLayout, querySlideNotes, querySlideTransition } from '@web-ppt/edit-core';
import type {
  ElementId, ImageCrop, LinkTarget, ParagraphPropertiesState, ParagraphPropertyOverrides,
  RunLinkState, RunPropertiesState, RunPropertyOverrides, SlideId, SlideLayoutState,
  SlideNotesState, TextBodyProperties, TextBodyPropertyOverrides,
  SlideTransitionInput, SlideTransitionState,
} from '@web-ppt/edit-core';
import type { EditorSession } from './session';
import type { TextEditorController } from './text-editor';
import type { ImageInsertionController } from './image-insertion';
import type {
  ImageBackgroundOptions, ImageInsertOptions, ImageReplaceOptions,
} from './image-insertion';
import type { ImageCropGestureController } from './image-crop-gesture';
import type { SlideLinkController } from './slide-link-controller';
import type { EditorMode } from './slide-editor-types';
import type { TableInsertOptions } from './table-insertion';
import { insertTable } from './table-insertion';
import { querySelectionBodyProps, setSelectionBodyProps } from './selection-body-properties';
import type { FormatPainterStartOptions } from './format-painter-types';
import type { FormatPainterViewBinding } from './format-painter-view';
import type { TextSearchOpenOptions } from './text-search-types';
import type { TextSearchViewBinding } from './text-search-view';
import type { TransitionPreviewController } from './transition-preview';

interface SlideEditorCommandsOptions {
  readonly session: EditorSession;
  readonly element: HTMLElement;
  readonly textEditor: TextEditorController;
  readonly imageInsertion: ImageInsertionController;
  readonly imageCropGesture: ImageCropGestureController;
  readonly links: SlideLinkController;
  readonly formatPainter: FormatPainterViewBinding;
  readonly textSearch: TextSearchViewBinding;
  transitionPreview(): TransitionPreviewController;
  mode(): EditorMode;
  slideId(): SlideId;
  destroyed(): boolean;
  cancelGestures(): void;
}

/** 把公开工具栏动作收敛为薄能力层，视图本体只负责 DOM 与生命周期装配。 */
export class SlideEditorCommands {
  constructor(private readonly options: SlideEditorCommandsOptions) {}

  startFormatPainter(options: FormatPainterStartOptions): boolean {
    const o = this.options;
    if (o.destroyed() || o.mode() !== 'edit' || o.textEditor.isComposing) return false;
    const started = o.formatPainter.start(options);
    if (!started) return false;
    o.cancelGestures();
    o.imageCropGesture.exit();
    o.textEditor.close(false);
    o.element.focus({ preventScroll: true });
    return true;
  }

  cancelFormatPainter(): void { this.options.formatPainter.cancel(); }
  openTextSearch(options: TextSearchOpenOptions): void { this.options.textSearch.open(options); }
  closeTextSearch(): void { this.options.textSearch.close(); }
  nextTextSearch() { return this.options.textSearch.next(); }
  previousTextSearch() { return this.options.textSearch.previous(); }
  replaceCurrentText(): boolean { return this.options.textSearch.replaceCurrent(); }
  replaceAllText(): number { return this.options.textSearch.replaceAll(); }
  followLink(target?: LinkTarget): boolean {
    return !this.options.destroyed() && this.options.links.follow(target);
  }
  releaseTextEditing(): void { this.options.textEditor.releaseTextEditing(); }
  registerTextUi(element: HTMLElement): () => void {
    return this.options.textEditor.registerExternalUi(element);
  }
  queryRunProps(): RunPropertiesState | null { return this.options.textEditor.queryRunProps(); }
  queryRunLink(): RunLinkState | null { return this.options.textEditor.queryRunLink(); }
  setRunProps(props: RunPropertyOverrides): boolean {
    return this.options.textEditor.setRunProps(props);
  }
  queryParaProps(): ParagraphPropertiesState | null { return this.options.textEditor.queryParaProps(); }
  setParaProps(props: ParagraphPropertyOverrides): boolean {
    return this.options.textEditor.setParaProps(props);
  }

  queryBodyProps(): TextBodyProperties | null {
    return querySelectionBodyProps(this.options.session.editor, this.options.slideId());
  }

  setBodyProps(props: TextBodyPropertyOverrides): boolean {
    const o = this.options;
    if (o.mode() !== 'edit' || o.textEditor.isComposing) return false;
    return setSelectionBodyProps(o.session.editor, o.slideId(), props);
  }

  insertImage(file: Blob, options: ImageInsertOptions): Promise<ElementId> {
    return this.options.imageInsertion.insert(file, options);
  }
  chooseImage(options: ImageInsertOptions): Promise<ElementId | null> {
    return this.options.imageInsertion.choose(options);
  }
  replaceImage(file: Blob, options: ImageReplaceOptions): Promise<ElementId> {
    return this.options.imageInsertion.replace(this.selectedImageId(options.id), file, options);
  }
  chooseReplacementImage(options: ImageReplaceOptions): Promise<ElementId | null> {
    return this.options.imageInsertion.chooseReplacement(this.selectedImageId(options.id), options);
  }
  setBackgroundImage(file: Blob, options: ImageBackgroundOptions): Promise<SlideId> {
    return this.options.imageInsertion.setBackground(file, options);
  }
  chooseBackgroundImage(options: ImageBackgroundOptions): Promise<SlideId | null> {
    return this.options.imageInsertion.chooseBackground(options);
  }
  setBackgroundCrop(crop: ImageCrop | null): boolean {
    const o = this.options;
    if (o.destroyed() || o.mode() !== 'edit') return false;
    o.session.editor.exec({ type: 'SetBackgroundCrop', id: o.slideId(), crop });
    return true;
  }

  queryTransition(): SlideTransitionState {
    return querySlideTransition(this.options.session.editor.doc, [this.options.slideId()]);
  }
  setTransition(value: SlideTransitionInput | null): boolean {
    const o = this.options;
    if (o.destroyed() || o.mode() !== 'edit') return false;
    o.session.editor.exec({ type: 'SetTransition', id: o.slideId(), t: value });
    return true;
  }
  previewTransition(value?: SlideTransitionInput): Promise<boolean> {
    return this.options.transitionPreview().preview(value);
  }

  queryLayout(): SlideLayoutState {
    return querySlideLayout(this.options.session.editor.doc, [this.options.slideId()]);
  }
  setLayout(layoutId: string): boolean {
    const o = this.options;
    if (o.destroyed() || o.mode() !== 'edit') return false;
    o.session.editor.exec({ type: 'SetLayout', id: o.slideId(), layoutId });
    return true;
  }
  queryNotes(): SlideNotesState {
    return querySlideNotes(this.options.session.editor.doc, [this.options.slideId()]);
  }
  setNotes(text: string): boolean {
    const o = this.options;
    if (o.destroyed() || o.mode() !== 'edit') return false;
    o.session.editor.exec({ type: 'SetNotes', id: o.slideId(), text });
    return true;
  }

  insertTable(rows: number, cols: number, options: TableInsertOptions): ElementId {
    const o = this.options;
    if (o.destroyed()) throw new Error('不能通过已销毁视图插入表格');
    if (o.mode() !== 'edit') throw new Error('查看模式不能插入表格');
    return insertTable(o.session.editor, o.slideId(), rows, cols, options);
  }

  startImageCrop(id?: ElementId): boolean {
    const o = this.options;
    if (o.destroyed() || o.mode() !== 'edit') return false;
    const selection = o.session.editor.selection;
    const target = id ?? (selection.kind === 'elements' && selection.ids.length === 1
      ? selection.ids[0] : undefined);
    return !!target && o.imageCropGesture.enter(target);
  }
  endImageCrop(): void { this.options.imageCropGesture.exit(); }

  private selectedImageId(explicit?: ElementId): ElementId {
    const selection = this.options.session.editor.selection;
    const id = explicit ?? (selection.kind === 'elements' && selection.ids.length === 1
      ? selection.ids[0] : undefined);
    if (!id || this.options.session.editor.doc.elements[id]?.src.kind !== 'image') {
      throw new Error('替换图片需要指定图片或先单选一张图片');
    }
    return id;
  }
}
