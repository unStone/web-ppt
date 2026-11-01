import type { LayoutCheck, LayoutLintReport } from '../lint/types';
import type { PresentationDescription } from '../describe/types';
import type {
  AddImageCommand as EditAddImageCommand, Command, ReplaceImageCommand as EditReplaceImageCommand,
  SetBackgroundImageCommand as EditSetBackgroundImageCommand, TextRange,
} from '../commands/types';
import type { TableCellAddress } from '../types';

type JsonBytes<T> = T extends { readonly bytes: Uint8Array }
  ? { readonly [K in keyof T]: K extends 'bytes' ? string : T[K] }
  : T;
type BinaryCommand = EditAddImageCommand | EditReplaceImageCommand | EditSetBackgroundImageCommand;
export type AddImageCommand = JsonBytes<EditAddImageCommand>;
export type ReplaceImageCommand = JsonBytes<EditReplaceImageCommand>;
export type SetBackgroundImageCommand = JsonBytes<EditSetBackgroundImageCommand>;

/** 与 Editor 命令一一对应；图片字节在 JSON 传输中使用 Base64。 */
export type AgentCommand = Exclude<Command, BinaryCommand>
  | AddImageCommand | ReplaceImageCommand | SetBackgroundImageCommand;

export interface AgentDescribeInput {
  readonly maxChars?: number;
}

export type AgentElementQuery = 'describe' | 'fill' | 'stroke' | 'effects' | 'crop' | 'link'
  | 'run' | 'paragraph' | 'body';

export interface AgentElementInput {
  readonly id: string;
  readonly query: AgentElementQuery;
  readonly range?: TextRange;
  readonly cell?: TableCellAddress;
}

export interface AgentLintInput {
  readonly checks?: readonly LayoutCheck[];
  readonly canvasColor?: string;
  readonly overlapRatio?: number;
  readonly imageDeviation?: number;
  readonly tolerancePx?: number;
  readonly maxIssues?: number;
}

export interface AgentRenderInput {
  readonly slideNumber: number;
  readonly format: 'svg' | 'png';
  readonly scale?: number;
}

export interface AgentEditInput {
  /** @minItems 1 */
  readonly commands: readonly AgentCommand[];
  readonly lint?: AgentLintInput;
}

export interface AgentEmptyInput {
  readonly [key: string]: never;
}

/** 每个属性是一种工具；校验时只提交当前工具对应的单属性对象。 */
export interface AgentToolInputMap {
  readonly describe?: AgentDescribeInput;
  readonly element?: AgentElementInput;
  readonly lint?: AgentLintInput;
  readonly render?: AgentRenderInput;
  readonly edit?: AgentEditInput;
  readonly undo?: AgentEmptyInput;
  readonly redo?: AgentEmptyInput;
  readonly save?: AgentEmptyInput;
}

export type AgentToolName = keyof AgentToolInputMap;
export type AgentToolInput<T extends AgentToolName> = NonNullable<AgentToolInputMap[T]>;

export interface AgentToolDescriptor {
  readonly name: AgentToolName;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface AgentElementResult {
  readonly id: string;
  readonly query: AgentElementQuery;
  readonly value: unknown;
}

export interface AgentRenderResult {
  readonly slideNumber: number;
  readonly format: 'svg' | 'png';
  readonly data: string;
}

export interface AgentHistoryState {
  readonly undoCount: number;
  readonly redoCount: number;
}

export interface AgentMutationResult {
  readonly affectedElements: readonly string[];
  readonly affectedSlides: readonly string[];
  readonly lint: {
    readonly status: 'ok';
    readonly slideNumbers: readonly number[];
    readonly report: LayoutLintReport | null;
  } | {
    readonly status: 'failed';
    readonly slideNumbers: readonly number[];
    readonly reason: string;
    readonly message: string;
  };
  readonly history: AgentHistoryState;
}

export interface AgentSaveResult {
  readonly bytes: string;
  readonly saveMode: 'patch' | 'generated';
  readonly packageMode: 'identity' | 'passthrough' | 'repacked';
  readonly fallbackReason: string | null;
  readonly preservedEntries: number;
  readonly rewrittenEntries: number;
}

export interface AgentToolOutputMap {
  readonly describe: PresentationDescription;
  readonly element: AgentElementResult;
  readonly lint: LayoutLintReport;
  readonly render: AgentRenderResult;
  readonly edit: AgentMutationResult;
  readonly undo: AgentMutationResult;
  readonly redo: AgentMutationResult;
  readonly save: AgentSaveResult;
}

export interface AgentToolFailure {
  readonly ok: false;
  readonly error: {
    readonly reason: string;
    readonly message: string;
    readonly commandIndex: number | null;
    readonly elementId: string | null;
    readonly slideNumber: number | null;
  };
}

export type AgentToolResult<T extends AgentToolName> =
  | { readonly ok: true; readonly value: AgentToolOutputMap[T] }
  | AgentToolFailure;
