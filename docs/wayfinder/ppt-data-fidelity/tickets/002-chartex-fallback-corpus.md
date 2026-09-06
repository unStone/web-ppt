---
title: 确认扩展图表回退与真实语料边界
status: open
assignee: /root
labels:
  - wayfinder:research
parent: ../map.md
blocked_by:
  - ./008-alternate-content-fallback.md
---

## Question

真实 Office 2016+ 文件如何把 `cx:chartSpace`、`mc:AlternateContent`、fallback 图片、关系和内嵌工作簿连接起来，
现有解析器是否确实在全部七类扩展图表上显示 fallback，而不是因为某种生产者差异偶然成功？

收集来源可追溯且可合法用于回归的树状图、旭日、直方图/Pareto、箱线、瀑布、漏斗和地图真实样本；记录各版本
命名空间、关系图、数据维度、空值/负值/重复类别、fallback 形态与 PowerPoint/LibreOffice 行为。从真实样本
最小化出确定性生成固件，但保留决定解析分支的全部结构，并把原样本哈希、来源和探针结果写成可复验清单。

验收必须先证明当前 fallback 在真实 Chrome 和独立 SVG 两条文字路径中可见；再明确六类可原生渲染图的统一数据
模型与 regionMap 永久 fallback 边界。不得把仅由自己编写的 XML 当成真实语料证据，也不得在没有行政区边界数据
时伪造地图原生渲染。

## Progress

2026-09-05 的[一手资料调查](../research/chartex-primary-sources.md)与
[机器可读来源清单](../../../../fixtures/chartex-corpus.json)已经落盘；9 个固定版本文件均在本地核对长度和
SHA-256，原文件仅在被忽略的 `corpus/chartex/` 中，不入库、不打入发布包。

| 证据层 | 实测结果 | 尚不能推出的结论 |
|---|---|---|
| 原有语料 | 扫描 116 个 PPTX，110 个可解 ZIP 中未见 ChartEx；6 个损坏/非 ZIP 输入单列跳过 | 不能以原有大语料回归绿证明 ChartEx 覆盖 |
| 真正的 PPTX | 漏斗图含 `cx2` Choice、`p:pic` Fallback、PNG、ChartEx 数据缓存与内嵌 XLSX | 其余六类 PPTX 的 envelope 和 Office 行为仍缺证 |
| 八个 XLSX | 覆盖七类及 Pareto；全部只有公式引用、零 ChartEx 缓存层级，全部回退为 `xdr:sp` | 不能用这些文件替代 PPTX 图片回退验收，不能把缓存缺失当作空数据 |
| 修复前解析 | 漏斗对象 ID 6 输出 `unsupported`，两条 SVG 均无对应图片 | 源文件带预览图不代表引擎能显示 |
| 单变量对照 | 仅在内存删去 Choice，ID 6 立即输出 image，两条 SVG 各有一张对应图片 | 这是定位分支错误的对照，不是修复，也不是 Chrome 解码/可见性验收 |

可复验命令（需已构建 core 与 edit-core；探针只读，不访问外链）：

```bash
fnm exec --using=v24.3.0 node tooling/probe-chartex.mjs --expect-fallback corpus/chartex/libreoffice-funnel-pp1.pptx
```

修复前实跑退出码 `1`：`actualKinds=["unsupported"]`、`matchedImages=0`、`emitted={html:false,svg:false}`。
图片原始 SHA-256 为 `855f488a5d14106adab0adc1d4a547863f09f2e737fc347dacf493b80ed63096`；单变量对照输出
同一哈希、853.333 × 568.889 px。探针同时按已核对的文件哈希标识来源，并将浏览器可见性与独立图片解码明确
标为 `not-tested`，避免把成功序列化误报成视觉通过；输出也带有实际运行的 core/XML 构建产物哈希。去掉 `--expect-fallback` 可调查 XLSX，输出
`not-applicable` 而非回退成功。

修复路线已拆成[修复未知扩展对象阻断兼容回退](008-alternate-content-fallback.md)，先恢复现有文件的可读性。
本票保持打开：仍需其余六类 PPTX、数据边界及对应的固件与 Chrome/独立 SVG 视觉证据，以及
六类原生渲染的统一输入模型；不能以完成资料搜索代替这些验收。

