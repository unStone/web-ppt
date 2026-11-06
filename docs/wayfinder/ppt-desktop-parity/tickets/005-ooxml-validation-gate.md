---
title: OOXML 合法性门禁
status: closed
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

## Answer

门禁以 `npm run test:ooxml` 进入 CI（构建后单独步骤）与发布流水线（补跑全量路径），`pretest:ooxml` 负责 build 与 .NET 还原。两道校验：

- **结构**：`xmllint` + ECMA-376 5th edition Transitional XSD（SHA256 钉版下载，见 `tooling/prepare-ooxml-schemas.mjs`，含 OPC / pml / dml / chart / vml 全命名空间映射），逐部件校验 sequence、必填子元素与取值。
- **语义**：`tooling/ooxml-validate`（.NET 8 + DocumentFormat.OpenXml 3.1，参考 office-kit/pptx 的 MIT 实现，见 THIRD_PARTY_NOTICES.md）运行 `OpenXmlValidator(Microsoft365)`。

输入集覆盖三份 office-artifacts 清单与 Agent / 模板生成产物共 148 份。两道通道校验同一份等价归一化副本（SDK 通道把归一化部件重新打包，包结构与关系不变）：MCE `AlternateContent` 取 Fallback 展开、根 `mc:Ignorable` 列出的前缀按 MCE 读端语义丢弃、`urn:web-ppt:*` 测试标记剥除（其存活性由功能断言负责，剥空的 `ext` 整只移除；`<ext uri="urn:web-ppt:*">` 是产品写入的扩展，如图表数据身份清单，原样保留）、`a:t` 的 `xml:space` 剥除。SDK 的 `[load-error]` 与 `[Sch_*]` / `[Sem_*]` 同样计为失败。例外逐条登记在 `tooling/lib/ooxml-validation.mjs`，不按部件或文件整类忽略：

| 例外 | 形态 | 原因 |
|---|---|---|
| `buSzPct` 千分比整数 | XSD pattern 报错过滤 | 5th edition 把 ST_TextBulletSizePercent 定为带百分号字符串，PowerPoint / Open XML SDK 实际写 `val="135000"`（SDK 接受，无需在 SDK 侧放行） |
| `a:p` 内裸 `m:oMath` | XSD 与 SDK 双通道过滤 | 两个校验器的 schema 都未在 DrawingML 段落声明 Office Math；LibreOffice 与本引擎直接书写，PowerPoint 实际宽容接受。改写为 MCE `a14:m` 包装牵动解析 / 渲染 / 生成全链路，属于后续数学创作票据，不在本门禁范围 |
| chartex / InkML 根 | 无映射部件跳过 | Microsoft 2014 扩展与 W3C InkML 无 ECMA-376 XSD |

实现过程中修掉的真实缺陷：

- 引擎：图表数据编辑与图表设计把轴标题挪到 `crossAx` 前（XSD 非法，`EG_AxShared` 要求 title 在 numFmt / tickLblPos / spPr / txPr 之前），改为锚定首个后继元素（`chart/xml-data.ts` 的 `axisTitleAnchor`）；非折线 / 散点系列的 `c:smooth` 移除；生成式 run / 段落属性一律按 `xml/order.ts` 顺序表插入（新增 `lvl1pPr`–`lvl9pPr` 与 `defRPr`）。
- 固件（引擎原样保留来源，固件非法就会流进保存产物）：tblStyle 部件序与 `tcTxStyle` 位置、defRPr 的 `ln` 位置、`type="cust"` 不在占位符枚举、`CT_Table` 无 extLst、chartKeep 空图表、`p:extLst` 内误用 `a:ext`、`hlinkMouseOver` 误写在 `cNvPr`（应为 `hlinkHover`）、`fadeThroughBlack` 非标准切换元素、空 `tnLst`、动画行为直接挂在 `tnLst`、MS 扩展属性缺根 `mc:Ignorable`、改名部件未同步 Content Types Override、同一共享部件被两种关系类型引用、仅含动作的 `hlinkClick` 缺 `r:id`。add-table 固件在调整顺序时丢了首行 `b="on"`，一并恢复。

与真机门禁的分工写入 [engineering/testing.md §7.6](../../../engineering/testing.md) 与 [engineering/powerpoint-runner.md](../../../engineering/powerpoint-runner.md)：通过校验不等于 PowerPoint 验收通过。

## Resolution（2026-11-06）

| 验收项 | 结果 |
|---|---|
| 门禁进入 CI 与 verify 依赖说明 | ✅ `ci.yml` 构建后步骤；`release.yml` 补跑全量路径；testing.md §7.6 说明产物依赖 |
| 全部保存产物零错误 | ✅ 148 份产物 XSD 0 错误；SDK 仅余 4 条已登记的裸 `m:oMath` 例外 |
| 结构负例被拦截 | ✅ 改坏根元素被 xmllint 拒绝 |
| 语义负例被拦截 | ✅ 关系目标缺失被 OpenXmlValidator 拒绝 |
| 与真机门禁分工说明 | ✅ testing.md §7.6 + powerpoint-runner.md「与 OOXML 合法性门禁的分工」 |
