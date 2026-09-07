# 能力盘点与演进路线

> 更新于 2026-09-07，实现提交 `8803e07`。扩展能力与限制见[能力矩阵与格式边界](expanded-capabilities.md)，验证证据见[交付记录](wayfinder/ppt-expanded-capabilities/map.md)。Windows 真机按用户要求继续跳过。

> 下一阶段按[内容流转、导出与保真计划](wayfinder/ppt-portability-fidelity/plan.md)推进；首项[高级文本生成保存与复制](portable-rich-text.md)已完成，下一项为经典图表多级类别编辑。

盘点 `0.5.0-beta.3` 的真实完成度，列全「读 / 写 / 交付」三条线的能力清单，并给出 0.5 转正到 1.0 的
路径与技术方案。范围与词汇沿用 [编辑能力技术方案](editing-design.md) 与 [CONTEXT.md](../CONTEXT.md)。

判断做不做只用两条：**对使用者有没有成本**（运行时、体积、复杂度落不落到用户头上）、**有没有解法**。
工作量不是理由；能做成按需入口 / 可 tree-shake 的等于零成本。

---

## 1. 当前完成度

### 1.1 一句话

**截至 `8803e07`，上一轮确认的功能范围已实现**：0.6 编辑、0.7 模板/主题、0.8 图表数据/现代图表/媒体，
以及图片效果、立体编辑、画布读屏语义、EditContext 与官网自动按需加载。2026-09-07 完成七类扩展：
图表深度编辑、批注编辑、页面确保适合、SmartArt/OLE/墨迹内部编辑、高级渲染、PDF/WebM 直接导出、
原生 PPT 生成保存及无来源复制。编辑能力已贯通历史、恢复、协同与保存重开，官网生产页面中英文工作流通过。
用户于 2026-09-06 要求跳过 Windows 真机验证，先完成功能；真实 ChartEx 类型语料、Windows 验收、
beta 反馈和正式发布继续单独登记。API 契约和迁移准备见 [1.0 API 准备](api-stability.md)。

### 1.2 门禁实测（2026-09-07，整轮通过）

| 门禁 | 命令 | 状态 | 证据 |
|---|---|---|---|
| 类型检查 | `npm run check` | ✅ 通过 | 本次实跑，退出码 0 |
| 断言总量 | `npm test` | ✅ 8772 项，原性能门禁通过 | 2230 core + 1132 edit + 575 save + 258 chart data + 197 MC fallback + 870 media + 29 templates + 31 v07 + 9 PowerPoint + 444 editor + 12 adapters + 134 collab + 130 metafile + 104 native ChartEx + 31 comments + 1789 扩展能力 + 797 高级文本流转 |
| 渲染快照 | 同上 | ✅ 186 个 | `test/snapshots/` |
| 编辑等价指纹 | 同上 | ✅ 696 对 | 102 份固件、348 页，独立进程原始 SVG 两条文本路径 |
| 构建 | `npm run build` | ✅ 8 包通过，原体积预算不变 | core / edit-core / viewer-core / editor / react / vue / fonts / collab |
| 跨产物一致性 | `npm run verify` | ✅ 通过（roadmap 更新后复核） | 一致性与按需发布入口契约 + 28 项 0.6 审计 + 18 项 0.7 审计 + 15 项 0.8 审计；原体积预算不变 |
| PowerPoint 真机 | Windows 自托管工作流 | ⏸ 按用户要求跳过 | 已修复经典图表系列标题和子节点顺序；未将修复标为完整 Windows 验收通过 |

### 1.3 里程碑

| M | 内容 | 状态 |
|---|---|---|
| M0 | 地基：core 加法 + `EditDoc` + 投影渲染 | ✅ 696 对指纹逐字节等价 |
| M1 | 保存链路：保留型 XML + zip 直通 + 补丁引擎 | ⚠️ 自动证明全绿，**PowerPoint 真机验收缺席** |
| M2 | 选择与变换：三层视图、命中、手柄、吸附、层级、对齐、剪贴板、历史 | ✅ |
| M3 | 文本编辑：覆盖层、IME、扁平模型、段落/run 属性、autofit、Safari engine 行盒 | ✅ |
| M4 | 内容能力：插入形状/图片/表格、填充描边效果、裁剪、超链接、页管理、备注 | ✅ |
| M5 | 打磨：格式刷、查找替换、选择窗格、锁定、崩溃恢复、切换效果 | ✅ |
| M6 | 扩展：动画、顶点、表样式、协同适配包 | ✅ 四项全部独立验收 |
| M7 | 设计：主题、母版、版式、三套按需模板与统一交付旅程 | ✅ Chrome + 11 件 Office 清单 |
| 扩展 | 图表/批注/页面适配/内部对象编辑、高级渲染、直接导出与旧 PPT | ✅ 七类能力完成，1789 项专项；支持边界见能力矩阵 |

### 1.4 本次交付审计（已收口）

`npm run verify` 首次运行暴露的全部是**源码对、交出去的东西不对**这一类；
[建立跨产物一致性闸门](wayfinder/ppt-editor/tickets/076-cross-artifact-consistency-gate.md) 已逐项修复并固化守卫：

