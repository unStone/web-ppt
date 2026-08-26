# @web-ppt/edit-core

[English](README.md) · **简体中文**

[Web-PPT](https://github.com/unStone/web-ppt) 的无 DOM、无框架编辑模型。
它把解析源值与用户覆盖分开保存，为页和元素分配会话内稳定身份，再投影回现有高保真 `Slide` Schema。

```bash
npm i @web-ppt/core @web-ppt/edit-core
```

```ts
import { layoutText, parse, renderElementToSvg, renderSlideToSvg, renderTextBodyToHtml } from '@web-ppt/core';
import { createDoc, Editor, querySelectionPane } from '@web-ppt/edit-core';

const source = await parse(file, { edit: true, keepPackage: true, lazy: false });
const doc = createDoc(source);
const editor = new Editor(doc);
const slideId = doc.slideOrder[0];
const elementId = doc.slides[slideId].children[0];
const objects = querySelectionPane(doc, slideId); // 最上层对象在前的稳定元素树

const change = editor.exec({ type: 'SetXfrm', id: elementId, x: 120 });
editor.exec({ type: 'SetFlip', id: elementId, h: true });
editor.exec({ type: 'SetName', id: elementId, name: '标题' });
editor.exec({ type: 'SetLocked', id: elementId, locked: true });        // 仅会话状态
editor.exec({ type: 'SetElementHidden', id: elementId, hidden: true }); // 仅会话状态
editor.exec({ type: 'AlignElements', ids: [elementId], edge: 'center' });
editor.exec({
  type: 'AddShape', slideId, preset: 'roundRect',
  rect: { x: 360, y: 180, w: 280, h: 160 },
});
const newShapeId = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
const imageBytes = new Uint8Array(await imageFile.arrayBuffer());
editor.exec({
  type: 'AddImage', slideId, bytes: imageBytes, mime: 'image/png',
  rect: { x: 420, y: 180, w: 320, h: 220 },
});
editor.exec({
  type: 'AddTable', slideId, rows: 3, cols: 4,
  rect: { x: 180, y: 140, w: 920, h: 360 },
});
const layoutId = doc.layoutOrder[0];
const added = editor.exec({ type: 'AddSlide', layoutId, at: { after: slideId } });
const newSlideId = [...added.createdSlides][0];
editor.exec({ type: 'MoveSlide', id: newSlideId, at: { after: null } });
const duplicated = editor.exec({ type: 'DuplicateSlide', id: newSlideId });
const duplicateSlideId = [...duplicated.createdSlides][0];

const slide = editor.toSlide(slideId);
const svg = renderSlideToSvg(source, slide, { idPrefix: `${slideId}-` });
const dirty = renderElementToSvg(editor.effectiveElement(elementId), {
  idPrefix: `${slideId}-${elementId}-`,
});
// 把该元素自己的 dirty.markup 与 dirty.defs 两个 DOM 分区一起替换。
// change.dirtyElements 与 change.dirtySlides 给出精确失效范围。

editor.subscribe(({ dirtyElements, dirtySlides, movedSlides, removedSlides, removedSlideFallbacks }) => {
  updateView(dirtyElements, dirtySlides);
  if (movedSlides.size || removedSlides.size) updatePageNavigator(doc.slideOrder);
  for (const [removedId, fallbackId] of removedSlideFallbacks) replaceActivePage(removedId, fallbackId);
});
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
协同客户端必须传入跨客户端唯一且稳定的 `origin`；追加行身份会包含它，两个 structuredClone 出来的
文档并发追加时才不会占用同一条 patch 路径。

文档文字查找是无 DOM 的稳定身份查询：按页序、组内绘制序和表格行列序遍历，返回 UTF-16 范围；可以跨
相邻 run 命中，但绝不跨段落、动态字段或公式原子拼接。空查询和非纯 JSON 选项会明确拒绝。

```ts
import { findText } from '@web-ppt/edit-core';

const matches = findText(editor.doc, {
  query: '季度', scope: { kind: 'document' }, matchCase: false, wholeWord: true,
});
const current = matches[0];
editor.exec({
  type: 'ReplaceText', from: '季度', to: '年度', matchCase: false, wholeWord: true,
  scope: {
    kind: 'match',
    match: { slideId: current.slideId, id: current.id, range: current.range },
  },
});
editor.exec({
  type: 'ReplaceText', from: '草稿', to: '定稿',
  scope: { kind: 'slides', slideIds: selectedSlideIds },
});
```

全部替换只匹配执行开始时的一份快照，把所有目标 shape/cell 放进一个事务，并只生成一个撤销单元。
精确范围失效、只读文档、锁定目标或任一目标非法时，整条命令在模型写入前拒绝。恢复回放与最小 OOXML
保存因此继续消费普通 patch，不需要另一条专用链路。

崩溃恢复使用独立的纯 JSON 日志订阅。它记录真正生效的 patch，覆盖撤销、重做、非历史写入、选区、
保存点、图片资源与全部身份水位；没有订阅者时，普通提交不会为恢复数据做深拷贝。持久化层应按序号
追加帧，并把首帧的 `identity.prefix` 与源文件 key 一起保存；重开同一源文件时用同一前缀建模：

```ts
import { createDoc, Editor, type RecoveryFrame } from '@web-ppt/edit-core';

const frames: RecoveryFrame[] = [];
const stop = editor.subscribeRecovery((frame) => frames.push(frame));

// 重新打开并解析同一源文件后：
const recoveredDoc = createDoc(reopenedSource, { idPrefix: frames[0].identity.prefix });
const recovered = new Editor(recoveredDoc, {
  recoveryFrames: JSON.parse(JSON.stringify(frames)),
});
```

回放会在副本上校验版本、顺序、源前缀、每组 patch、选区和最终完整模型，全部通过后才交换到目标文档；
坏尾帧不会留下半恢复状态。恢复会保留当前内容与脏保存点，但有意不伪造旧撤销栈。直接调用
`restoreRecoveryFrames()` 时，也只能用于尚未暴露给视图的新解析文档。仅会话有效的图片 URL 会先变成
保留 patch token；回放要求资源 sidecar 与 token 一一对应，再按 OPC part 重绑，或恢复旧 `.ppt` 内嵌字节。
sidecar 缺失时直接拒绝，不能留下失效 URL。

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

`SetFill { id, fill }` 修改形状的矢量填充：显式无填充、纯色、线性/径向渐变和渲染器支持的
DrawingML 图案。`SetStroke { id, stroke }` 修改形状描边与图片边框，包括颜色、幻灯片像素线宽、
预设虚线、端帽、连接、复合线和线端。颜色会在命令入口规范成 core 解析器使用的 `rgb()` / `rgba()`，
角度、stop、透明度和线宽也会收敛到 OOXML 可往返精度；查询会显式补全实线、端帽、连接与无线端，
避免 UI 把 XML 缺省误解成未定义。传 `null` 会删除直接覆盖并恢复来源/主题值；`{ type: 'none' }`
是显式无填充或无描边，仍然属于直接格式。

```ts
import {
  queryElementFill, queryElementStroke, SHAPE_PATTERN_PRESETS,
} from '@web-ppt/edit-core';

const fill = queryElementFill(editor.doc, selectedIds);
// { value, mixed, direct } 可直接驱动 React/Vue/Svelte/Web Component 控件。
editor.exec({
  type: 'SetFill', id: elementId,
  fill: {
    type: 'gradient', angle: 45,
    stops: [{ pos: 0, color: '#38BDF8' }, { pos: 1, color: '#6366F1' }],
  },
});
editor.exec({
  type: 'SetStroke', id: elementId,
  stroke: { color: '#0F172A', width: 2, dash: [8, 6], cap: 'round', join: 'round' },
});
editor.exec({ type: 'SetFill', id: elementId, fill: null }); // 恢复继承填充
const stroke = queryElementStroke(editor.doc, selectedIds);
```

图片填充编辑、效果、文字颜色和单元格边框是独立能力，不会被塞进这两条命令。

页面属性也只使用稳定页身份。`SetBackground { id, fill }` 接受同一套矢量填充，
`SetHidden { id, v }` 修改页面目录中的隐藏标记；两者传 `null` 都表示恢复解析来源。
`querySlideBackground` 与 `querySlideHidden` 接受多个 `SlideId`，返回有效值/来源、mixed/sourceMixed
和直接覆盖状态。背景变化只请求目标页整页重绘，隐藏元数据不会重建视觉未变化的 SVG。

```ts
import { querySlideBackground, querySlideHidden } from '@web-ppt/edit-core';

const background = querySlideBackground(editor.doc, selectedSlideIds);
editor.exec({ type: 'SetBackground', id: slideId, fill: { type: 'solid', color: '#0F172A' } });
editor.exec({
  type: 'SetBackgroundImage', id: slideId, bytes: imageBytes, mime: 'image/png',
  crop: { l: 0.1, t: 0.05, r: 0.1, b: 0.05 }, alpha: 0.85,
});
editor.exec({ type: 'SetBackgroundCrop', id: slideId, crop: null }); // 清除裁剪，保留图片
editor.exec({ type: 'SetHidden', id: slideId, v: true });
const hidden = querySlideHidden(editor.doc, selectedSlideIds);
```

图片背景按内容寻址：多页上传相同字节只保存一份媒体；来源页或版式继承的图片背景也可直接裁剪，
不会修改共享版式或母版。

超链接使用稳定领域目标，不向 UI 泄漏页码或 OOXML action。`SetLink` 编辑形状/图片链接；文字区间通过
`SetRunProps` 的同名 `link` 字段编辑。`{ kind: 'none' }` 表示显式移除，`null` 表示恢复解析来源。
`queryElementLink` 与 `queryRunLink` 返回有效值、来源、直接覆盖、混合及可跟随状态，React、Vue、Svelte、
Web Component 和原生工具栏都无需读取 `src` / `ovr`。

```ts
import { queryElementLink, queryRunLink } from '@web-ppt/edit-core';

editor.exec({
  type: 'SetLink', id: elementId,
  target: { kind: 'slide', slideId: doc.slideOrder[2] },
});
const elementLink = queryElementLink(doc, [elementId]);
editor.exec({
  type: 'SetRunProps', id: elementId, range,
  props: { link: { kind: 'external', href: 'https://example.com/docs' } },
});
const runLink = queryRunLink(doc, elementId, range);
```

外链只接受规范化的 `http`、`https`、`mailto`；内链在页面重排、撤销重做、保存重开及同/跨文档复制中
始终持有 `SlideId`。相对动作和不支持的来源仍可查询并只读保留。

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

`SetParaProps` 会设置选区触及的全部段落，空段也包含在内；折叠选区立即作用于当前段。P0 属性包括
对齐、有效行高倍数、段前/段后间距（幻灯片 px）、左边距（幻灯片 px）和可为负的首行缩进（幻灯片 px）。
属性传 `null` 只删除对应的直接 `pPr` 字段并恢复级别样式继承；原本没有直设字段时是严格 no-op。
`queryParaProps` 为每个属性独立返回 `{ value, mixed }`。

```ts
import { queryParaProps } from '@web-ppt/edit-core';

editor.exec({
  type: 'SetParaProps', id: elementId, range,
  props: { align: 'center', lineHeight: 1.5, spaceAfter: 8, indent: -12 },
});
const paragraphState = queryParaProps(editor.doc, elementId, range);
// paragraphState.align 为 { value: 'center', mixed: false }
```

`EditText` 还支持 `replaceFragment`，供剪贴板适配层提交纯 JSON 富文本片段。片段只包含段落字符串和连续的半开
格式区间，区间只能携带六个 P0 字符属性；DOM、CSS 和 OOXML 来源身份都不能越过此边界。未声明属性继承被替换
范围起点的格式，块生成段落，字符串里的 `\n` 保持段内硬换行。复制/剪切可用 `textFragmentFromRange()` 生成
反向传输结构，而不会泄漏保存溯源元数据。

```ts
import { textFragmentFromRange } from '@web-ppt/edit-core';

const fragment = textFragmentFromRange(editor.effectiveElement(elementId).text!, range);
editor.exec({
  type: 'EditText', id: elementId,
  ops: [{ type: 'replaceFragment', ...range, fragment }],
});
```

`copyElements(doc, ids)` 返回版本化、纯 JSON 的 `ElementClipboardPayload`。通过
`Editor.exec({ type: 'PasteElements', payload, at: { parentId, x, y } })` 粘贴时，会分配新的会话身份与
OOXML spid，以幻灯片视觉坐标保持嵌套组布局，并作为一个原子历史单元提交。图片以 base64 + SHA-256
携带并在目标包去重，超链接重建关系；SmartArt 等复杂对象只复用经过闭包哈希验证的同包 OPC part，
跨文档无法无损迁移时会在分配身份前明确拒绝，不会静默变成截图。

`InsertRow` 当前有意只提供表格尾部追加语义，供末格 Tab 和“在末尾添加行”按钮共用；它没有一个对
纵向合并表格并不安全的 `at` 参数。新行保留原末行高度、直接格式、输入格式和横向合并拓扑，清空内容，
并重新计算 `bandRow` / `lastRow` 与 frame 高度。命令只生成稳定行身份的稀疏 patch，不把整张表复制进历史。

```ts
editor.exec({ type: 'InsertRow', id: tableElementId });
```

`AddShape { slideId, preset, rect }` 会在现有可写页面顶层插入 DrawingML 预设形状。命令校验预设名与
矩形，分配无冲突的模型/OOXML 身份，自动选中新形状，并以一个树 patch 进入历史；新增后立即复用已有
变换和双击文字编辑路径。React、Vue、Svelte、Web Component 或原生工具栏都调用同一条 JSON 命令，
headless 包不依赖任何框架运行时。

`AddImage { slideId, bytes, mime, rect, placeholderId? }` 按魔数字节识别完整 PNG、JPEG、GIF、WebP
容器，复制调用者拥有的字节，并立即投影为可渲染 `ImageElement`。SHA-256 会复用源包或本会话中相同内容的
媒体 part，但每张图片仍分配无冲突的独立关系和 `p:pic` 身份。传入空图片 `placeholderId` 时会原子替换
占位符；元素、关系、媒体、Content Types、选区、撤销重做与最小保存由同一个树 patch 组拥有。模型用一枚
哈希 token 代替在 `src` 中再次复制 Base64。SVG 在外部引用与脚本清洗形成独立安全契约前不会伪装成支持。

`AddTable { slideId, rows, cols, rect, placeholderId? }` 会插入 1–75 行、1–75 列的原生 DrawingML 表格。
列宽与行高用整数 EMU 均分，总和精确等于 frame。即时模型先按源文档默认表样式与当前主题求值，保存的
`a:tbl` 引用同一 styleId，因此首行/条纹不会在重开后跳色。所有空格创建后立刻可输入，并已携带末格
`Tab` 所需的追加行模板；空内容占位符可原子替换，保存只改拥有该表格的 slide part。

`doc.layoutOrder` 与 `doc.layouts` 只在编辑模式公开源文件的真实版式目录。
`AddSlide { layoutId, at: { after } }` 按选定版式创建一页，不复制其它幻灯片；返回的
`createdSlides` 集合就是 React、Vue、Svelte、Web Component 或原生页面导航的稳定交接面，订阅事件也会
收到同一集合。空标题/正文占位符继承版式几何与文字样式，但不复制提示文字；日期、页脚和页码仍保存为
OOXML 字段。撤销/重做恢复同一份模型与 OPC 身份；保存只追加必要的包引用，不重建未触碰 part。

`MoveSlide { id, at: { after } }` 用稳定页身份重排已有页或会话中新页，`null` 表示置首。订阅事件只报告
`movedSlides`，不会伪装成删除再新增，因此 React、Vue、Svelte、Web Component 与原生缩略图导航只需读取
最终 `doc.slideOrder`，已挂载画布仍停留在自己的 `SlideId`。撤销重做、页码字段、相对跳页、section 归属、
备注和最小 OOXML 保存共用同一顺序语义。

`RemoveSlide { id }` 删除已有页或会话新增页，并拒绝删除唯一剩余页。事务返回值与订阅事件同时公开
`removedSlides` 和 `removedSlideFallbacks`：每个被删页映射到最近的存活后继，删除末页时映射到前驱。
React、Vue、Svelte、Web Component 与原生导航都可直接切换活动路由，不必从瞬时下标推导。撤销重做恢复
同一页面、元素和 OPC 身份；保存清理页面索引、slide part 与独占 notes，媒体和未知关系目标不做级联删除。

`DuplicateSlide { id }` 快照页面提交瞬间的有效元素树，并把独立副本紧邻插在来源后。框架适配层只需读取
返回的 `createdSlides` 身份；其它落点继续提交独立 `MoveSlide`。页面/元素 id、slide/notes part、
presentation 身份和 notes 回指都相互独立，版式、媒体、图表、评论与未知目标则继续共享原包资源；任一页后续
编辑或删除都不会改变另一页。

`querySlideNotes(doc, ids)` 返回纯文本备注的 `value/source/mixed/sourceMixed/direct`，工具栏无需读取
`src/ovr`。`SetNotes { id, text }` 把换行保存为 DrawingML 段落，空字符串表示显式清空；事务只发布
`notesSlides`，不会使画布投影变脏。无 notes 的旧页和会话新页在首次编辑时才创建 OPC 闭包；共享 notes
会先分配独立 part，正文之外的占位符、格式、notesMaster、外链和未知扩展继续逐字保留。

HTML 结果与预览共用渲染器，并带 `data-p` / `data-r`、项目符号、空 run 和 autofit 标记，
可直接作为 contenteditable 覆盖层的内容。core 仍不访问 DOM；焦点与 IME 生命周期由编辑器适配层负责。
`layoutText` 与原生 SVG 共用断行，并返回段落/run 身份和 UTF-16 光标停靠点；竖排用返回的
`transform` 映射逻辑坐标。只需要行盒时可传 `{ includeCarets: false }` 跳过逐字测量。

常规调用只需 `Editor.save()`：它把当前变换、层级、文字、字符格式与段落格式、表格追加行、新形状/页面、页面复制/删除、演讲者备注、占位符清空和元素删除写回 OOXML，
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
字节序和 BOM 均保留；实测 Vite 产物（含各入口静态共享 chunk）：编辑入口 62.33KB gzip，`xml` 为
8.07KB，`opc` 为 4.38KB；主入口加载后首次保存再按需增加 8.30KB。净条目的本地头、extra field 与压缩流逐字直通；zip64、数据描述符、
存档注释、加密条目等会返回明确原因并确定性重压。全部入口都不依赖 DOM。

若 `.pptx` 没有用编辑元数据与原包模式解析，`doc.meta.readonly` 会明确为 `true`，避免产生无法保存的修改。
旧 `.ppt` 走后续的生成式 `.pptx` 保存路径，不支持写回二进制 `.ppt`。
协同排序时把新元素的稳定 ULID 作为第三个参数传给
`fractionalIndexBetween(lower, upper, ulid)`；单机模式可省略。

MIT
