function alpha(input: number): string {
  let value = '';
  let number = input;
  while (number > 0) {
    value = String.fromCharCode(65 + ((number - 1) % 26)) + value;
    number = Math.floor((number - 1) / 26);
  }
  return value;
}

function roman(input: number): string {
  const table: readonly (readonly [number, string])[] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let value = '';
  let number = input;
  for (const [amount, symbol] of table) {
    while (number >= amount) { value += symbol; number -= amount; }
  }
  return value;
}

/** OOXML 自动编号在解析与编辑投影中必须共用同一文字结果。 */
export function formatDrawingAutoNumber(scheme: string, number: number): string {
  let body: string;
  if (scheme.startsWith('alphaLc')) body = alpha(number).toLowerCase();
  else if (scheme.startsWith('alphaUc')) body = alpha(number);
  else if (scheme.startsWith('romanLc')) body = roman(number).toLowerCase();
  else if (scheme.startsWith('romanUc')) body = roman(number);
  else if (scheme.startsWith('circleNum')) {
    body = number >= 1 && number <= 20 ? String.fromCharCode(0x2460 + number - 1) : String(number);
  } else body = String(number);
  if (scheme.endsWith('ParenBoth')) return `(${body})`;
  if (scheme.endsWith('ParenR')) return `${body})`;
  if (scheme.endsWith('Period')) return `${body}.`;
  return body;
}
