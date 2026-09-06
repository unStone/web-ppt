export interface NativeEditContext extends EventTarget {
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  updateText(start: number, end: number, text: string): void;
  updateSelection(start: number, end: number): void;
  updateControlBounds(bounds: DOMRect): void;
  updateSelectionBounds(bounds: DOMRect): void;
  updateCharacterBounds(start: number, bounds: DOMRect[]): void;
}
export interface NativeTextUpdate extends Event {
  readonly updateRangeStart: number;
  readonly updateRangeEnd: number;
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}
export interface NativeTextFormat {
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly underlineStyle: string;
  readonly underlineThickness: string;
}
export type EditContextWindow = Window & typeof globalThis & {
  EditContext?: new (options: { text: string; selectionStart: number; selectionEnd: number }) => NativeEditContext;
};
export type EditingHost = HTMLDivElement & { editContext: NativeEditContext | null };
