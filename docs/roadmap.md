# 能力盘点与演进路线

盘点 `0.5.0-beta.2` 的真实完成度，列全「读 / 写 / 交付」三条线的能力清单，并给出 0.5 转正到 1.0 的
路径与技术方案。范围与词汇沿用 [编辑能力技术方案](editing-design.md) 与 [CONTEXT.md](../CONTEXT.md)。

判断做不做只用两条：**对使用者有没有成本**（运行时、体积、复杂度落不落到用户头上）、**有没有解法**。
工作量不是理由；能做成按需入口 / 可 tree-shake 的等于零成本。

---

## 1. 当前完成度

### 1.1 一句话

**引擎能力已经打穿，自动化交付缺口也已收口。** M0–M6 全部里程碑的技术内容都已验收；
只剩 PowerPoint 真机验收与 0.5.0 转正两个外部动作，不阻塞 0.6 功能开发。

### 1.2 门禁实测（2026-08-31）

| 门禁 | 命令 | 状态 | 证据 |
|---|---|---|---|
| 类型检查 | `npm run check` | ✅ 通过 | 本次实跑，退出码 0 |
| 断言总量 | `npm test` | ✅ 4178 项 | 2168 core + 942 edit + 433 save + 9 PowerPoint + 389 editor + 9 adapters + 98 collab + 130 metafile |
| 渲染快照 | 同上 | ✅ 178 个 | `test/snapshots/` |
| 编辑等价指纹 | 同上 | ✅ 490 对 | 独立进程原始 SVG，两条文本路径 |
| 构建 | `npm run build` | ✅ 8 包 | core / edit-core / viewer-core / editor / react / vue / fonts / collab |
| 跨产物一致性 | `npm run verify` | ✅ 通过 | 许可证 / 版本 / 链接 / HTML id / 文档规模 / 八包清单与体积 |
| PowerPoint 真机 | Windows 自托管工作流 | ❌ **无 runner** | 门禁设施已就绪，缺 Windows + 桌面 PowerPoint |

### 1.3 里程碑

| M | 内容 | 状态 |
|---|---|---|
| M0 | 地基：core 加法 + `EditDoc` + 投影渲染 | ✅ 490 对指纹逐字节等价 |
| M1 | 保存链路：保留型 XML + zip 直通 + 补丁引擎 | ⚠️ 自动证明全绿，**PowerPoint 真机验收缺席** |
| M2 | 选择与变换：三层视图、命中、手柄、吸附、层级、对齐、剪贴板、历史 | ✅ |
| M3 | 文本编辑：覆盖层、IME、扁平模型、段落/run 属性、autofit、Safari engine 行盒 | ✅ |
| M4 | 内容能力：插入形状/图片/表格、填充描边效果、裁剪、超链接、页管理、备注 | ✅ |
| M5 | 打磨：格式刷、查找替换、选择窗格、锁定、崩溃恢复、切换效果 | ✅ |
| M6 | 扩展：动画、顶点、表样式、协同适配包 | ✅ 四项全部独立验收 |

### 1.4 本次交付审计（已收口）

`npm run verify` 首次运行暴露的全部是**源码对、交出去的东西不对**这一类；
[建立跨产物一致性闸门](wayfinder/ppt-editor/tickets/076-cross-artifact-consistency-gate.md) 已逐项修复并固化守卫：

| # | 首次发现 | 处理结果 | 固化守卫 |
|---|---|---|---|
| 1 | 三份文档的断言数全线过期 | 按本轮 4,178 项实测同步 | 各套件全绿后落盘，verify 定点比对 |
| 2 | 快照目录会残留无消费者的旧基线 | 新增孤儿基线检查 | core 测试以本轮实际使用集合反查目录 |
| 3 | README 与官网包表漏 `@web-ppt/collab` | 三张表均完整列八包 | 包表集合必须与非 private package 完全一致 |
| 4 | collab 体积无发布入口声明 | 补 10.04KB gzip | 读取 `package.json#main` 后实测 gzip |
| 5 | 12,160B 与 10.04KB 看似冲突 | 前者是排除 peer 的测试薄包，后者是发布入口 | CHANGELOG 同时声明并分别核对 |
| 6 | 稳定版清单仍写七包 | 改为八包及真实发布顺序 | 发布包版本与构建清单同步比对 |

