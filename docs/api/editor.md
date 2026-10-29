# 编辑器接入

`@web-ppt/editor` 管理解析资源、headless `Editor` 与全部挂载视图；`@web-ppt/edit-core` 提供编辑文档模型、命令历史、投影与保存；`@web-ppt/react` / `@web-ppt/vue` 是薄适配层。查看器见[查看器与渲染](viewer.md)，格式边界见[格式能力](format-capabilities.md)。

外部 Agent 可按需使用 [describe 结构化读出](agent-describe.md)，获得当前编辑态的稳定元素 ID、页面坐标、占位符来源和段落文字。

## 安装

编辑能力自 0.5.0 起稳定，整套依赖必须使用相同版本：

```bash
npm i @web-ppt/core @web-ppt/edit-core @web-ppt/viewer-core @web-ppt/editor
# React / Vue 项目再安装 @web-ppt/react react 或 @web-ppt/vue vue
```

## 打开与挂载

```ts
import { openEditor } from '@web-ppt/editor';

const session = await openEditor(file);
const slideView = session.mount(container, { mode: 'edit', zoom: 1 });
const selectionPane = session.mountSelectionPane(paneContainer, { mode: 'edit' });
const slideId = session.editor.doc.slideOrder[0];
const elementId = session.editor.doc.slides[slideId].children[0];
session.editor.exec({ type: 'SetXfrm', id: elementId, x: 120 });
session.editor.exec({ type: 'SetZ', id: elementId, to: 'front' });
const current = session.toPresentation();             // 当前编辑态的只读投影，不触发保存点
slideView.setMode('view'); // 静态预览不重建，只隐藏交互层
selectionPane.setMode('view');
session.dispose();         // 释放全部视图、原包与 blob URL
```

## 内置模板

新建文稿可按需加载内置模板目录；三套模板只包含确定性主题、母版与版式配方，不进入默认入口：

```ts
import { createPptxFromTemplate, listBuiltinTemplates } from '@web-ppt/editor/templates';
import { openEditor } from '@web-ppt/editor';

const catalog = listBuiltinTemplates(); // 极光 / 刊页 / 夜幕，以及轻量预览色 token
const session = await openEditor(createPptxFromTemplate(catalog[0].id));
```

0.7 的统一门禁（`npm run test:v07`）沿“模板 → 主题 → 母版 → 版式 → 普通页面 → 保存重开”走完三套模板；`SetTheme` 走 `exec`，母版与版式走 `execDesign`，它们共享历史、恢复、协同和保存协议，但普通页面不能越权修改设计画布。

## 设计画布

```ts
import { openEditor } from '@web-ppt/editor';
import { createDesignEditor, listLayouts, listMasters, queryMaster } from '@web-ppt/editor/design';

const session = await openEditor(file);
const slideView = session.mount(container, { mode: 'edit', zoom: 1 });
const layout = listLayouts(session.editor.doc)[0];
const designView = createDesignEditor(layoutContainer, session, { target: layout.target });
designView.exec({ type: 'SetBackground', target: layout.target, fill: { type: 'solid', color: '#112233' } });
const master = listMasters(session.editor.doc)[0];
designView.setTarget(master.target);
const masterState = queryMaster(session.editor.doc, master.target); // 背景与 title/body/other × 9 级来源/有效值/覆盖
designView.exec({
  type: 'SetMasterTextStyle', target: master.target, category: 'body', level: 1,
  paragraph: { align: 'right' }, run: { font: 'Aptos', size: 30 },
});
const imageZip = await import('@web-ppt/core/image-zip');
const currentImages = await imageZip.presentationToImageZip(session.toPresentation());
designView.destroy();     // 设计画布是按需扩展，显式释放
session.dispose();
```

## React / Vue 适配

React / Vue 不必自己翻译生命周期，可直接安装官方薄适配包；`mode`、`slideId`、`zoom` 都是受控属性，`source` 由组件拥有并释放，注入共享会话时必须显式写 `sessionOwnership="external"`：

```tsx
import { WebPptEditor } from '@web-ppt/react';

<WebPptEditor source={file} mode="edit" zoom={1} onError={console.error} />
```

Vue 使用同名 `WebPptEditor`（来自 `@web-ppt/vue`）和 kebab-case 属性。两包都支持 SSR 导入、文件替换、view/edit 切换、撤销、保存、多视图与卸载清理；Svelte、Web Component 等可直接复用 editor 的同一 adapter contract。

