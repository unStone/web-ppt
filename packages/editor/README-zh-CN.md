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
`foreignObject` 时自动切到原生 SVG 文本；也可显式指定 `html` 或 `svg`。整页与元素增量更新始终走
同一文本模式，不会在提交后跳版。

同一会话可以同时挂载主画布和缩略图。销毁单个视图不会误释放共享资源；销毁会话会清理全部剩余视图，
且可重复调用。React、Vue、Svelte、Web Component 或原生 DOM 适配器都复用同一个
`openEditor` / `mount` seam，本包不依赖任何 UI 框架运行时。

发布入口体积由仓库构建实测；`@web-ppt/core`、`@web-ppt/edit-core` 与 `@web-ppt/viewer-core`
均为 peer 依赖。

MIT