---

## 2. 功能清单

### 2.1 读：解析与渲染

| 域 | `.pptx` | `.ppt` | 缺口 |
|---|---|---|---|
| 预设几何 | ✅ 187 个（ECMA-376 全集） | ✅ MSOSPT 全表 | — |
| 自定义几何 | ✅ custGeom + gdLst 公式 + arcTo | ✅ pVertices / pSegmentInfo | — |
| 填充 | ✅ 纯色/线性/径向渐变/图片/平铺/图案/主题色变换 | ✅ 纯色/渐变/图片 | — |
| 描边 | ✅ 虚线/箭头/端点/连接 | ✅ 虚线/箭头 | — |
| 效果 | ✅ 外阴影/内阴影/发光/柔化/倒影 | ⚠️ 格式本身没有 | 无解，非缺陷 |
| 3D | ✅ 挤出/斜角/轮廓/材质/视角 | ⚠️ 缺可信样本 | 等轴测近似，非真投影 |
| 文本 | ✅ 完整 + 15 种艺术字变形 | ✅ 基础字符与段落 | 包络型艺术字只弯基线 |
| 样式继承 | ✅ 母版→版式→占位符→段落→run | ✅ TxMasterStyle | — |
| 图片 | ✅ 裁剪/裁进形状/透明度/灰度 | ✅ Pictures 流 | — |
| EMF/WMF/PICT | ✅ 解码为 SVG | ✅ | **EMF+ 未处理**；光栅操作码、Region 布尔无解 |
| 表格 | ✅ tableStyles/条纹/合并/边框/垂直对齐 | ✅ 网格启发式 | — |
| 图表 | ✅ 经典 16 种 + 次坐标轴 + 3D | ✅ 经内嵌 EMF | **chartex 7 种未实现** |
| SmartArt | ✅ 缓存 drawing / 6 种布局族自排 | ❌ | `.ppt` SmartArt 未实现 |
| 媒体·墨迹·评论·节 | ✅ | ❌ | — |
| 组合 | ✅ 嵌套 + 子坐标系 | ✅ 展平 | — |
| 切换 / 动画 | ✅ 20 种 / 四类按点击分批 | ✅ 6 种 / 5 步 | — |
| 加密 | ✅ 标准 AES-ECB / 敏捷 AES-CBC | ✅ RC4 CryptoAPI | **打开密码文件不可解析** |
| 数学公式 | ✅ OMML 解析 | ❌ | 只取线性文本，**不做 MathML 排版** |
| 嵌入字体 | ✅ EOT 剥壳 | — | MTX 压缩需外部 `setFontDecoder` |

导出：PNG（data: URI + foreignObject，像素与预览一致）、独立 SVG 文件（原生 `<text>`，自包含）、
可打印 HTML（按动画批次展开）。**无直接 PDF、无批量图片、无视频。**

### 2.2 写：编辑命令（43 个已实现）

