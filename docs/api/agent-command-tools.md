# Agent 命令工具面

`@web-ppt/edit-core/agent` 把当前 `EditDoc` 的查询、`Editor` 命令、历史、渲染和保存封装为传输协议无关的 JSON 工具。入口不依赖 DOM、网络、模型服务或 MCP SDK；MCP / WebMCP 只负责在各自协议层转发这些工具。

```ts
import { openAgentSession } from '@web-ppt/edit-core/agent';

const session = await openAgentSession(bytes, {
  idPrefix: 'agent-',
  measureText, // 渲染和文字检查需要真实测量
  rasterize,   // 只有 PNG 渲染需要
  lint: { fonts: { available: ['Arial'], embedded: [] } },
});
try {
  const described = await session.call('describe', {});
  if (!described.ok) throw new Error(described.error.message);
  const title = described.value.slides[0].elements.find((element) => element.placeholder?.type === 'title');
  const edited = await session.call('edit', {
    commands: [{ type: 'SetName', id: title.id, name: '季度汇报' }],
  });
  const saved = await session.call('save', {});
} finally {
  session.dispose();
}
```

已有 `EditDoc` 使用 `createAgentSession(doc, options?)`；该路径由调用方管理文档生命周期，`session.dispose()` 只释放编辑器。`openAgentSession` 创建的会话则由会话释放文档与来源资源。

## 工具与输入

`listAgentTools()` 返回工具名、说明和可直接交给协议层的 `inputSchema`。完整 Draft-07 Schema 同时由 `@web-ppt/edit-core/agent/schema.json` 发布，并从公开 TypeScript 类型生成；`npm run schema:agent` 更新，`npm run verify` 检查类型、Schema 和独立校验器一致。

| 工具 | 输入 | 成功结果 |
|---|---|---|
| `describe` | 可选 `maxChars` | 001 的 `PresentationDescription` |
| `element` | 元素 `id`、`query`，文字查询附 `range` / `cell` | 单元素 describe 或 fill / stroke / effects / crop / link / run / paragraph / body 当前状态 |
| `lint` | 七项检查子集与阈值 | 002 的完整 `LayoutLintReport` |
| `render` | 从 1 开始的 `slideNumber`、`format: svg \| png`、可选 `scale` | SVG 字符串或 Base64 PNG |
| `edit` | 非空 `commands`、可选 lint 选项 | 受影响元素 / 页面、该页 lint、历史计数 |
| `undo` / `redo` | 空对象 | 与 `edit` 相同的观察结构 |
| `save` | 空对象 | Base64 PPTX、补丁 / 生成路径及 OPC 保存详情 |

`AgentCommand` 与公开 `Command` 的命令名和字段一致。`AddImage`、`ReplaceImage`、`SetBackgroundImage` 的 `bytes` 在 JSON 中使用规范 Base64 字符串；其余资源仍使用现有纯数据表示。非法 Base64 在任何文档修改前拒绝。

普通页面命令在一个 `Editor.exec(...commands)` 中提交。设计画布命令在一个 `Editor.execDesign(target, ...commands)` 中提交；同一批量只能属于一个设计画布，混合画布返回 `mixed-design-target`。工具不增加编辑语义，扩展命令仍要求宿主先加载对应扩展命名空间。

## 编辑后观察

`edit` 的提交只发生一次，任一命令失败时沿用 `Editor` 逆补丁整体回滚，文稿、选择和历史不变。成功后返回：

- `affectedElements` / `affectedSlides`：实际失效及结构影响的稳定 ID；
- `lint.slideNumbers`：当前仍存在且受影响的页码；
- `lint.report`：只包含这些页的问题；没有现存受影响页时为 `null`；
- `history`：提交后的撤销 / 重做数量。

默认观察只执行不需要宿主资源的 `off-canvas` 与 `element-overlap`。需要文字溢出、字体、对比度等检查时，显式提供 `checks` 及对应的测量、字体或资源解析器。异步观察在提交后执行；观察失败返回 `lint.status: failed` 和稳定 reason，不把已提交编辑伪报为失败，也不擅自撤销。

## 失败协议

调用统一返回 `{ ok: true, value }` 或 `{ ok: false, error }`。错误包含 `reason`、`message`、`commandIndex`、`elementId` 和 `slideNumber`；不能定位的字段为 `null`。

| reason | 含义 |
|---|---|
| `invalid-input` | 输入不符合发布的 JSON Schema；能定位到命令时给出序号 |
| `invalid-base64` | 图片字节不是规范 Base64 |
| `target-not-found` | 页面、元素、版式、母版、主题、节或嵌套目标不存在 |
| `command-rejected` | 锁定、几何、格式、扩展等命令语义拒绝；附实际出错命令序号 |
| `mixed-design-target` | 一个批量混合多个设计画布 |
| `no-history` | 没有可撤销 / 重做的事务 |
| `session-disposed` | 会话已经释放 |
| `node-measure-required` / `node-rasterizer-required` | Node 渲染缺少必需的宿主注入 |

`LayoutLintError` 与 `NodeRenderError` 的既有 reason 原样保留。其他未分类错误为 `tool-failed`，不返回部分成功结果。

## 保存与确定性

`save` 根据当前包状态自动选择：有可补丁原包时走 `saveMode: patch`；来源包释放或没有原包时走 `saveMode: generated`。两条路径均沿用 `Editor.saveDetailed()`，保存点与后续编辑语义不变。Base64 只用于 JSON 传输，解码后再交给核心解析器或文件写入层。

查询和命令输出不包含会话随机的资源 URL。跨进程比较身份时显式使用相同 `idPrefix`；默认身份分配规则不变。工具按需独立构建，`core` 与 `edit-core` 默认入口及其静态分块逐字节不变，Ajv 仅用于开发期生成校验器，不是新增运行时依赖。
