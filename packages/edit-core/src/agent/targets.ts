import type { Command, SetZCommand } from '../commands/types';
import type { DesignTarget, EditDoc, ElementId } from '../types';
import { AgentToolError } from './errors';

const SLIDE_ID_COMMANDS = new Set([
  'MoveSlide', 'RemoveSlide', 'DuplicateSlide', 'SetBackgroundCrop', 'SetBackgroundImage',
  'SetHidden', 'SetLayout', 'SetNotes',
]);
const SECTION_ID_COMMANDS = new Set(['RenameSection', 'MoveSection', 'RemoveSection']);

function missing(commandIndex: number, id: string, kind: string): never {
  throw new AgentToolError('target-not-found', `命令 ${commandIndex} 找不到${kind}：${id}`, commandIndex, id);
}
function exists(value: unknown): value is string { return typeof value === 'string' && !!value; }
function sameTarget(left: DesignTarget, right: DesignTarget): boolean {
  return left.kind === right.kind && left.id === right.id;
}
function assertDesign(doc: EditDoc, target: DesignTarget, index: number): void {
  const records = target.kind === 'layout' ? doc.layouts : doc.masters;
  if (!records[target.id]) missing(index, target.id, target.kind === 'layout' ? '版式' : '母版');
}
function assertSlide(doc: EditDoc, id: string, index: number): void {
  if (!doc.slides[id]) missing(index, id, '页面');
}
function assertElement(doc: EditDoc, id: string, index: number): void {
  if (!doc.elements[id]) missing(index, id, '元素');
}

export function assertCommandTargets(doc: EditDoc, command: Command, index: number): void {
  const input = command as unknown as Record<string, unknown>;
  if (!!input.target && typeof input.target === 'object') assertDesign(doc, input.target as DesignTarget, index);
  if (command.type === 'SetTheme') {
    if (!doc.themes[command.id]) missing(index, command.id, '主题');
    return;
  }
  if (command.type === 'AddSlide' || command.type === 'SetLayout') {
    if (!doc.layouts[command.layoutId]) missing(index, command.layoutId, '版式');
  }
  if (command.type === 'AddSlide' && command.at.after) assertSlide(doc, command.at.after, index);
  if (command.type === 'SetAnimations' || (exists(input.slideId) && command.type !== 'AddSlide')) {
    assertSlide(doc, input.slideId as string, index);
  }
  if (command.type === 'AddSection') {
    command.slideIds.forEach((id) => assertSlide(doc, id, index));
    if (command.at.after) {
      if (!doc.sections.records[command.at.after]) missing(index, command.at.after, '节');
    }
  }
  if (command.type === 'MoveSection' && command.at.after && !doc.sections.records[command.at.after]) {
    missing(index, command.at.after, '节');
  }
  if (command.type === 'MoveSlide' && command.at.after) assertSlide(doc, command.at.after, index);
  if (command.type === 'PasteElements') {
    if (!doc.slides[command.at.parentId] && !doc.elements[command.at.parentId]) {
      missing(index, command.at.parentId, '粘贴父级');
    }
  }
  if (command.type === 'ReplaceText') {
    const scope = command.scope;
    if (scope.kind === 'slide') assertSlide(doc, scope.slideId, index);
    else if (scope.kind === 'slides') scope.slideIds.forEach((id) => assertSlide(doc, id, index));
    else if (scope.kind === 'match') {
      assertSlide(doc, scope.match.slideId, index);
      assertElement(doc, scope.match.id, index);
    }
  }
  if (command.type === 'SetLink' && command.target?.kind === 'slide') {
    assertSlide(doc, command.target.slideId, index);
  }
  if (command.type === 'ApplyFormat') {
    assertElement(doc, command.from, index);
    assertElement(doc, command.to, index);
    return;
  }
  if ('ids' in command && Array.isArray(command.ids)) {
    command.ids.forEach((id) => assertElement(doc, id, index));
    return;
  }
  if (!exists(input.id)) return;
  if (command.type === 'SetBackground' || command.type === 'SetTransition') {
    assertSlide(doc, input.id, index);
    return;
  }
  if (command.type === 'SetMasterTextStyle') return;
  if (command.type === 'Extension' && command.scope === 'slide') assertSlide(doc, input.id, index);
  else if (SLIDE_ID_COMMANDS.has(command.type)) assertSlide(doc, input.id, index);
  else if (SECTION_ID_COMMANDS.has(command.type)) {
    if (!doc.sections.records[input.id]) missing(index, input.id, '节');
  } else assertElement(doc, input.id, index);
}

export function assertBatchTargets(doc: EditDoc, commands: readonly Command[]): void {
  commands.forEach((command, index) => assertCommandTargets(doc, command, index));
  const layers = commands.map((command, index) => ({ command, index }))
    .filter((entry): entry is { command: SetZCommand; index: number } => entry.command.type === 'SetZ');
  if (layers.length < 2) return;
  const first = doc.elements[layers[0].command.id];
  const mismatch = layers.findIndex((entry) => {
    const record = doc.elements[entry.command.id];
    return record.parent !== first.parent || (record.meta.origin?.part ?? null) !== (first.meta.origin?.part ?? null);
  });
  if (mismatch >= 0) {
    throw new AgentToolError('command-rejected', '同一层级事务只能调整同一父级、同一来源 part 的元素', layers[mismatch].index);
  }
}

function canvasOfElement(doc: EditDoc, id: ElementId): DesignTarget | null {
  let current = doc.elements[id];
  while (current) {
    if (doc.layouts[current.parent]) return { kind: 'layout', id: current.parent };
    if (doc.masters[current.parent]) return { kind: 'master', id: current.parent };
    if (doc.slides[current.parent]) return null;
    current = doc.elements[current.parent];
  }
  return null;
}

function commandDesignTarget(doc: EditDoc, command: Command): DesignTarget | null {
  const input = command as unknown as Record<string, unknown>;
  if (!!input.target && typeof input.target === 'object') return input.target as DesignTarget;
  const ids: readonly string[] = command.type === 'ApplyFormat' ? [command.from, command.to]
    : 'ids' in command && Array.isArray(command.ids) ? command.ids
      : exists(input.id) ? [input.id] : [];
  const targets = ids.map((id) => canvasOfElement(doc, id)).filter((target): target is DesignTarget => !!target);
  return targets[0] ?? null;
}

export function commonDesignTarget(doc: EditDoc, commands: readonly Command[]): DesignTarget | null {
  const targets = commands.map((command) => commandDesignTarget(doc, command)).filter((target): target is DesignTarget => !!target);
  if (!targets.length) return null;
  if (targets.some((target) => !sameTarget(target, targets[0]))) {
    throw new AgentToolError('mixed-design-target', '一个原子批量事务不能混合多个设计画布', null);
  }
  return targets[0];
}