| 域 | 已实现 | 未实现 |
|---|---|---|
| 变换 | `SetXfrm` `SetFlip` `AlignElements` `Group` `Ungroup` | **`DistributeElements`** |
| 结构 | `RemoveElement` `SetZ` `PasteElements` `SetName` `SetLocked` `SetElementHidden` | **`SetAltText`** |
| 形状 | `AddShape` `SetFill` `SetStroke` `SetEffects` `SetGeometry` `ConvertToCustomGeometry` | **`SetPreset`**（改形状类型）、**`SetAdj`**（调节手柄）、`SetScene3D` |
| 图片 | `AddImage` `ReplaceImage` `SetCrop` | **`SetPictureFx`**（透明度/灰度/双色调） |
| 文本 | `EditText` `SetRunProps` `SetParaProps` `SetBodyProps` `FitTextShape` `ReplaceText` | **项目符号/编号**、**高亮/字距/大小写/上下标/下划线类型**、**`ClearFormat`** |
| 表格 | `AddTable` `InsertRow`（**仅尾部追加**）`SetTableStyle` + 单元格文字 | **删行、插/删列、合并/拆分、行高列宽、`SetCellProps`** |
| 页面 | `AddSlide` `RemoveSlide` `MoveSlide` `DuplicateSlide` `SetLayout` `SetBackground` `SetBackgroundImage` `SetBackgroundCrop` `SetHidden` `SetNotes` `SetTransition` `SetAnimations` | **节（`p14:sectionLst`）**、**`SetSlideSize`** |
| 链接 | `SetLink`（元素级 + run 级） | — |
| 格式 | `ApplyFormat`（格式刷） | — |
| 版式/母版/主题 | — | **全部未实现**（`EditDoc.layouts` 只是只读目录，母版不在模型里） |
| 图表/SmartArt/OLE/墨迹/媒体 | 仅框架级 `SetXfrm` / `SetZ` / `RemoveElement` | 内部编辑、**图表数据** |

保存：补丁保存（原包直通，只改脏 part）、生成保存（无原包时确定性生成）、`.ppt` 编辑另存 `.pptx`。

### 2.3 工程与产品

| 能力 | 状态 |
|---|---|
| 发布包 | ✅ 8 个（core / edit-core / viewer-core / editor / react / vue / fonts / collab），`@next` 同版本 |
| 框架适配 | ✅ React 1.02KB + Vue 1.29KB gzip，单一 adapter contract，Svelte / WC 可直接复用 |
| 崩溃恢复 | ✅ 版本化帧 + IndexedDB 分块 + 原子换代 + 挂载前决策 |
| 协同 | ✅ 字段级 LWW、分数序、可插拔 provider、BroadcastChannel 双标签页 |
| 无障碍 | ✅ 选择窗格键盘导航 / 锁定 / 隐藏；⚠️ **画布本身无 AT 语义** |
| 性能契约 | ✅ 抗环境负载，功能失败与预算超标分离 |
| 官网编辑页 | ✅ 独立 `editor.html`，本机打开/编辑/保存/恢复 |
| 触屏 / 移动 | ⚠️ Pointer Events 已统一，**无双指缩放、无长按菜单、无命中容差** |
| 国际化 | ❌ 编辑包零文案（好事）；官网**仅中文** |
| 文件保存 UX | ⚠️ 仅 download，**未接 File System Access** |

---

## 3. 缺口分类与取舍判定

```mermaid
flowchart TD
    G["全部缺口"] --> A["G1 交付缺口<br/>做完了没交出去"]
    G --> B["G2 编辑能力缺口<br/>设计里有，没做"]
    G --> C["G3 解析保真缺口"]
    G --> D["G4 平台缺口<br/>浏览器能力受限"]
    G --> E["G5 范围外<br/>需要重新决策"]
    A --> A1["立刻做：零成本、纯收益"]
    B --> B1["0.6 主线"]
    C --> C1["0.8，按样本驱动"]
    D --> D1["产品层双路径，不进内核"]
    E --> E1["先决策再排期"]
```

