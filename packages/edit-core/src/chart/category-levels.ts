import type { XmlElement } from '@web-ppt/edit-core/xml';
import { removeXmlChild } from '@web-ppt/edit-core/xml';
import type { ChartCategory, ChartDatasetState, ChartFormulaBinding, ChartPointId } from './types';
import { chartFormula, parseChartFormula, resizedChartFormula } from './formula';
import { chartXml, xmlAttribute as attr, xmlContent as content, makeDataElement as make, appendXml as append, setDataText as setText } from './xml-data';
import { MAX_CATEGORY_LEVELS, MAX_CHART_POINTS, MAX_CHART_CELLS } from './limits';

const { child, children } = chartXml;

export function readCategoryLevels(holder: XmlElement | null, valueFormula: string | null): {
  readonly slots: Array<Array<string | null>>; readonly count: number;
  readonly hierarchy: NonNullable<ChartFormulaBinding['hierarchy']>;
} | undefined {
  const ref = child(holder, 'multiLvlStrRef');
  if (!ref) return undefined;
  const cache = child(ref, 'multiLvlStrCache'), levels = children(cache, 'lvl');
  if (!levels.length || levels.length > MAX_CATEGORY_LEVELS) throw new Error('多级类别缺少缓存或层数超限');
  const rawCount = attr(child(cache, 'ptCount'), 'val');
  let count = rawCount === null ? 0 : Number(rawCount);
  if (!Number.isInteger(count) || count < 0) throw new Error('多级类别点数无效');
  const maps = levels.map(level => {
    const values = new Map<number, string>();
    for (const point of children(level, 'pt')) {
      if (children(point, 'v').length !== 1) throw new Error('类别层级缺少唯一文本值');
      const index = Number(attr(point, 'idx') ?? NaN);
      if (!Number.isInteger(index) || index < 0 || index >= MAX_CHART_POINTS || values.has(index)) throw new Error('多级类别索引无效或重复');
      values.set(index, content(child(point, 'v')));
      count = Math.max(count, index + 1);
    }
    return values;
  }).reverse();
  if (count > MAX_CHART_POINTS || count * levels.length > MAX_CHART_CELLS) throw new Error('多级类别规模超限');
  const range = parseChartFormula(content(child(ref, 'f')).trim()), values = parseChartFormula(valueFormula);
  if (!range) throw new Error('多级类别公式无法无歧义写回');
  const rows = range.endRow - range.startRow + 1, columns = range.endColumn - range.startColumn + 1;
  const vertical = columns === levels.length && rows === Math.max(1, count);
  const horizontal = rows === levels.length && columns === Math.max(1, count);
  const hint = values && values.startColumn === values.endColumn ? 'rows'
    : values && values.startRow === values.endRow ? 'columns' : undefined;
  const orientation = vertical && horizontal ? hint : vertical ? 'rows' : horizontal ? 'columns' : undefined;
  if (!orientation) throw new Error('多级类别公式的层级方向不明确');
  return { count, hierarchy: { levels: levels.length, orientation },
    slots: Array.from({ length: count }, (_, index) => maps.map(level => level.get(index) ?? null)) };
}

export function resizedCategoryFormula(binding: ChartFormulaBinding, count: number): string | null {
  const range = parseChartFormula(binding.formula), hierarchy = binding.hierarchy;
  if (!range || !hierarchy) return resizedChartFormula(binding.formula, count);
  return chartFormula({ ...range, ...(hierarchy.orientation === 'rows'
    ? { endRow: range.startRow + Math.max(1, count) - 1 }
    : { endColumn: range.startColumn + Math.max(1, count) - 1 }) });
}

/** 更高级别开始新组时，下级空槽不继承旧父组中的标签。 */
export function resolvedCategoryLevels(categories: readonly ChartCategory[], depth: number): Array<Array<string | null>> {
  let active = Array<string | null>(depth).fill(null);
  return categories.map(category => {
    const slots = category.levels ?? [...Array<string | null>(depth - 1).fill(null), category.label];
    active = [...active];
    for (let level = 0; level < depth; level++) {
      if (slots[level] !== null) { active.fill(null, level + 1); active[level] = slots[level]; }
      else if (level === depth - 1) active[level] = null;
    }
    return active;
  });
}

/** 以墓碑中的原生组首恢复跨度；并发删除相邻类别也不能把仍被使用的父组删掉。 */
export function preserveCategorySpans(
  categories: readonly ChartDatasetState['categories'][ChartPointId][], depth: number,
): void {
  let heads = Array<{ id: string; value: string } | null>(depth).fill(null);
  const ancestry = new Map<string, typeof heads>();
  let previous: typeof heads = Array(depth).fill(null);
  for (const category of categories) {
    if (category.levelParent !== undefined) heads = [...(category.levelParent
      ? ancestry.get(category.levelParent) ?? Array(depth).fill(null) : Array(depth).fill(null))];
    const slots = [...category.levels!];
    for (let level = 0; level < depth - 1; level++) {
      const clearedParent = category.levelClears?.[level];
      if (slots[level] === null && clearedParent !== undefined) {
        const parent = clearedParent ? ancestry.get(clearedParent) : undefined;
        const sameGroup = parent && heads.slice(0, level).every((head, index) => head?.id === parent[index]?.id);
        heads[level] = sameGroup ? parent[level] : null;
        heads.fill(null, level + 1);
      }
      if (slots[level] === null) continue;
      heads[level] = { id: category.id, value: slots[level]! };
      heads.fill(null, level + 1);
    }
    ancestry.set(category.id, [...heads]);
    if (category.removed) continue;
    for (let level = 0; level < depth - 1; level++) {
      if (slots[level] === null && heads[level] && heads[level]!.id !== previous[level]?.id) slots[level] = heads[level]!.value;
    }
    (category as { levels: readonly (string | null)[] }).levels = slots;
    previous = [...heads];
  }
}

export function writeCategoryLevels(holder: XmlElement, categories: readonly ChartCategory[], binding: ChartFormulaBinding): void {
  const depth = binding.hierarchy!.levels;
  let ref = child(holder, 'multiLvlStrRef');
  if (!ref) {
    for (const node of children(holder).filter(node => ['numRef', 'strRef', 'strLit', 'numLit'].includes(node.localName))) removeXmlChild(holder, node);
    ref = make(holder, 'multiLvlStrRef'); append(holder, ref);
  }
  let formula = child(ref, 'f');
  if (!formula) { formula = make(ref, 'f'); append(ref, formula, ref.children[0] ?? null); }
  setText(formula, resizedCategoryFormula(binding, categories.length) ?? '');
  let cache = child(ref, 'multiLvlStrCache');
  if (!cache) { cache = make(ref, 'multiLvlStrCache'); append(ref, cache, child(ref, 'extLst')); }
  for (const node of children(cache).filter(node => ['ptCount', 'lvl'].includes(node.localName))) removeXmlChild(cache, node);
  const count = make(cache, 'ptCount', [['val', String(categories.length)]]); append(cache, count, child(cache, 'extLst'));
  for (let level = depth - 1; level >= 0; level--) {
    const current = make(cache, 'lvl'); append(cache, current, child(cache, 'extLst'));
    categories.forEach((category, index) => {
      const value = category.levels?.[level] ?? null;
      if (value === null) return;
      const point = make(current, 'pt', [['idx', String(index)]]), text = make(point, 'v');
      setText(text, value); append(point, text); append(current, point);
    });
  }
}
