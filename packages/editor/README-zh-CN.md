# @web-ppt/editor

[English](README.md) · **简体中文**

[Web-PPT](https://github.com/unStone/web-ppt) 的无框架浏览器 DOM 编辑层。文件只打开一次，编辑会话统一拥有
解析资源与 headless 编辑模型；文件不上传，同一会话可挂载一份或多份高保真幻灯片视图。

```bash
npm i @web-ppt/core @web-ppt/edit-core @web-ppt/viewer-core @web-ppt/editor
```

```ts
import { openEditor } from '@web-ppt/editor';

const session = await openEditor(file);
const view = session.mount(container, {
  mode: 'edit', zoom: 1, textMode: 'auto', snapping: true,
  snapMargins: { left: 24, right: 24, top: 24, bottom: 24 }, // 可选，单位为幻灯片 px
});

const slideId = session.editor.doc.slideOrder[0];
const elementId = session.editor.doc.slides[slideId].children[0];
session.editor.exec({ type: 'SetXfrm', id: elementId, x: 120 });
session.editor.exec({ type: 'AlignElements', ids: [elementId], edge: 'center' });
session.editor.exec({
  type: 'AddShape', slideId, preset: 'roundRect',
  rect: { x: 360, y: 180, w: 280, h: 160 },
});
const layoutId = session.editor.doc.layoutOrder[0];
const added = session.editor.exec({ type: 'AddSlide', layoutId, at: { after: slideId } });
view.setSlide([...added.createdSlides][0]);
session.editor.exec({ type: 'MoveSlide', id: view.slideId, at: { after: null } });
const duplicated = session.editor.exec({ type: 'DuplicateSlide', id: view.slideId });
view.setSlide([...duplicated.createdSlides][0]);

await view.insertImage(imageFile, { rect: { x: 420, y: 180, w: 320, h: 220 } });
// 或在工具栏点击中调用：const imageId = await view.chooseImage();
const tableId = view.insertTable(3, 4); // 行、列；当前空内容占位符会被原位替换

view.setMode('view');       // 静态预览 DOM 不重建，只隐藏交互层
view.setMode('edit');
view.setSlide(slideId);
view.setZoom(1.5);
view.setSnapping(false);   // 无需重新挂载即可切换

const bytes = await session.editor.save();
view.destroy();             // 只销毁这一份视图
session.dispose();          // 销毁剩余视图并释放 ZIP 字节 / blob URL
```

`SlideEditor` 由三层组成：既有 SVG 静态预览、SVG 交互覆盖层、HTML 文本覆盖层。headless `Editor`
提交事务后只替换脏元素自己的 markup 与 defs 分区；未修改兄弟的 DOM 节点身份保持不变。只有脏分区
超过 8 个且覆盖本页 30% 以上时才退回整页重渲，避免小页面的比例失真。顶层和嵌套组节点都会得到
稳定 `data-edit-id`，命中不依赖只在 OOXML part 内有效的数字 id。

聚焦的 edit 视图通过同步 `ClipboardEvent` 支持原生 `Ctrl/Cmd+C/X/V`，同时写入
`application/x-web-ppt-elements+json` 与 `text/plain`，不会调用需要权限的 `navigator.clipboard`。
多元素树粘贴只形成一个撤销单元；`Ctrl/Cmd+D` 不改系统剪贴板，直接按幻灯片坐标偏移 10px 再制。
view 模式、活动 pointer 手势、文本/表格选区及表单/contenteditable 后代保留浏览器所有权。小批量只
插入新增 markup/defs 分区，大批量才使用既有的有界整页回退。

链接遵循 PowerPoint 的 edit/view 区分：edit 单击只选择，`Ctrl/Cmd+Enter` 或 `view.followLink()` 才跟随
当前单一元素/文字链接；view 模式的内链可用 `Tab` 聚焦、`Enter` 跟随，并以稳定 `SlideId` 路由，外链默认以
`noopener,noreferrer` 安全打开。
任意 UI 框架都可用同一个回调接管，返回 `true` 表示宿主已完成路由：

```ts
const view = session.mount(container, {
  mode: 'edit',
  onLinkFollow(target, context) {
    if (target.kind === 'slide') {
      appRouter.openSlide(target.slideId);
      return true;
    }
  },
});
view.followLink({ kind: 'external', href: 'https://example.com/docs' });
```

回调只收到外链或稳定页身份，不暴露页下标和 OOXML action。view 模式不安装编辑 pointer/键盘/剪贴板
监听器；模式切换与 `destroy()` 对称释放，多份 React/Vue/Svelte/Web Component/原生 view 的导航状态互不串联。

双击可编辑形状会打开 HTML 文字层，直接使用浏览器原生选区与 IME。选中文字后，`Ctrl/Cmd+B`、`I`、
`U` 及对应 `beforeinput` 格式事件会作为一个撤销单元提交；折叠光标下则只更新本视图的待输入格式，
下一次插入与格式合成一个历史单元，不制造零宽模型 run。实时 DOM Range 会发布到
`session.editor.selection`；非折叠选区可直接调用 headless `SetRunProps` / `queryRunProps`，折叠光标的
待输入格式则通过下方视图 seam 留在拥有输入权的视图。所有挂载视图同步刷新，同时活动浏览器选区保持
不丢。切到 view 模式会关闭输入层并保留同一份高保真静态预览。

```ts
const unregister = view.registerTextUi(toolbarElement);
boldButton.addEventListener('pointerdown', (event) => {
  event.preventDefault(); // 保住原生选区与焦点
  const state = view.queryRunProps();
  if (state) view.setRunProps({ b: state.b.mixed || state.b.value !== true });
});
centerButton.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  const state = view.queryParaProps();
  if (state) view.setParaProps({ align: 'center' });
});
// 工具栏不再属于本视图时调用 unregister()。
```

段落控件复用同一条实时 DOM Range，且不绑定框架。`setParaProps` 把所有触及段落（包括折叠光标所在段）
作为一个撤销单元提交，然后恢复浏览器 Range；`queryParaProps` 分别报告对齐、有效行高、间距、边距和
缩进的混合态。共享会话的全部视图都会刷新，已通过 `registerTextUi` 注册的外部工具栏不会抢走焦点或
意外关闭文字编辑。

文字态的 `Ctrl/Cmd+C`、`X`、`V` 直接使用浏览器同步剪贴板事件。复制和剪切会写入清洗后的 `text/plain` 与
`text/html`；默认粘贴只保留字体、字号、粗体、斜体、下划线和删除线，`Ctrl/Cmd+Shift+V` 忽略 HTML。
块节点映射为 PPT 段落，`<br>` 保持段内硬换行。外部 HTML 只在脱离页面的树中解析，绝不注入活动编辑面；脚本、
样式表、链接目标、图片源、隐藏元数据和白名单外 CSS 都会丢弃。清洗后的 HTML 文本若与 `text/plain` 不一致，
就退化为纯文本而不猜索引。每次粘贴或剪切只形成一个撤销单元。当前图片载荷会被安全拦截且不改 DOM，后续由
`AddImage` 命令接管。

编辑模式直接使用浏览器 SVG 原生命中：点击组内元素默认选最外层组，双击每次进入一层，
`Escape` 每次退出一层；`Alt`+点击按 `elementsFromPoint` 的 z 序循环重叠候选。锁定、
用户隐藏和不可编辑的分支不会被选中。查看模式不拦截指针事件，也不改共享的 headless 选区；
选择变化只替换交互层，静态预览 DOM 保持不变。

`Shift`、`Ctrl` 或 macOS `Command`+点击会在当前页或已进入组的直属可选子项中增减选；与 `Alt` 组合
仍可触达重叠栈里尚未选中的对象。带修饰键框选预览并提交有效旧选区与完全框中对象的对称差，带修饰键
空白点击保留选区。结果按绘制顺序排列，不写历史，也不重建静态预览。

编辑视图聚焦后，方向键在幻灯片空间微移 `1px`，`Shift`+方向键微移 `10px`；多选和旋转、翻转、
非均匀缩放组内元素都会得到相同世界位移。一次物理按住产生的 auto-repeat 合成一个撤销单元，松开后
再按则分开；锁定、隐藏、不可编辑或跨页选区会整次拒绝。view 模式、活动 pointer 手势以及普通或
Shadow DOM 内的表单/contenteditable 保留自己的方向键所有权。

`Tab` / `Shift+Tab` 按当前页或已进入组的直属绘制顺序正向/反向循环选取可编辑元素；共享会话中的
其它页面选区会从本视图首项/末项重新开始。遍历只改选区，不写历史、不重建静态预览；普通或
Shadow DOM 内的表单/contenteditable 仍使用浏览器原生 Tab 焦点行为。

双击表格单元格进入同一文字编辑面后，`Tab` / `Shift+Tab` 只在非合并占位格之间移动；最后一格按
`Tab` 会用一个 `InsertRow` 事务追加空行并进入新行首格。表样式、frame 高度、静态预览、选择框与
caret 同步更新，焦点不会逃到页面其它控件；view 模式不会触发结构命令。

`Ctrl/Cmd+Z` 撤销，`Ctrl/Cmd+Shift+Z` 或 `Ctrl/Cmd+Y` 重做。恢复选区在其它页面时，只有收到事件的
编辑视图切到结果页；其它共享视图保持原页。活动 pointer 预览与普通或 Shadow DOM 文本控件保留键盘
所有权，单元素历史仍只替换自己的 DOM 分区。

`Delete` / `Backspace` 把当前元素选区作为一个撤销单元删除。组合递归删除；图表、SmartArt、OLE 等
框架对象只移除外框，不回收可能共享的关系或媒体。有内容的占位符第一次只清空文字，第二次才删除框。
删除与撤销按稳定 z 序增量移除或插回 markup/defs 分区，未触碰兄弟保持 DOM 身份；表单、contenteditable、
Shadow DOM 文本与活动 pointer 手势继续使用浏览器原生键盘行为。

`Ctrl/Cmd+]` 上移一层，`Ctrl/Cmd+Shift+]` 置顶，`Ctrl/Cmd+[` 下移一层，`Ctrl/Cmd+Shift+[` 置底。
多选作为一个撤销单元移动并保持内部相对顺序，组内元素和 frame 对象使用同一语义；边界操作不制造空历史。
视图只移动既有 markup 分区，defs、超链接 wrapper、未触碰兄弟和共享视图中的节点身份都保持不变。

产品工具栏不进入基础 DOM 包。六个对齐按钮直接调用 headless `AlignElements` 命令，已挂载视图会同步
替换真正移动的元素并刷新选择框。React、Vue、Web Component 与原生应用因此共用同一个集成面，
框架运行时不会进入 editor 包。

填充和描边控件复用同一个外置工具栏 seam。editor 发布入口直接转出 `queryElementFill`、
`queryElementStroke` 与 `SHAPE_PATTERN_PRESETS`，适配层可读取有效值/混合态并提交 JSON 命令，
无需扫描 SVG 或导入编辑器内部模块。所有已挂载的 edit/view 视图只更新目标 markup/defs 分区，
未修改兄弟和整页 SVG 的 DOM 身份保持不变。

```ts
import { openEditor, queryElementFill } from '@web-ppt/editor';

const state = queryElementFill(session.editor.doc, selectedIds);
session.editor.exec({
  type: 'SetFill', id: selectedIds[0],
  fill: { type: 'solid', color: state.mixed ? '#2563EB' : '#0EA5E9' },
});
session.editor.exec({
  type: 'SetStroke', id: selectedIds[0],
  stroke: { color: '#0F172A', width: 2, dash: null },
});
```

页面侧栏使用 editor 入口转出的 `querySlideBackground` / `querySlideHidden`，并通过同一个 headless
editor 提交 `SetBackground` / `SetHidden`。显示目标页的多个 edit/view 挂载面会同步更新背景，停留在其它页
的画布继续保留原 SVG 身份。
本地图片可直接调用 `await view.setBackgroundImage(file, options)`，或用 `view.chooseBackgroundImage()`
唤起文件选择器；已有或继承图片背景通过 `view.setBackgroundCrop(cropOrNull)` 裁剪。React、Vue、
Web Component 与原生工具栏都不需要理解 OPC 关系或媒体哈希。

形状库也复用同一条无框架 seam：调用 `session.editor.exec({ type: 'AddShape', ... })`。所有挂载视图会
同步插入新 SVG 分区，edit 视图显示选择框，双击继续打开既有文字编辑器。view 模式本身不提供创建手势；
产品层决定何时展示命令，不需要导入 DOM 内部模块。

图片按钮可调用 `view.chooseImage()` 使用内置本地文件选择器；React、Vue、Web Component 或原生工具栏
已经拿到 `File` / `Blob` 时，直接调用 `view.insertImage(file, options)`。PNG、JPEG、GIF、WebP 按字节
而不是扩展名或浏览器 MIME 识别，文件不离开本机；默认 5MB 上限保证插入仍落在标准 8MB 撤销预算内，
也可显式调整。读取期间视图暴露 `aria-busy="true"`，失败会拒绝 Promise 并派发 `webpptimageerror`。
双击空图片占位符走同一入口，占位符与新图片在一个撤销单元内原子替换；画布上的系统图片粘贴也复用
同一 `AddImage` 命令，文本/表格选区仍保留原生粘贴所有权。

表格选择器同步调用 `view.insertTable(rows, cols, options?)`。显式 `rect` 会原样使用；没有矩形时，视图会
优先替换当前选中的空内容占位符，否则按行列数生成居中的可用尺寸。结果是真实 DrawingML 表格，单元格
直接进入既有文字编辑面，末格 `Tab` 复用既有追加行路径；方法返回新元素稳定 id，view 模式明确拒绝创建。

页面导航同样使用上方的 `AddSlide` seam。headless 返回值直接给出新页身份，每个 edit/view 挂载面继续调用
既有 `setSlide` 切换，因此工具栏不用修改 DOM，也不用扫描生成 ID。edit 视图只在 interaction 层绘制空版式
占位符，双击复用现有文字编辑器；view 视图以及导出、保存产物都不含这些辅助 UI。

页面重排使用相邻的 `MoveSlide { id, at: { after } }` seam。适配层订阅 `movedSlides` 后读取最终
`session.editor.doc.slideOrder` 即可；已挂载的 view/edit 画布保持稳定 `slideId`，只增量刷新页码或相对跳页
等派生分区。React、Vue、Web Component 等框架无需维护第二份页序状态。

页面删除调用 `session.editor.exec({ type: 'RemoveSlide', id })`。所有停留在被删页的 view/edit 画布都会
关闭输入并切到公开 `removedSlideFallbacks` 指定的后继或前驱；其它画布保持自己的稳定 `slideId` 与 SVG 根。
React、Vue、Svelte、Web Component 和原生导航消费同一映射即可；当
`session.editor.doc.slideOrder.length === 1` 时应直接禁用删除入口。

页面复制提交 `DuplicateSlide { id }`，新稳定页身份从 `createdSlides` 返回。现有画布继续停留在原页并保留
活动输入，React、Vue、Svelte、Web Component 等适配层可用该身份显式切页或挂载新画布。副本默认紧邻来源；
用户选择其它位置时再组合 `MoveSlide`。

单选时 interaction SVG 绘制精确 OBB，多选时绘制各 OBB 的世界系 AABB 并集，并附带 8 个缩放柄和
1 个旋转柄；无论视图 zoom 如何变化，描边和手柄都保持屏幕像素尺寸。旋转/翻转元素与嵌套组严格复用
core 渲染器的变换顺序。

自定义适配器无需挂载额外视图，也能复用同一套纯坐标 seam：

```ts
import {
  elementFrameToSlidePoint, screenToSlidePoint,
  slideToElementFramePoint, slideToElementParentPoint,
} from '@web-ppt/editor';

const slidePoint = screenToSlidePoint(
  { x: event.clientX, y: event.clientY },
  { left: canvasRect.left, top: canvasRect.top, zoom: view.zoom },
);
const localPoint = slideToElementFramePoint(session.editor.doc, elementId, slidePoint);
const parentPoint = slideToElementParentPoint(session.editor.doc, elementId, slidePoint);
const origin = elementFrameToSlidePoint(session.editor.doc, elementId, { x: 0, y: 0 });
```

这些函数不依赖 DOM，并包含所有祖先组的旋转、翻转、子坐标偏移与缩放；几何计算使用 `localPoint`，
修改 `x` / `y` 使用 `parentPoint`。

按住元素即可在一次手势中选中并移动；拖动当前多选中的任一成员会保留并整体移动选区。屏幕 3px 阈值
区分点击与拖动。视图捕获主指针，以 `requestAnimationFrame` 合并预览帧，只平移临时 SVG wrapper
和 interaction overlay——手势期间不改模型、defs 或静态元素身份。`pointerup` 先拆幽灵，再提交一个
`SetXfrm` 事务；`Escape`、指针取消/丢失、切页、切模式或销毁视图都会无历史恢复原 DOM。
旋转/翻转嵌套组会分别换算到元素父坐标。

移动会在屏幕 6px 阈值内吸附到画布中线/边缘和同组直接兄弟的边缘/中线，等距时显示成对双向箭头。
可选 `snapMargins` 由宿主以幻灯片 px 显式给出四侧页边距，不猜文档语义。两轴独立按稳定优先级裁决，
候选重叠时不会随元素遍历顺序抖动。手势中按住 `Ctrl` 临时关闭吸附；`snapping: false` 或
`view.setSnapping(false)` 可关闭整份视图。参考线只存在于 interaction SVG，所有取消路径都会清理且不改模型。

8 个缩放柄向外扩展 4 个屏幕像素的透明命中区；四角改双轴，四边只改单轴。`Shift` 保持宽高比，
`Alt` 固定中心，手势过程中也可随时按下或释放修饰键。拖过对角锚点时，尺寸会规范成正数，活动手柄
连续跟随指针并切换 `flipH` / `flipV`，不会跳边。单个旋转/翻转元素与嵌套组在各自父坐标里守住
对角锚点；多选按共同世界系 AABB 缩放。预览复用移动手势的 pointer capture/rAF 生命周期，只改临时
wrapper 与 interaction overlay；松手把全部选择根提交为一个撤销单元。

旋转柄也有 4 个屏幕像素的透明命中余量。单选把指针角度反解到元素父坐标，能穿过自身翻转与多层
旋转/翻转组；多选围绕共同 AABB 中心同步更新每个选择根的中心和方向。角度跨越 ±180° 时连续累计，
`Shift` 可在手势中动态吸附到 15°，单选旁实时显示角度。预览仍只改幽灵 wrapper；松手以一个事务
精确写回 OOXML 的 1/60000 度，全部取消路径都不提交。

`textMode: 'auto'` 是默认值：它复用 `viewer-core` 的运行时探测，在 Safari/iOS 无法正确缩放
`foreignObject` 时自动切到原生 SVG 文本，并让 SVG 外的 `contenteditable` 直接消费 core 的 engine
绝对行盒；也可显式指定 `html` 或 `svg`。软换行不会进入模型，硬换行、空段、RTL、竖排、分栏和公式
仍可按源 UTF-16 位置编辑。整页、元素增量更新和活动编辑面始终走同一模式，不会在提交后跳版。

同一会话可以同时挂载主画布和缩略图。销毁单个视图不会误释放共享资源；销毁会话会清理全部剩余视图，
且可重复调用。React、Vue、Svelte、Web Component 或原生 DOM 适配器都复用同一个
`openEditor` / `mount` seam，本包不依赖任何 UI 框架运行时。

发布入口实测为 32.71KB gzip；`@web-ppt/core`、`@web-ppt/edit-core` 与 `@web-ppt/viewer-core`
均为 peer 依赖。

MIT
