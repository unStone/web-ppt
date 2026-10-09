# 坑索引

坑分两处维护，避免同一事实两个源头：

| 层面 | 位置 | 内容 |
|---|---|---|
| 实现陷阱（改代码前必读） | [AGENTS.md 已知陷阱](../AGENTS.md#已知陷阱) | 渲染保真、文本排版、字体、SVG 导出、npm 与发布等 13 条，随代码演进维护 |
| 交付与交互层面的坑 | 本文件 | 散落各设计文档的真踩坑记录，按域索引，每条链接出处 |

## 浏览器与平台行为

| 坑 | 出处 |
|---|---|
| Chrome 不给 `foreignObject` 里的 HTML 画 Custom Highlight，页内标字必须按文本容器拼接，否则相邻形状假命中 | [viewer-search-highlight](viewer/viewer-search-highlight.md) |
| Vite dev server 把未知扩展的 404 回成首页 HTML，HTTP 200 不等于下载成功，必须校验内容类型 | [viewer-file-progress](viewer/viewer-file-progress.md) |
| `instanceof` 跨 bundle（宿主与包各自打包同名错误类）判定会断，错误识别要靠结构特征 | [editor-open-kind](viewer/editor-open-kind.md) |
| Node 宽松解析允许的命名空间闭包（如 `p14:media`）浏览器会拒绝整页，严格 XML 必须双端验证 | [media-insertion](api/media-insertion.md) |
| Cordis 的 disposer 是 thenable，async generator 会先解包导致父作用域并行清理，破坏「字体先于会话释放」的顺序，须用同步 effect 收编 | [cordis-editor](design/cordis-editor.md) |
| 直接 import 官网对话框模块会被站点 i18n 按需加载改地址，查看器要复制轻量实现 | [viewer-password](viewer/viewer-password.md) |

## 放映与键盘交互

| 坑 | 出处 |
|---|---|
| 系统快捷键绝不能 `preventDefault`：⌘W 关标签、⌘P 打印、⌘+. 结束放映都是保留键 | [white-screen](playback/white-screen.md)、[present-prev-letter](playback/present-prev-letter.md)、[blank-period](playback/blank-period.md) |
| 监听顺序敏感：数字跳页必须排在黑屏之前、Home/End 排在之后，否则一个先揭遮罩一个后翻页 | [slide-number](playback/slide-number.md)、[slide-ends](playback/slide-ends.md) |
| 捕获与冒泡要分工：黑屏遮罩须捕获阶段先截住；翻页键放冒泡，否则先翻页再揭遮罩；网格捕获阶段见 `g` 就切换会把 Ctrl+G 吃掉 | [present-backspace](playback/present-backspace.md)、[present-vertical](playback/present-vertical.md)、[viewer-search-again](viewer/viewer-search-again.md) |
| 黑层点击须吞掉随后 50ms 的 click；黑层只盖舞台，否则无键盘的设备退不出 | [blank-screen](playback/blank-screen.md) |
| 后退时只改 visibility 不重绘会留在 fill 状态——退场仍透明、强调仍放大；先发事件再改光标会闪一帧开头 | [present-rewind](playback/present-rewind.md) |
| 隐去控制条后必须 `pointer-events:none`，否则看不见的按钮偷点击；触屏判定用 hover 媒体查询而非 UA | [present-bar](playback/present-bar.md) |
| 迟到的 `requestFullscreen` 回调要用世代令牌挡住，否则取消后仍进全屏；全屏失败退回静态终态是错误决策，应退回可交互浏览态 | [present-mode](playback/present-mode.md) |
| 滑动手势按下就 capture 会废掉竖向滚动；滑动结束不压 click 会让放映连跳两页 | [swipe-nav](playback/swipe-nav.md) |
| 备注正文必须用 `textContent` 注入（防 XSS）；下一页预览必须独立 defs id，否则渐变互串 | [speaker-aids](playback/speaker-aids.md) |
| `s` 键开备注是 Open 不是 Toggle，且不得改写浏览记忆，否则退出放映后留着放映里打开的备注 | [notes-key](playback/notes-key.md) |
| 页码芯片放在舞台里会被 `paint()` 的 innerHTML 清掉，必须挂在舞台之外 | [slide-number](playback/slide-number.md) |

## 打开与文件链路

| 坑 | 出处 |
|---|---|
| 密码框只 `remove()` 会让 `show()` 的 Promise 永远挂死，必须走取消回调闭环 | [open-session](viewer/open-session.md) |
| 魔数认文件时 CFB 提前拒会误伤加密 `.ppt`（先解密再认）；认错格式仍跑 prepare 会让 50MB PDF 卡死主线程 | [open-kind](viewer/open-kind.md) |
| 先画第 1 页再 `goTo` 目标页会闪帧；`pushState` 会把浏览器后退变成撤销翻页 | [viewer-open-page](viewer/viewer-open-page.md) |
| 换样本不删 `?p=` 会把旧页码套用到新文稿 | [sample-open-page](viewer/sample-open-page.md) |
| `blob:` URL 不能当分享链接；本地文件打开失败不删 `?file=` 的话刷新会撒谎说还在 | [viewer-clear-file](viewer/viewer-clear-file.md) |
| 下载保存只能确认浏览器接受交付，检测不到用户在下载面板点取消；恢复记录必须绑定输入字节指纹，否则同名不同内容会恢复错 | [local-file-save](api/local-file-save.md) |

## 惰性解析与性能

| 坑 | 出处 |
|---|---|
| 对 parts 做懒 Proxy 会被 `Object.keys` / 展开运算一次解完，惰性必须挡住枚举 | [parse-preview-parts](parsing/parse-preview-parts.md) |
| 一个 `slides.filter(notes)` 就能以 92ms 打穿懒解析——任何「顺手遍历全部页」都要过审 | [viewer-open-lazy](viewer/viewer-open-lazy.md) |
| 清空查找只改文案不够，必须换代（generation），否则上一趟扫描继续 inflate 后页；短作业每页 yield 的调度开销会大于工作本身 | [viewer-search-lazy](viewer/viewer-search-lazy.md) |
| 钩子扫描失败不能挡住 parse——钩子是可选增强，失败只能降级 | [advanced-prepare](parsing/advanced-prepare.md) |
| `lazy:false` 会补解全部页是调用方明确要求的，不算回归 | [parse-preview-slides](parsing/parse-preview-slides.md) |
| IntersectionObserver 第一次 observe 就回调，先观察等于先把栏顶解了；`scrollIntoView` 会连带滚动 document | [open-start-page](viewer/open-start-page.md) |

## 保存、恢复与协同

| 坑 | 出处 |
|---|---|
| 关闭恢复偏好只影响下次打开，不能越过当前待写帧，否则切换文稿时丢最后一帧编辑 | [cordis-editor](design/cordis-editor.md) |
| 文件交付期间要停止编辑命令，但触摸缩放和视口尺寸仍须同步，否则界面假死感 | [cordis-editor](design/cordis-editor.md) |
| 立体材质近似值每次保存都追加，反复保存越来越厚——查询接口要返回可写回深度，写回前先清旧近似 | [appearance-editing](api/appearance-editing.md) |
| CSS 字符串与结构化属性值不一致的富文本直接拒绝，不要猜哪个是真的 | [portable-rich-text](api/portable-rich-text.md) |

## 测试与验收方法学

| 坑 | 出处 |
|---|---|
| 专项过滤（`--source-only`、单文件检查）只用于定位问题，不能替代完整门禁 | [site-i18n](design/site-i18n.md) |
| Office COM 拒绝 Session 0 服务，PowerPoint 真机 runner 必须交互会话；`git status` 非空时跑真机会产生不可复现的假证据 | [powerpoint-runner](powerpoint-runner.md) |
| Windows PowerPoint 16.0 对 ChartEx 只显示预览图，不能当原生布局的 oracle | [chartex-native](api/chartex-native.md) |
| LibreOffice 渲染多级类别会省略显式空字符串、行内混排公式会丢弃，这些差异不能当己方 bug 的证据 | [chart-hierarchical-categories](api/chart-hierarchical-categories.md)、[portable-rich-text](api/portable-rich-text.md) |
| 「文件里有 Office 预览图」不等于「回退已生效」，要实测当前渲染路径 | [roadmap §5.10](roadmap.md) |
| 旧占位 MP4 不作播放证据，媒体验收要真实可解码字节 | [media-insertion](api/media-insertion.md) |
