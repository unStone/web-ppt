---
title: 新建 SmartArt
status: open
priority: P2
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./001-smartart-layout-engine.md
---

## Question

用户怎样从布局目录插入 SmartArt、在文本窗格里写层级内容，或把已有项目符号文字转换为 SmartArt？

## 现状

`edit-core/smartart` 只能编辑已有 SmartArt 的节点、文字和层级；没有新建入口，也没有内置布局定义。

## 范围

| 部分 | 说明 |
|---|---|
| 布局目录 | 自行编写的 `layoutDef` 集合，覆盖列表、流程、循环、层次结构、关系、矩阵、棱锥七类；每个布局附颜色与样式定义 |
| 命令 | 插入 SmartArt（布局、位置、初始节点）、切换布局（保留数据模型）、从文本框转换（按段落级别生成节点） |
| 原生内容 | 写出 data / layout / quickStyle / colors / drawing 五个部件与关系；drawing 缓存由 001 引擎生成 |
| 产品入口 | 插入菜单的布局选择器、文本窗格、“转换为 SmartArt”（产品待确认） |

## 完成条件

- 目录内每个布局生成固件，保存后 LibreOffice、Open XML SDK 校验器与独立读取器无修复打开，形状与 001 引擎结果一致。
- 切换布局与文本转换可撤销 / 重做 / 恢复，协同下节点身份稳定。
- 目录的布局定义全部为本仓库编写，来源与许可写入固件元数据。

## 参考

上游没有 SmartArt 新建（README 的 Scope 表标注 post-1.0）。布局定义只依据 ECMA-376 §21.4 自行编写，不取 PowerPoint 自带定义，也不取 HeyPuter 的实现。
