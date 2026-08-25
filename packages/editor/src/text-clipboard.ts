import type { RunPropertyOverrides, TextFragment } from '@web-ppt/edit-core';

const BLOCKS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'li', 'main', 'nav', 'ol',
  'p', 'pre', 'section', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul',
]);
const SKIPPED = new Set(['base', 'head', 'iframe', 'link', 'meta', 'noscript', 'object', 'script', 'style', 'template']);
const FORMATTING_ELEMENTS = new Set([
  ...BLOCKS, 'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'span', 'font',
]);

type ClipboardPort = Pick<DataTransfer, 'getData' | 'setData'>;
type FragmentParagraph = TextFragment['paragraphs'][number];

interface MutableParagraph {
  text: string;
  marks: { from: number; to: number; props: RunPropertyOverrides }[];
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

function elementProps(element: HTMLElement, inherited: RunPropertyOverrides): RunPropertyOverrides {
  const next: { -readonly [K in keyof RunPropertyOverrides]: RunPropertyOverrides[K] } = { ...inherited };
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
  if (/^(bold|bolder)$/i.test(style.fontWeight) || Number(style.fontWeight) >= 600) next.b = true;
  else if (/^(normal|lighter)$/i.test(style.fontWeight) || /^[1-5]00$/.test(style.fontWeight)) next.b = false;
  if (/^(italic|oblique)/i.test(style.fontStyle)) next.i = true;
  else if (/^normal$/i.test(style.fontStyle)) next.i = false;
  const decoration = style.textDecorationLine || style.textDecoration;
  if (/\bnone\b/i.test(decoration)) { next.u = false; next.strike = false; }
  if (/\bunderline\b/i.test(decoration)) next.u = true;
  if (/\bline-through\b/i.test(decoration)) next.strike = true;
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
    if (SKIPPED.has(element.localName) || element.hidden || element.getAttribute('aria-hidden') === 'true'
      || element.style.display === 'none' || element.style.visibility === 'hidden') return;
    if (element.localName === 'br') { append(current, '\n', props); return; }
    if (element.localName === 'img' || element.localName === 'svg') return;
    const block = BLOCKS.has(element.localName);
    if (block && current.text) flush();
    const count = paragraphs.length;
    // 未知标签只保留后代文本，不能借自定义元素把任意样式带进文档模型。
    const next = FORMATTING_ELEMENTS.has(element.localName) ? elementProps(element, props) : props;
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
  const decoration = [props.u ? 'underline' : '', props.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  if (props.u !== undefined || props.strike !== undefined) style.push(`text-decoration:${decoration || 'none'}`);
  const body = escapeHtml(text).replace(/\n/g, '<br>');
  return style.length ? `<span style="${escapeHtml(style.join(';'))}">${body}</span>` : body;
}

export function textFragmentToHtml(fragment: TextFragment): string {
  return fragment.paragraphs.map((paragraph) => `<div>${paragraph.marks.length
    ? paragraph.marks.map((mark) => markHtml(paragraph.text.slice(mark.from, mark.to), mark.props)).join('')
    : ''}</div>`).join('');
}

export function writeTextClipboard(data: ClipboardPort | null, plain: string, html: string): boolean {
  if (!data) return false;
  data.setData('text/plain', plain);
  data.setData('text/html', html);
  return true;
}