| # | 首次发现 | 处理结果 | 固化守卫 |
|---|---|---|---|
| 1 | 三份文档的断言数全线过期 | 按实测同步，见上方门禁表 | 各套件全绿后落盘，verify 定点比对 |
| 2 | 快照目录会残留无消费者的旧基线 | 新增孤儿基线检查 | core 测试以本轮实际使用集合反查目录 |
| 3 | README 与官网包表漏 `@web-ppt/collab` | 三张表均完整列八包 | 包表集合必须与非 private package 完全一致 |
| 4 | collab 体积无发布入口声明 | 补 11.73KB gzip | 读取 `package.json#main` 后实测 gzip |
| 5 | 14,288B 与 11.76KB 看似冲突 | 前者是排除 peer 的测试薄包，后者是发布入口 | CHANGELOG 同时声明并分别核对 |
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
| 3D | ✅ 挤出/斜角/轮廓/材质/视角 | ⚠️ 缺可信样本 | 真实相机投影；材质、光照与网格为近似 |
| 文本 | ✅ 完整 + 15 种艺术字变形 | ✅ 基础字符与段落 | 包络型艺术字只弯基线 |
| 样式继承 | ✅ 母版→版式→占位符→段落→run | ✅ TxMasterStyle | — |
| 图片 | ✅ 裁剪/裁进形状/透明度/灰度/双色调 | ✅ Pictures 流 | — |
| EMF/WMF/PICT | ✅ 解码为 SVG | ✅ | EMF+ 按需入口支持常见绘图；未知记录按格式回退 |
| 表格 | ✅ tableStyles/条纹/合并/边框/垂直对齐 | ✅ 网格启发式 | — |
| 图表 | ✅ 经典 16 种 + 次坐标轴 + 3D | ✅ 经内嵌 EMF | ChartEx 含 geoCache 地图；完整真实语料与 Office 原生验收待补 |
| SmartArt | ✅ 缓存 drawing / 6 种布局族自排 | ❌ | `.ppt` SmartArt 未实现 |
| 媒体·墨迹·评论·节 | ✅ | ❌ | — |
| 组合 | ✅ 嵌套 + 子坐标系 | ✅ 展平 | — |
| 切换 / 动画 | ✅ 20 种 / 四类按点击分批 | ✅ 6 种 / 5 步 | — |
| 加密 | ✅ 标准 AES-ECB / 敏捷 AES-CBC | ✅ RC4 CryptoAPI | **打开密码文件不可解析** |
| 数学公式 | ✅ OMML 解析与结构化 SVG 排版 | ❌ | 已覆盖分式、根式、脚标、大算子、矩阵等；数学字体与复杂细节继续对照 |
| 嵌入字体 | ✅ EOT 剥壳 | — | MTX 压缩需外部 `setFontDecoder` |

导出：PNG（data: URI + foreignObject，像素与预览一致）、独立 SVG 文件（原生 `<text>`，自包含）、
批量动画终态 PNG ZIP（按需入口、有界并发）与可打印 HTML（按动画批次展开）。新增直接图片页面 PDF 与无音轨 WebM，均为按需入口。

### 2.2 写：编辑命令与按需扩展

| 域 | 已实现 | 未实现 |
|---|---|---|
| 变换 | `SetXfrm` `SetFlip` `AlignElements` `DistributeElements` `Group` `Ungroup` | — |
| 结构 | `RemoveElement` `SetZ` `PasteElements` `SetName` `SetAltText` `SetLocked` `SetElementHidden` | — |
| 形状 | `AddShape` `SetFill` `SetStroke` `SetEffects` `SetGeometry` `ConvertToCustomGeometry` `SetPreset` `SetAdj` + 按需 `SetScene3D` | — |
| 图片 | `AddImage` `ReplaceImage` `SetCrop` + 按需 `SetPictureFx`（透明度/灰度/双色调） | — |
| 文本 | `EditText` `SetRunProps`（含高亮/字距/大小写/上下标/精确下划线与单双删除线）`ClearFormat` `SetParaProps`（含项目符号/编号）`SetBodyProps` `FitTextShape` `ReplaceText` | — |
| 表格 | `AddTable` `InsertRow` `InsertColumn` `RemoveRow` `RemoveColumn` `MergeCells` `SplitCell` `SetRowHeight` `SetColumnWidth` `SetCellProps` `SetTableStyle` + 单元格文字 | — |
| 页面 | `AddSlide` `RemoveSlide` `MoveSlide` `DuplicateSlide` `AddSection` `RenameSection` `MoveSection` `RemoveSection` `SetSlideSize` `SetLayout` `SetBackground` `SetBackgroundImage` `SetBackgroundCrop` `SetHidden` `SetNotes` `SetTransition` `SetAnimations` | — |
| 页面适配 | 按需 `resize`：全稿确保适合，同步文字/效果/表格/母版/版式/批注锚点 | — |
| 链接 | `SetLink`（元素级 + run 级） | — |
| 格式 | `ApplyFormat`（格式刷） | — |
| 版式/母版/主题 | `SetTheme` + 主题目录；版式/母版设计画布 + 复用元素/背景/切换命令 + `p:txStyles` | — |
| 经典图表 | 按需数据与类型/样式编辑，cache/内嵌工作簿同步 | 不兼容类型转换明确拒绝 |
| 现代图表 | ChartEx 分层数据、增删行、工作簿同步 | 完整 Office 真机验收 |
| 批注 | 新增、修改、删除、回复与字段级历史/协同 | — |
| 媒体 | 按需 `AddMedia`：PCM WAV / MP4（含分片）/ 显式外链、默认音频图标、`ReplaceMediaPoster`；框架/官网入口、历史与保存、选中媒体播放与失败提示 | Windows PowerPoint 实测；无原包复制需先保存重开 |
| SmartArt/OLE/墨迹 | 按需节点/嵌入内容/笔画内部编辑，原生保存 | 未识别宿主格式及布局边界见能力矩阵 |
| 无来源复制 | 按需 `generate.copyPortableElements`：选中子树、资源、公式/艺术字/高级文字效果直接跨文稿复制 | 丢失原生语义及能力范围外的对象明确拒绝，见[支持矩阵](portable-rich-text.md) |

