# 1.0 API 契约与迁移准备

当前处于 0.8 预发布线；本页和[机器可读清单](api-contract.json)是 **1.0 冻结候选**，尚未正式冻结。beta 反馈、真实 ChartEx 语料与 Windows PowerPoint 验收仍按[路线图](../roadmap.md)执行，候选清单通过不替代这些交付条件。

## 包与公开入口

九个发布包使用相同版本；外部调用只使用包名和 `package.json#exports` 声明的子路径。下表路径均相对该包，所有包另公开 `./package.json`；实际条件映射、CLI、Skill、Schema 摘要和协议版本由机器可读清单完整登记。

| 包 | 候选公开入口 | 契约 |
|---|---|---|
| `@web-ppt/core` | `.`、`./worker`、`./node` | 统一 Schema、魔数识别、Worker 无 DOM；唯一运行时依赖 fflate；Node 真实测字与光栅化由宿主注入 |
| 同上 | `./geometry`、`./geometry/handles` | 格式无关几何与按需调节柄 |
| 同上 | `./chart-edit`、`./chart-ex`、`./modern-charts`、`./diagram-edit`、`./ink-edit` | 按需解析、原生对象编辑来源与现代图表准备 |
| 同上 | `./emf-plus`、`./advanced-rendering`、`./three-d` | 按需解码与渲染增强；格式近似边界见[能力矩阵](expanded-capabilities.md) |
| 同上 | `./image-zip`、`./pdf`、`./pdf/vector`、`./pdf/vector/browser` | 图片 ZIP、图片 PDF、正式矢量 PDF 与可选浏览器适配 |
| `@web-ppt/edit-core` | `.`、`./xml`、`./opc`、`./save`、`./generate`、`./cfb`、`./ppt` | 文档、事务、历史、投影、公开低层容器操作与保存；保存不隐式结束会话 |
| 同上 | `./templates`、`./chart`、`./chart-shared`、`./chart-design`、`./chart-ex` | 模板、经典与现代图表数据、共享工作簿及设计编辑 |
| 同上 | `./media`、`./appearance`、`./resize`、`./comments`、`./smartart`、`./ole`、`./ink` | 可选命令与恢复、协同、保存注册；接收端先注册同一扩展 |
| 同上 | `./describe`、`./lint`、`./lint/sampler`、`./agent`、`./fill` | Agent 读出、检查、采样、原子命令与模板生成；不内置模型 |
| 同上 | `./describe/schema.json`、`./lint/schema.json`、`./agent/schema.json`、`./fill/schema.json` | 由公开 TypeScript 类型生成的四份 JSON Schema |
| `@web-ppt/viewer-core` | `.`、`./comments`、`./video` | headless 查看状态、只读批注与 WebM 导出；视频冻结边界见下表 |
| `@web-ppt/editor` | `.`、`./vertex`、`./adjustments`、`./design` | 浏览器会话、三层视图、顶点、调节柄与设计画布 |
| 同上 | `./templates`、`./chart`、`./chart-shared`、`./media`、`./accessibility`、`./edit-context` | 按需交互；浏览器增强释放时调用 `dispose()` |
| `@web-ppt/react` | `.`、`./templates`、`./chart`、`./chart-shared`、`./media` | React 薄适配与可选 peer |
| `@web-ppt/vue` | `.`、`./templates`、`./chart`、`./chart-shared`、`./media` | Vue 薄适配与可选 peer |
| `@web-ppt/fonts` | `.`、`./glyphs`、`./glyphs/harfbuzz`、`./glyphs/worker`、`./glyphs/browser` | 替换表、字体与字形 Provider、宿主整形器及 Worker / 浏览器端口；包内不带字体字节 |
| `@web-ppt/collab` | `.`、`./migration` | 字段级 LWW、provider、checkpoint 与显式扩展迁移 |
| `@web-ppt/agent-mcp` | `.`；CLI `web-ppt-agent`；`skills/web-ppt/SKILL.md` | 本机 stdio、文件会话、原子交付与 Agent 操作循环；MCP 握手软件版本读取包清单 |

