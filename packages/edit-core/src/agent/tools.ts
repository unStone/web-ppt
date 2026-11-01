import { agentToolSchema } from './generated-schema';
import type { AgentToolDescriptor, AgentToolName } from './types';

const DESCRIPTIONS: Readonly<Record<AgentToolName, string>> = {
  describe: '读取页面、元素身份、文字与版式结构',
  element: '读取单个元素的当前样式或文字属性',
  lint: '检查文字溢出、重叠、越界、对比度、字体、占位文字与图片比例',
  render: '将当前编辑投影渲染为 SVG 或 PNG',
  edit: '在一个原子事务中提交一条或多条编辑命令并返回布局观察',
  undo: '撤销一个历史事务并返回布局观察',
  redo: '重做一个历史事务并返回布局观察',
  save: '按当前包状态执行补丁保存或生成保存',
};
const NAMES = Object.keys(DESCRIPTIONS) as AgentToolName[];

export function listAgentTools(): readonly AgentToolDescriptor[] {
  return NAMES.map((name) => ({
    name,
    description: DESCRIPTIONS[name],
    inputSchema: {
      $schema: agentToolSchema.$schema,
      $ref: `#/definitions/AgentToolInputMap/properties/${name}`,
      definitions: agentToolSchema.definitions,
    },
  }));
}
