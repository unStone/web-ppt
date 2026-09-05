/** 只有 JS/Excel/OOXML 往返词法完全不变时，类别标签才继续按数值写入。 */
export function canonicalNumericCategories(values: readonly string[]): number[] | null {
  const numbers: number[] = [];
  for (const value of values) {
    const number = Number(value);
    if (!Number.isFinite(number) || String(number) !== value) return null;
    numbers.push(number);
  }
  return numbers;
}