需要选择窗格时，React/Vue 的 `WebPptSelectionPane` 直接复用 `useWebPptAdapter()` 返回的 adapter；无框架宿主使用 `session.mountSelectionPane()`。对象树支持键盘导航、重命名、锁定、隐藏和组合继承，文字/几何编辑不会重建目录 DOM。

## 交互能力

编辑模式的 interaction SVG 会为普通、旋转/翻转及嵌套组元素绘制精确 OBB、8 个缩放柄和旋转柄；手柄始终保持屏幕像素尺寸。`@web-ppt/editor` 同时公开元素本地坐标、幻灯片坐标与屏幕坐标的纯函数，框架适配器无需复制组变换数学。

元素和多选可直接移动；8 个缩放柄支持 Shift 等比、Alt 中心缩放与过锚翻面。旋转柄支持连续跨越 ±180°、动态 Shift 15° 约束、嵌套翻转组与共同中心多选；变换帧只改幽灵 DOM，松手才形成一个可撤销、可保存的事务。

移动以屏幕 6px 为阈值吸附画布与同组兄弟的边缘、中线和等距位置，`Ctrl` 可临时关闭；参考线与等距箭头只进入 interaction SVG。空白画布拖过屏幕 3px 后进入 PowerPoint 语义框选：只命中世界 OBB 四角完全落入的当前组直属元素，预览不改模型或静态 SVG。

触屏点选只对手指增加 12px 细描边容差，鼠标和触控笔保持精确命中；单指沿用上述编辑手势，双指升级为不进历史的画布缩放/平移。宿主通过 `onTouchNavigate` 接管外层视口，通过 `onContextRequest` 呈现 500ms 长按菜单；查看模式不绑定编辑触屏事件，页面滚动仍归浏览器。

视图聚焦后，方向键以幻灯片空间微移 1px，`Shift`+方向键微移 10px；多选与嵌套组保持相同世界位移，一次物理长按只占一个可撤销、可保存的历史单元。`Tab` / `Shift+Tab` 按当前页或已进入组的直属绘制顺序循环选取可编辑元素；跨页共享选区从当前视图首项/末项重新开始。表单、Shadow DOM 与文本编辑焦点不会被画布劫持。

## 快捷键与剪贴板

`Ctrl/Cmd+Z` 撤销，`Ctrl/Cmd+Shift+Z` 或 `Ctrl/Cmd+Y` 重做；恢复的选区属于其它页面时，仅收到快捷键的视图自动切到结果页，其它共享视图不跳页。活动 pointer 预览和文本控件继续拥有自己的快捷键，单元素撤销重做仍只更新目标 DOM 分区。

`Ctrl/Cmd+C/X/V` 通过浏览器同步 `ClipboardEvent` 复制、剪切、粘贴元素树，图片资源按 SHA-256 去重，超链接与 OOXML 关系在目标页重建；`Ctrl/Cmd+D` 不触碰系统剪贴板，直接偏移 10px 再制。粘贴、剪切和再制各自只形成一个撤销单元，view 模式、表单/contenteditable、文本选区及活动手势保留浏览器所有权。

进入文字编辑后，同一组快捷键改为复制、剪切和粘贴文字：默认粘贴白名单内的字体、字号和粗斜下删格式，`Ctrl/Cmd+Shift+V` 强制纯文本；块节点生成段落，`<br>` 保持硬换行。外部 HTML 只解析为纯 JSON 片段，脚本、样式表、链接目标和图片源不会进入活动 DOM，清洗后文本与 `text/plain` 不一致时自动降级为纯文本。

`Delete` / `Backspace` 把当前元素选区作为一个事务删除；组合会递归删除，图表、SmartArt、OLE 等框架对象只删除外框，不清理可能共享的关系或媒体。含内容占位符第一次只清空文字并保留框，第二次才删框。删除与撤销按稳定 z 序增量移除/插回 DOM，未触碰兄弟保持节点身份；表单、Shadow DOM、文本编辑焦点和活动 pointer 手势仍保留浏览器所有权。

