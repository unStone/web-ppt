# 字体与字形 Provider 验收记录

[011](tickets/011-font-glyph-implementation.md) 已完成。正式 API、源码 / 发布产物、Cordis 产品入口及独立读取证明均已验收；005 可继续实现矢量 PDF。

| 已接通部分 | 入口 / 证据 |
|---|---|
| 可选字体 SDK | `@web-ppt/fonts/glyphs`：注册、精确匹配、元数据、独立字节副本、整形、轮廓、脚本分段、同源测量 |
| 整形适配 | `@web-ppt/fonts/glyphs/harfbuzz` 注入 HarfBuzz；`@web-ppt/fonts/glyphs/worker` 提供独占 Worker 客户端与服务器 |
| 注册边界 | sfnt 表目录、OS/2 版本、cmap/loca/glyf 范围与组件环检测；预算包括并发预留；分段校验可取消 |
| 字体权限 | 外层 EOT 与内层 sfnt 权限取交集；预览用途不得转编辑，禁止子集化保留完整字节，Bitmap Only 不交付轮廓 |
| 文字 | Latin / Han 横排 LTR；真实连字、组合音标、UTF-16 簇与缺字区间；复杂脚本和方向错误可定位 |
| Worker 生命周期 | 真实线程测试中，取消当前请求终止旧 Worker，未取消请求在新 Worker 按需重建字体；重复关闭、资源归零 |
| 文稿来源 | 编辑模式保留 `Presentation.embeddedFontSources`，编辑会话通过只读 `session.embeddedFontSources` 提供，避免为了取字体投影全部页面；未解码字体也可定位，关闭会话撤销源 URL；常规预览不增加源字体副本 |
| 排版接缝 | core 的 HTML / 原生 SVG 接受 `measureText`；`withFontMeasurement` 重放现有同步布局以准备异步字宽，不复制断行算法 |
| 产品所有权 | Cordis `editor-document-fonts` 在视图挂载前检查并应用嵌入字体的编辑许可；无嵌入字体时不加载 Provider。文稿拥有 Provider、Worker、FontFace 与导出 Blob URL |
| 浏览器绑定 | `@web-ppt/fonts/glyphs/browser` 管理 FontFace 作用域；`session.setFontResources` 更新预览及导出投影，`browserFontsReady` 复用已加载字体。资源更新不写历史，IME 组词期间保留编辑节点 |
| 产品工具 | 工具栏「字体与缺字」提供中英文检查、缺字位置、格式 / 许可 / 排版限制和本机显式替换；重复检查保留替换选择。本机字体仅用于当前预览及图片 / SVG 导出，不写入 PPTX |

## 验证记录

