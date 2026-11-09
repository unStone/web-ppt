import generatedValidator from './generated-validator';
import { AgentToolError } from './errors';
import type { AgentToolInput, AgentToolName } from './types';

interface ValidationError {
  readonly instancePath?: string;
  readonly message?: string;
}
interface Validator {
  (value: unknown): boolean;
  readonly errors?: readonly ValidationError[] | null;
}
const validate = generatedValidator as Validator;

export function assertToolInput<T extends AgentToolName>(name: T, input: unknown): AgentToolInput<T> {
  if (!validate({ [name]: input })) {
    const errors = validate.errors ?? [];
    const detail = errors.map((error) => `${error.instancePath || '/'} ${error.message ?? '校验失败'}`).join('; ');
    const commandPath = errors.map((error) => /\/commands\/(\d+)(?:\/|$)/.exec(error.instancePath ?? '')).find((match) => match !== null);
    const commandIndex = commandPath ? Number(commandPath[1]) : null;
    throw new AgentToolError('invalid-input', `${name} 输入不符合 JSON Schema${detail ? `：${detail}` : ''}`, commandIndex);
  }
  return input as AgentToolInput<T>;
}