`Ctrl/Cmd+]` 上移一层，`Ctrl/Cmd+Shift+]` 置顶，`Ctrl/Cmd+[` 下移一层，`Ctrl/Cmd+Shift+[` 置底。多选保持内部相对顺序并只形成一个撤销单元；组内元素、超链接与 frame 对象沿用相同语义。DOM 只移动现有元素分区，不重建 markup/defs，边界操作也不会制造空历史。

`Shift`、`Ctrl` 或 macOS `Cmd` 点击按当前页/组的绘制顺序加入或移除元素；与 `Alt` 组合时可继续穿透重叠对象。带修饰键框选会预览并提交既有选区与框中对象的对称差，空白修饰点击保留选区。所有这些操作只改 interaction SVG，不写历史或重建静态预览。

## 格式刷、查找与页面属性

单选形状/图片/组或文字范围后，`slideView.startFormatPainter()` 启用单次格式刷，`{ continuous: true }` 可跨页、跨视图连续使用。`Escape`、切换 view、删除来源或释放会话会立即退出；不兼容目标通过统一错误 seam 报告且不丢来源。React/Vue 直接用共享 adapter 的 `startFormatPainter/cancelFormatPainter` 和 `snapshot.formatPainter`，不复制状态机；Chrome 60 元素完整反馈 p95 为 0.4ms。

`Ctrl/Cmd+F` 与 `Ctrl/Cmd+H` 打开会话级查找/替换，`Enter` / `Shift+Enter` 循环导航，`Escape` 关闭。view 模式可跨页查找与高亮，edit 模式才允许替换当前或全部；命中字段、公式、锁定对象时保持原子边界。React/Vue 使用 `adapter.openTextSearch()` 等动作和 `snapshot.textSearch` 渲染自己的搜索栏，不会复制索引或状态机。Chrome 契约实测 200 页首次索引 / 冷查询 p95 为 2.0 / 0.5ms，60 元素页导航 / 替换完整反馈 p95 为 0.1 / 0.9ms。

页面切换工具栏直接使用 `queryTransition` / `setTransition` / `previewTransition`：view/edit 均可即时预览当前值或尚未提交的值，只有 edit 能写入；连续预览会取消旧动画，默认挂载不自动播放。React/Vue 复用同一 adapter，支持 40 种效果、显式关闭、来源恢复、精确时长、自动换片与 morph 粒度。Chrome 实测 40 种效果与 60 元素复杂页启动 p95 0.1ms，200 页批量提交 / 单页反馈 p95 2.4 / 0.3ms。

元素动画工具栏使用 `queryAnimations` / `setAnimations` / `previewAnimations`：时间线以稳定元素身份表达，`null` 恢复来源，`[]` 显式清空；view/edit 都能预览当前值或尚未提交的合法值，预览不改模型、选区或历史。首版安全目录覆盖 appear/fade/fly/wipe/zoom/dissolve、spin/grow 与 2–256 顶点运动路径；复杂来源会返回 `sourceReadonly`，产品应提示用户明确整条替换；公开 `MAX_ANIMATION_STEPS=128` 供工具栏提前约束。Chrome 实测 60 元素启动 / 200 页批量提交 / 单页反馈 p95 为 0.8 / 3.5 / 0.4ms。

## 低层 EditDoc

直接开发编辑适配器、做增量更新或字符串比较时，可显式指定稳定的 SVG 命名空间；编辑器需要回写锚点时，再显式开启编辑解析并交给无框架的 `EditDoc`：

```ts
import { layoutText, parse, renderElementToSvg, renderSlideToSvg, renderTextBodyToHtml } from '@web-ppt/core';
import { createDoc, disposeDoc, invalidateElement, renderedElement, toSlide } from '@web-ppt/edit-core';

const source = await parse(file, { edit: true, keepPackage: true, lazy: false });
const doc = createDoc(source);
const slideId = doc.slideOrder[0];
const elementId = doc.slides[slideId].children[0];

doc.elements[elementId].ovr.x = 120;                 // src 不变，ovr 只记用户改动
invalidateElement(doc, elementId);                  // 只失效该元素、组祖先和所属页
const svg = renderSlideToSvg(source, toSlide(doc, slideId), { idPrefix: `${slideId}-` });

// 交互时只渲染脏元素；同一 SVG 中每个元素必须使用独立、稳定的前缀。
// renderedElement 已把祖先组合的缩放折算进外框，组内元素的局部重渲与整页渲染一致。
const part = renderElementToSvg(renderedElement(doc, elementId), {
  idPrefix: `${slideId}-${elementId}-`,
});
// part.markup 与 part.defs 应作为该元素自己的两个 DOM 分区一起替换。
```

