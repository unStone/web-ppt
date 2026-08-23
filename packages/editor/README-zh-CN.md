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
const view = session.mount(container, { mode: 'edit', zoom: 1, textMode: 'auto' });

const slideId = session.editor.doc.slideOrder[0];
const elementId = session.editor.doc.slides[slideId].children[0];
session.editor.exec({ type: 'SetXfrm', id: elementId, x: 120 });

view.setMode('view');       // 静态预览 DOM 不重建，只隐藏交互层
view.setMode('edit');
view.setSlide(slideId);
view.setZoom(1.5);

const bytes = await session.editor.save();
view.destroy();             // 只销毁这一份视图
session.dispose();          // 销毁剩余视图并释放 ZIP 字节 / blob URL
```

`SlideEditor` 由三层组成：既有 SVG 静态预览、SVG 交互覆盖层、HTML 文本覆盖层。headless `Editor`
提交事务后只替换脏元素自己的 markup 与 defs 分区；未修改兄弟的 DOM 节点身份保持不变。脏顶层元素超过
本页 30% 时才退回整页重渲。顶层和嵌套组节点都会得到稳定 `data-edit-id`，命中不依赖只在 OOXML part
内有效的数字 id。

`textMode: 'auto'` 是默认值：它复用 `viewer-core` 的运行时探测，在 Safari/iOS 无法正确缩放
`foreignObject` 时自动切到原生 SVG 文本；也可显式指定 `html` 或 `svg`。整页与元素增量更新始终走
同一文本模式，不会在提交后跳版。

同一会话可以同时挂载主画布和缩略图。销毁单个视图不会误释放共享资源；销毁会话会清理全部剩余视图，
且可重复调用。React、Vue、Svelte、Web Component 或原生 DOM 适配器都复用同一个
`openEditor` / `mount` seam，本包不依赖任何 UI 框架运行时。

发布入口体积由仓库构建实测；`@web-ppt/core`、`@web-ppt/edit-core` 与 `@web-ppt/viewer-core`
均为 peer 依赖。

MIT
