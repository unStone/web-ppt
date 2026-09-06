# 1.0 API 契约与迁移准备

当前版本仍为 `0.5.0-beta.3`。本页固定已实现公开面的兼容约束和升级方式；1.0 的正式冻结、beta 反馈周期、
Windows 验收与发布仍是后续交付条件，不通过修改版本号代替验收。

| 边界 | 兼容约束 |
|---|---|
| 包 | 八个发布包保持同版本；只使用包名及 `package.json#exports` 声明的子路径 |
| core | `.pptx` / `.ppt` 按魔数识别，统一 Schema；Worker 无 DOM；唯一运行时依赖 fflate |
| 渲染 | 屏幕/PNG 的 HTML 文本与独立 SVG/打印的原生文本维持两条路径 |
| 编辑 | `Editor`、事务、选择、历史、恢复、投影与两种保存是主入口；按需命令通过扩展入口进入 |
| 按需能力 | chart、media、appearance、templates、accessibility、edit-context 不扩大默认编辑器依赖图 |
| 协同 | 对外传递恢复/协同协议数据，保留协议版本及稳定身份；不自行改内部对象树 |
| 资源生命周期 | 编辑器借用来源包；会话结束后释放，保存不隐式结束会话 |
| 发布门禁 | 类型契约、确定性固件、语料指纹、浏览器旅程、保存 XML、八包构建与跨产物核对 |

## 当前升级提示

| 使用方式 | 迁移动作 |
|---|---|
| 普通解析和编辑 | 无需修改；新能力不会自动加入默认 SDK 入口 |
| 宿主需要现代图表 | 打开前调用 `prepareModernCharts`，或显式 `setChartExParser(parseChartEx)` |
| 宿主需要图片/立体效果 | 使用 appearance 入口；恢复/协同接收端提前注册同一扩展 |
| 自定义图片滤镜 | `duotone` 现在是独立颜色字段，不能从旧 `grayscale/contrast` 近似反推；未受支持的滤镜生成保存仍拒绝 |
| 读取立体深度再编辑 | 使用 `queryScene3D` 获取写回值；Schema 中的可见深度含既有材质近似 |
| 浏览器输入与读屏 | 挂载后启用相应入口，释放时先调用增强对象的 `dispose()` |
| 二进制 `.ppt` | 仍另存为 `.pptx`；无 OOXML 来源的对象复制需先保存并重开 |

公开类型使用示例和负例位于 `tooling/type-contracts/`，源码类型检查与产物 exports 构建共同约束公开接口。
不兼容变更必须有迁移说明和明确版本决策；不承诺私有源码路径、内部 XML 操作器或生成产物文件名的稳定性。

语料回归使用 `npm run test:edit:equivalence`；新增功能使用确定性固件及真实浏览器像素，真实 ChartEx 原文件证据
继续在 [ChartEx 能力边界](chartex-native.md) 登记。外部语料不足时保留已知边界，不能用人工固件冒充 Office 证据。

只读批注新增可选 `@web-ppt/viewer-core/comments`，导出通过尾部 `CommentExportOptions` 开关扩展，既有调用保持兼容；见[批注交付](comments.md)。
