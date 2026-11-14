# SmartArt 布局定义引擎

状态：引擎骨架已交付（真实 layoutDef 的树求值 + 九种算法 + 约束/规则子集 + 覆盖守恒回退）；组织结构图分支与 composite 平铺的完整求解器是后续工作。实施记录与对照归因见[票据 001](../wayfinder/ppt-desktop-parity/tickets/001-smartart-layout-engine.md)。

## 1. 问题

没有缓存 drawing 的 SmartArt、以及编辑节点后的重排，此前按六个「布局族」启发式手工排布——布局族之外（matrix、带 constrLst 的组织结构图等）位置与字号偏离。需要按文件自带的 `dgm:layoutDef`（ECMA-376 Part 1 §21.4.2）求值出与 PowerPoint 缓存可对照的形状、位置和字号。

## 2. 设计决策

### D1 引擎只服务完整 layoutDef，极简定义走启发式

[diagram-engine.ts](../../packages/core/src/diagram-engine.ts) 解析 layoutNode 树（choose/if/else、forEach 轴选择、alg、shape、constrLst、ruleLst）并求值。入口节点没有任何子树的「极简定义」（python-pptx / LibreOffice 等第三方工具只写算法名，点展开无从表达）返回稳定 reason `minimal-layout-definition`，由调用方回退到 diagram.ts 的启发式族布局——那里的输出对这类文件已通过验收（test-core 固件与快照继续成立）。

### D2 求值语义（子集）

| 构造 | 支持范围 |
|---|---|
| forEach 轴 | self / ch / des / sib / precedSib / followSib / anc / par / selfAndPar / root（含 `root des` 复合轴）、ref 引用复用、st/cnt 偏移、ptType 过滤 |
| choose/if/else | func=var（dir / linDir / hierBranch）、func=cnt（带 axis / ptType 的关联点计数）、func=depth / maxDepth；op = equ / gte / lte / gt / lt |
| 算法 | lin / snake / cycle / pyra / hierRoot / hierChild / conn / tx / sp / composite（共十种，覆盖 ECMA-376 的全部算法类型） |
| 约束 | w / h / primFontSz / secFontSz / sp / sibSp / secSibSp / ctrX / ctrY / l / t / alignOff / bendDist 及边距类（记录值）；refType + for/forName/refFor/refForName 作用域引用 |
| 规则 | ruleLst 的 primFontSz 收缩（测量文本溢出，按 fact 步进、至多 max 次） |

不认识的算法、轴、函数测试或约束类型在解析/求值时终止并返回稳定 reason（`unsupported-algorithm` / `unsupported-axis` / `unsupported-function` / `unsupported-constraint` / `unsupported-rule`）。

### D3 覆盖守恒：不完整结果不输出

引擎求值出的形状绑定的独立数据点数少于数据点总数时（真实文件的版本变体里，某些分支在缺省 hierBranch / 条件测试下不展开），返回 `incomplete-coverage` 让调用方回退启发式——**不输出比启发式更差的结果**。这是设计标准「稳定 reason 的显式回退」的直接应用。

### D4 数据点绑定与辅助形状

形状与数据点的绑定沿用表现层语义：forEach 选择的点直接绑定；composite 类无 forEach 的树按布局序绑定。`ptType` 变体（parTrans / sibTrans）选出的连线点不在数据点树里，绑定循环统一改绑到下一个未占用的数据点；数据点耗尽后的装饰形状不绑点（文本集合不出现重复项）。

### D5 不做（后续工作）

- 组织结构图（orgChart1）的分支方向变量（hierBranch = l / r / hang）驱动的不对称布局——缺省链路下这些分支不展开，覆盖守恒触发后回退启发式（启发式的层次排布对这两个样本与缓存形状/文本数一致）。
- composite 平铺的完整 l/t/w/h 约束代数（含公式 `gdLst`）——cycle4 的 matrix 变体同样走守恒回退。
- radial 类真实样本仍未取得（portability 008 已登记），radial1 保持启发式覆盖。

## 3. 验收（test-smartart-engine，源码 + dist 双模式）

- **snake-rows**（bList2）：剥离缓存后引擎接管，24 形状 / 15 文本，与 PowerPoint 缓存逐形状一致；几何确定性（同输入两次一致）。
- **matrix1**（composite）：引擎接管，文本集合与缓存一致（5/5）。
- **orgChart1 两个样本与 cycle4**：覆盖守恒触发回退启发式，剥离后形状/文本数与缓存一致（不劣化）。
- reason 回退：极简 layoutDef 返回 `minimal-layout-definition`，启发式输出与既有断言一致（test-core 固件全部继续通过、212+ 快照逐字节不变）。
- 语料缺失时（corpus/ 不入库）测试按空跑退出并提示 `fetch-corpus`，CI 有语料预热。

## 4. 对照矩阵（2026-11-14 实测）

| 样本 | 缓存 | 剥离缓存后 | 路径 |
|---|---|---|---|
| smartart-snake-rows（bList2） | 24 形状 / 15 文本 | 24 / 15 | 引擎接管，逐形状一致 |
| tdf145528_SmartArt_Matrix（matrix1） | 5 / 5 | 9 / 5 | 引擎接管（装饰形状 4 个不绑文本） |
| smartart-org-chart（orgChart1 v14） | 8 / 5 | 8 / 5 | 覆盖守恒 → 启发式 |
| smartart-org-chart2（orgChart1 v12） | 17 / 9 | 17 / 9 | 覆盖守恒 → 启发式 |
| smartart-cycle-matrix（cycle4） | 11 / 11 | 11 / 11 | 覆盖守恒 → 启发式 |
