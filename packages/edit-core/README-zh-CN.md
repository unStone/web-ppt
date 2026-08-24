# @web-ppt/edit-core

[English](README.md) · **简体中文**

[Web-PPT](https://github.com/unStone/web-ppt) 的无 DOM、无框架编辑模型。
它把解析源值与用户覆盖分开保存，为页和元素分配会话内稳定身份，再投影回现有高保真 `Slide` Schema。

```bash
npm i @web-ppt/core @web-ppt/edit-core
```

```ts
import { layoutText, parse, renderElementToSvg, renderSlideToSvg, renderTextBodyToHtml } from '@web-ppt/core';
import { createDoc, Editor } from '@web-ppt/edit-core';

const source = await parse(file, { edit: true, keepPackage: true, lazy: false });
const doc = createDoc(source);
const editor = new Editor(doc);
const slideId = doc.slideOrder[0];
const elementId = doc.slides[slideId].children[0];

const change = editor.exec({ type: 'SetXfrm', id: elementId, x: 120 });
editor.exec({ type: 'SetFlip', id: elementId, h: true });
editor.exec({ type: 'AlignElements', ids: [elementId], edge: 'center' });

const slide = editor.toSlide(slideId);
const svg = renderSlideToSvg(source, slide, { idPrefix: `${slideId}-` });
const dirty = renderElementToSvg(editor.effectiveElement(elementId), {
  idPrefix: `${slideId}-${elementId}-`,
});
// 把该元素自己的 dirty.markup 与 dirty.defs 两个 DOM 分区一起替换。
// change.dirtyElements 与 change.dirtySlides 给出精确失效范围。

editor.subscribe(({ dirtyElements, dirtySlides }) => updateView(dirtyElements, dirtySlides));
editor.undo();
editor.redo();
const pptxBytes = await editor.save(); // 动态加载 OOXML/ZIP 保存链路

const element = editor.effectiveElement(elementId);
if (element.kind === 'shape' && element.text) {
  const textLayer = document.querySelector<HTMLElement>('[data-text-layer]')!;
  textLayer.innerHTML = renderTextBodyToHtml(element.text, element.w, element.h);
  const textEditor = textLayer.firstElementChild as HTMLElement;
  textEditor.contentEditable = 'true';
  textEditor.spellcheck = false;

  // Safari engine 模式：不用在 SVG 内编辑，也能把指针 x 映射为 UTF-16 光标偏移。
  const engineLayout = layoutText(element.text, element.w, element.h);
  const caretStops = engineLayout.lines.flatMap((line) =>
    line.segments.flatMap((segment) => segment.carets));
}
```

命令与 patch 都是普通 JSON。事务会先校验再原子提交，只生成一个本地撤销单元，并在撤销/重做时恢复选区。
同一 `mergeKey` 的连续编辑最多合并 500ms；远端 `origin` 会应用但不进入本地历史。`isDirty()` 比较当前
状态与最近一次 `markSaved()` 保存点。React、Vue、Web Component 或原生适配层只需订阅 `subscribe()`
并调用两个投影方法，任何框架运行时都不会进入本包。

`RemoveElement` 会递归移除元素树，逆 patch 保留稳定 parent/z 身份。有内容的占位符第一次执行时只写入
空文本覆盖并保留形状，下一次才删除。保存只补丁拥有该元素的 OOXML 宿主或段落列表，并刻意保留可能被
其它元素共享的媒体与关系。

`SetZ { id, to: 'front' | 'back' | 'forward' | 'backward' }` 在同一父级与来源 part 内调整层级。
来源 `z` 保持不变，只有移动过的元素携带稀疏 `order`，因此大文档不会为未编辑元素复制顺序状态。
订阅事件用 `reorderedElements` 区分只需移动现有 DOM 的层级 patch，`renderElements` 只包含需要重建
markup/defs 的元素；框架适配层无需猜 patch 类型。

`AlignElements { ids, edge: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' }` 把单元素对齐到
幻灯片，多元素对齐到旋转后视觉 AABB 的并集。旋转对象、翻转/非均匀缩放组合内元素和框架对象都走
同一套世界坐标到父坐标换算；一个命令只生成一个撤销单元，已经对齐时不制造空历史。React、Vue、
Web Component 或原生工具栏可把六个按钮直接映射到这条 JSON 命令，无需依赖 DOM 包内部结构。

`SetRunProps` 给半开文字区间写入稀疏字符格式覆盖，支持跨 run、跨段落设置字体、幻灯片像素字号、
粗体、斜体、下划线和删除线。属性传 `null` 会删除直接格式并恢复 OOXML 继承值；公式保持不可拆且保留格式的原子，
动态字段保存后仍是原字段。headless 的折叠选区刻意不写模型——待输入格式属于挂载的输入适配层，
从而避免向 OOXML 制造零宽 run。

```ts
import { queryRunProps } from '@web-ppt/edit-core';

const range = {
  from: { p: 0, r: 0, off: 2 },
  to: { p: 1, r: 0, off: 4 },
};
editor.exec({
  type: 'SetRunProps', id: elementId, range,
  props: { font: 'Inter', size: 24, b: true },
});
const state = queryRunProps(editor.doc, elementId, range);
// state.b 为 { value: true, mixed: false }；每个属性独立报告 mixed 状态。
```

`copyElements(doc, ids)` 返回版本化、纯 JSON 的 `ElementClipboardPayload`。通过
`Editor.exec({ type: 'PasteElements', payload, at: { parentId, x, y } })` 粘贴时，会分配新的会话身份与
OOXML spid，以幻灯片视觉坐标保持嵌套组布局，并作为一个原子历史单元提交。图片以 base64 + SHA-256
携带并在目标包去重，超链接重建关系；SmartArt 等复杂对象只复用经过闭包哈希验证的同包 OPC part，
跨文档无法无损迁移时会在分配身份前明确拒绝，不会静默变成截图。

HTML 结果与预览共用渲染器，并带 `data-p` / `data-r`、项目符号、空 run 和 autofit 标记，
可直接作为 contenteditable 覆盖层的内容。core 仍不访问 DOM；焦点与 IME 生命周期由编辑器适配层负责。
`layoutText` 与原生 SVG 共用断行，并返回段落/run 身份和 UTF-16 光标停靠点；竖排用返回的
`transform` 映射逻辑坐标。只需要行盒时可传 `{ includeCarets: false }` 跳过逐字测量。

常规调用只需 `Editor.save()`：它把当前变换、层级、文字与字符格式、占位符清空和元素删除写回 OOXML，
刷新 `doc.package` 供下一次保存
继续直通，并且只在写入成功后推进脏状态保存点。需要保存诊断信息时，使用同一生命周期下的详细方法：

```ts
const result = await editor.saveDetailed();
// result.mode: identity | passthrough | repacked
// result.fallbackReason 用于解释为什么本次需要整包重压。
```

只有扩展其它写回命令时才需要直接使用底层保留型 OOXML 树：

```ts
import {
  findXmlChild, findXmlDescendant, parseXmlTree, serializeXmlTreeBytes, setXmlAttribute,
} from '@web-ppt/edit-core/xml';

const tree = parseXmlTree(doc.package!.parts['ppt/slides/slide1.xml']);
const xfrm = findXmlDescendant(tree.root, { localName: 'xfrm' })!;
const off = findXmlChild(xfrm, { localName: 'off' })!;
setXmlAttribute(off, 'x', String(Math.round(element.x * 9525)));
const changedPart = serializeXmlTreeBytes(tree);
```

底层 OPC 补丁器仍可用于脱离编辑会话的独立包变换：

```ts
import { disposeOpcPackage, patchOpcPackage } from '@web-ppt/edit-core/opc';

const packageHandle = doc.package!;
const saved = patchOpcPackage(packageHandle, {
  'ppt/slides/slide1.xml': changedPart,
});
const pptxBytes = saved.bytes;
// saved.mode: identity | passthrough | repacked
// saved.fallbackReason 非空时，UI 可说明为什么本次需要整包重压。
```

不要把底层结果直接赋给仍在编辑的 `EditDoc`：`Editor.save()` 会同时维护包与撤销保存基线。若确实要
采用一个完整的外部包快照，调用 `replaceDocPackage(doc, saved.package)`，它会显式重置该基线。
`disposeDoc(doc)` 会释放当前包；独立保存结果不再使用时调用 `disposeOpcPackage(saved.package)`。

未触碰的声明、注释、处理指令、前缀、属性顺序、自闭合形态和 `AlternateContent` 保持原词法；
`insertXmlInOrder` 统一执行 OOXML sequence，`reorderXmlChildren` 只替换既有目标槽位。UTF-8 / UTF-16
字节序和 BOM 均保留；实测 Vite 产物（含各入口静态共享 chunk）：编辑入口 41.55KB gzip，`xml` 为
7.90KB，`opc` 为 4.38KB；主入口加载后首次保存再按需增加 6.21KB。净条目的本地头、extra field 与压缩流逐字直通；zip64、数据描述符、
存档注释、加密条目等会返回明确原因并确定性重压。全部入口都不依赖 DOM。

若 `.pptx` 没有用编辑元数据与原包模式解析，`doc.meta.readonly` 会明确为 `true`，避免产生无法保存的修改。
旧 `.ppt` 走后续的生成式 `.pptx` 保存路径，不支持写回二进制 `.ppt`。
协同排序时把新元素的稳定 ULID 作为第三个参数传给
`fractionalIndexBetween(lower, upper, ulid)`；单机模式可省略。

MIT