| 缺口 | 用户有成本？ | 有解法？ | 判定 |
|---|---|---|---|
| 跨产物一致性 / collab 漏列 | 有（装错包、信错数字） | 有 | ✅ **已完成** |
| 表格结构编辑 | 有（表格是 PPT 高频对象，只能追加行等于不可用） | 有（rowId 已有，缺 colId 与合并不变量） | **0.6 P0** |
| 项目符号 / 编号 | 有（做 PPT 必用） | 有（继承重基与自动编号求值都已具备） | **0.6 P0** |
| 形状预设切换 + 调节柄 | 有（形状库不能变形等于半个形状库） | 有（`a:ahLst` 可从 ECMA 预设定义生成，惰性查表零体积） | **0.6 P0** |
| 字符高级属性 + 清除格式 | 有 | 有（双层模型天然支持删覆盖） | **0.6 P1** |
| 分布 / 替代文字 / 节 / 页面尺寸 | 有（各自小，合起来是「像不像 PowerPoint」） | 有（全是既有基础设施的加法） | **0.6 P1** |
| 触屏手势 | 有（平板打不开等于少一半设备） | 有（Pointer Events 已统一） | **0.6 P1** |
| 批量导出图片 | 有 | 有（`slideToPng` + fflate 已在依赖里） | **0.6 P2，成本近乎零** |
| 主题编辑 | 有（换配色是模板定制第一需求） | 有（phClr / fillRef 求值链路已全通） | **0.7 P0** |
| 版式 / 母版编辑 | 有（企业模板定制） | 有（补丁引擎能改任意 part，缺反向失效索引） | **0.7 P1** |
| 图表数据编辑 | 有（图表是 PPT 第二高频对象） | 有（须同时改 cache 与 embedded xlsx，可做成按需入口） | **0.8 P0** |
| chartex 解析 | 部分（PowerPoint 自带 fallback 预览，不会白屏） | 有，除 `regionMap` | **0.8 P1**，地图无解 |
| 媒体插入 | 有 | 有 | **0.8 P2** |
| File System Access | 有（Safari/Firefox 无法原地覆盖） | 部分（仅 Chromium） | **产品层双路径**，不进内核 |
| EditContext | 无（contenteditable 已能用） | 部分（仅 Chromium） | 渐进增强，不改主路径 |
| Safari LBSE | 无（engine 行盒已兜住） | 上游未默认开启 | **保留兜底，不要删** |
| `.ppt` 二进制写回 | 无（明确转 `.pptx`） | 有但会静默降级 | **不做**（范围外，已决策） |
| EMF+ / 光栅操作码 / Region 布尔 | 无（无样本 / SVG 表达不了） | 无 | **不做**（无解） |
| 地图图表 regionMap | 无 | 无（需数 MB 行政区边界，违反零成本） | **不做**（无解 + 有成本） |
| 宏 / AI 生成 / 模板市场 / 服务端转换 | — | — | **不做**（非目标） |

---

## 4. 演进路线

```mermaid
flowchart LR
    B["0.5.0-beta.2<br/>@next · 8 包"] --> S["0.5.0 转正<br/>只做交付动作"]
    S --> V6["0.6 编辑完整度<br/>让「能编辑」变「够用」"]
    V6 --> V7["0.7 模板与主题<br/>版式 · 母版 · 主题"]
    V7 --> V8["0.8 数据与保真<br/>图表数据 · chartex · 媒体"]
    V8 --> V1["1.0 稳定 API"]
```

| 版本 | 主题 | 票据 | 阻塞 |
|---|---|---|---|
| **0.5.0** | 转正，零新能力 | 一致性闸门 ✅ · PowerPoint 真机 · 转正七步（八包） | PowerPoint 真机需 Windows + 桌面 PowerPoint |
| **0.6** | 编辑完整度 | [补齐 0.6 高频编辑能力](wayfinder/ppt-editing-completeness/map.md)：表格 · 列表 · 预设形状 · 字符格式 · 常用命令 · 触屏 · 批量导出 | 无 |
| **0.7** | 模板与主题 | 主题编辑 · 版式编辑 · 母版编辑 · 内置模板 | 依赖 0.6 的继承重基经验 |
| **0.8** | 数据与保真 | 图表数据编辑 · chartex 解析 · 媒体插入 · 官网 i18n | 需真实语料 |
| **1.0** | 稳定 API | API 冻结 · 语料回归 · 文档完整 | 依赖 beta 反馈周期 |

