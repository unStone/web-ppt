import { own } from '../data-validation';
import { assertTableStyleSettings } from '../table-style';
import type { EditDoc } from '../types';
import type {
  CommandPatches, ElementTableStylePatch, SetTableStyleCommand,
} from './types';

const SWITCHES = ['firstRow', 'lastRow', 'bandRow', 'firstCol', 'lastCol', 'bandCol'] as const;

export function setTableStylePatches(
  doc: EditDoc,
  command: SetTableStyleCommand,
  origin: string,
): CommandPatches {
  if (doc.meta.readonly) throw new Error('只读编辑文档不能修改表样式');
  const record = doc.elements[command.id];
  if (!record || record.src.kind !== 'table') throw new Error(`找不到表格：${command.id}`);
  if (record.meta.editable !== 'full' || record.meta.locked) throw new Error(`表格不可编辑：${command.id}`);
  const path = ['elements', command.id, 'ovr', 'tableStyle'] as const;
  const hadOverride = own(record.ovr, 'tableStyle');
  if (command.styleId === null) {
    if (SWITCHES.some((field) => own(command, field))) {
      throw new Error('SetTableStyle.styleId=null 时不能携带样式开关');
    }
    if (!hadOverride) return { forward: [], inverse: [] };
    return {
      forward: [{ op: 'del', path, origin }],
      inverse: [{ op: 'set', path, value: structuredClone(record.ovr.tableStyle!), origin }],
    };
  }
  const value = assertTableStyleSettings(doc, command.id, {
    styleId: command.styleId,
    ...Object.fromEntries(SWITCHES.map((field) => [field, command[field]])),
  }, 'SetTableStyle');
  if (hadOverride && JSON.stringify(record.ovr.tableStyle) === JSON.stringify(value)) {
    return { forward: [], inverse: [] };
  }
  const forward: ElementTableStylePatch = {
    op: 'set', path, value: structuredClone(value), origin,
  };
  const inverse: ElementTableStylePatch = hadOverride
    ? { op: 'set', path, value: structuredClone(record.ovr.tableStyle!), origin }
    : { op: 'del', path, origin };
  return { forward: [forward], inverse: [inverse] };
}
