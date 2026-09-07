import {
  listSections, queryElementAltText, querySlideSize,
} from '@web-ppt/edit-core';
import type {
  AddSectionCommand, DistributeElementsCommand, Editor, ElementAltTextState, ElementId,
  SectionId, SectionRecord, SetAltTextCommand, SetSlideSizeCommand, SlideSizeState,
} from '@web-ppt/edit-core';

/** 挂载视图与 headless adapter 共享同一套公共命令语义。 */
export class CommonObjectSlideCommands {
  constructor(private readonly editor: Editor) {}

  distribute(
    enabled: boolean, axis: DistributeElementsCommand['axis'], ids?: readonly ElementId[],
  ): boolean {
    if (!this.writable(enabled)) return false;
    const targets = ids ?? (this.editor.selection.kind === 'elements'
      ? this.editor.selection.ids : null);
    if (!targets) return false;
    this.editor.exec({ type: 'DistributeElements', ids: targets, axis });
    return true;
  }

  queryAltText(id?: ElementId): ElementAltTextState | null {
    const target = this.selectedElementId(id);
    return target ? queryElementAltText(this.editor.doc, target) : null;
  }

  setAltText(
    enabled: boolean, value: Pick<SetAltTextCommand, 'title' | 'descr'>, id?: ElementId,
  ): boolean {
    const target = this.selectedElementId(id);
    return target ? this.exec(enabled, { type: 'SetAltText', id: target, ...value }) : false;
  }

  listSections(): SectionRecord[] { return listSections(this.editor.doc); }

  addSection(enabled: boolean, value: Omit<AddSectionCommand, 'type'>): SectionRecord | null {
    if (!this.writable(enabled)) return null;
    const existing = new Set(this.editor.doc.sections.order);
    this.editor.exec({ type: 'AddSection', ...value });
    return listSections(this.editor.doc).find((section) => !existing.has(section.id)) ?? null;
  }

  renameSection(enabled: boolean, id: SectionId, name: string): boolean {
    return this.exec(enabled, { type: 'RenameSection', id, name });
  }

  moveSection(enabled: boolean, id: SectionId, after: SectionId | null): boolean {
    return this.exec(enabled, { type: 'MoveSection', id, at: { after } });
  }

  removeSection(enabled: boolean, id: SectionId): boolean {
    return this.exec(enabled, { type: 'RemoveSection', id });
  }

  querySlideSize(): SlideSizeState { return querySlideSize(this.editor.doc); }

  setSlideSize(enabled: boolean, value: Pick<SetSlideSizeCommand, 'w' | 'h' | 'fit'>): boolean {
    return this.exec(enabled, { type: 'SetSlideSize', ...value });
  }

  private writable(enabled: boolean): boolean { return enabled && !this.editor.doc.meta.readonly; }

  private exec(enabled: boolean, command: Parameters<Editor['exec']>[0]): boolean {
    if (!this.writable(enabled)) return false;
    this.editor.exec(command);
    return true;
  }

  private selectedElementId(explicit?: ElementId): ElementId | null {
    if (explicit !== undefined) return explicit;
    const selection = this.editor.selection;
    return selection.kind === 'elements' && selection.ids.length === 1 ? selection.ids[0] : null;
  }
}

const commandsByEditor = new WeakMap<Editor, CommonObjectSlideCommands>();

export function commonObjectSlideCommands(editor: Editor): CommonObjectSlideCommands {
  const existing = commandsByEditor.get(editor);
  if (existing) return existing;
  const commands = new CommonObjectSlideCommands(editor);
  commandsByEditor.set(editor, commands);
  return commands;
}
