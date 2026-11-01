---
title: 命令工具面
status: closed
priority: P2
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./001-structured-describe.md
  - ./002-layout-lint.md
---

## Question

怎样把现有 `EditDoc` 查询与编辑命令描述成 Agent 可调用的工具，并且每次编辑后立即返回布局观察（「一次编辑，一次观察」）？

## 范围

| 部分 | 说明 |
|---|---|
| 工具描述 | 每个公开命令都有 JSON Schema 输入描述，由命令类型生成，不手写 |
| 查询工具 | describe（001）、单元素样式查询、lint（002）、渲染（003） |
| 编辑工具 | 单条与批量命令；批量命令在同一事务内原子提交，任一失败则整体拒绝 |
| 提交结果 | 受影响元素 id、该页 lint 结果；失败返回稳定 reason 与出错命令序号 |
| 会话 | 打开、保存（补丁保存或生成保存）、撤销 / 重做，沿用 `Editor` 历史 |

实现前确定是否与 005 的 MCP 包合并为同一个新包，结论写入地图 Decisions。

## 完成条件

- 全部公开命令都有 Schema，`npm run verify` 比对 Schema 与命令类型，新增命令漏写 Schema 时 verify 失败。
- 非法输入（Schema 不符、目标 id 不存在、命令语义拒绝）各有原子拒绝测试：文稿与历史均不变。
- 批量命令一次撤销即可整体回退。
- 保存产物通过补丁保存与生成保存两条路径的现有保存门禁，并由 LibreOffice 与独立读取器无修复打开。

## 不做

- 不新增编辑语义：工具面只暴露已有命令，新编辑能力先进 edit-core。

## Answer

采用 `@web-ppt/edit-core/agent` 独立子入口，不与 005 的 MCP 包合并。`listAgentTools()` 提供 describe、单元素样式、lint、渲染、edit、undo、redo、save 八类工具及输入 Schema；`openAgentSession` / `createAgentSession` 复用当前 `EditDoc` 与 `Editor`。[API 与失败协议](../../../api/agent-command-tools.md)，[实现决策](../../../design/agent-command-tools.md)。

`AgentCommand` 覆盖现有 `Command` 联合类型，三条图片命令仅把字节映射为 Base64。Schema、Ajv standalone 校验器和发布 JSON 均由 `tooling/generate-agent-tool-schema.mjs` 生成，运行时无新增依赖。批量在完整校验与目标预检后只执行一次 `Editor` 事务；提交前在结构化克隆上顺序预检并附实际命令序号，新增身份分配与 `Editor` 默认热路径均不受影响。编辑成功后异步观察受影响页，观察失败与提交结果分开表示。

## Resolution（2026-11-02 关闭）

| 完成条件 | 结果与证据 |
|---|---|
| 全命令 Schema 与 verify 防漂移 | `schemas/agent-tools.schema.json`、内嵌 Schema 与 standalone 校验器全部由公开类型生成；`schema:agent --check` 同时核对三者。外部 TypeScript 契约证明 `AgentCommand['type']` 与 `Command['type']` 无缺失或多余，图片字节只接受 Base64 字符串 |
| 三类非法输入原子拒绝 | `tooling/test-agent-tools.mjs` 55 项断言：Schema 额外字段、缺失元素、负几何分别返回 `invalid-input` / `target-not-found` / `command-rejected`；含第二条失败、跨页 `SetZ`、非法 Base64 及新增形状后失败的文档、身份与历史均逐字节不变 |
| 批量一次撤销 | 名称与文字在同一 `Editor` 历史单元提交，一次 undo 同时恢复；redo 恢复编辑；预检在结构化克隆上顺序应用 patch，新增身份不触碰真文档 |
| 查询与观察 | describe、单元素 fill、lint、SVG 均经真实入口调用；编辑后报告只含受影响页；缺测字返回 `node-measure-required`；dist 与源码行为一致 |
| 两种保存与外部打开 | 补丁 / 生成保存均重开核对编辑内容；LibreOffice 26.2.5.2 打开并导出 PDF（15607 / 15050 bytes），macOS Quick Look 另读取成功，证据 `out/agent-tools/external-readers.json` |
| 成本与默认边界 | Agent 336653B gzip；5 个独立进程中位数：冷加载 39.93ms、编辑并观察 6.25ms、堆增量 15290960B。独立构建前后 core / edit-core 默认闭包逐文件 SHA-256 一致；官网激活体积预算通过 |
| 全仓门禁 | `check → test → build → verify` 全部通过：178 份固件 / 600 页 / 1200 对编辑等价指纹，Agent 55 项断言，dist 全套复验及 939 项一致性检查。Python 3.11 下 PDFium 对照通过 |

Windows PowerPoint 真机继续按既有约定暂缓，未记为通过。