本轮探针烟测通过：真实漏斗连续两次输出一致且按预期失败；八个 XLSX 不误报图片回退成功；无参数、未知参数
和文件缺失退出码正确。全仓类型检查与 `npm run verify` 重新通过，未改发布包实现或包体积预算，未重复运行
已知受扰的性能门禁。

探针自身的可重复契约为 `fnm exec --using=v24.3.0 node tooling/test-chartex-probe.mjs`：从哈希锁定的原文件在
临时目录生成正对照及“图片 + 同 ID 占位”反例，结束即清理。反例先出现退出码 `0` 的假阳性，收紧为同一源
part/ID 唯一目标图片后通过；临时改写包的来源标为未知，不冒充真实 Office 产物。

### 后续修复证据

票 008 当前实现已让上述原文件探针退出 `0`：`actualKinds=["image"]`、`matchedImages=1`、两条序列化均为
`true`，源 PPTX 与 PNG 哈希均未变化。另经真实 Chrome 截图确认屏幕预览和独立 SVG 均可见，抽样 MAE 均为 0。
自制确定性固件只提炼 envelope 结构，图片和图表数据自行生成；没有重新分发上游媒体。详细命令、视觉证据和
原包释放后的生成保存进度见[实现进度](008-alternate-content-fallback.md)。这些结果只覆盖真实漏斗，不替代其余类型。

### 2026-09-06 数据来源增量

[数据取证与模型约束](../research/chartex-data-model.md)已将 9 个源文件的 ChartEx 公式沿定义名称、工作表关系及
共享字符串解析为可定位矩形；PPTX 内嵌工作簿按自身关系读取并记录哈希。树状/旭日类别的 16 个缺失单元格、
跨分支重复标签、瀑布负值与漏斗隐藏系列已明确记录。确定性人工边界和真实源文件分别验收，不混淆证据层级。

[补充检索](../research/chartex-pptx-corpus-search.md)还核实了上游作者发布的瀑布解包目录：8 点缓存与内嵌
工作簿一致，含负值和小计索引 `0/4/7`。未取得原始 ZIP，未重打包冒充原始 PPTX，未重新分发媒体。

原生布局的统一输入约束已落盘，但层级空槽继承、缓存优先级与各算法退化仍待确认；其他类型的原始 PPTX
仍未齐备，因此本票不关闭，也不把探针能力标成原生绘图能力。

本轮验收：`check → test → build → verify` 全绿，347 项一致性检查通过；Chrome 原有性能预算不变，
546 对编辑等价指纹一致，edit-core 默认入口仍为 82,500 B gzip。新增探针的默认人工边界、`--corpus`
九文件契约和既有回退探针均通过。双轴审查发现的关系读取重复、非工作簿宿主误标均已修复并复审通过。

### 2026-09-06 缓存对齐与层级语义增量

[层级主来源补充](../research/chartex-hierarchy-semantics.md)确认普通稀疏父类别继承有 Microsoft 产品说明；
官方 SDK 旭日示例的缓存层序与工作表列序相反，且反向对齐后仍有标签差异。所查 LibreOffice 固定版本将
两种层级服务分派为不支持提示，因此不能用它的占位图作为原生几何参照；未来仍记录其对照结果，几何另需
可验证的 Office 输出。

[数据探针](../research/chartex-data-model.md#缓存字面值与工作簿的对齐报告)现可读取按索引保留空槽的缓存／
字面维度、按方向投影工作簿矩形，并报告单层原值差异；多层未证实映射不做同位置推断。真实漏斗六维各四点
一致，八个 XLSX 的无缓存状态没有被误报成数据一致。默认人工边界接入构建后的 `verify`，原始来源单独验哈希。

本增量不新增原生绘图、不改变默认发布包依赖图，也不关闭本票；其他类型原始 PPTX、层序映射、优先级和布局
退化仍未齐备。先让数据证据可复验，不把调查输出升级为已完成的六类原生能力。