一致性闸门已完成。PowerPoint 真机验收全程外部阻塞，不要让它挡住 0.6 的开发，只挡 0.5.0 的 tag。

---

## 5. 技术方案

### 5.1 [补齐表格结构与单元格格式编辑](wayfinder/ppt-editing-completeness/tickets/001-table-structure-editing.md)

现在只有尾部追加行。缺的是删行、插/删列、合并/拆分、行高列宽、单元格样式。

**落点**

| 能力 | OOXML |
|---|---|
| 行 | `a:tbl/a:tr`，`@h` 行高（EMU） |
| 列 | `a:tbl/a:tblGrid/a:gridCol@w`；**每行 `a:tc` 数必须等于 `gridCol` 数** |
| 合并 | 锚格 `a:tc@gridSpan`（横跨）/ `@rowSpan`（纵跨）；被覆盖格写 `@hMerge="1"` / `@vMerge="1"` 且**仍须存在** |
| 单元格 | `a:tcPr`：`@anchor` `@marL/R/T/B` `@vert` + `a:lnL/lnR/lnT/lnB/lnTlToBr/lnBlToTr` + 填充 |

**为什么只做了追加**——四个真难点：

| 难点 | 后果 | 解法 |
|---|---|---|
| 删行/列会切断跨越它的合并矩形 | `hMerge`/`vMerge` 悬空 → PowerPoint 提示修复 | 删除前先把跨越边界的合并**分解**成独立格，作为同一事务的一部分 |
| 表格 frame 的 `ext` 由行高列宽之和决定 | 插行后 frame 高度不对，视觉漂移 | 复用 `037`（spAutoFit）的 **entry 级因果历史**：结构改动与 frame 改高是一个原子单元 |
| 协同/恢复日志需要稳定地址 | 行有 `rowId`（`039` 引入），列没有 | 补对称的 `colId`，与 `rowId` 同一分配器 |
| 条纹与首末行列样式由**序号**派生 | 插删后整表样式全变 | 投影缓存对表格**整体失效**，不做逐格失效 |

**模型**：合并只保留**单一真值**——锚格 + 跨度。`hMerge`/`vMerge` 是投影期展开的产物，模型里不可写，
从源头掐掉「两个地方都能改、改得不一致」这类 bug。

**命令**

```ts
InsertRow{ id, at }            // 扩展现有：at 省略仍为尾部追加
RemoveRow{ id, row: RowId }
InsertCol{ id, at, width }
RemoveCol{ id, col: ColId }
MergeCells{ id, from: CellAddr, to: CellAddr }
SplitCell{ id, cell: CellAddr }
SetRowHeight{ id, row, h } / SetColWidth{ id, col, w }
SetCellProps{ id, cells: CellAddr[], props }   // null 恢复来源，同 SetEffects 双语义
```

**不变量**（进 `model-invariants.ts`，事务边界校验）：① 每行 `tc` 数 == `gridCol` 数
② 合并矩形互不重叠、不越界 ③ 锚格自身不是 `hMerge`/`vMerge` ④ 行高列宽 ≥ 0。

**验收**：确定性固件 `sample-editor-table-structure.pptx`（含预置合并）+ LibreOffice 网格 oracle +
独立进程等价指纹 + PowerPoint 无修复打开 + 60 格提交预算。

### 5.2 [切换预设形状并拖动调节柄](wayfinder/ppt-editing-completeness/tickets/003-preset-shape-adjustments.md)

模型侧几乎零新增——`003` 已让编辑投影保留 `preset + adj`，`geometry/` 能求值全部 187 个预设。

| 命令 | 落点 | 说明 |
|---|---|---|
| `SetPreset{ id, preset }` | `a:prstGeom@prst` + 重置 `a:avLst` | 保留填充/描边/效果/`a:txBody`，只换几何 |
| `SetAdj{ id, name, value }` | `a:avLst/a:gd@name@fmla="val N"` | 拖动调节柄 |