| 维度 | 当前证据 |
|---|---|
| 源码 / dist | Provider 100、真实 Worker 136、文稿 30、测量 15 项断言，两种入口均通过；`011-final-test-v4.log` / `011-final-verify-v6.log` |
| 仓库门禁 | check → test → build → verify 全部通过；`011-final-check-v4.log`、`011-final-test-v4.log`、`011-final-build-v4.log`、`011-final-verify-v6.log`。补开发类型后的 `011-final-check-types.log` 也通过 |
| 渲染等价 | 151 份 PPT 固件 / 494 页 / 988 对 SVG 指纹一致；新增原始字体只改变 Blob 序号，资源改按 MIME + 实际字节寻址，其余 SVG 原样比较；186 份快照通过 |
| 源码 / dist 浏览器 | `browser-document.json` / `browser-document-dist.json`：三轮切换、Canvas 字宽、SVG / PNG 内联、IME、诊断、安装失败 / 取消、本机替换与导出取消通过；关闭时 Worker、FontFace 与持有字节归零 |
| 正式站点 | 构建与中英文静态检查通过；`011-site-font-product.log` 字体专项通过，`011-site-production-final.log` 三张正式页面完整中英文工作流通过 |
| Tarball | `packages/consumer.json`：真实安装包的五个入口均存在，不含字体样本或 WASM；不安装 HarfBuzz 的严格消费者，以及注入 HarfBuzz + Emscripten 开发类型的消费者分别通过 |
| 包边界 | `boundary.json`：八个默认入口不引入 Provider / HarfBuzz / Cordis；三个 headless 字体子入口不依赖 DOM；浏览器绑定独立按需 |
| Worker / 输入 | 创建失败、超时、预算、排队 / 活跃取消、释放与重放、EOT 权限跨线程及非法消息结果通过；cmap / name / glyf 验证有明确预算与可取消边界 |
| PPTX 保存 | `font-runtime-save.log`：运行时替换不产生撤销命令，零编辑保存仍与原始 PPTX 字节相同；源包仍由会话统一释放 |
| 确定性 | 全仓 158 个文件两次重生 hash 一致；16 个字体样本迁移后的 manifest 与原型、两次生成均一致 |
| 独立证明 | `proof-final.log` / `independent-final.log` / `independent.json`：当前正式 API 重新生成证明，MuPDF 精确提取四行原文，36 个 GID / 位置和 FontTools 轮廓一致；同 GID 不同原文、组合音标和 No Subsetting 全字体保留通过 |
| 真实 MTX | 固定 POI 六份压缩字体中，一份可注册 / 整形，五份解码结果含非法 cmap language 被拒绝；合法 face 的 900 字重超出当前浏览器样式绑定范围。`native-mtx.json` / `cost.json`，不能写成六份均可安装 |
| 完整中文成本 | 10,595,964 字节 / 31,036 字形，三轮 5 万字符、8 并发、取消与恢复；具体时间和内存统计口径见下表 |
| 原型吸收 | 临时实现、旧入口及私有依赖已删除；样本 / 许可证移入 `tooling/font-glyph-samples`，正式证明与成本命令取代原型 |
| 审查 | 两个独立审查轴的五项发现已修复并复核，独立浏览器额外发现 cmap language 校验缺口并修复 |

## 发布入口成本

以下 gzip 均按静态相对依赖闭包逐文件计量，不含 peer、HarfBuzz 或字体字节；共享分块在单入口内只计算一次。

| 入口 | 原始字节 | gzip 字节 |
|---|---:|---:|
| fonts 默认 | 8,381 | 2,752 |
| glyphs | 29,418 | 9,882 |
| glyphs/harfbuzz | 1,487 | 768 |
| glyphs/worker | 35,782 | 11,673 |
| glyphs/browser | 3,036 | 1,271 |

editor 默认入口为 60,691 字节 gzip（59.27 KiB），既有预算未放宽。HarfBuzz 1.6.1 的 WASM 单独由产品 Worker 按需加载；严格第三方声明检查需要宿主提供 `@types/emscripten`，不成为字体 SDK 的运行时或类型依赖。

## 已确认的实现细节

| 问题 | 决策与原因 |
|---|---|
| 字节所有权 | 输入可能是 Node Buffer，不能用共享存储的 `slice()` 作为注册副本 |
| HarfBuzz 方向 | 使用 `Direction.LTR` 数值枚举，字符串会导致无效方向 |
| 同 GID 不同原文 | 原文簇独立于定位字形，`ffi` 与 `ﬃ` 不通过反查 cmap 合并 |
| 取消后的文稿字体 | 规范字体字节保留在文稿 Provider；取消活跃 Worker 后，其他请求按需重建，不清空整个字体注册表 |
| Office EOT v2 | 没有 EUDC 载荷时也会写默认 codepage；校验应检查实际 EUDC 载荷和标志，不能仅凭 codepage 拒绝合法字体 |
| EOT RootString | 离线文稿不能把网页域名限制扩展为任意导出文件；非空地址限制返回明确原因 |
| 测量缓存 | 只在准备期间使用临时估算，最后交付的测量遇到未准备文本必须报错；字重 / 斜体与实际 face 不符也报错 |
| 编辑器体积 | 新资源接口曾触及既有 gzip 预算；复用 core 的 `compactLibrary`（关闭语义压缩、保留 pure 注解），现有 editor 预算不变。全量回归已通过，文档按最终闭包体积更新 |
| Worker 消息 | 只传显式的数据字段；测量器的字体选择回调不能进入 structured clone。真实 Worker 测量合约已覆盖此边界 |
| FontFace 名称 | Chrome 实测把构造参数外加的引号作为名称的一部分；传原始家族名称，CSS 由渲染器转义，独立 Canvas 验证实际字宽 |
| 编辑等价指纹 | 新增原始字体会改变测试 Blob URL 序号；只对资源按 MIME + 实际字节寻址，其余 SVG 原样比较，不删除字体引用或归一化布局 |
| 字体资源内联 | 字体 CSS 与图片 XML 的 URL 转义不同；导出识别带引号 URL 并还原 CSS 转义，视频的未内联检查同步支持引号 |
| 关闭顺序 | 先关闭 Worker 队列，再广播各请求取消；否则取消活跃请求会重启 Worker。真实线程红 / 绿证据为 `worker-close-red.log` / `worker-boundaries.log` |
| 字节统计含义 | 服务统计显式持有的 Provider 字节、Worker 客户端字节和导出 Blob 字节；不涵盖源 PPTX、浏览器字体内部存储或 Worker WASM 容量 |

