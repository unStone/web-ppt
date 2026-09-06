# 官网中英文验收矩阵

范围：[路线图](roadmap.md)与[国际化票据](wayfinder/ppt-data-fidelity/tickets/006-site-i18n.md)。
对象是官网首页、样本查看器和编辑页的产品界面，不是文稿翻译，也不是编辑画布的完整 AT 语义。

## 语言与内容边界

| 约束 | 实现 / 验收证据 |
|---|---|
| 中文 `zh-CN` / 英文 `en`；URL → 保存偏好 → 浏览器语言；未知语言回退英文 | [语言解析](../packages/site/src/i18n/locale.ts)、[偏好与深链接回归](../tooling/lib/site-editor-language-contract.mjs) |
| 三页静态中文与 `.en.html` 镜像；无脚本也有对应 metadata | [静态产物验收](../tooling/test-site-i18n-static.mjs)：语言互链、canonical、JSON-LD、Open Graph、Twitter 与页面语言一致 |
| 缺词 / 参数不匹配失败；不猜测翻译文稿 | [类型契约](../tooling/type-contracts/site-i18n.ts)、[构建守卫](../tooling/check-site-i18n.mjs)；动态文本仅显式消息绑定 |
| 默认中文不加载英文目录；慢请求等待、失败明确回退，刷新后可恢复 | [生产入口](../tooling/lib/site-i18n-production-contract.mjs)、[冷启动词库回归](../tooling/lib/site-i18n-startup-contract.mjs) |
| 词条与站点状态不进入八个发布包，也不新增运行时依赖 | [构建守卫](../tooling/check-site-i18n.mjs)同时检查产物与全部发布入口源码依赖图，含反例 |
| 文件名、文稿文字、对象名、图表数据、URL、样本署名与底层诊断保留原文 | 下列文件、图表、对象、预览契约包含中文和 `<` / `&` 参数；只在创建默认文稿/对象时选择当前语言的名称 |

## 产品工作流

表中回归均在真实 Chrome 上消费生产产物；状态检查用公开 DOM / 无障碍树，交互用键鼠/触屏，
文件和网络问题在浏览器文件、编码、下载或请求边界制造，不替换编辑器内部实现。

| 工作流 | 两种语言与状态保持的证据 |
|---|---|
| 打开 / 保存 / 图片 ZIP、任务中切语言、失败与旧格式转换 | [文件](../tooling/lib/site-i18n-files-contract.mjs)、[错误与转换](../tooling/lib/site-i18n-errors-contract.mjs)：真实下载字节、原文件名、取消保持会话、文件任务锁与完成后恢复 |
| 模板按需新建与取消 | [模板](../tooling/lib/site-i18n-template-contract.mjs)：四个入口、三套设计名称、弹层身份、Esc 与重新打开；未选择前不替换当前文件 |
| 本机恢复 / 放弃、写入 / 失败、冷恢复后续编 | [恢复](../tooling/lib/site-i18n-recovery-contract.mjs)：真实 IndexedDB 事务中止、失败不损伤文稿和历史、保存副本重开后正常落盘；恢复决策中切语言不代替决策 |
| 默认示例 HTTP / 网络失败、异步竞态 | [示例启动](../tooling/lib/site-i18n-bootstrap-contract.mjs)：无文稿不误报可编辑；切语言、打开/新建、编辑与保存重开；迟到响应不能覆盖本地文件 |
| 首页动态信息、查看器导航与全屏 | [查看器](../tooling/lib/site-i18n-viewer-contract.mjs)、[控件](../tooling/lib/site-viewer-controls-contract.mjs)：下载/解析、页码、查看器身份与复制成功/失败/恢复 |
| 样本卡片与预览、失败重开、迟到请求 | [样本](../tooling/lib/site-i18n-gallery-contract.mjs)：动态导航保留语言，样本标题/署名/出处不翻译，关闭与重开隔离请求 |
| 首页架构图、疑难案例与更多样本 | [首页](../tooling/lib/site-i18n-home-contract.mjs)：产品展示与源样本分离，案例下载失败提示与实际文稿超链接反馈 |
| 媒体插入 / 海报 / 外链与原生播放 | [媒体](../tooling/lib/site-i18n-media-contract.mjs)：真实媒体文件、校验、等待中切语言、撤销/重做、错误降级与播放器状态保持 |
| 图表数据编辑与只读分支 | [图表](../tooling/lib/site-i18n-chart-contract.mjs)：类别/散点/气泡/组合图、输入与光标、加载失败、原始数据与保存重开 |
| 查找替换 / 格式刷 | [产品工具](../tooling/lib/site-i18n-product-tools-contract.mjs)：跨页命中、非法输入与恢复、原生键盘不能绕过禁用、历史与格式应用 |
| 页面备注 / 切换 / 动画时间线 | [页面工具](../tooling/lib/site-i18n-slide-tools-contract.mjs)：枚举值不变、原文备注/动画目标、未提交输入、排序与保存重开 |
| 形状、文字、图片与链接格式 | [对象](../tooling/lib/site-i18n-inspector-contract.mjs)、[文字](../tooling/lib/site-i18n-text-contract.mjs)、[图片](../tooling/lib/site-i18n-image-contract.mjs)、[插入/链接](../tooling/lib/site-i18n-content-contract.mjs)：校验后恢复、原生输入、撤销/重做与保存 |
| 动画预览 / 长按与通用反馈 | [反馈](../tooling/lib/site-i18n-feedback-contract.mjs)：真实 WAAPI 和触点、预览取消不误报成功、过期任务不覆盖新状态 |
| 选择窗格及画布编辑上下文名称 | [对象树](../tooling/lib/site-i18n-accessibility-contract.mjs)、[搜索/文字/单元格/文件输入](../tooling/lib/site-i18n-view-labels-contract.mjs)：真实无障碍树、焦点/选区/草稿与继承状态 |
| 空占位符编辑提示 | [占位符](../tooling/lib/site-i18n-placeholder-contract.mjs)：语言原地切换、模式/缩放、真实双击、撤销重做、保存重开不写入产品提示 |
| 三页与模板/恢复/媒体/预览浮层的语言入口 | [共用输入矩阵](../tooling/lib/site-language-input-contract.mjs)：320px 触点可达，原生 Tab / Shift+Tab / Enter；单一入口暂借后归还 |

## 完成门禁

| 范围 | 命令 |
|---|---|
| 类型、全部功能/浏览器/性能回归、八包构建与一致性 | `npm run check && npm test && npm run build && npm run verify` |
| 根路径完整生产回归 | `env -u SITE_I18N_ONLY SITE_BASE=/ npm run test:site:i18n` |
| GitHub Pages 子路径完整生产回归 | `env -u SITE_I18N_ONLY SITE_BASE=/web-ppt/ npm run test:site:i18n` |

专项过滤只用于定位，不能替代上面的完整门禁。OS 原生文件选择器/媒体控件的语言由浏览器和系统决定；
站点负责其入口与上下文名称。画布 AT 语义、File System Access 与 EditContext 仍按总路线图单独推进。