**唯一的新东西是调节柄的位置**。ECMA-376 的预设定义里每个形状带 `a:ahLst`（adjust handle list）：
`a:ahXY` 给出手柄坐标与 `minX/maxX/minY/maxY`，`a:ahPolar` 给出 `minR/maxR/minAng/maxAng`。
现在的几何层只求值 path，没读 ahLst。

- 表**从 ECMA 预设定义生成**，不手写——和 187 个预设本身同一来源
- 按预设名**惰性查表**，只在编辑器拖手柄时加载 → 默认渲染路径零增重，可 tree-shake
- 拖动时按 min/max 夹逼，杜绝生成 PowerPoint 拒绝的几何

### 5.3 [编辑项目符号与自动编号](wayfinder/ppt-editing-completeness/tickets/002-bullets-and-numbering.md)

`SetParaProps` 扩展一个 `bullet` 字段：

```ts
bullet?: { kind: 'none' }
       | { kind: 'char'; char: string; font?: string }
       | { kind: 'autoNum'; type: AutoNumType; startAt?: number }
       | { kind: 'blip'; image: ImageRef }
       | null   // null = 删覆盖，回到版式/母版继承
```

| 事实 | 影响 |
|---|---|
| `a:buNone` / `a:buChar` / `a:buAutoNum` / `a:buBlip` **互斥** | 写时必须先删同组其它元素（同 `SetFill` 的坑）；`xml/order.ts` 里这组 sequence **已经登记好了** |
| 级别默认项目符号来自版式/母版 `a:lvlNpPr` | 「无覆盖」≠「无项目符号」，必须走 `068` 建立的九级继承重基 |
| 自动编号续号 | `text-auto-number.ts` 的 `formatDrawingAutoNumber` 已实现，投影直接复用 |

配套 `a:buFont` / `a:buClr` / `a:buSzPct`。难度低、频次高，0.6 里性价比最高的一项。

### 5.4 [补齐字符高级格式与清除格式](wayfinder/ppt-editing-completeness/tickets/004-advanced-run-formatting.md)

`SetRunProps` 现在只有 `font / size / color / b / i / u / strike` 七个字段。补齐：

| 属性 | 落点 |
|---|---|
| 高亮 | `a:rPr/a:highlight` |
| 字距 | `a:rPr@spc`（1/100 pt） |
| 大小写 | `a:rPr@cap="all\|small\|none"` |
| 上下标 | `a:rPr@baseline`（1/1000 %） |
| 下划线类型 | `a:rPr@u`（17 种，现在只有布尔） |
| 删除线类型 | `a:rPr@strike="sngStrike\|dblStrike"` |

`ClearFormat{ id, range }` 删除 `a:rPr` 上的**直接**属性回到继承——这正是 `src`/`ovr` 双层模型的
免费红利（`delete ovr`），几乎零新增代码。

### 5.5 [补齐分布、替代文字、节与页面尺寸](wayfinder/ppt-editing-completeness/tickets/005-common-object-and-slide-commands.md)

全是既有基础设施的加法，合并成一张票：

| 命令 | 落点 | 复用 |
|---|---|---|
| `DistributeElements{ ids, axis }` | 批量 `a:off` | `028` 的世界 AABB + 父空间逆变换；≥3 个才允许 |
| `SetAltText{ id, title, descr }` | `p:cNvPr@title/@descr` | 选择窗格的 `SetName` 已经在改同一个节点 |
| `AddSection` / `RenameSection` / `MoveSection` / `RemoveSection` | `p:extLst/p14:sectionLst` | 解析侧已支持；`045` 删页闭包已经在维护 `sectionLst` |
| `SetSlideSize{ w, h }` | `p:sldSz` | v1 只做「最大化」；PowerPoint 的「确保适合」要等比重排全部元素，留 P2 |

