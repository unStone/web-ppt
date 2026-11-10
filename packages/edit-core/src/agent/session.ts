import { parse } from '@web-ppt/core';
import type { Presentation, TextMeasure } from '@web-ppt/core';
import { renderSlidePngInNode, renderSlideSvgInNode } from '@web-ppt/core/node';
import type { NodeRasterizer } from '@web-ppt/core/node';
import { createDoc, disposeDoc, Editor } from '@web-ppt/edit-core';
import type { Command, DesignCommand, EditDoc, EditorChange, Patch, TransactionResult } from '@web-ppt/edit-core';
import { describePresentation } from '../describe/index';
import { lintPresentation } from '../lint/index';
import type { LayoutLintOptions } from '../lint/types';
import { commandPatches } from '../commands/dispatch';
import { applyLocalPatches } from '../commands/patch';
import { decodeBase64, encodeBase64 } from './base64';
import { AgentToolError, failure } from './errors';
import { queryElement } from './query';
import { assertBatchTargets, commonDesignTarget } from './targets';
import { assertToolInput } from './validation';
import type {
  AgentEditInput,
  AgentLintInput,
  AgentMutationResult,
  AgentRenderInput,
  AgentSaveResult,
  AgentToolInput,
  AgentToolName,
  AgentToolOutputMap,
  AgentToolResult,
} from './types';

export interface AgentSessionOptions {
  readonly idPrefix?: string;
  readonly lint?: LayoutLintOptions;
  readonly measureText?: TextMeasure;
  readonly rasterize?: NodeRasterizer;
  readonly presentation?: Presentation;
}

const DEFAULT_LINT: LayoutLintOptions = { checks: ['off-canvas', 'element-overlap'] };

function commandFailure(error: unknown): AgentToolError {
  if (error instanceof AgentToolError) return error;
  const candidate = error as { commandIndex?: unknown };
  const index = typeof candidate?.commandIndex === 'number' ? candidate.commandIndex : null;
  return new AgentToolError('command-rejected', error instanceof Error ? error.message : String(error), index);
}

export class AgentSession {
  private active = true;
  constructor(
    readonly editor: Editor,
    private readonly options: AgentSessionOptions = {},
    private readonly ownsDoc = false,
  ) {}

  get doc(): EditDoc {
    return this.editor.doc;
  }

  async call<T extends AgentToolName>(name: T, input: AgentToolInput<T>): Promise<AgentToolResult<T>> {
    try {
      if (!this.active) throw new AgentToolError('session-disposed', 'Agent 会话已经释放');
      const valid = assertToolInput(name, input);
      const value = await this.dispatch(name, valid);
      return { ok: true, value: value as AgentToolOutputMap[T] };
    } catch (error) {
      return failure(error);
    }
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.editor.dispose();
    if (this.ownsDoc) disposeDoc(this.doc);
  }

  private async dispatch<T extends AgentToolName>(name: T, input: AgentToolInput<T>): Promise<AgentToolOutputMap[AgentToolName]> {
    switch (name) {
      case 'describe':
        return describePresentation(this.doc, input as AgentToolInput<'describe'>);
      case 'element':
        return queryElement(this.doc, input as AgentToolInput<'element'>);
      case 'lint':
        return lintPresentation(this.doc, this.lintOptions(input as AgentLintInput));
      case 'render':
        return this.render(input as AgentRenderInput);
      case 'edit':
        return this.edit(input as AgentEditInput);
      case 'undo':
        return this.replay('undo');
      case 'redo':
        return this.replay('redo');
      case 'save':
        return this.save();
    }
  }

  private async edit(input: AgentEditInput): Promise<AgentMutationResult> {
    const commands = input.commands.map((command, index) => {
      if (!('bytes' in command)) return command as Command;
      return { ...command, bytes: decodeBase64(command.bytes, index) } as Command;
    });
    assertBatchTargets(this.doc, commands);
    const preview = structuredClone({ ...this.doc, package: null }) as EditDoc;
    (preview as { package: EditDoc['package'] }).package = this.doc.package;
    commands.forEach((command, index) => {
      try {
        applyLocalPatches(preview, commandPatches(preview, command, 'agent-preflight').forward);
      } catch (error) {
        throw new AgentToolError('command-rejected', error instanceof Error ? error.message : String(error), index);
      }
    });
    const design = commonDesignTarget(this.doc, commands);
    let result: TransactionResult;
    try {
      result = design ? this.editor.execDesign(design, ...(commands as DesignCommand[])) : this.editor.exec(...commands);
    } catch (error) {
      throw commandFailure(error);
    }
    return this.mutation(result, input.lint, result.forward);
  }

