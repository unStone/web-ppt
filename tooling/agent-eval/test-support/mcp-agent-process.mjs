import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [host, config] = process.argv.slice(2);
const client = new Client({ name: 'explicit-external-agent-test-double', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [host, '--config', config], stderr: 'pipe' });
transport.stderr?.on('data', (bytes) => process.stderr.write(bytes));
let index = 0;
const call = async (tool, args) => {
  const id = `item_${index++}`;
  console.log(JSON.stringify({ type: 'item.started', item: { id, type: 'mcp_tool_call', server: 'ppt_eval', tool, arguments: args } }));
  const result = await client.callTool({ name: tool, arguments: args });
  console.log(
    JSON.stringify({
      type: 'item.completed',
      item: { id, type: 'mcp_tool_call', server: 'ppt_eval', tool, arguments: args, result, status: 'completed' },
    }),
  );
  const data = JSON.parse(result.content[0].text);
  if (!data.ok) throw new Error(`实际 MCP 调用失败：${tool}: ${JSON.stringify(data.error)}`);
  return data.value;
};
try {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'test-double' }));
  await client.connect(transport);
  await client.listTools();
  const { sessionId } = await call('ppt_open', { path: 'input.pptx' });
  await call('ppt_describe', { sessionId });
  await call('ppt_edit', {
    sessionId,
    commands: [
      {
        type: 'ReplaceText',
        scope: { kind: 'document' },
        from: 'Draft quarterly report',
        to: 'Approved quarterly report',
        matchCase: true,
        wholeWord: false,
      },
    ],
  });
  await call('ppt_lint', { sessionId });
  await call('ppt_save', { sessionId, path: 'result.pptx' });
  await call('ppt_close', { sessionId });
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 0, output_tokens: 0 }, testDouble: true }));
} finally {
  await client.close();
}
