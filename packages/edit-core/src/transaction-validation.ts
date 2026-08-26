import { commandTargetIds } from './commands/dispatch';
import { assertFormatMask } from './commands/format-painter-types';
import { willRemoveElementStructure } from './commands/element-tree';
import { assertSetZCommand } from './commands/set-z';
import type { Command } from './commands/types';
import { writableLayerSiblingIds } from './element-order';
import { isElementDescendantOf } from './selection';
import type { EditDoc, ElementId } from './types';

export function shapeTextCommandTarget(command: Command): ElementId | null {
  if (command.type === 'ApplyFormat') {
    assertFormatMask(command.mask, 'ApplyFormat.mask');
    return command.toCell === undefined
      && command.mask.some((field) => field === 'run' || field === 'paragraph' || field === 'body')
      ? command.to : null;
  }
  if (command.type !== 'EditText' && command.type !== 'SetRunProps'
    && command.type !== 'SetParaProps' && command.type !== 'SetBodyProps') {
    return null;
  }
  return !('cell' in command) || command.cell === undefined ? command.id : null;
}

/** 删除子树与同树属性编辑无法形成无需依赖顺序的双向 patch，必须在任何模型修改前拒绝。 */
export function validateCommandRelations(doc: EditDoc, commands: readonly Command[]): void {
  const removedSlideIds = new Set(commands.flatMap((command) =>
    command.type === 'RemoveSlide' ? [command.id] : []));
  const slidePropertyConflict = commands.flatMap((command) =>
    command.type === 'SetBackground' || command.type === 'SetBackgroundImage'
      || command.type === 'SetBackgroundCrop'
      || command.type === 'SetHidden' || command.type === 'SetLayout'
      || command.type === 'SetNotes' ? [command.id] : [])
    .find((id) => removedSlideIds.has(id));
  // 删除页的逆 patch 先恢复整页；同事务再夹带页属性会让预校验依赖执行顺序，直接拒绝才是原子语义。
  if (slidePropertyConflict) {
    throw new Error(`同一事务不能修改再删除同一页面：${slidePropertyConflict}`);
  }
  const layers = commands.filter((command) => command.type === 'SetZ');
  const layerRecords = layers.map((command) => assertSetZCommand(doc, command));
  if (layerRecords.length > 1) {
    const parent = layerRecords[0].parent;
    const part = layerRecords[0].meta.origin?.part ?? null;
    if (layerRecords.some((record) => record.parent !== parent
      || (record.meta.origin?.part ?? null) !== part)) {
      throw new Error('同一层级事务只能调整同一父级、同一来源 part 的元素');
    }
  }
  const removals = commands.filter((command) => command.type === 'RemoveElement');
  if (new Set(removals.map((command) => command.id)).size !== removals.length) {
    throw new Error('同一事务不能重复删除同一元素');
  }
  const roots = removals.filter((command) => willRemoveElementStructure(doc.elements[command.id]));
  const explicitFits = new Set(commands.flatMap((command) =>
    command.type === 'FitTextShape' ? [command.id] : []));
  const duplicatedFitId = commands.map(shapeTextCommandTarget)
    .find((id): id is ElementId => !!id && explicitFits.has(id));
  if (duplicatedFitId) {
    throw new Error(`文字命令会自动派生 FitTextShape，同一事务不能重复指定：${duplicatedFitId}`);
  }
  if (roots.length && layerRecords.length) {
    const layerCandidates = writableLayerSiblingIds(doc, layerRecords[0]);
    if (roots.some((root) => layerCandidates.some((id) => id === root.id
      || isElementDescendantOf(doc, id, root.id)))) {
      throw new Error('同一事务不能删除可能承担层级覆盖的兄弟子树');
    }
  }
  for (let left = 0; left < roots.length; left++) {
    for (let right = left + 1; right < roots.length; right++) {
      if (isElementDescendantOf(doc, roots[left].id, roots[right].id)
        || isElementDescendantOf(doc, roots[right].id, roots[left].id)) {
        throw new Error('同一事务的删除根不能互为祖先与后代');
      }
    }
  }
  for (const command of commands) {
    if (command.type === 'RemoveElement') continue;
    // ApplyFormat 读取来源的有效投影；它与写目标同样不能依赖同事务已删除的子树。
    const dependencies = command.type === 'ApplyFormat'
      ? [...commandTargetIds(command), command.from]
      : commandTargetIds(command);
    const conflict = dependencies.find((id) => roots.some((root) => id === root.id
      || isElementDescendantOf(doc, id, root.id)));
    if (conflict) throw new Error(`同一事务不能先修改再删除同一子树：${conflict}`);
  }
}