  private async replay(direction: 'undo' | 'redo'): Promise<AgentMutationResult> {
    const result = direction === 'undo' ? this.editor.undo() : this.editor.redo();
    if (!result) throw new AgentToolError('no-history', `没有可${direction === 'undo' ? '撤销' : '重做'}的历史事务`);
    return this.mutation(result);
  }

  private async mutation(
    change: TransactionResult | EditorChange,
    lint?: AgentLintInput,
    forward: readonly Patch[] = [],
  ): Promise<AgentMutationResult> {
    const elements = new Set(change.dirtyElements);
    for (const patch of forward) if (patch.path[0] === 'elements') elements.add(patch.path[1]);
    const slides = new Set([
      ...change.dirtySlides,
      ...change.createdSlides,
      ...change.removedSlides,
      ...change.movedSlides,
      ...change.notesSlides,
    ]);
    const affectedSlides = [...this.doc.slideOrder.filter((id) => slides.has(id)), ...[...slides].filter((id) => !this.doc.slides[id])];
    const slideNumbers = affectedSlides.flatMap((id) => {
      const index = this.doc.slideOrder.indexOf(id);
      return index < 0 ? [] : [index + 1];
    });
    return {
      affectedElements: [...elements].sort(),
      affectedSlides,
      lint: await this.observe(slideNumbers, lint),
      history: { undoCount: this.editor.history.undoCount, redoCount: this.editor.history.redoCount },
    };
  }

  private async observe(slideNumbers: readonly number[], input?: AgentLintInput): Promise<AgentMutationResult['lint']> {
    if (!slideNumbers.length) return { status: 'ok', slideNumbers, report: null };
    try {
      const full = await lintPresentation(this.doc, this.lintOptions(input));
      const pages = new Set(slideNumbers);
      const description = describePresentation(this.doc);
      return {
        status: 'ok',
        slideNumbers,
        report: {
          ...full,
          totalSlides: slideNumbers.length,
          totalElements: description.slides
            .filter((slide) => pages.has(slide.number))
            .reduce((count, slide) => count + slide.elements.length, 0),
          issues: full.issues.filter((issue) => pages.has(issue.slideNumber)),
        },
      };
    } catch (error) {
      return {
        status: 'failed',
        slideNumbers,
        reason: typeof (error as { reason?: unknown }).reason === 'string' ? (error as { reason: string }).reason : 'lint-failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private lintOptions(input: AgentLintInput = {}): LayoutLintOptions {
    return {
      ...DEFAULT_LINT,
      ...this.options.lint,
      ...input,
      measureText: this.options.lint?.measureText ?? this.options.measureText,
    };
  }

  private async render(input: AgentRenderInput): Promise<{ slideNumber: number; format: 'svg' | 'png'; data: string }> {
    if (!Number.isInteger(input.slideNumber) || input.slideNumber < 1 || input.slideNumber > this.doc.slideOrder.length) {
      throw new AgentToolError('target-not-found', `找不到页码：${input.slideNumber}`, null, null, input.slideNumber);
    }
    const slides = this.doc.slideOrder.map((id) => this.editor.toSlide(id));
    const presentation: Presentation = {
      ...this.options.presentation,
      width: this.doc.meta.width,
      height: this.doc.meta.height,
      source: this.doc.meta.source,
      slides,
    };
    const slide = slides[input.slideNumber - 1];
    const options = { measureText: this.options.measureText! };
    if (input.format === 'svg') {
      return { slideNumber: input.slideNumber, format: 'svg', data: renderSlideSvgInNode(presentation, slide, options) };
    }
    const bytes = await renderSlidePngInNode(presentation, slide, {
      ...options,
      rasterize: this.options.rasterize!,
      scale: input.scale,
    });
    return { slideNumber: input.slideNumber, format: 'png', data: encodeBase64(bytes) };
  }

  private async save(): Promise<AgentSaveResult> {
    const saveMode = this.doc.package && !this.doc.package.disposed ? 'patch' : 'generated';
    const result = await this.editor.saveDetailed();
    return {
      bytes: encodeBase64(result.bytes),
      saveMode,
      packageMode: result.mode,
      fallbackReason: result.fallbackReason,
      preservedEntries: result.preservedEntries,
      rewrittenEntries: result.rewrittenEntries,
    };
  }
}

export function createAgentSession(doc: EditDoc, options: AgentSessionOptions = {}): AgentSession {
  return new AgentSession(new Editor(doc), options);
}

export async function openAgentSession(bytes: Uint8Array, options: AgentSessionOptions = {}): Promise<AgentSession> {
  const presentation = await parse(bytes, { edit: true, keepPackage: true, lazy: false });
  try {
    const doc = createDoc(presentation, { idPrefix: options.idPrefix });
    return new AgentSession(new Editor(doc), { ...options, presentation }, true);
  } catch (error) {
    presentation.dispose?.();
    throw error;
  }
}
