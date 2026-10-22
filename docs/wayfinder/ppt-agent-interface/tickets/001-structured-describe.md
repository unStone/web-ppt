---
title: 结构化读出 describe
status: closed
priority: P1
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

Agent 读取文稿时，怎样一次拿到版式、占位符角色、几何与文字，并且拿到的元素 id 可以直接用作编辑命令的目标？

## 范围

| 输出字段 | 来源 | 说明 |
|---|---|---|
| 页：序号、隐藏、版式名、母版名、节、备注文字 | `Presentation`、版式与节信息 | `.pptx` / `.ppt` 输出同一结构 |
| 元素：id、类型、名称、替代文字、层级路径、包围盒 | `EditDoc` 的 `ElementId`；组合按 `placeGroupFrame` 换算到页面坐标 | id 必须是命令接受的同一个 `ElementId`，不另造编号 |
| 占位符：类型、序号、继承来源 | `placeholder-match` | 供模板填充（007）按角色选位 |
| 文字：段落层级、项目符号、纯文字 | `slideText` 与文本模型 | 不输出 run 级样式；样式查询由 004 的查询命令提供 |
| 预算：`maxTokens` / `maxChars` | 读出时截断 | 截断位置和省略的元素数写进结果，不静默丢弃 |

实现前确定入口位置：元素 id 来自 `EditDoc`，所以 describe 至少依赖 edit-core；结论写入地图 Decisions。

## 完成条件

- 发布 JSON Schema，并由 TypeScript 类型生成；`npm run verify` 比对 Schema 与类型一致。
- 全部 `.pptx` / `.ppt` 固件通过 Schema 校验；在独立进程中两次输出逐字节一致。
- 每个元素 id 都能作为 `EditDoc` 命令目标成功选中，由测试逐个核对。
- 截断有正反例测试：预算内完整输出，预算外报告省略数量。
- 基础入口体积不变（verify 体积核对通过）；新入口实测冷加载耗时并登记。

## 不做

- 不输出原始 XML 或完整样式树；不做自然语言摘要。

## Answer

使用 `@web-ppt/edit-core/describe` 的 `describePresentation(doc, options?)` 读取当前 `EditDoc`，复用投影、编辑身份、组合几何与占位符匹配。接口与边界见 [API](../../../api/agent-describe.md)，决策见 [技术方案](../../../design/agent-describe.md)；Schema 通过同包 `describe/schema.json` 导出。

## Resolution

2026-10-22 验收，Node v24.3.0；Schema 生成另在 CI 使用的 Node v20.20.2 通过。

| 维度 | 证据 |
|---|---|
| 源码与发布产物 | `npm run test:describe` / `npm run test:describe:dist` 均通过 432 项契约断言；175 份 pptx/ppt 固件由 Ajv 校验生成的 Schema，并在两个独立进程逐字节比对 |
| 编辑身份 | 每份固件逐个返回 ID 通过 `Editor.select`；另验 SetName、SetAltText、EditText、SetNotes、撤销、组旋转/翻转与层级调整后的读取 |
| 设计与框架对象 | 换版式后旧继承节点退出，新设计节点映射真实设计 ID；未保存的新增版式形状可读；SmartArt 新增节点后读取当前文字，内部绘制节点不冒充稳定编辑目标 |
| 预算 | 完整、恰好容纳、元素/整页截断、中文/代理对/转义、双预算、非法上限、无计数器、计数失败和最小结果不足均有契约验证；截断结果也通过 Schema |
| 发布与兼容 | `npm pack --dry-run` 核对 JS、声明与 Schema 均入包；无源码 paths 的外部 TS 调用编译通过；独立构建前后 core/edit-core 默认静态闭包逐文件 SHA-256 一致 |
| 成本 | 新入口 3366B gzip；两页、4 个逻辑对象，5 个新进程的中位数：冷加载 23.90ms（含 peer）、读出 2.06ms、堆增量 6627920B（含 peer 加载、解析与读出）；记录由 `tooling/measure-agent-describe.mjs` 生成 |
| 仓库门禁 | `npm run check`、`npm test`（含性能）、`npm run build`、`npm run verify` 全部通过；全固件 1164 对 SVG 编辑等价指纹一致；专用固件连续生成两次 SHA-256 一致 |

纯读取不产生编辑历史、恢复帧或协同补丁；测试核对查询前后文档不变。沿用现有保存与渲染链路，Windows PowerPoint 真机按既有约定暂缓。