`renderTextBodyToHtml` 默认输出 `data-p` / `data-r`、空 run、项目符号和有效 autofit 比例标记，供 IME 结束后的 DOM 反解与选区还原；它不访问 DOM，也不会替调用方管理焦点。文本、属性和 CSS 边界会转义，`javascript:` / `file:` 等危险链接只保留为不可点击数据。

`layoutText` 与原生 SVG `<text>` 共用断行、CJK 标点挤压、分栏、行距与 autofit 算法。它返回段落/run 身份、行盒和 UTF-16 光标停靠点；竖排坐标通过返回的 `transform` 映射到元素局部坐标，公式作为只允许首尾停靠的原子段。只要行盒、不做字符命中时传 `{ includeCarets: false }` 可跳过逐字测量。

## 文本编辑层

文本编辑层放在 SVG 外；正常浏览器与 `foreignObject` 预览复用完全相同的 HTML/CSS：

```ts
import { layoutText, renderTextBodyToHtml } from '@web-ppt/core';
import { renderedElement } from '@web-ppt/edit-core';

const element = renderedElement(doc, elementId);
if (element.kind === 'shape' && element.text) {
  const textLayer = document.querySelector<HTMLElement>('[data-text-layer]')!;
  textLayer.innerHTML = renderTextBodyToHtml(element.text, element.w, element.h);
  const editor = textLayer.firstElementChild as HTMLElement;
  editor.contentEditable = 'true';
  editor.spellcheck = false;

  // Safari 安全路径不再让浏览器断行，而是直接序列化原生 SVG 共用的绝对行盒。
  textLayer.innerHTML = renderTextBodyToHtml(element.text, element.w, element.h, {
    layout: 'engine',
  });
  const engineLayout = layoutText(element.text, element.w, element.h);
  // engineLayout.lines[*].segments[*].carets 是 TextRun.text 的 UTF-16 偏移。
}
```

`{ layout: 'engine' }` 会把 `layoutText()` 的软换行拆成带源 UTF-16 半开区间的绝对定位分段，同时以不可见锚点保留硬换行、空 run/段和公式原子；`white-space: pre` 确保浏览器不会二次断行。

## 预设几何与保存

缩放预设形状时，投影会从保留的 `preset + adj` 自动重算路径。`doc.meta.readonly` 会明确指出输入是否缺少可靠的保存上下文，避免用户编辑完才发现不能保存。切换类型可直接提交 `SetPreset`，调节值提交 `SetAdj`；需要可视化句柄时再按需加载独立入口：

```ts
import { resolvePresetAdjustmentHandles } from '@web-ppt/core/geometry/handles';
import { createPresetAdjustmentEditor } from '@web-ppt/editor/adjustments';

const handles = resolvePresetAdjustmentHandles({ preset: 'roundRect', adj: {} }, 320, 180);
const adjustments = createPresetAdjustmentEditor(session, view);
adjustments.start(elementId); // interaction 层预览，pointerup 形成一个撤销事务
```

句柄表覆盖 187 个规范预设，其中 120 个含句柄；公式按 EMU 求值，默认 core、edit-core 与 editor 入口均不包含这张表。

保存链路可按需导入 `@web-ppt/edit-core/xml`：保留型树对未修改 part 逐字节回环，定点改属性时保留声明、注释、PI、命名空间前缀、属性顺序、自闭合形态和 `AlternateContent`，新增节点统一走 OOXML sequence 顺序表。`@web-ppt/edit-core/opc` 再把脏 part 合回原包：净条目连本地头、extra field 和压缩流一起逐字直通；无修改保存直接复用原始字节，特殊 ZIP 特性会返回可展示的降级原因。

## 相关

- [查看器与渲染](viewer.md)
- [格式能力矩阵](format-capabilities.md)
- [格式限制](format-limitations.md)
- [API 稳定性与迁移](api-stability.md)
- [本地文件保存](local-file-save.md)
- [移动端与浏览器增强](browser-editing.md)
- [测试规范](../engineering/testing.md)
- [编辑技术总纲](../design/editing-design.md)
