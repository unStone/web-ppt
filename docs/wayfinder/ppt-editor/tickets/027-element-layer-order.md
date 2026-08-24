---
title: 实现元素层级调整与快捷键
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./026-element-delete.md
---

## Question

如何让聚焦的 edit 视图通过公开纯 JSON `SetZ` 命令和 `Ctrl/Cmd + [ / ]` 快捷键，把当前元素选区在
同一父级、同一可写 OOXML part 内置底、下移一层、上移一层或置顶，并把一次用户操作作为一个可撤销事务？
多选必须保持元素间相对次序；祖先与后代同时入选时只移动最外层根；组合内元素、普通形状以及只开放框架
编辑的图片、图表、SmartArt、OLE、墨迹与媒体都要适用，`editable: none`、锁定元素与跨父级混合选区必须
在落模前整体拒绝，不能产生部分成功。

层级是结构状态而不是视觉样式覆盖：来源绘制序保持不可变，只有实际移动的记录承担稀疏顺序覆盖；撤销回到
来源序后 dirty 必须归零。分数序键要避免每次操作重编号，边界操作不创建历史；同一事务的 patch 顺序、选区、
影响集和 undo/redo 结果必须确定。继承自母版/版式的只读元素不属于 slide `p:spTree`，不能作为可写兄弟移动；
命令只在同一来源 part 的直属可写兄弟集合中调整，同时保持只读投影的固定位置。

快捷键仅由收到事件的 edit 视图拥有：恰好一个 Ctrl/Meta 且没有 Alt 时，`]` 上移、`Shift+]` 置顶、`[` 下移、
`Shift+[` 置底。view 模式、普通或 Shadow DOM 表单与 contenteditable 保留浏览器所有权；活动 pointer 手势只
消费默认行为，不修改历史。没有元素选区或已经位于边界时仍消费已识别键，但不创建历史。嵌套挂载只由最内层
视图处理一次，事件视图回显结果页，其它共享视图保持原页。

编辑器必须移动既有 markup/defs 分区节点，而不是重建整页、重新生成 defs 或替换未触碰兄弟身份。保存时只
重排目标 `p:spTree` / `p:grpSp` 的既有元素宿主，保留非图形子节点、词法空白、关系、媒体和未触碰 zip 条目；
保存重开后的模型序、两条 SVG 渲染路径独立进程指纹都要与编辑态一致，LibreOffice 打开不得报告修复。确定性
固件要同时覆盖 slide、group、frame、超链接与只读继承元素；真实 Chrome 中 60 元素层级操作到完整 DOM
反馈 p95 不超过 `8ms`。

验收只经过发布的 `openEditor(...).mount(...)`、公开 headless 命令/历史/选区、保存重开与真实 Chrome 可信
键盘输入。本票不实现对齐/分布、组合/取消组合、选择窗格、剪贴板、跨父级移动、关系或媒体插入；但建立的
稀疏顺序、XML 重排和 DOM 移动边界必须能被后续粘贴复用。

## Resolution

- `@web-ppt/edit-core` 新增公开纯 JSON `SetZ` 与 `ElementRecord.order`：来源 `z` 永远不改，事务先在可写
  sibling 双向链表上 O(k) 求最终排列，再以 Fenwick O(N log N) 选择可复用来源序，只给真正跨序的记录写
  稀疏分数键。`editable:none`、locked 与不同 part 占据固定槽位；结构删除与潜在层级补丁冲突在落模前拒绝。
- 影响集拆成 `renderElements` / `reorderedElements`。编辑视图按模型移动既有 markup 分区，defs、超链接包装、
  未触碰兄弟及所有共享视图节点身份保持；置顶锚点取旧 DOM 实际末节点，组内与固定槽位重排不重建整页。
- 键盘按物理 `BracketLeft` / `BracketRight` 识别，兼容合成事件的 `[]/{}`；恰好一个 Ctrl/Meta、无 Alt
  时支持四向层级。多选保序为单历史，边界、空选区、其它页与活动手势不产生空事务，view、表单、
  contenteditable、开放/封闭 Shadow DOM 和外层嵌套视图保留所有权。
- 保存期按 part 一次遍历定位 OOXML 宿主，只重排目标 `p:spTree` / `p:grpSp` 的既有图形槽；未知节点、
  词法空白、关系、媒体与净 ZIP 条目原样保留。保存重开、HTML/SVG 两路径独立进程指纹与编辑态一致；
  LibreOffice 无修复打开并导出 `32475-byte` PDF。
- 确定性固件 `sample-editor-layer.pptx` 覆盖 60 个可写顶层、组合、frame、超链接、版式只读与跨页；
  连续生成 SHA-256 均为 `5fc2c0b626740c2a2a0503bb5d325df72909e02fe91eaeaddf32436cb3ed5d8a`。
- 全量验收通过：1987 项 core、293 项 edit-core、19 项 M1 保存、136 项 editor、162 个快照、36 份固件 /
  130 页 / 260 对独立进程 SVG 指纹及 130 项图元文件。真实 Chrome 层级/撤销/重做 60 元素 p95 为
  `1.3/0.3/0.2ms`，可信 `Ctrl+]` 与 `Ctrl+Shift+}` 通过；60/120/240/480/960 元素 headless 中位为
  `0.163/0.173/0.379/0.758/1.885ms`，1500 组纯层级与 500 组混合随机事务通过。
- 构建实测 edit-core 初始入口 `14.19KB gzip`、首次保存增量 `14.62KB`，editor `19.82KB`；npm dry-run
  确认层级命令、顺序 patch、XML 重排与键盘声明进入 tarball。Standards 与 Spec 双轴审查发现的 Shift
  物理键、DOM 置顶锚点、固定槽位、稀疏覆盖、JSON 路径、混合历史与扩展性问题均已回归，最终均 clean。
