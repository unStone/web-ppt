import {
  TEXT_CAPS_STYLES, TEXT_STRIKE_STYLES, TEXT_UNDERLINE_STYLES,
} from '@web-ppt/edit-core';
import type { ParagraphBullet, RunPropertyOverrides, TextFragment } from '@web-ppt/edit-core';

const BLOCKS = /^(?:address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|tfoot|thead|tr|ul)$/;
const SKIPPED = /^(?:base|head|iframe|link|meta|noscript|object|script|style|template)$/;
const FORMATTING_ELEMENTS = /^(?:b|strong|i|em|u|ins|s|strike|del|span|font)$/;

type ClipboardPort = Pick<DataTransfer, 'getData' | 'setData'>;
type FragmentParagraph = TextFragment['paragraphs'][number];

interface MutableParagraph {
  text: string;
  marks: { from: number; to: number; props: RunPropertyOverrides }[];
  bullet?: ParagraphBullet;
}

const emptyParagraph = (): MutableParagraph => ({ text: '', marks: [] });
const sameProps = (left: RunPropertyOverrides, right: RunPropertyOverrides): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\uFFFC/g, '');
}

export function plainTextFragment(text: string): TextFragment {
  return {
    paragraphs: normalizeText(text).split('\n').map((value): FragmentParagraph => ({
      text: value,
      marks: value ? [{ from: 0, to: value.length, props: {} }] : [],
    })),
  };
}

function append(paragraph: MutableParagraph, text: string, props: RunPropertyOverrides): void {
  const value = normalizeText(text);
  if (!value) return;
  const from = paragraph.text.length;
  paragraph.text += value;
  const previous = paragraph.marks[paragraph.marks.length - 1];
  if (previous && previous.to === from && sameProps(previous.props, props)) previous.to = paragraph.text.length;
  else paragraph.marks.push({ from, to: paragraph.text.length, props: { ...props } });
}

