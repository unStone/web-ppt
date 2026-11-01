import type { Command } from '@web-ppt/edit-core';
import type { AgentCommand, AgentToolInput } from '@web-ppt/edit-core/agent';

type MissingCommand = Exclude<Command['type'], AgentCommand['type']>;
type ExtraCommand = Exclude<AgentCommand['type'], Command['type']>;
const missing: MissingCommand = null as never;
const extra: ExtraCommand = null as never;
const image: AgentCommand = { type: 'AddImage', slideId: 'slide', bytes: 'AA==', mime: 'image/png', rect: { x: 0, y: 0, w: 1, h: 1 } };
const batch: AgentToolInput<'edit'> = { commands: [image] };
void missing;
void extra;
void batch;

// @ts-expect-error JSON 图片字节不接受 Uint8Array
const binary: AgentCommand = { type: 'ReplaceImage', id: 'image', bytes: new Uint8Array(), mime: 'image/png' };
void binary;