保存：补丁保存（原包直通，只改脏 part）、生成保存（无原包时确定性生成）、`.ppt` 编辑另存 `.pptx`，以及有明确能力校验的原生 `.ppt` 生成保存。
原生 `.ppt` 根据当前投影生成新文件，不保留未知二进制记录；支持内容与拒绝条件见[保存矩阵](expanded-capabilities.md#原生-ppt-保存矩阵)。

### 2.3 工程与产品

| 能力 | 状态 |
|---|---|
| 发布包 | ✅ 8 个（core / edit-core / viewer-core / editor / react / vue / fonts / collab），`@next` 同版本 |
| 框架适配 | ✅ React 1.12KB + Vue 1.34KB gzip，单一 adapter contract，Svelte / WC 可直接复用 |
| 崩溃恢复 | ✅ 版本化帧 + IndexedDB 分块 + 原子换代 + 挂载前决策 |
| 协同 | ✅ 字段级 LWW、分数序、可插拔 provider、BroadcastChannel 双标签页 |
| 无障碍 | ✅ 选择窗格键盘导航 / 锁定 / 隐藏；✅ 按需画布对象目录、替代文字、选择状态及阅读顺序 |
| 浏览器输入 | ✅ 按需 EditContext；IME 单事务、选区与候选位置；加载失败和不支持时保留 contenteditable |
| 性能契约 | ✅ 抗环境负载，功能失败与预算超标分离 |
| 官网编辑页 | ✅ 独立 `editor.html`，本机打开/模板新建/编辑/保存/恢复 |
| 触屏 / 移动 | ✅ 手指细描边容差 + 双指缩放/平移 + 长按上下文 seam；查看模式保留页面滚动 |
| 国际化 | ✅ 官网三页完整中英文、SEO、原地切换、动态工具/上下文名称及错误恢复；键盘/触屏、根路径/子路径生产回归通过，发布包不含站点词条，详见[验收矩阵](site-i18n.md) |
| 文件保存 UX | ✅ 产品层 File System Access + 下载双路径、会话目标与另存为、延迟保存点及失败重试；详见[本机文件保存](local-file-save.md) |

---

## 3. 缺口分类与取舍判定

```mermaid
flowchart TD
    G["全部缺口"] --> A["G1 交付缺口<br/>做完了没交出去"]
    G --> B["G2 编辑能力<br/>已确定范围完成"]
    G --> C["G3 解析保真缺口"]
    G --> D["G4 平台缺口<br/>浏览器能力受限"]
    G --> E["G5 范围外<br/>需要重新决策"]
    A --> A1["自动门禁已通过<br/>真机与发布单独登记"]
    B --> B1["新需求另定范围"]
    C --> C1["按真实样本补证据与修正"]
    D --> D1["产品层双路径，不进内核"]
    E --> E1["先决策再排期"]
```

| 缺口 | 用户有成本？ | 有解法？ | 判定 |
|---|---|---|---|
| 跨产物一致性 / collab 漏列 | 有（装错包、信错数字） | 有 | ✅ **已完成** |
| 表格结构编辑 | 有（表格是 PPT 高频对象） | 稳定 rowId/colId 与合并不变量 | ✅ **已完成** |
| 项目符号 / 编号 | 有（做 PPT 必用） | 有（继承重基与自动编号求值都已具备） | ✅ **已完成** |
| 形状预设切换 + 调节柄 | 有（形状库不能变形等于半个形状库） | 有（`a:ahLst` 从固定规范源生成，惰性查表零默认成本） | ✅ **已完成** |
| 字符高级属性 + 清除格式 | 有 | 有（双层模型天然支持删覆盖） | ✅ **已完成** |
| 分布 / 替代文字 / 节 / 页面尺寸 | 有（各自小，合起来是「像不像 PowerPoint」） | 有（全是既有基础设施的加法） | ✅ **已完成** |
| 触屏手势 | 有（平板打不开等于少一半设备） | 有（Pointer Events 已统一） | ✅ **已完成** |
| 批量导出图片 | 有 | 有（复用 `slideToPng` + fflate） | ✅ **已完成** |
| 主题编辑 | 有（换配色是模板定制第一需求） | 有（phClr / fillRef 求值链路已全通） | ✅ **已完成** |
| 版式 / 母版编辑 | 有（企业模板定制） | 有（统一设计画布与反向失效索引） | ✅ **已完成** |
| 图表数据编辑 | 有（图表是 PPT 第二高频对象） | 有（同时改 cache 与 embedded xlsx，按需入口） | **0.8 P0 已完成** |
| ChartEx 解析与编辑 | 有（现代图表需显示及改数） | 七类原生布局、分层数据与工作簿同步；地图读取 geoCache | ✅ **功能完成**，继续真实语料与 Office 原生验收 |
| 图表类型/样式、批注编辑、页面确保适合 | 有（高频编辑工作流） | 独立入口，沿用事务/历史/恢复/协同 | ✅ **已完成** |
| SmartArt / OLE / 墨迹内部编辑 | 有（只移动外框无法改内容） | 按可识别格式编辑原生数据 | ✅ **能力矩阵内已完成**，未知格式保留边界 |
| PDF / WebM 直接导出 | 有（无需其他应用即可交付） | 图片页面 PDF、无音轨 WebM，浏览器按需编码 | ✅ **已完成** |
| 媒体插入 | WAV / MP4 / 外链 + 海报编辑、框架/官网入口、按需恢复与播放降级已实现；PowerPoint 实测待补 | 有，独立按需入口 | **功能完成，真机验收暂缓**，见[媒体操作与 API](media-insertion.md) |
| File System Access | 有（Safari/Firefox 无法原地覆盖） | 部分（仅 Chromium） | ✅ **产品层双路径已完成**，不进内核 |
| EditContext | 无（contenteditable 已能用） | 部分（仅 Chromium） | ✅ 按需渐进增强，真实 Chromium 输入与失败回退已验证 |
| Safari LBSE | 无（engine 行盒已兜住） | 上游未默认开启 | **保留兜底，不要删** |
| `.ppt` 原生生成保存 / 无来源复制 | 有（旧文件需直接编辑与交付） | CFB/Escher 写入器 + 生成保存能力校验 | ✅ **已完成**，不支持的对象明确拒绝 |
| EMF+ 常见绘图 | 有（增强型图元显示缺失） | 按需解码为统一 Schema | ✅ **已完成**，未知记录按格式回退 |
| 未覆盖光栅操作码 / Region 布尔 | 依具体文件而定 | 尚无完整实现，需可信样本与 SVG 表达验证 | **保真边界**，不宣称完整支持 |
| 三维相机与挤出 | 有（相机和深度影响外观） | XYZ 矩阵、正交/透视投影及曲线斜角 | ✅ **已完成**，材质/光照及网格为近似 |
| 地图图表 regionMap | 有 | 文件内 geoCache 边界，无外部地图数据包 | ✅ 按需实现；无缓存时兼容回退 |
| 宏 / AI 生成 / 模板市场 / 服务端转换 | — | — | **不做**（非目标） |

---

## 4. 演进路线

版本主题沿用原规划；功能完成不代表对应版本已经发布。已交付扩展和下一阶段计划均未分配发布版本。

```mermaid
flowchart LR
    B["0.5.0-beta.3<br/>当前包版本"] --> V6["0.6 编辑完整度<br/>功能完成"]
    V6 --> V7["0.7 模板与主题<br/>功能完成"]
    V7 --> V8["0.8 数据与保真<br/>功能完成"]
    V8 --> X["七类扩展<br/>实现与自动门禁完成"]
    X --> N["下一阶段计划<br/>内容流转 · PDF · 音视频 · 格式保真"]
    B --> S["稳定版交付<br/>Windows 验收暂缓"]
    X --> V1["1.0 API 冻结<br/>待 beta 反馈及外部验收"]
    S --> V1
```

| 版本 | 主题 | 票据 | 阻塞 |
|---|---|---|---|
| **0.5.0** | 转正，零新能力 | 一致性闸门 ✅ · PowerPoint 真机 · 转正七步（八包） | PowerPoint 真机需 Windows + 桌面 PowerPoint |
| **0.6** | 编辑完整度 | [补齐 0.6 高频编辑能力](wayfinder/ppt-editing-completeness/map.md)：表格 · 列表 · 预设形状 · 字符格式 · 常用命令 · 触屏 · 批量导出 ✅ | 无 |
| **0.7** | 模板与主题 | [主题编辑 · 版式编辑 · 母版编辑 · 内置模板 · 集成验收](wayfinder/ppt-template-theme/map.md) ✅ | 无 |
| **0.8** | 数据与保真 | [图表数据编辑 · chartex 解析 · 媒体插入 · 官网 i18n](wayfinder/ppt-data-fidelity/map.md) ✅ | 功能完成；真实语料单独验收 |
| **扩展（版本待定）** | 深度编辑、高级渲染与直接导出 | [七类扩展交付](wayfinder/ppt-expanded-capabilities/map.md) ✅，实现提交 `8803e07` | 自动验收通过；Windows 真机按用户要求跳过 |
| **下一阶段（待开发）** | 内容流转、矢量 PDF、音视频与格式保真 | [执行计划与任务依赖](wayfinder/ppt-portability-fidelity/plan.md) | 字体先原型，长尾格式先定样本及支持范围；其余按优先级推进 |
| **1.0** | 稳定 API | [API 契约、迁移说明与类型回归已补](api-stability.md) | 正式冻结依赖 beta 反馈及外部验收 |

一致性闸门已完成。Windows 真机按用户要求暂缓，继续作为正式发布条件。

---

## 5. 已实现的技术方案

以下记录实现约束；历史票据中的验收目标与当前验证状态分开登记，当前状态以 §1 为准。

### 5.1 ✅ [补齐表格结构与单元格格式编辑](wayfinder/ppt-editing-completeness/tickets/001-table-structure-editing.md)

已补齐行列增删、合并/拆分、行高列宽与单元格样式。

**落点**

| 能力 | OOXML |
|---|---|
| 行 | `a:tbl/a:tr`，`@h` 行高（EMU） |
| 列 | `a:tbl/a:tblGrid/a:gridCol@w`；**每行 `a:tc` 数必须等于 `gridCol` 数** |
| 合并 | 锚格 `a:tc@gridSpan`（横跨）/ `@rowSpan`（纵跨）；被覆盖格写 `@hMerge="1"` / `@vMerge="1"` 且**仍须存在** |
| 单元格 | `a:tcPr`：`@anchor` `@marL/R/T/B` `@vert` + `a:lnL/lnR/lnT/lnB/lnTlToBr/lnBlToTr` + 填充 |

**结构编辑的四个约束**：

| 难点 | 后果 | 解法 |
|---|---|---|
| 删行/列会切断跨越它的合并矩形 | `hMerge`/`vMerge` 悬空 → PowerPoint 提示修复 | 删除前先把跨越边界的合并**分解**成独立格，作为同一事务的一部分 |
| 表格 frame 的 `ext` 由行高列宽之和决定 | 插行后 frame 高度不对，视觉漂移 | 复用 `037`（spAutoFit）的 **entry 级因果历史**：结构改动与 frame 改高是一个原子单元 |
| 协同/恢复日志需要稳定地址 | 行列索引随插删漂移 | 对称的 `rowId` / `colId`，与同一分配器对接 |
| 条纹与首末行列样式由**序号**派生 | 插删后整表样式全变 | 投影缓存对表格**整体失效**，不做逐格失效 |

**模型**：合并只保留**单一真值**——锚格 + 跨度。`hMerge`/`vMerge` 是投影期展开的产物，模型里不可写，
从源头掐掉「两个地方都能改、改得不一致」这类 bug。

**命令**

```ts
InsertRow{ id, at?: { before: TableRowId | null } }
RemoveRow{ id, row: TableRowId }
InsertColumn{ id, at?: { before: TableColumnId | null } }
RemoveColumn{ id, column: TableColumnId }
MergeCells{ id, from: TableCellRef, to: TableCellRef }
SplitCell{ id, cell: TableCellRef }
SetRowHeight{ id, row, height } / SetColumnWidth{ id, column, width }
SetCellProps{ id, cell: TableCellRef, props }   // 属性值 null 恢复来源
```

**不变量**（进 `model-invariants.ts`，事务边界校验）：① 每行 `tc` 数 == `gridCol` 数
② 合并矩形互不重叠、不越界 ③ 锚格自身不是 `hMerge`/`vMerge` ④ 行高列宽 ≥ 0。

**验收**：确定性固件 `sample-editor-table-structure.pptx`（含预置合并）+ LibreOffice 网格 oracle +
独立进程等价指纹 + PowerPoint 无修复打开 + 60 格提交预算。

### 5.2 ✅ [切换预设形状并拖动调节柄](wayfinder/ppt-editing-completeness/tickets/003-preset-shape-adjustments.md)

编辑投影以互斥的 `presetGeometry` / `geometry` 稀疏覆盖保留语义；切换时用对侧 tombstone 保证
历史、恢复与字段级 LWW 协同都只留下一个几何真值。

| 命令 | 落点 | 说明 |
|---|---|---|
| `SetPreset{ id, preset }` | `a:prstGeom@prst` + 重置 `a:avLst` | 保留填充/描边/效果/`a:txBody`，只换几何 |
| `SetAdj{ id, name, value }` | `a:avLst/a:gd@name@fmla="val N"` | 拖动调节柄 |

调节柄来自预设定义里的 `a:ahLst`（adjust handle list）：
`a:ahXY` 给出手柄坐标与 `minX/maxX/minY/maxY`，`a:ahPolar` 给出 `minR/maxR/minAng/maxAng`。
句柄定义通过独立入口读取，与默认几何路径求值分开加载。

- 表由固定 Apache POI 预设源生成并校验 commit + SHA-256：187 个预设，120 个含句柄
- `@web-ppt/core/geometry/handles` 与 `@web-ppt/editor/adjustments` 都是独立构建的按需入口；构建守卫
  禁止句柄定义进入 core、edit-core 与 editor 主入口
- 公式在 DrawingML EMU 空间求值，最终位置才转 CSS px；187 预设通过同点拖拽恒等性质
- 旋转形状拖动只更新 interaction 层，提交为单一历史事务；补丁与生成保存都回写规范 `prstGeom/avLst`

### 5.3 ✅ [编辑项目符号与自动编号](wayfinder/ppt-editing-completeness/tickets/002-bullets-and-numbering.md)

`SetParaProps` 扩展一个 `bullet` 字段：

```ts
bullet?: { kind: 'none' }
       | ({ kind: 'char'; char: string } & BulletStyle)
       | ({ kind: 'autoNum'; type: AutoNumType; startAt?: number } & BulletStyle)
       | ({ kind: 'blip'; image: ImageRef } & BulletStyle)
       | null   // null = 删覆盖，回到版式/母版继承
```

| 事实 | 影响 |
|---|---|
| `a:buNone` / `a:buChar` / `a:buAutoNum` / `a:buBlip` **互斥** | 写时必须先删同组其它元素（同 `SetFill` 的坑）；`xml/order.ts` 里这组 sequence **已经登记好了** |
| 级别默认项目符号来自版式/母版 `a:lvlNpPr` | 「无覆盖」≠「无项目符号」，必须走 `068` 建立的九级继承重基 |
| 自动编号续号 | `text-auto-number.ts` 的 `formatDrawingAutoNumber` 已实现，投影直接复用 |

已贯通命令、查询、富文本剪贴板、格式刷、表格、恢复/协同、补丁与生成保存；配套
`a:buFont` / `a:buClr` / `a:buSzPct` / `a:buSzPts`，图片资源按内容哈希去重并建立关系闭包。

### 5.4 ✅ [补齐字符高级格式与清除格式](wayfinder/ppt-editing-completeness/tickets/004-advanced-run-formatting.md)

`SetRunProps` 与 `TextRun` 现已贯通全部目标字段：

| 属性 | 落点 |
|---|---|
| 高亮 | `a:rPr/a:highlight` |
| 字距 | `a:rPr@spc`（1/100 pt） |
| 大小写 | `a:rPr@cap="all\|small\|none"` |
| 上下标 | `a:rPr@baseline`（1/1000 %） |
| 下划线类型 | `a:rPr@u`（17 种，兼容旧布尔别名） |
| 删除线类型 | `a:rPr@strike="sngStrike\|dblStrike"` |

精确 `underline` / `strikeType` 与旧 `u` / `strike` 布尔别名并存：读取始终给旧消费者派生布尔值，
旧写入在首次编辑时迁移到精确值。`ClearFormat{ id, range }` 以 mark 级清除意图删除来源 `a:rPr` 的
视觉直设并回到 Source Value；文字、段落、超链接、动态字段和公式原子不变。折叠光标的清除留在视图，
与下一次可信输入或 IME 原子提交，不制造零宽 OOXML run。

### 5.5 ✅ [补齐分布、替代文字、节与页面尺寸](wayfinder/ppt-editing-completeness/tickets/005-common-object-and-slide-commands.md)

全是既有基础设施的加法，合并成一张票：

| 命令 | 落点 | 复用 |
|---|---|---|
| `DistributeElements{ ids, axis }` | 批量 `a:off` | `028` 的世界 AABB + 父空间逆变换；≥3 个才允许 |
| `SetAltText{ id, title, descr }` | `p:cNvPr@title/@descr` | 选择窗格的 `SetName` 已经在改同一个节点 |
| `AddSection` / `RenameSection` / `MoveSection` / `RemoveSection` | `p:extLst/p14:sectionLst` | 解析侧已支持；`045` 删页闭包已经在维护 `sectionLst` |
| `SetSlideSize{ w, h }` | `p:sldSz` | 仅改画布；按需 `createSlideSizeEditor(editor).setSize({ w, h, fit: 'ensureFit' })` 提供全稿等比适配 |

四组命令现已贯通 Source Value 恢复、原子历史、恢复日志、字段级协同、保留型/生成式保存与公开
editor/adapter seam。仅改画布时，挂载视图在同一提交帧同步舞台、静态 SVG 与交互 viewBox；
确保适合同步缩放文字、效果、表格和设计来源，组合仅缩放根框。节以稳定 `SlideId` 重建，复制/删除页不会留下漂移成员。

### 5.6 ✅ [补齐触屏编辑手势](wayfinder/ppt-editing-completeness/tickets/006-touch-editing-gestures.md)

Pointer Events 继续作为唯一输入边界，三项触屏能力现已在编辑器交互层闭环：

| 项 | 实现 | 不变量 |
|---|---|---|
| 命中容差 | 手指在真实 SVG 几何外扩 12 个屏幕像素 | 鼠标/触控笔仍走浏览器精确命中；不改模型 |
| 双指缩放/平移 | 单指升级双指，rAF 合帧发布 `viewport` | 只同步视图 zoom，外层滚动归宿主；不进历史/恢复/保存 |
| 长按菜单 | 500ms 发布 `onContextRequest` | 移动 8px 即取消；菜单内容和呈现归产品层 |

`pointercancel`、capture 丢失、切页/模式、宿主缩放和 destroy 统一收束；多视图不合并触点。真实 Chrome
验证距离/中心误差均为 0、60 元素触屏帧 p95 约 1ms，并覆盖可信 capture 与长按阈值。查看模式不绑定
编辑触屏事件且清空 `touch-action`，默认 viewer 路径没有新增依赖或运行时分支。

### 5.7 ✅ [批量导出幻灯片图片](wayfinder/ppt-editing-completeness/tickets/007-batch-image-export.md)

按需入口 `@web-ppt/core/image-zip` 提供 `presentationToImageZip(pres, options)`：稳定原页码命名、
隐藏页策略、动画终态、确定性 ZIP 元数据和 1–8 路有界并发都由 core 负责，产品层不再自行循环打包。
单页仍复用 data URI + `foreignObject` 与 `SecurityError` 回退，默认 core 入口不暴露批量 API。

直接 PDF 已提供 `core/pdf` 图片页面写入器，无打印对话框；矢量、可搜索文字仍使用 `presentationToPrintableHtml` + 浏览器打印。

### 5.8 ✅ [模板与主题编辑（0.7，已完成）](wayfinder/ppt-template-theme/map.md)

**收益排序：主题 > 版式 > 母版。** 改一处主题，全文档立刻变样，而 `phClr` / `fillRef` / `lnRef`
的求值链路解析侧已经全通。

| 阶段 | 命令 | 落点 | 难点 |
|---|---|---|---|
| 主题 ✅ | `SetTheme{ clrScheme?, fontScheme? }` | `ppt/theme/themeN.xml` | 按主题分支精确失效 |
| 版式 ✅ | 以 `DesignTarget` 复用通用画布命令 | `ppt/slideLayouts/slideLayoutN.xml` | 反向索引 + 占位符重绑 |
| 母版 ✅ | 同上 | `ppt/slideMasters/slideMasterN.xml` | 同上，再加 `p:txStyles` |

**继承倒灌已由增量反向索引闭环**：`layoutId → SlideId[]` 在 `SetLayout` / `AddSlide` / `RemoveSlide`
时维护，`masterId → layoutId[]` 接入同一条链；改设计来源只失效真正依赖它的后代。

**占位符反向重绑也已完成**：版式改动后仍可匹配的页面占位符保留逻辑身份和直接覆盖，失去宿主的占位符
固定必要外观并安全降级。

写回无新基础设施：补丁引擎本来就能改任意 part。

内置模板不是复制一批固定 `.pptx`。`@web-ppt/edit-core/templates` 复用生成保存的确定性骨架，提供极光、
刊页、夜幕三套主题、母版和五种常用版式配方；现有 `createBlankPptx()` 保持字节兼容，未打开新建选择器的用户
不加载模板目录或模板数据。

**0.7 集成验收已闭环**：三套模板逐一走完“模板 → 主题 → 母版 → 版式 → 普通页面 → 保存重开”，覆盖权限
隔离、撤销重做、恢复后续编、字段级协同、直接覆盖、占位符身份与无关 DOM 身份；补丁保存、生成保存和 `.ppt`
另存汇入唯一 11 件清单，由 LibreOffice 逐件打开，Windows PowerPoint 工作流消费同一清单并绑定提交与字节。

### 5.9 [图表数据编辑（0.8，已完成）](wayfinder/ppt-data-fidelity/tickets/001-chart-data-editing.md)

经典图表保留 `editable: 'frame'` 的原子画布身份，数据编辑通过独立按需入口完成。一个 `ChartDataset` 是唯一
语义真值，保存时**同时投影到两处**：

```mermaid
flowchart LR
    U["用户改数值"] --> C["ppt/charts/chartN.xml<br/>c:numCache / c:strCache"]
    U --> X["ppt/embeddings/WorkbookN.xlsx<br/>sheet1.xml + sharedStrings.xml"]
    C --> P["PowerPoint 显示的值"]
    X --> E["双击「编辑数据」时 Excel 看到的值"]
```

实现覆盖柱/线/饼/面积等类别图、散点图、气泡图和组合图的系列、类别、点位增删改；稳定语义 ID、撤销重做、
恢复帧与字段级 LWW 协同共用既有编辑模型。保存事务原子更新 cache、公式范围、工作表及 shared strings；共享
图表 part、共享工作簿、歧义绑定和不可写来源显式只读，不能假装 Excel 已同步。

`@web-ppt/core/chart-edit`、`@web-ppt/edit-core/chart`、`@web-ppt/editor/chart` 及 React/Vue 转发均为按需入口，
官网数据表同样动态加载；默认 core / edit-core / editor 和官网初始依赖闭包没有增长。确定性固件来自 Apache POI
真实嵌入工作簿语料；258 项专项断言、真实 Chrome、LibreOffice 打开与缓存/工作簿一致性均通过，Windows
PowerPoint 继续消费同一工件清单提供提交绑定证据，真机运行按用户要求暂缓。
扩展入口 `@web-ppt/edit-core/chart-design` 已补齐兼容类型切换与样式编辑，并沿用同一工作簿只读判断。

### 5.10 ✅ ChartEx（0.8 与扩展）

`cx:chartSpace` 是**另一套 schema**，按用户功能分为 7 类：树状图、旭日、直方图（含 Pareto）、箱线、瀑布、漏斗、地图。
落在 `ppt/charts/chartEx1.xml`，通过 `p:graphicFrame` 的 `<mc:AlternateContent>` 挂载。

**实测纠正（2026-09-05）：有预览图不等于回退已生效。** LibreOffice 官方语料中的 PowerPoint 漏斗 PPTX
确实带有 `Fallback/p:pic`，旧解析器却把 Choice 的未知图表占位当成非空成功结果，两条 SVG 均丢图。
[兼容回退修复](wayfinder/ppt-data-fidelity/tickets/008-alternate-content-fallback.md)现已恢复真实漏斗图片，并通过
Chrome 屏幕与独立 SVG 解码；197 项专项守住整壳编辑、身份、补丁与生成保存。编辑会话按引用保留兼容
源文件及实际依赖，原包释放后仍可导出；源数据缺失或与生成包冲突时明确拒绝，不能把预览图片等同于原生图表数据。
新建/嵌套分组、解组、单独复制孩子及冷恢复后的来源转交已贯通；解组不重复物化表格追加行，生成保存保持有效层级顺序。
另外八个真实 XLSX 只有公式引用与文字回退，不能替代其余六类 PPTX 的验收；完整证据见
[回退与真实语料调查](wayfinder/ppt-data-fidelity/tickets/002-chartex-fallback-corpus.md)。
现已补齐这 9 个文件的定义名称、单元格类型与内嵌工作簿引用取证；层级空槽及重复标签不能直接压平，
[统一输入约束](wayfinder/ppt-data-fidelity/research/chartex-data-model.md)已用于原生实现；歧义来源继续回退。

`@web-ppt/core/chart-ex` 已实现 squarify、分层圆弧、分箱/Pareto、箱线、累计瀑布和源顺序比例漏斗，
输出统一 Schema；SDK 默认不加载实现，官网按内容类型自动加载，失败时保留回退。104 项专项、八页 Chrome 四类导出及两条保存通过。
Windows 16.0 Build 4266 只显示现代图表的图片，不能作为原生布局 oracle。详见[按需 API 与验收边界](chartex-native.md)。

`regionMap` 已通过文件自带的 geoCache 边界实现，支持压缩缓存、四种投影、孔洞与跨日期变更线；
无缓存时保留兼容预览，不依赖外部地图服务。`@web-ppt/edit-core/chart-ex` 同时提供七类现代图表的
分层数据编辑、增删行与工作簿同步；完整真实 PPTX 类型语料和 Office 原生布局验收仍待补齐。

### 5.11 平台事实与对策

调研结论（2026-08）：

| 平台能力 | 事实 | 对我们的影响 | 对策 |
|---|---|---|---|
| WebKit LBSE | 2026 年 7 月 Igalia 仍在做性能优化，**默认未开启**，需 runtime flag | Safari 的 `foreignObject` 缩放 bug 还在 | **保留 `034` 的 engine 行盒路径，不要因为「LBSE 快落地了」删掉** |
| EditContext | 仍**只有 Chromium**，Safari/Firefox 未实现（有社区 polyfill） | 自绘文本 + 完整 IME 只能在 Chrome 用 | contenteditable 保持主路径；EditContext 只做渐进增强，且必须在两条路径跑同一套断言 |
| File System Access | `showSaveFilePicker` **只有 Chromium**；Safari/Firefox 仅 OPFS，且 Firefox 是**有意不实现** | Safari/Firefox 保存只能是下载，无法原地覆盖 | ✅ 产品层双路径已接入：能力检测、当前会话目标与另存为；不支持则 download，拒绝/取消不偷偷下载。**不进 `editor` 包**，详见[交付与验证边界](local-file-save.md) |

---

### 5.12 ✅ 扩展编辑、渲染与导出

| 能力 | 入口与验证 |
|---|---|
| 图片/立体编辑、AT / EditContext | [外观编辑](appearance-editing.md)：历史/恢复/协同与两条保存；[浏览器增强](browser-editing.md)：读屏语义及真实 Chromium 输入 |
| 图表深度编辑、批注编辑、页面适配 | `chart-design` / `chart-ex` / `comments` / `resize`：数据与原生 XML 同步，官网完整操作与只读边界回归 |
| SmartArt / OLE / 墨迹 | `smartart` / `ole` / `ink`：节点、可识别 XLSX/DOCX 嵌入内容、InkML 笔画；保存原生数据与兼容预览 |
| 地图 / EMF+ / 三维 | `chart-ex` / `emf-plus` / `three-d`：文件内边界、常见记录、真实相机投影；复杂格式和视觉近似明确列界 |
| PDF / WebM | 图片页面 PDF 含批注/回复，无音轨 WebM 含动画/切换；浏览器下载及 Poppler/FFmpeg 独立读取通过 |
| 原生 PPT / 无来源复制 | `ppt.savePpt` / `generate.copyPortableElements`：能力校验、浏览器下载/重开；LibreOffice 保留文字、曲线、组合、图片与备注 |
| 产品集成与门禁 | 1789 项扩展断言、独立发布入口交叉验证、官网三张生产页面中英文工作流；108 份固件连续两次逐字节一致 |

公开 API、格式边界与调用示例统一维护在[扩展能力矩阵](expanded-capabilities.md)；逐项问题与证据见[交付记录](wayfinder/ppt-expanded-capabilities/map.md)。

---

## 6. 现行范围决策

本表取代首个完整版本与历史票据中对应的范围外决策。

| 项 | 当前决定 | 边界 |
|---|---|---|
| 图表数据、类型与样式编辑 | ✅ 已实现 | 不兼容转换与不可写工作簿明确拒绝 |
| 母版 / 版式编辑 | ✅ 已实现 | 沿用统一设计画布及继承模型 |
| 审阅批注工作流 | ✅ 已实现 | 新增、修改、删除、回复与原生保存 |
| `.ppt` 原生生成保存 | ✅ 已实现 | 基于投影生成；支持矩阵外拒绝，不保留未知二进制记录 |
| SmartArt / OLE / 墨迹内部编辑 | ✅ 已实现 | 按可识别格式编辑；未知格式维持框架级操作 |
| 三维相机投影与挤出 | ✅ 已实现 | 材质/光照和纹理网格为近似，不包含通用三维建模 |
| 地图 / EMF+ / PDF / WebM | ✅ 按需实现 | 地图需 geoCache；EMF+ 有记录边界；PDF 为图片页面；WebM 无音轨 |
| 宏 / 模板市场 / AI 生成 / 服务端转换 | **维持范围外** | 不属于当前纯浏览器渲染与编辑目标 |

---

## 7. 下一步计划与交付

### 7.1 待开发能力

| 优先级 | 内容 | 当前状态 |
|---|---|---|
| P0 | 高级文本生成保存/跨文稿复制；经典图表多级类别及共享工作簿同步 | 高级文本已完成；下一项为多级类别，随后共享工作簿同步 |
| P1 | 按需字体与字形能力 → 矢量、可搜索 PDF | 字体先做原型，验证通过后建立正式实现票 |
| P2 | 视频音轨/混音 → 内嵌视频逐帧合成 | 以固定时间轴及明确编解码支持矩阵交付 |
| P3 | SmartArt/OLE、高级渲染、原生 PPT 的增量能力 | 先调查真实样本与原生语义，再逐项建立实现票 |

范围、任务依赖和共同验收条件统一见[下一阶段执行计划](wayfinder/ppt-portability-fidelity/plan.md)。
仅高级文本流转已计入当前功能，其余仍是待办；不以计划改写上一轮的验证结果。

### 7.2 验证与发布

| 顺序 | 动作 | 当前状态 | 完成条件 |
|---|---|---|---|
| 1 | 补齐真实 ChartEx PPTX 类型语料及高级渲染对照 | 合成功能门禁和现有真实样本通过，完整类型覆盖待补 | 可信来源、可复现输入、逐类型原生布局与保存重开证据 |
| 2 | Windows + 桌面 PowerPoint 自托管验收 | **按用户要求暂缓**，未计为通过 | 同一 Office 工件清单绑定提交与字节，无修复打开并核验原生内容 |
| 3 | beta 反馈、API 冻结与版本发布 | [API 契约与迁移准备](api-stability.md)已完成，尚未正式冻结 | 外部验收与反馈收口后确定版本，再执行发布流程 |

Windows 真机仍列为正式发布条件；它不阻挡已完成代码与 roadmap 的提交、推送。