### 5.6 [补齐触屏编辑手势](wayfinder/ppt-editing-completeness/tickets/006-touch-editing-gestures.md)

Pointer Events 已统一，`slide-editor.ts` 也已按模式设 `touch-action: none`。缺的是三件事：

| 项 | 现状 | 方案 |
|---|---|---|
| 命中容差 | 按精确命中，手指点不中细描边 | 按 `pointerType==='touch'` 放大命中半径，只改交互层，不改模型 |
| 双指缩放/平移 | 无 | 双指进入画布导航，**不进历史**；与既有 rAF 幽灵状态机同一层 |
| 长按菜单 | 无 | 长按 = 右键语义，产品层决定菜单内容 |

判定：`pointerType` 分支只在编辑器交互层，查看路径零影响。

### 5.7 [批量导出幻灯片图片](wayfinder/ppt-editing-completeness/tickets/007-batch-image-export.md)

`slideToPng` 已有，fflate 已在依赖里。加一个 `presentationToImageZip(pres, { scale })`，
产品层不用自己循环 + 打包。成本接近零，直接做。

**直接 PDF 不做**——`presentationToPrintableHtml` + 浏览器打印已经能出矢量、可搜索的 PDF。
真正缺的是**无人值守导出**（不弹打印对话框），那要 PDF 写入器 + 字体子集化，收益不抵成本，排在母版之后再评估。

### 5.8 主题 / 版式 / 母版编辑（0.7）

**收益排序：主题 > 版式 > 母版。** 改一处主题，全文档立刻变样，而 `phClr` / `fillRef` / `lnRef`
的求值链路解析侧已经全通。

| 阶段 | 命令 | 落点 | 难点 |
|---|---|---|---|
| 主题 | `SetTheme{ clrScheme?, fontScheme? }` | `ppt/theme/themeN.xml` | 全文档失效，不能按元素增量 |
| 版式 | 复用 slide 的全部命令，把 layout 当特殊投影 | `ppt/slideLayouts/slideLayoutN.xml` | **继承倒灌** |
| 母版 | 同上 | `ppt/slideMasters/slideMasterN.xml` | 同上，再加 `p:txStyles` |

**核心难点是继承倒灌**：现有 WeakMap 精确缓存按「元素 / 页」设计，改版式要让引用它的**所有页**
失效。需要新建一层反向索引 `layoutId → SlideId[]`，在 `SetLayout` / `AddSlide` / `RemoveSlide` 时维护。

第二个难点是**占位符反向重绑**：`053` 解决的是「页换版式」，这里是「版式改了，页上已绑定的占位符
失去宿主」——同一套 `placeholder-match` 逻辑反着跑一遍。

写回无新基础设施：补丁引擎本来就能改任意 part。

### 5.9 图表数据编辑（0.8）

图表是 PPT 里第二高频的对象，现在是 `editable: 'frame'`。做完整需要**同时改两处**：

```mermaid
flowchart LR
    U["用户改数值"] --> C["ppt/charts/chartN.xml<br/>c:numCache / c:strCache"]
    U --> X["ppt/embeddings/WorkbookN.xlsx<br/>sheet1.xml + sharedStrings.xml"]
    C --> P["PowerPoint 显示的值"]
    X --> E["双击「编辑数据」时 Excel 看到的值"]
```

只改缓存 → 显示对，但用户一点「编辑数据」就看到旧数；只改工作簿 → 显示不变。**必须同时改。**

- xlsx 写回需要一个最小 SpreadsheetML 补丁器，**复用 `edit-core/opc` 与 `edit-core/xml` 两个按需入口**，不引新依赖
- 做成 `@web-ppt/edit-core/chart` 独立按需入口 → 主包零增长
- 范围只到**数值与类别的增删改**。图表类型切换要重建整棵 `c:plotArea`，收益低，不做

### 5.10 chartex（0.8）

