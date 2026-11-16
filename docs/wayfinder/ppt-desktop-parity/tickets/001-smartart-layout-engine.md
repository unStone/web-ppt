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

## Answer（2026-11-15，两阶段求值与 composite 约束代数已交付；层级算法待后续）

设计、求值语义与真值对照见[设计文档](../../../design/smartart-layout-engine.md)。

### 根因（2026-11-15）

0.9.0-beta.3 / beta.4 的引擎与规范语义不一致，默认渲染路径（beta.4 接线）上没有缓存的 snake 类 SmartArt 全部形状叠在同一位置：

| 问题 | 规范语义 | 修正前 |
|---|---|---|
| choose 分支内容 | 分支里的 `alg` / `shape` / `presOf` / `constrLst` 属于所在 layoutNode | 只收集子 layoutNode，根节点按 dir 选的算法与象限形状全部丢失 |
| 约束目标 | `forName` 指目标子节点 | 与声明节点名比较，`for="ch" forName` 约束从不生效 |
| 求值顺序 | 父矩形先定，再推子约束 | 子节点先按传入 box 求值 |
| 数据点绑定 | `presOf` 轴选择，一形状可承载多点 | 按布局序逐个绑定 |
| `st` / `cnt` | `st` 从 1 计，`cnt=0` 为全部，多段轴逐段求值 | `st` 从 0 计，`cnt=0` 为空，无多段轴 |
| 字号 | 数据模型 run 直设 `sz` 优先；rule `val` 是收缩下限 | 引擎字号覆盖直设值；rule `val` 被当作起始值 |

此前对照用的「缓存形状数」来自本仓库自己的启发式或引擎输出：LibreOffice 语料里除 matrix1 外缓存 drawing 都为空，那些「与缓存逐形状一致」的结论不成立。

### 交付

| 层 | 交付 |
|---|---|
| 引擎 | `core/src/diagram-engine.ts`：实例树构建（多段轴、choose 分支并入、presOf 多点绑定）+ 自顶向下布局；composite 约束代数（w/h/l/t/r/b/ctrX/ctrY 与偏移、refForName 兄弟引用、`ar`）；snake 网格；溢出收缩与同名统一字号；90°/270° 旋转与缓存同构。只保留经真值验证的 composite / snake / tx / sp，其余算法返回 `unsupported-algorithm` |
| 接入 | graphic-frame 与 diagram-edit：约束字号作为文本继承链缺省，直设 `sz` 优先；`layoutDiagramXml` 显式返回每个元素承载的点（不再依赖取文本顺序），保存的 drawing 写出旋转与多点合并文本 |
| 验收 | `test-smartart-engine`：matrix1 与 PowerPoint 缓存逐形状一致；snake / cycle4 满足 LibreOffice 固定提交的 `testSnakeRows` / `testCycleMatrix` 断言；orgChart1 返回稳定 reason；composite 约束样例与 reason 回退不依赖语料 |

完成条件核对：

- ⚠️ **逐形状对照部分达成**：唯一带 PowerPoint 缓存的 matrix1 逐形状一致；snake、cycle4 缓存为空，按 LibreOffice 断言验收；orgChart1 的层级算法未实现。
- ⚠️ **确定性固件以真实样本替代**：引擎验收用 portability 008 登记的真实样本（pin + SHA1，`fetch-corpus` 可复现）；composite 约束有内联确定性样例。
- ✅ 未实现的算法、轴、约束返回稳定 reason 并回退启发式，不输出未经验证的排布。
- ✅ 编辑节点后保存重开：edit-core/smartart 经 diagram-edit 走同一引擎（`test-smartart-edit`）。

后续工作（保持本票 open）：

1. hierRoot / hierChild / conn（orgChart1，含 `hierBranch` 与助理点），以 LibreOffice `testOrgChart` 系列断言验收。
2. lin / cycle / pyra / radial 先取得带真值的样本（portability 008）。
3. 全部算法覆盖后删除 diagram.ts 的启发式族布局。

## 参考

上游 office-kit/pptx 没有该引擎（`src/internal/diagram/index.ts` 只做直通）。HeyPuter 的实现属于 AGPL，不读取、不移植；依据只有 ECMA-376 与真实样本。

## 不做

- 新建 SmartArt 与内置布局目录（[006](006-smartart-authoring.md)）。
- 三维 SmartArt 样式的光照细节，沿用现有三维近似。
