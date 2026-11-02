---
title: 模板填充生成
status: closed
assignee: codex
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
| 设计调整 | 在生成副本中修复可确定处理的问题，完整七项检查必须零问题；输入模板与大纲不变 |
| 保存 | 补丁保存（保留模板原包）或生成保存 |

## 完成条件

- 三套内置模板与至少一份外部模板的生成结果 lint 零错误。
- 生成产物保存重开后与生成时的 describe 输出一致；LibreOffice 与独立读取器无修复打开。
- 同一输入两次生成，产物逐字节一致。
- 大纲中的非法内容（未知页类型、缺图、图表数据形状不符）原子拒绝。

## 不做

- 不生成内容本身，大纲由调用方或外部 Agent 提供；不做模板市场。

## Answer

独立入口 `@web-ppt/edit-core/fill` 与公开大纲 Schema，覆盖标题、章节、正文、双栏、图片和八种原生图表。输入校验后在私有文稿中按占位符角色生成，执行真实设计修复、保存与规范化重开，返回最终字节、describe、完整 lint、可编辑 ID 和修复记录。[API](../../../api/agent-template-fill.md) · [技术方案](../../../design/agent-template-fill.md)。

## Resolution

2026-11-02 关闭。生成副本允许实际调整设计，以全部七项检查零问题为完成标准；原始输入保持不变。

| 维度 | 证据 |
|---|---|
| 大纲与原子性 | 483 项固定业务断言：严格 Schema、六类页面、非法内容、XML 1.0 字符、Unicode/行尾、启动配置快照、裁剪精度、取消和输入保护；无部分成功文件 |
| 包类型 | 普通 POTX 主内容类型规范化为 PPTX；普通 PPTX 新旧生成字节不变，源输入不变，最终描述与真实重开一致；宏主类型明确拒绝。11 项包协议回归、最终六页转换产物的 LibreOffice/Quick Look 打开通过 |
| 原生内容 | 八种 chart + 内嵌 XLSX、公式/缓存、缺失点、系列与类别独立 XML 校验；真实 query/edit/undo/redo/save 重开验证，图片字节一致 |
| 全部七项 | 70 项真实浏览器断言；自有样本与 aurora/editorial/midnight 各六页严格零问题，真实 FontFace/OFL 别名、Canvas 字宽和 SVG 像素取样；修复修改实际 master/layout XML 和投影，未过滤 issue 或降低阈值 |
| 外部模板 | Apache POI `WithMaster.pptx`，来源固定 commit `29c9cacc354613eedf6c7ee24007a597f64c1951`，[语料清单](../../../../fixtures/corpus.json)，SHA-256 `54ae7677fd2813a815160cc72bd8960a4e482690dfc369b392868521c9b61549`；六页原有 15 项低对比度经真实修改后全部七项零问题，静态母版文字保留；`external-report.json`、`browser-report-dist.json` |
| 身份与往返 | 最终文件以同一 idPrefix 实际重开，describe 逐字段一致；bindings 与修复 ID 对应最终文稿 |
| 确定性 | 两个独立进程 PPTX SHA-256 均为 `fc2e587743062b62b40f3cdf9a1ff79e806c3ab080436b458b391759333c5e65`；describe/lint/bindings 相同，读/编辑两条文字路径指纹一致；`out/template-fill/determinism.json` |
| 源码与发布 | 纯发布模式审计无 src 混入；五份源码/发布生成产物逐字节相同，`source-dist-parity.json`；npm 清单、类型编译、Schema 和独立入口复验通过 |
| 独立读取器 | 五份各六页产物均由 LibreOffice 无修复打开并导出 PDF、Quick Look 生成有效缩略图；输入冻结防并发重写，`external-readers.json`、`office-dist-browser.log`。Quick Look 的深色动态页码/稀疏缓存/气泡预览近似单独记录；不将打开成功等同像素相同。Windows PowerPoint 真机按原决定暂缓 |
| 备注闭包 | 新增/改写备注补 notesMaster、主题、Content-Type、Presentation 显式目录/关系及 NotesSlide 关系；未编辑历史来源保持字节，已有母版私有扩展复用，撤销/重做、共享备注分叉与 detached 删页恢复回归通过；保存套件 582 项 |
| 默认成本 | 独立构建前后 core/edit-core 默认闭包逐文件 SHA-256 不变；`default-entry-proof.json`。最终入口静态闭包 174881B raw / 42585B gzip，不含 peer 与动态内置配方 |
| 运行成本 | 五个独立 Node 冷导入（含 peer）中位 34.58ms；三个独立 Chrome，资源准备后六页 Aurora 含修复、原生图表、保存重开和七项检查中位 1908.8ms。客户端入口与共享缓存 GC 后 JS 堆增量中位约 6.96MB，不等同纯入口或进程内存；`performance.json` |
| 全仓 | 最终版本 check → 完整 test（含性能）→ 九包 build → verify 全部通过；181 份固件、1210 对编辑等价指纹、212 个快照，官网生产中英文静态检查通过；`out/template-fill/gates.json`、`final-*.log`。此前浏览器契约一次超时及原阈值隔离重测通过证据保留在 `timeout-full-test.log` / `performance-isolated.log`，未更改任何阈值 |