`cx:chartSpace` 是**另一套 schema**，7 种布局：树状图、旭日、直方图（含 Pareto）、箱线、瀑布、漏斗、地图。
落在 `ppt/charts/chartEx1.xml`，通过 `p:graphicFrame` 的 `<mc:AlternateContent>` 挂载。

**关键情报：PowerPoint 自己就在 `Fallback` 里放一份 `p:pic` 预览图**，所以不实现 cx 也不会白屏——
需要拿真实样本实测确认当前 fallback 路径确实走通了，这是排优先级的前提。

真要实现，六种都是纯几何，`chart/plots.ts` 已有同类代码：squarify（树状图）、极坐标堆叠（旭日）、
累计基线（瀑布）、五数概括（箱线）、梯形（漏斗）、分箱 + 累计线（直方图/Pareto）。

**`regionMap` 明确不做**：需要几 MB 的世界行政区边界数据，塞进包里把成本落到每个用户头上，
按需下载又要求文件可公网获取——与「文件不出本机」冲突。保持 fallback。

### 5.11 平台事实与对策

调研结论（2026-08）：

| 平台能力 | 事实 | 对我们的影响 | 对策 |
|---|---|---|---|
| WebKit LBSE | 2026 年 7 月 Igalia 仍在做性能优化，**默认未开启**，需 runtime flag | Safari 的 `foreignObject` 缩放 bug 还在 | **保留 `034` 的 engine 行盒路径，不要因为「LBSE 快落地了」删掉** |
| EditContext | 仍**只有 Chromium**，Safari/Firefox 未实现（有社区 polyfill） | 自绘文本 + 完整 IME 只能在 Chrome 用 | contenteditable 保持主路径；EditContext 只做渐进增强，且必须在两条路径跑同一套断言 |
| File System Access | `showSaveFilePicker` **只有 Chromium**；Safari/Firefox 仅 OPFS，且 Firefox 是**有意不实现** | Safari/Firefox 保存只能是下载，无法原地覆盖 | 产品层双路径：有 FSA 就 `showSaveFilePicker` + 记住句柄；否则 download。**属于产品层职责，不进 `editor` 包**（与 `Ctrl/Cmd+S` 现有分工一致） |

---

## 6. 需要重新决策的范围外项

`map.md` 的「Out of scope」定于首个完整版本，0.5 之后其中三条值得重新过一遍：

| 项 | 原因 | 建议 |
|---|---|---|
| 图表数据编辑 | 原文是「首个完整版本只支持框架级」 | **改为 0.8 目标**（§5.9 已给方案） |
| 母版 / 版式编辑 | 未明确列为范围外 | **纳入 0.7** |
| 审阅批注工作流 | 明确非目标 | 解析侧已支持结构化评论；**只做只读展示与导出，不做工作流**，保持非目标 |
| `.ppt` 二进制写回 | 会静默降级 OOXML 独有能力 | **维持不做** |
| SmartArt / OLE / 墨迹内部编辑 | 内部结构不可安全改写 | **维持 `editable: 'frame'`** |
| 宏 / 真三维 / 模板市场 / AI 生成 / 服务端转换 | 与产品边界冲突 | **维持不做** |

---

## 7. 立即可执行的三件事

| 顺序 | 动作 | 阻塞 | 产出 |
|---|---|---|---|
| 1 | 开始[补齐表格结构与单元格格式编辑](wayfinder/ppt-editing-completeness/tickets/001-table-structure-editing.md) | 无 | 最大的结构缺口闭环 |
| 2 | 随后完成[编辑项目符号与自动编号](wayfinder/ppt-editing-completeness/tickets/002-bullets-and-numbering.md) | 无 | 0.6 P0 主线过半 |
| 3 | 找一台 Windows + 桌面 PowerPoint 跑自托管 runner | **外部** | 解开 0.5.0 转正 |

第 3 项全程外部阻塞，**只挡 0.5.0 的 tag，不要让它挡住 0.6 的开发**。