## 稳定候选与冻结排除项

候选稳定指纳入 1.0 兼容评审；实验性排除项仍保留当前调用、默认值和显式失败约定，不能借更新清单静默改变行为。图表、SmartArt、三维等已知格式限制描述保真范围，不将已有公开入口排除出候选清单。

| 能力 | 冻结决定 | 依据与边界 |
|---|---|---|
| 解析、编辑、协同、框架适配、按需扩展 | 候选稳定 | 上表全部公开入口；屏幕 / PNG 的 HTML 文本与独立 SVG / 打印的原生文本维持两条路径 |
| describe、lint、Agent 命令、模板填充与本机 MCP | 候选稳定 | 四份 Schema、稳定 reason、原子编辑与资源生命周期；详见对应 [Agent API](agent-command-tools.md)、[MCP](agent-mcp.md)和[模板填充](agent-template-fill.md) |
| Node 渲染与字体 Provider | 候选稳定 | 缺真实测字 / 光栅化注入时明确拒绝；字体权限、资源加载与字形范围见[字体接口](font-glyphs.md) |
| 矢量 PDF 及其浏览器适配 | 候选稳定 | 0.6 已转正式入口，四个独立实现对照；复杂对象通过 `issues` / 显式回退端口报告 |
| WebM 基础导出与 `audio` | 候选稳定 | 音轨同步、循环、取消与释放验收已完成；`audio` 默认关闭，能力失败经 `onWarning` 暴露 |
| WebM `videoOverlay` | 排除正式冻结，保持实验性 | 默认关闭；媒体加载 / 帧不可用有稳定 warning，保真和平台边界继续按实际证据维护 |
| `edit-context`、浏览器字体与 PDF 适配 | SDK 包装接口候选稳定 | 宿主必须检测能力并管理生命周期；浏览器原生接口的可用性、编码器和字体环境不作跨平台保证 |
| 官网 WebMCP | 不属于发布 SDK 冻结范围 | 站点插件依赖浏览器草案；工具复用 Agent 契约，原生注册接口与 origin trial 条件见 [WebMCP](agent-webmcp.md) |
| 私有源码路径、内部 XML 数据结构、分块文件名、默认随机身份 | 排除正式冻结 | `xml` / `opc` / `cfb` 的公开导出仍在候选范围；不能依赖未导出内部对象或临时资源 URL |

## 数据协议

协议版本与 npm 软件版本分别管理。未知版本应在读取边界拒绝；宿主保留真实身份、来源资源及完整字段，不自行改写协议数据或猜测迁移结果。

| 协议 | 当前版本 | 约束 |
|---|---|---|
| `PresentationDescription` | `1` | ID 与编辑模型一致；跨进程重解析比较时显式使用相同 `idPrefix` |
| `LayoutLintReport` | `1` | reason、测量值和本次检查集可见；缺必需资源拒绝整次检查 |
| `TemplateFillOutline` | `1` | 四份 Schema 中的填充输入；同输入、模板、配置及测量环境下字节确定 |
| `RecoveryFrame` / `EDITOR_RECOVERY_VERSION` | `1` | 恢复帧连同资源与身份持久化；会话结束后释放来源资源 |
| `RecoveryStoreJournal` | `1` | 浏览器恢复存储保留来源身份、epoch、恢复帧和资源；不与单帧版本混为一份数据 |
| `ElementClipboardPayload` | `1` | 剪贴板载荷经公开复制 / 粘贴接口流转，不等同于任意内部对象的 JSON 副本 |
| `CollabMessage` / `CollaborationCheckpoint` | `1` | 恢复协作文稿必须保留 checkpoint；provider 负责鉴权与传输 |
| `ExtensionMigrationReceipt` | `1` | 仅执行完整且已裁决的迁移凭据；保留原操作与删除赢家 |
| Agent 工具输入 | 四份 Schema 中的工具 Schema | 不另设虚构版本字段；以发布 Schema、工具名及稳定 reason 评审兼容性 |

