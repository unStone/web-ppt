const LIMIT = 10000;
const unsigned = (raw) => typeof raw === 'string' && /^\+?\d+$/.test(raw.trim())
  && Number(raw) <= 0xffffffff ? Number(raw) : null;
const numeric = (raw) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())
  && Number.isFinite(Number(raw)) ? { kind: 'number', value: Number(raw) } : { kind: 'invalid', value: null, raw };

/** 缓存和字面数据共用 idx 语义；保留空槽，不能按 XML 的 pt 出现顺序压平。 */
function inlineDimension(dimension) {
  const source = dimension.formulas.length ? 'cache' : 'literal';
  const invalid = (reason) => ({ status: 'invalid', source, reason });
  if (dimension.formulas.length > 1) return invalid('multiple-formulas');
  if (!dimension.levels.length) return { status: 'absent', source };
  let total = 0;
  const levels = [];
  for (const level of dimension.levels) {
    const count = unsigned(level.ptCount);
    if (count === null) return invalid('invalid-point-count');
    total += count;
    if (total > LIMIT || dimension.levels.length > LIMIT) return invalid('dimension-limit');
    const values = Array.from({ length: count }, () => ({ kind: 'missing', value: null }));
    const seen = new Set();
    for (const point of level.points) {
      if (point.invalidContent) return invalid('invalid-point-content');
      const index = unsigned(point.idx);
      if (index === null || index >= count) return invalid('invalid-point-index');
      if (seen.has(index)) return invalid('duplicate-point-index');
      seen.add(index);
      values[index] = dimension.kind === 'strDim'
        ? { kind: 'string', value: point.value }
        : numeric(point.value);
    }
    levels.push({ count, name: level.name, formatCode: level.formatCode, values });
  }
  return { status: 'resolved', source, levels };
}

function workbookDimension(dimension) {
  const references = dimension.workbookReferences;
  const unresolved = (reason) => ({ status: 'unresolved', reason });
  if (references.length !== 1) return unresolved(references.length ? 'multiple-formulas' : 'no-formula');
  const reference = references[0];
  if (reference.status !== 'resolved') return unresolved(reference.reason);
  const direction = reference.direction;
  if (!['col', 'row'].includes(direction)) return unresolved('invalid-direction');
  const values = direction === 'row' ? reference.rows
    : (reference.rows[0] ?? []).map((_, column) => reference.rows.map((row) => row[column]));
  return { status: 'resolved', direction, levels: values.map((values) => ({ count: values.length, values })) };
}

function compareSources(inline, workbook) {
  const unavailable = (reason) => ({ status: 'not-comparable', reason });
  if (inline.status !== 'resolved') return unavailable(`inline-${inline.status}`);
  if (workbook.status !== 'resolved') return unavailable(workbook.reason);
  // 物理列序并不保证等于层级缓存顺序；没有对应关系的证据时不能伪造逐点差异。
  if (inline.levels.length !== 1 || workbook.levels.length !== 1) return unavailable('hierarchy-order-unverified');
  const a = inline.levels[0], b = workbook.levels[0];
  if ([...a.values, ...b.values].some((point) => ['invalid', 'error', 'uncalculated'].includes(point.kind))) {
    return unavailable('unusable-values');
  }
  if (a.count !== b.count) return { status: 'different', reason: 'point-count', inlineCount: a.count, workbookCount: b.count };
  const differences = a.values.flatMap((point, index) => {
    const other = b.values[index];
    return point.kind === other.kind && point.value === other.value ? [] : [{ index, inline: point, workbook: other }];
  });
  return { status: differences.length ? 'different' : 'equal', compared: a.count,
    ...(differences.length ? { differences } : {}) };
}

/** 调查报告保留两路证据，不承担选源、公式重算或层级空白继承策略。 */
export function dimensionEvidence(dimension) {
  const inlineData = inlineDimension(dimension), workbookData = workbookDimension(dimension);
  return { inlineData, workbookData, sourceComparison: compareSources(inlineData, workbookData) };
}
