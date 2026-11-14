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

## Answer（2026-11-14，引擎骨架已交付；层级分支与完整约束代数待后续）

设计与实施见[设计文档](../../../design/smartart-layout-engine.md)。已交付：

| 层 | 交付 |
|---|---|
| 引擎 | `core/pptx/diagram-engine.ts`：layoutDef 树求值（choose/if/else、forEach 十类轴、ref 引用）、十种算法（lin/snake/cycle/pyra/hierRoot/hierChild/conn/tx/sp/composite）、约束子集（w/h/primFontSz/间距/居中/定位，refType + 作用域引用）、ruleLst 字号收缩、覆盖守恒（绑定数据点不足 → `incomplete-coverage` 稳定 reason） |
| 接入 | graphic-frame 与 diagram-edit 引擎优先、reason 回退启发式；极简 layoutDef（第三方工具无子树）返回 `minimal-layout-definition` 走启发式——既有固件与 212+ 快照逐字节不变 |
| 验收 | test-smartart-engine（源码 + dist）：五个真实样本剥离缓存对照——snake 与缓存逐形状一致、matrix1 文本集合一致、orgChart1/cycle4 守恒回退不劣化；reason 与确定性断言；语料缺失时空跑提示 |

完成条件核对（对照票据原文）：

- ⚠️ **逐形状对照部分达成**：snake 类（forEach 驱动）引擎接管且与缓存逐形状一致；matrix 类文本集合一致（装饰形状不绑文本）。orgChart1 的 hierBranch 分支方向与 composite 的完整 l/t/w/h 约束代数未实现——这些变体按覆盖守恒回退启发式（形状/文本数与缓存一致，不劣化），逐条归因见设计文档对照矩阵。
- ⚠️ **确定性固件以真实样本替代**：引擎验收直接用 portability 008 登记的真实样本（pin + SHA1 校验、`fetch-corpus` 可复现），语料缺失时空跑；独立算法固件未单独生成（记录为与票据原文的偏离）。
- ✅ 未实现的构造返回稳定 reason 并回退启发式/缓存，不输出错误排布。
- ✅ 编辑节点后保存重开：edit-core/smartart 经 diagram-edit 走同一引擎，LibreOffice 与独立读取器显示一致（test-smartart-edit 既有断言继续通过）。

后续工作（保持本票 open，缩减范围）：

1. orgChart1 的 hierBranch 不对称分支（l / r / hang）布局。
2. composite 的完整 l/t/w/h 约束代数与 `gdLst` 公式。
3. radial 类真实样本（portability 008 登记）驱动 radial1 引擎化。
4. 全覆盖后删除 diagram.ts 的启发式族布局（当前保留服务极简定义与守恒回退）。

## 参考

上游 office-kit/pptx 没有该引擎（`src/internal/diagram/index.ts` 只做直通）。HeyPuter 的实现属于 AGPL，不读取、不移植；依据只有 ECMA-376 与真实样本。

## 不做

- 新建 SmartArt 与内置布局目录（[006](006-smartart-authoring.md)）。
- 三维 SmartArt 样式的光照细节，沿用现有三维近似。