## 从 0.5–0.8 升级

0.5–0.8 没有撤除公开 API；新增能力按需导入。整套包升到同一版本，预发布安装显式选择版本或 `@next`，以官方 registry 查询结果确认发布状态。

| 使用方式或变化 | 宿主动作 |
|---|---|
| 非等比组合变换（0.5） | `elementFrameToSlideMatrix` / `elementParentToSlideMatrix` 已沿渲染链求值；非 90° 整数倍旋转或嵌套组合可能改变结果。编辑交互使用 `elementEditFrame` 等编辑坐标 API，避免把矩形渲染外框当作斜切变换 |
| 现代图表 | 打开前调用 `prepareModernCharts`，或显式 `setChartExParser(parseChartEx)`；可写数据以能力检查为准 |
| 图片 / 立体效果 | 使用 appearance 入口；恢复和协同接收端预先注册同一扩展。`duotone` 使用独立颜色字段，`queryScene3D` 返回实际写回深度，lat/lon/rev 对应 XYZ |
| 浏览器输入与读屏 | 挂载后启用增强入口，结束时先调用增强对象的 `dispose()`；缺浏览器能力保留既有输入路径 |
| 二进制 `.ppt` 与跨文稿复制 | 可另存 `.pptx`，或通过 `edit-core/ppt` 生成原生 PPT；无 OOXML 来源复制使用 `copyPortableElements`，支持范围外明确拒绝 |
| Node SVG / PNG（0.6） | 从 `core/node` 导入并提供真实 `measureText`；PNG 另提供 `rasterize`，缺注入抛稳定 reason |
| 矢量 PDF / WebM（0.6） | 矢量 PDF 使用正式 `pdf/vector` 入口；音轨和视频帧合成分别显式打开，含媒体仍须接受 `mediaPosters: true`，订阅 `onWarning` |
| Agent 命令与 MCP（0.8 beta） | JSON 图片字节使用规范 Base64；一次批量属于一个画布，失败保留原子边界。检查 `ok` 与 lint 观察状态；本机文件会话通过 MCP 保存 / 渲染交付后确认成功 |
| 模板填充（0.8 beta） | 使用 `fill` 与版本 1 大纲；提供真实 lint 资源，默认修复生成副本并要求完整检查通过，输入保持不变 |
| 批注导出 | 只读面板使用 `viewer-core/comments`；导出通过尾部 `CommentExportOptions` 开关扩展，默认行为不变 |

## 自动门禁与更新

`npm run test:api-contract` 比对源码清单并执行变异自测，`npm run test:api-contract:dist` 严格检查实际发布入口、声明、CLI、Skill 与发布类型。两者分别纳入统一功能测试与 verify；`npm run check` 覆盖源码类型。

新增正例与 `@ts-expect-error` 负例位于 `tooling/type-contracts/agent-read.ts`、`template-fill.ts`、`recovery-collab.ts` 和 `agent-mcp.ts`，连同 `agent-tools.ts` 由源码与发布类型分别检查。发布配置 `tooling/tsconfig.api-contracts-dist.json` 清空源码 paths，以包名解析真实声明。

有意改变公开面时，先更新对应 API 文档、迁移说明和类型 / 行为回归，再运行 `npm run schema:api-contract`（`check-api-contract.mjs --write`）生成候选清单并审查差异；四份 Schema 仍由各自生成与校验命令维护。清单更新只记录当前候选，不自动批准破坏性变化，也不宣布 1.0 冻结。

语料回归使用 `npm run test:edit:equivalence`；真实 ChartEx 原文件证据继续在[能力边界](chartex-native.md)登记。外部语料不足时保留已知限制，不能用人工固件冒充 Office 证据。
