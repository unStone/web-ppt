import { isOpening, squeezeEm, squeezeTotal } from './cjk-punct';
import { fontSize, measureTextWidth } from './text-measure';
import type { TextMeasure } from './text-measure';
import type { Line, Token } from './text-layout';
import type { TextLayoutCaret, TextLayoutSegment } from './text-layout-types';

const lineWidth = (line: Line): number => (line.squeezed ? line.width - line.squeeze : line.width);

function sourceCharacters(token: Token): Array<{ from: number; to: number; display: string }> {
  const out: Array<{ from: number; to: number; display: string }> = [];
  const source = token.run.text;
  for (let from = token.from; from < token.to;) {
    const cp = source.codePointAt(from)!;
    const value = String.fromCodePoint(cp);
    const to = Math.min(token.to, from + value.length);
    out.push({ from, to, display: token.run.caps === 'all' ? value.toUpperCase() : value });
    from = to;
  }
  return out;
}

function tokenCarets(
  token: Token,
  startX: number,
  squeezed: boolean,
  scale: number,
  measurer?: TextMeasure,
): TextLayoutCaret[] {
  const effectiveWidth = token.width - (squeezed ? token.squeeze : 0);
  if (token.atomic) {
    return [{ offset: token.from, x: startX }, { offset: token.to, x: startX + effectiveWidth }];
  }
  const chars = sourceCharacters(token);
  if (!chars.length) return [{ offset: token.from, x: startX }];
  const measured = chars.map((char) => measureTextWidth(char.display, token.run, scale, measurer));
  const measuredTotal = measured.reduce((sum, width) => sum + width, 0);
  const ratio = measuredTotal > 0 ? token.width / measuredTotal : 0;
  const fallback = measuredTotal > 0 ? 0 : token.width / chars.length;
  let x = startX;
  const carets: TextLayoutCaret[] = [{ offset: chars[0].from, x }];
  chars.forEach((char, index) => {
    const amount = squeezed ? squeezeEm(char.display) * fontSize(token.run, scale) : 0;
    if (amount && isOpening(char.display)) {
      x -= amount;
      carets[carets.length - 1].x = x;
    }
    x += measuredTotal > 0 ? measured[index] * ratio : fallback;
    if (amount && !isOpening(char.display)) x -= amount;
    carets.push({ offset: char.to, x });
  });
  carets[carets.length - 1].x = startX + effectiveWidth;
  return carets;
}

export function publicSegments(
  line: Line,
  lineStart: number,
  scale: number,
  rtl: boolean,
  includeCarets: boolean,
  measurer?: TextMeasure,
): TextLayoutSegment[] {
  let cursor = lineStart;
  const segments = line.segs.map((segment) => {
    const width = segment.width
      - (line.squeezed ? squeezeTotal(segment.text) * fontSize(segment.run, scale) : 0);
    const carets: TextLayoutCaret[] = [];
    let tokenX = cursor;
    if (includeCarets && !segment.bullet) {
      for (const token of segment.tokens ?? []) {
        const stops = tokenCarets(token, tokenX, line.squeezed, scale, measurer);
        if (carets.length && stops.length && carets[carets.length - 1].offset === stops[0].offset) stops.shift();
        carets.push(...stops);
        tokenX += token.width - (line.squeezed ? token.squeeze : 0);
      }
    }
    const result: TextLayoutSegment = {
      runIndex: segment.runIndex ?? -1,
      from: segment.from ?? 0,
      to: segment.to ?? 0,
      text: segment.text,
      x: cursor,
      width,
      naturalWidth: segment.width,
      bullet: segment.bullet === true,
      atomic: segment.atomic === true,
      carets: segment.bullet ? [] : carets,
    };
    cursor += width;
    return result;
  });
  if (!rtl) return segments;

  const mirror = lineStart * 2 + lineWidth(line);
  for (const segment of segments) {
    if (segment.carets.length) {
      segment.carets = segment.carets.map((caret) => ({ ...caret, x: mirror - caret.x }));
      segment.x = Math.min(...segment.carets.map((caret) => caret.x));
    } else segment.x = mirror - segment.x - segment.width;
  }
  return segments;
}
