import type { TextBody } from '@web-ppt/core';
import { textFragmentFromRange, textPositionToIndex } from '@web-ppt/edit-core';
import type {
  RunPropertyOverrides, TextEditOp, TextFragment, TextPosition,
} from '@web-ppt/edit-core';
import {
  readTextClipboard, textFragmentToHtml, writeTextClipboard,
} from './text-clipboard';

interface ClipboardTextContext {
  text: TextBody;
  positions: { from: TextPosition; to: TextPosition };
}

interface TextClipboardControllerOptions {
  enabled(): boolean;
  context(): ClipboardTextContext | null;
  pendingProps(): RunPropertyOverrides;
  commit(ops: readonly TextEditOp[], nextIndex: number, label: string): void;
}

type PasteIntent = { kind: 'default' } | { kind: 'plain-once'; resetTimer: number | null };
const PASTE_INTENT_TIMEOUT_MS = 1000;

function fragmentLength(fragment: TextFragment): number {
  return fragment.paragraphs.reduce((length, paragraph) => length + paragraph.text.length, 0)
    + Math.max(0, fragment.paragraphs.length - 1);
}

function withPendingProps(fragment: TextFragment, pending: RunPropertyOverrides): TextFragment {
  if (!Object.keys(pending).length) return fragment;
  return {
    paragraphs: fragment.paragraphs.map((paragraph) => ({
      ...paragraph,
      marks: paragraph.marks.map((mark) => ({ ...mark, props: { ...pending, ...mark.props } })),
    })),
  };
}

export class TextClipboardController {
  private readonly options: TextClipboardControllerOptions;
  private root: HTMLDivElement | null = null;
  private pasteIntent: PasteIntent = { kind: 'default' };

  constructor(options: TextClipboardControllerOptions) { this.options = options; }

  bind(root: HTMLDivElement): void {
    this.root = root;
    root.addEventListener('copy', (event) => this.copy(event));
    root.addEventListener('cut', (event) => this.cut(event));
    root.addEventListener('paste', (event) => this.paste(event));
    root.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() !== 'v' || !event.shiftKey || event.altKey
        || (!event.ctrlKey && !event.metaKey)) return;
      this.armPlainPasteIntent(root);
    });
  }

  release(): void {
    this.resetPasteIntent();
    this.root = null;
  }

  beforeInput(event: InputEvent): boolean {
    if (event.inputType !== 'insertFromPaste') return false;
    event.preventDefault();
    this.insert(event.dataTransfer, this.consumePlainPasteIntent());
    return true;
  }

  private copy(event: ClipboardEvent): boolean {
    if (!this.options.enabled()) return false;
    const context = this.options.context();
    const root = this.root;
    if (!context || !root || !event.clipboardData) return false;
    const from = textPositionToIndex(context.text, context.positions.from);
    const to = textPositionToIndex(context.text, context.positions.to);
    if (from === to) return false;
    const fragment = textFragmentFromRange(context.text, context.positions);
    const plain = fragment.paragraphs.map((paragraph) => paragraph.text).join('\n');
    const html = textFragmentToHtml(fragment);
    if (!writeTextClipboard(event.clipboardData, plain, html)) return false;
    event.preventDefault();
    return true;
  }

  private cut(event: ClipboardEvent): void {
    const context = this.options.context();
    if (!context || !this.copy(event)) return;
    const from = textPositionToIndex(context.text, context.positions.from);
    this.options.commit([{ type: 'replace', ...context.positions, text: '' }], from, '剪切文字');
  }

  private paste(event: ClipboardEvent): void {
    if (!this.options.enabled()) return;
    event.preventDefault();
    this.insert(event.clipboardData, this.consumePlainPasteIntent());
  }

  private armPlainPasteIntent(root: HTMLDivElement): void {
    this.resetPasteIntent();
    const resetTimer = root.ownerDocument.defaultView?.setTimeout(
      () => this.resetPasteIntent(), PASTE_INTENT_TIMEOUT_MS,
    ) ?? null;
    this.pasteIntent = { kind: 'plain-once', resetTimer };
  }

  private consumePlainPasteIntent(): boolean {
    const plainOnly = this.pasteIntent.kind === 'plain-once';
    this.resetPasteIntent();
    return plainOnly;
  }

  private resetPasteIntent(): void {
    if (this.pasteIntent.kind === 'plain-once' && this.pasteIntent.resetTimer !== null) {
      this.root?.ownerDocument.defaultView?.clearTimeout(this.pasteIntent.resetTimer);
    }
    this.pasteIntent = { kind: 'default' };
  }

  private insert(data: Pick<DataTransfer, 'getData'> | null, plainOnly: boolean): void {
    const context = this.options.context();
    const root = this.root;
    if (!context || !root) return;
    const parsed = readTextClipboard(data, root.ownerDocument, plainOnly);
    if (!parsed) return;
    const fragment = withPendingProps(parsed, this.options.pendingProps());
    const from = textPositionToIndex(context.text, context.positions.from);
    this.options.commit([{
      type: 'replaceFragment', ...context.positions, fragment,
    }], from + fragmentLength(fragment), plainOnly ? '粘贴纯文本' : '粘贴文字');
  }
}
