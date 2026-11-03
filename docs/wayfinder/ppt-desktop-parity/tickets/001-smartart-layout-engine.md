---
title: SmartArt 布局定义引擎
status: open
priority: P1
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

没有缓存 drawing 的 SmartArt、以及编辑节点后的重排，怎样按文件自带的布局定义得到与 PowerPoint 一致的形状、位置和字号？

## 现状

`core/src/pptx/diagram.ts` 在缺少缓存时按 6 个布局族（linear、cycle、pyramid、hierarchy、snake、radial）启发式排布；`edit-core/smartart` 编辑节点后也按布局族重排。布局族之外的布局（matrix、venn 变体、带 `constrLst` 的组织结构图等）位置与字号都会偏离。

## 范围

| 部分 | 说明 |
|---|---|
| 布局树 | 解析 `dgm:layoutDef`：`layoutNode`、`forEach`、`choose` / `if` / `else` 条件、`presOf`、`presLayoutVars` |
| 算法 | ECMA-376 Part 1 §21.4.2 的 `lin`、`snake`、`cycle`、`hierRoot` / `hierChild`、`pyra`、`conn`、`tx`、`sp`、`composite` |
| 约束与规则 | `constrLst` 的等式、引用、`refFor` / `refForName`、作用域；`ruleLst` 的递减重试（文字缩小、间距收缩） |
| 文字适配 | 与 `layoutText` 同一测量，规则要求统一字号时整组求值 |
| 输出 | 产出与缓存 drawing 同构的形状列表，进入 Schema；保存时写回 drawing 缓存 |
| 接入 | 渲染无缓存时、`edit-core/smartart` 编辑后均走引擎；布局族启发式在引擎覆盖全部算法后删除 |

## 完成条件

- 真实样本（[portability 008](../../ppt-portability-fidelity/tickets/008-native-object-scope.md) 已登记的 POI 语料，以及该票待取得的 matrix / radial / 组织结构图）去掉缓存后，引擎结果与 PowerPoint 缓存逐形状比较：位置与尺寸误差、字号差异有明确阈值并全部通过，超阈值的样本逐条归因。
- 每类算法、条件分支与规则重试各有确定性固件，两次运行逐字节一致。
- 未实现的算法或约束类型返回稳定 reason 并回退到缓存或占位框，不输出错误排布。
- 编辑节点后保存重开，LibreOffice 与独立读取器显示一致。

## 参考

上游 office-kit/pptx 没有该引擎（`src/internal/diagram/index.ts` 只做直通）。HeyPuter 的实现属于 AGPL，不读取、不移植；依据只有 ECMA-376 与真实样本。

## 不做

- 新建 SmartArt 与内置布局目录（[006](006-smartart-authoring.md)）。
- 三维 SmartArt 样式的光照细节，沿用现有三维近似。
