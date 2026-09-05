import { homeMessages } from './en-home';
import { editorMessages } from './en-editor';
import { sampleMessages } from './en-samples';

export const messages = { ...homeMessages, ...editorMessages, ...sampleMessages } as const;
export type Message = keyof typeof messages;
