import type { AgentToolFailure } from './types';

export class AgentToolError extends Error {
  constructor(
    readonly reason: string,
    message: string,
    readonly commandIndex: number | null = null,
    readonly elementId: string | null = null,
    readonly slideNumber: number | null = null,
  ) {
    super(message);
    this.name = 'AgentToolError';
  }
}

export function failure(error: unknown): AgentToolFailure {
  const source = error as Partial<AgentToolError> & { commandIndex?: number };
  return {
    ok: false,
    error: {
      reason: typeof source?.reason === 'string' ? source.reason : 'tool-failed',
      message: error instanceof Error ? error.message : String(error),
      commandIndex: typeof source?.commandIndex === 'number' ? source.commandIndex : null,
      elementId: typeof source?.elementId === 'string' ? source.elementId : null,
      slideNumber: typeof source?.slideNumber === 'number' ? source.slideNumber : null,
    },
  };
}
