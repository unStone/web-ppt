import type { AgentSessionOptions, AgentToolFailure, AgentSaveResult, AgentRenderResult } from '@web-ppt/edit-core/agent';

export type AgentMcpOptions = Omit<AgentSessionOptions, 'idPrefix' | 'presentation'>;

export class AgentMcpError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgentMcpError';
  }
}

export interface AgentMcpOpenResult {
  readonly sessionId: string;
  readonly path: string;
}

export type AgentMcpSaveResult =
  | {
      readonly ok: true;
      readonly value: AgentSaveResult & { readonly path: string };
    }
  | AgentToolFailure;

export type AgentMcpRenderResult =
  | {
      readonly ok: true;
      readonly value: AgentRenderResult & { readonly path?: string };
    }
  | AgentToolFailure;
