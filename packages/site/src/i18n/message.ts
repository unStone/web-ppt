import type { Message } from './messages';

export type MessageParameter = string | number | Date | SiteMessage;
type ParametersIn<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | ParametersIn<Rest> : never;
export type MessageArguments<S extends string> = [ParametersIn<S>] extends [never] ? [] : [Record<ParametersIn<S>, MessageParameter>];
export interface SiteMessage {
  readonly source: Message;
  readonly parameters: Readonly<Record<string, MessageParameter>>;
}
export type SiteNotice = (value: string | SiteMessage, tone?: 'normal' | 'success' | 'error') => void;

/** 跨异步任务传递消息身份，显示时才决定语言；业务字符串始终只是参数。 */
export function message<S extends Message>(source: S, ...args: MessageArguments<S>): SiteMessage {
  return { source, parameters: { ...args[0] } };
}
