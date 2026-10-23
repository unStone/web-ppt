---
title: 模板填充生成
status: open
priority: P3
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./002-layout-lint.md
  - ./004-command-tool-surface.md
---

## Question

给定模板与内容大纲，怎样确定性地生成保留主题与母版、原生可编辑的文稿？

## 范围

| 步骤 | 复用 |
|---|---|
| 解析大纲 JSON（页、标题、正文、图片、图表数据），Schema 公开 | 004 的 Schema 生成方式 |
| 按占位符角色为每页选版式；无匹配版式时给出 reason，不拉伸替代 | `placeholder-match`、001 的版式描述 |
| 新建页并填文字、图片与图表数据 | `AddSlide` from layout、`ReplaceImage`、图表数据编辑 |
| 文字适配 | `FitTextShape`、autofit |
| 生成后检查 | 002 的 lint |
| 保存 | 补丁保存（保留模板原包）或生成保存 |

## 完成条件

- 三套内置模板与至少一份外部模板的生成结果 lint 零错误。
- 生成产物保存重开后与生成时的 describe 输出一致；LibreOffice 与独立读取器无修复打开。
- 同一输入两次生成，产物逐字节一致。
- 大纲中的非法内容（未知页类型、缺图、图表数据形状不符）原子拒绝。

## 不做

- 不生成内容本身，大纲由调用方或外部 Agent 提供；不做模板市场。