规范依据：[OpenType cmap](https://learn.microsoft.com/en-us/typography/opentype/spec/cmap)、[glyf](https://learn.microsoft.com/en-us/typography/opentype/spec/glyf)、[OS/2 fsType](https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype)、[EOT 容器](https://www.w3.org/submissions/EOT/)。

## 审查后的修复

| 轴 | 发现与处理 |
|---|---|
| 需求（3 项） | 名称表按记录 / 累计解码字节限额；项目符号只继承字体 / 大小 / 颜色；问题列表统一上限 499 条诊断加 1 条预算提示 |
| 规范（2 项） | 产品使用 `embeddedFonts: source` 避免旧同步解码；旧本机字体及安装失败注册通过 `release` 归还预算，Worker 重建其他只读任务 |
| 产品门禁取证 | 窄屏触点误把布局视口坐标交给 CDP，记录显示约 67 px 水平偏移；按 visualViewport 原点换算后真实保存通过。未附加调试的 Worker URL 可为空，按新增 target 身份验证创建与退出 |
| 独立浏览器发现 | 补非 Macintosh cmap language 为零的校验；HarfBuzz 能整形不等于字体格式有效，更不等于 Chrome 能安装 |

API、来源、默认预算与复现步骤见[字体指南](../../font-glyphs.md)。

## 完整中文字体成本

Chrome 152.0.7977.83，同一独立浏览器进程、HTTP 缓存禁用；后续轮次仍可能复用编译缓存。FontTools 将固定上游 NotoSansSC 实例化为 400 字重，不做字集子集化，修改后家族已换名；字节 hash 为 `d475c009444c0f4838cf889ebaa2dff5a69afdf4d7dd5d70840582c43ff72fce`。

| 维度 | 三轮观察范围 |
|---|---|
| 注册 10.6 MB / 31,036 字形 | 30.9–35.0 ms，不启动 HarfBuzz |
| 首次 Worker 注册并整形 | 65.4–76.1 ms |
| 5 万 UTF-16 单位整形（每轮 5 次） | 55.7–84.9 ms，含线程传输与结果校验 |
| 8 个并发长文本请求 | 387.6–403.4 ms，总完成时间 |
| 取消活跃长文本请求 | 约 3.7 ms；旧 Worker 终止，后续请求可重建 |
| 遍历中取消大字体注册 | 16.6–16.9 ms；注册字节与预留归零 |
| WASM 线性内存容量 | 18,743,296 字节；由公开字体表视图的 backing buffer 读取，非 malloc 已用字节 |
| 关闭后页面 JS 堆 | GC 后三轮 769,368 → 784,664 → 804,196 字节；backing storage 均为 257,772 字节，不包含 Worker JS 堆 |
| 关闭 | 每轮 Provider / 客户端持有字体字节归零，Worker target 全部退出；未测进程 RSS 或瞬时峰值 |

真实 MTX 读取固定 POI 语料，最终五份为 `invalid-font`（cmap 的非 Macintosh language 非零），一份可注册和整形。实际产品打开链路调用主线程解码器 0 次；该合法 face 的真实字重为 900，产品当前常规 / 粗体绑定返回 `face-style-mismatch`。全部问题可定位，关闭后资源归零。未修写来源字体，也未将这份负面验收记为六份字体均可安装；此限制不影响静态合法 TTF、合规 EOT 容器或宿主注入其他合规解码器。
