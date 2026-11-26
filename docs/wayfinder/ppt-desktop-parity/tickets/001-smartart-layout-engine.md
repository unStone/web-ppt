---
title: SmartArt 布局定义引擎
status: closed
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

## Answer（2026-11-16，十种标准算法、确定性固件与真值对照全部完成）

设计、求值语义与真值对照见[设计文档](../../../design/smartart-layout-engine.md)。

### 交付演进

1. **两阶段求值与 composite / snake（2026-11-15）**：修正 choose 分支属性并入、`forName` 目标子节点作用域、父先于子的自顶向下求值、`presOf` 多点绑定、多段轴与 1 起计 `st`、直设 `sz` 优先与 `zOrderOff` 绘制顺序；`matrix1` 与 PowerPoint 缓存逐形状一致，`snake` / `cycle4` 满足 LibreOffice 参照断言。
2. **全算法覆盖、过渡点轴与确定性固件收口（2026-11-16）**：
   - 补齐 `hierRoot` / `hierChild` / `conn`（含递归 `forEach ref` 惰性展开、`ST_ElementType` 的 `node` 涵盖 `asst` 与 `norm` 区分、节点 `presLayoutVars` 与 `varLst` 的 `hierBranch` 求值、`maxDepth` 子树深度自适应横向/侧挂排布、三段折线与侧挂 L 形连线）、`lin`（横纵流式排布、超限等比压缩、`userA`..`userZ` 变量）、`cycle`（圆周、`ctrShpMap=fNode` 径向中心映射、相邻连线）与 `pyra`（正/倒置梯形带与规则收缩）。
   - 扩展 `pos` / `revPos` / `posOdd` / `posEven` 条件函数、`parTrans` / `sibTrans` 过渡点序列与 `hideLastTrans` 抑制、全部 64 种 `ST_ConstraintType` 与 `ruleLst` 数值规则；`edit-core/smartart` 读写保留 `type="asst"` 助理节点，连线生成唯一 `modelId`。
   - 新增七页无缓存确定性固件 `fixtures/sample-smartart-engine.pptx`（通过 ECMA-376 XSD 与 OpenXmlValidator Microsoft365 双通道零错误，保存产物纳入 `test:ooxml` 门禁），仅对无子树的第三方极简 `layoutDef` 返回 `minimal-layout-definition` 交轻量族布局兜底。

## Resolution（2026-11-16）

| 完成条件 | 结果 |
|---|---|
| 真实样本与缓存 / 参照断言逐形状对照 | ✅ `matrix1` 与 POI `hProcess9` 对照 PowerPoint 缓存逐形状一致；LibreOffice `smartart-snake-rows`、`smartart-cycle-matrix`、`smartart-org-chart`（含 Assistant 与 3 连线）、`smartart-org-chart2`（四层混合横排/侧挂与 8 连线）及 POI `lProcess2` / `vList5` / `venn1` / `AlternatingHexagons` / `hierarchy4` / `hList1` 全部零回退通过 |
| 每类算法、条件分支与规则重试确定性固件 | ✅ `fixtures/sample-smartart-engine.pptx` 覆盖十种算法、条件函数与规则收缩，双跑字节一致 |
| 未知构造稳定 reason 回退 | ✅ 未知算法 / 轴 / 函数 / 约束 / 规则、极简定义与覆盖不完整全部返回稳定 `EngineReason` |
| 编辑节点后保存重开一致 | ✅ 补丁保存与生成保存重开保留改字、`asst` 助理与全部连线，LibreOffice 转 PDF 与 OpenXmlValidator 均零错误 |

## 参考

上游 office-kit/pptx 没有该引擎（`src/internal/diagram/index.ts` 只做直通）。HeyPuter 的实现属于 AGPL，不读取、不移植；依据只有 ECMA-376 与真实样本。

## 不做

- 新建 SmartArt 与内置布局目录（[006](006-smartart-authoring.md)）。
- 三维 SmartArt 样式的光照细节，沿用现有三维近似。