function fontFamily(value: string): string | null {
  const first = value.split(',')[0]?.trim().replace(/^(['"])(.*)\1$/, '$2') ?? '';
  return first && first.length <= 200 && !/[;{}\u0000-\u001f]/.test(first) ? first : null;
}

function fontSize(value: string, inherited?: number | null): number | null {
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)(px|pt|pc|em|rem|%)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const base = inherited ?? 16;
  const size = unit === 'px' ? amount : unit === 'pt' ? amount * 4 / 3 : unit === 'pc' ? amount * 16
    : unit === '%' ? base * amount / 100 : base * amount;
  return Number.isFinite(size) && size > 0 && size <= 1000 ? Math.round(size * 1000) / 1000 : null;
}

function drawingColor(value: string): string | null {
  const color = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const match = /^(rgb|rgba)\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?\)$/i.exec(color);
  if (!match || (match[1].toLowerCase() === 'rgb') !== (match[5] === undefined)) return null;
  const channels = match.slice(2, 5).map(Number);
  const alpha = match[5] === undefined ? 1 : Number(match[5]);
  return channels.every((channel) => channel >= 0 && channel <= 255)
    && alpha >= 0 && alpha <= 1 ? color : null;
}

function finiteAttribute(element: HTMLElement, name: string, limit: number): number | null | undefined {
  if (!element.hasAttribute(name)) return undefined;
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined;
}

function exactMetadata(element: HTMLElement, next: Record<string, unknown>): void {
  const underline = element.getAttribute('data-web-ppt-underline');
  if (underline && (TEXT_UNDERLINE_STYLES as readonly string[]).includes(underline)) {
    next.underline = underline;
    delete next.u;
  }
  const strikeType = element.getAttribute('data-web-ppt-strike');
  if (strikeType && (TEXT_STRIKE_STYLES as readonly string[]).includes(strikeType)) {
    next.strikeType = strikeType;
    delete next.strike;
  }
  const caps = element.getAttribute('data-web-ppt-caps');
  if (caps && (TEXT_CAPS_STYLES as readonly string[]).includes(caps)) next.caps = caps;
  const spacing = finiteAttribute(element, 'data-web-ppt-spacing', 400000 / 75);
  if (spacing !== undefined) next.spacing = spacing;
  const baseline = finiteAttribute(element, 'data-web-ppt-baseline', 2147483.647);
  if (baseline !== undefined) next.baseline = baseline;
  if (element.hasAttribute('data-web-ppt-highlight')) {
    const value = element.getAttribute('data-web-ppt-highlight') ?? '';
    const highlight = drawingColor(value);
    if (!value) next.highlight = null;
    else if (highlight) next.highlight = highlight;
  }
}

function elementProps(element: HTMLElement, inherited: RunPropertyOverrides): RunPropertyOverrides {
  const next: Record<string, unknown> = { ...inherited };
  const tag = element.localName;
  if (tag === 'b' || tag === 'strong') next.b = true;
  if (tag === 'i' || tag === 'em') next.i = true;
  if (tag === 'u' || tag === 'ins') next.u = true;
  if (tag === 's' || tag === 'strike' || tag === 'del') next.strike = true;
  const style = element.style;
  const family = fontFamily(style.fontFamily || (tag === 'font' ? element.getAttribute('face') ?? '' : ''));
  if (family) next.font = family;
  const size = fontSize(style.fontSize, typeof next.size === 'number' ? next.size : null);
  if (size) next.size = size;
  const color = drawingColor(style.color);
  if (color) next.color = color;
  if (/^(bold|bolder)$/i.test(style.fontWeight) || Number(style.fontWeight) >= 600) next.b = true;
  else if (/^(normal|lighter)$/i.test(style.fontWeight) || /^[1-5]00$/.test(style.fontWeight)) next.b = false;
  if (/^(italic|oblique)/i.test(style.fontStyle)) next.i = true;
  else if (/^normal$/i.test(style.fontStyle)) next.i = false;
  const decoration = style.textDecorationLine || style.textDecoration;
  if (/\bnone\b/i.test(decoration)) { next.u = false; next.strike = false; }
  const decorationStyle = style.textDecorationStyle;
  if (/\bunderline\b/i.test(decoration)) {
    next.underline = decorationStyle === 'double' ? 'dbl'
      : decorationStyle === 'dotted' ? 'dotted'
        : decorationStyle === 'dashed' ? 'dash' : decorationStyle === 'wavy' ? 'wavy' : 'sng';
    delete next.u;
  }
  if (/\bline-through\b/i.test(decoration)) {
    next.strikeType = decorationStyle === 'double' ? 'dblStrike' : 'sngStrike';
    delete next.strike;
  }
  const highlight = drawingColor(style.backgroundColor);
  if (highlight) next.highlight = highlight;
  const spacing = /^(-?[0-9]+(?:\.[0-9]+)?)px$/i.exec(style.letterSpacing.trim());
  if (spacing && Math.abs(Number(spacing[1])) <= 400000 / 75) next.spacing = Number(spacing[1]);
  if (style.textTransform === 'uppercase') next.caps = 'all';
  if (style.fontVariantCaps === 'small-caps' || style.fontVariant === 'small-caps') next.caps = 'small';
  if (style.verticalAlign === 'super') next.baseline = 30;
  if (style.verticalAlign === 'sub') next.baseline = -25;
  exactMetadata(element, next);
  return next as RunPropertyOverrides;
}

function htmlFragment(html: string, document: Document): TextFragment | null {
  const template = document.createElement('template');
  template.innerHTML = html;
  const paragraphs: MutableParagraph[] = [];
  let current = emptyParagraph();
  const flush = (force = false): void => {
    if (current.text || force) paragraphs.push(current);
    current = emptyParagraph();
  };
  const walk = (node: Node, props: RunPropertyOverrides): void => {
    if (node.nodeType === node.TEXT_NODE) { append(current, node.nodeValue ?? '', props); return; }
    if (node.nodeType !== node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (SKIPPED.test(element.localName) || element.hidden || element.getAttribute('aria-hidden') === 'true'
      || element.style.display === 'none' || element.style.visibility === 'hidden') return;
    if (element.localName === 'br') { append(current, '\n', props); return; }
    if (element.localName === 'img' || element.localName === 'svg') return;
    const block = BLOCKS.test(element.localName);
    if (block && current.text) flush();
    const encodedBullet = block ? element.getAttribute('data-web-ppt-bullet') : null;
    if (encodedBullet) {
      try { current.bullet = JSON.parse(encodedBullet) as ParagraphBullet; } catch { /* 非法元数据降级为普通文本。 */ }
    }
    const count = paragraphs.length;
    // 未知标签只保留后代文本，不能借自定义元素把任意样式带进文档模型。
    const next = block || FORMATTING_ELEMENTS.test(element.localName)
      ? elementProps(element, props) : props;
    for (const child of element.childNodes) walk(child, next);
    if (block) {
      if (current.text) flush();
      else if (paragraphs.length === count) flush(true);
    }
  };
  for (const node of template.content.childNodes) walk(node, {});
  if (current.text || !paragraphs.length) flush(true);
  return { paragraphs };
}

export function readTextClipboard(
  data: Pick<DataTransfer, 'getData'> | null,
  document: Document,
  plainOnly = false,
): TextFragment | null {
  if (!data) return null;
  const rawPlain = data.getData('text/plain');
  if (rawPlain === '') return null;
  const plain = normalizeText(rawPlain);
  const html = plainOnly ? '' : data.getData('text/html');
  if (!html) return plainTextFragment(plain);
  const rich = htmlFragment(html, document);
  const richText = rich?.paragraphs.map((paragraph) => paragraph.text).join('\n') ?? '';
  return rich && richText === plain ? rich : plainTextFragment(plain);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markHtml(text: string, props: RunPropertyOverrides): string {
  const style: string[] = [];
  if (props.font) style.push(`font-family:${JSON.stringify(props.font)}`);
  if (props.size) style.push(`font-size:${props.size}px`);
  if (props.b !== undefined) style.push(`font-weight:${props.b ? '700' : '400'}`);
  if (props.i !== undefined) style.push(`font-style:${props.i ? 'italic' : 'normal'}`);
  if (props.color) style.push(`color:${props.color}`);
  const underline = props.underline ?? (props.u === undefined ? undefined : props.u ? 'sng' : 'none');
  const strikeType = props.strikeType
    ?? (props.strike === undefined ? undefined : props.strike ? 'sngStrike' : 'noStrike');
  const decoration = [underline && underline !== 'none' ? 'underline' : '',
    strikeType && strikeType !== 'noStrike' ? 'line-through' : ''].filter(Boolean).join(' ');
  if (underline !== undefined || strikeType !== undefined) {
    const decorationStyle = underline === 'dbl' || strikeType === 'dblStrike' ? 'double'
      : underline?.startsWith('wavy') ? 'wavy'
        : underline?.includes('dotted') ? 'dotted'
          : underline?.includes('dash') ? 'dashed' : 'solid';
    style.push(`text-decoration-line:${decoration || 'none'}`, `text-decoration-style:${decorationStyle}`);
  }
  if (props.highlight) style.push(`background-color:${props.highlight}`);
  if (props.spacing !== undefined && props.spacing !== null) style.push(`letter-spacing:${props.spacing}px`);
  if (props.caps === 'all') style.push('text-transform:uppercase');
  else if (props.caps === 'small') style.push('font-variant-caps:small-caps');
  if (props.baseline && props.baseline > 0) style.push('vertical-align:super');
  else if (props.baseline && props.baseline < 0) style.push('vertical-align:sub');
  const metadata = [
    underline !== undefined ? ` data-web-ppt-underline="${underline}"` : '',
    strikeType !== undefined ? ` data-web-ppt-strike="${strikeType}"` : '',
    props.highlight !== undefined
      ? ` data-web-ppt-highlight="${escapeHtml(props.highlight ?? '')}"` : '',
    props.spacing !== undefined && props.spacing !== null
      ? ` data-web-ppt-spacing="${props.spacing}"` : '',
    props.caps !== undefined && props.caps !== null ? ` data-web-ppt-caps="${props.caps}"` : '',
    props.baseline !== undefined && props.baseline !== null
      ? ` data-web-ppt-baseline="${props.baseline}"` : '',
  ].join('');
  const body = escapeHtml(text).replace(/\n/g, '<br>');
  return style.length || metadata ? `<span${metadata}${style.length
    ? ` style="${escapeHtml(style.join(';'))}"` : ''}>${body}</span>` : body;
}

export function textFragmentToHtml(fragment: TextFragment): string {
  return fragment.paragraphs.map((paragraph) => `<div${paragraph.bullet
    ? ` data-web-ppt-bullet="${escapeHtml(JSON.stringify(paragraph.bullet))}"` : ''}>${paragraph.marks.length
    ? paragraph.marks.map((mark) => markHtml(paragraph.text.slice(mark.from, mark.to), mark.props)).join('')
    : ''}</div>`).join('');
}

export function writeTextClipboard(data: ClipboardPort | null, plain: string, html: string): boolean {
  if (!data) return false;
  data.setData('text/plain', plain);
  data.setData('text/html', html);
  return true;
}
