import type { TemplateFillOutline } from './types';
import { TemplateFillError } from './errors';

function text(value: string, path: string, page: number | null): string {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (
      point === 9
      || point === 10
      || point === 13
      || (point >= 0x20 && point <= 0xd7ff)
      || (point >= 0xe000 && point <= 0xfffd)
      || (point >= 0x10000 && point <= 0x10ffff)
    )
      continue;
    throw new TemplateFillError(
      'invalid-outline',
      `${path} 包含 XML 1.0 不允许的字符 U+${point.toString(16).toUpperCase().padStart(4, '0')}`,
      page,
      path,
    );
  }
  return value.replace(/\r\n?/g, '\n');
}

/** 在写入 OOXML 前规范化行尾；不能依赖宽容的自有解析器替独立读取器把关。 */
export function normalizedOutline(outline: TemplateFillOutline): TemplateFillOutline {
  const copy = structuredClone(outline);
  const visit = (value: unknown, path: string, page: number | null): unknown => {
    if (typeof value === 'string') return path.endsWith('.image.bytes') || path.endsWith('.layoutId') ? value : text(value, path, page);
    if (Array.isArray(value)) return value.map((item, index) => visit(item, `${path}[${index}]`, path === 'slides' ? index + 1 : page));
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        (value as Record<string, unknown>)[key] = visit(child, path ? `${path}.${key}` : key, page);
      }
    }
    return value;
  };
  return visit(copy, '', null) as TemplateFillOutline;
}
