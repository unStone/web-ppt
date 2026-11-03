---
title: OOXML 合法性门禁
status: open
priority: P1
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

在 Windows PowerPoint 真机验收暂缓期间，怎样在 Linux CI 上用独立实现证明补丁保存、生成保存与 `.ppt` 另存 `.pptx` 的产物满足 OOXML 结构与语义规则？

## 现状

CI 用 LibreOffice 重开与独立读取器验证保存产物；没有按 ECMA-376 XSD 做结构校验，也没有运行 Open XML SDK 的语义校验。LibreOffice 能容忍的错误，PowerPoint 可能判定为需要修复。

## 范围

| 部分 | 说明 |
|---|---|
| XSD 结构校验 | 对保存产物的每个 XML 部件按 ECMA-376 Transitional XSD 校验（`xmllint`） |
| 语义校验 | 独立 .NET 工具运行 `OpenXmlValidator`，覆盖属性共存约束、关系目标、取值范围与部件不变量 |
| 输入集 | 全部编辑固件的保存产物、v07 / v08 Office 工件清单、Agent 与模板生成产物 |
| CI | Linux job 安装 .NET 与 xmllint；任一错误失败并打印错误 Id、部件与 XPath |
| 已知例外 | 例外清单逐条写明规则 Id 与原因，不允许整类忽略 |

## 完成条件

- 门禁进入 CI 与 `npm run verify` 的依赖说明；现有全部保存产物零错误，或每个例外有登记的原因。
- 人为注入的结构错误与语义错误各至少一例被门禁拦截（负例测试）。
- `engineering/testing.md` 与 `engineering/powerpoint-runner.md` 说明该门禁与真机门禁的分工：通过校验不等于 PowerPoint 验收通过。

## 参考

上游 `tools/ooxml-validate/`（`Program.cs`、`ooxml-validate.csproj`）与 `test/fn-charts.test.ts` 中的 `xmllint` 调用方式（MIT，`18b7e75`）；上游 `test/corpus/` 的跨生成器对照（PptxGenJS、python-pptx 产物）作为输入集扩展的参考。

## 不做

- 替代 Windows PowerPoint 真机门禁（[ppt-editor 010](../../ppt-editor/tickets/010-prove-m1-save.md) 仍是正式发布条件）。
