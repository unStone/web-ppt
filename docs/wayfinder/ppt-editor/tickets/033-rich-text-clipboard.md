---
title: 实现文字剪贴板与富文本粘贴闭环
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./032-paragraph-formatting.md
---

## Question

如何沿用已经稳定的扁平 mark、DOM Range 和字符格式命令 seam，让用户在文字编辑面中复制、剪切、默认带格式粘贴，
并用 Ctrl/Cmd+Shift+V 可靠地粘贴纯文本，同时保持命令纯数据、一次撤销、IME 生命周期、预览和保存重开一致？

headless seam 扩展 `EditText` 的纯 JSON 操作：`replaceFragment { from, to, fragment }`。片段只含段落文本与半开格式区间，
格式白名单复用 P0 字符属性 `font/size/b/i/u/strike`，不得携带 DOM、CSS、来源 run 身份或可执行内容。HTML 只在
`@web-ppt/editor` 边界经脱离文档的树解析；只接纳语义标签与内联样式白名单，脚本、样式表、隐藏元数据、链接目标和
图片源全部丢弃，未知节点只取文本。`text/plain` 是内容真相；HTML 文本与它不一致时必须退化为纯文本，不能猜测索引。

段落块映射为 PPT 段落，`br` 映射为段内硬换行；插入片段未声明的属性继承目标光标格式，显式格式形成新 mark，跨段
替换合并首尾且新段继承插入段 `pPr`。公式只能在原子边界外替换。复制输出标准 `text/plain` 与清洗后的 `text/html`；
剪切先写剪贴板再用同一模型事务删除选区。所有操作都必须原子校验、可 structuredClone、一次撤销，无变化不制造历史。

DOM seam 从真实 `ClipboardEvent.clipboardData` 读取，兼容浏览器在 `beforeinput.dataTransfer` 提供数据的分支；拦截后立即
重渲并恢复光标。Ctrl/Cmd+Shift+V 只读 `text/plain`。活动 IME、view 模式、其它视图和普通表单必须让位；只含图片等
尚未支持的载荷也要阻止浏览器私改编辑 DOM。图片转 `AddImage` 明确依赖 M4，不在本票偷偷建立第二条元素插入旁路。

测试只观察三条已约定 seam：发布的 headless 命令及有效投影、发布挂载入口的真实 copy/cut/paste 与 Range、保存后由 core
重开。覆盖嵌套标签、Word 风格内联 CSS、跨段与 br、CRLF、空段、纯文本快捷键、恶意 HTML、格式不一致回退、公式边界、
剪切撤销与多视图；真实 Chrome 验证可信系统剪贴板和 2,000 字符富文本粘贴完整上屏 p95 ≤ 30ms。保存只改目标文本，
两条预览文本路径正常展示，LibreOffice 打开不得修复。

本票不实现图片粘贴、颜色/高亮/超链接、列表结构转换、表格单元格、Safari engine 行盒、autofit 节流、产品工具栏 UI 或
框架适配包；后续能力只能消费本票的纯片段与公开生命周期，不重新解析未清洗 HTML。

## Resolution

- `@web-ppt/edit-core` 新增纯 JSON `replaceFragment` 与 `textFragmentFromRange`，用连续半开 mark 统一跨 run、
  跨段、空段、段内硬换行和光标格式继承；所有输入先原子校验，公式只允许在原子边界替换，严格 no-op 不制造历史。
- `@web-ppt/editor` 以脱离文档的 HTML 树和六属性白名单接通 copy/cut/paste、`beforeinput.dataTransfer` 与
  Ctrl/Cmd+Shift+V。`text/plain` 始终是内容真相；未知标签只取文本，脚本、隐藏节点、图片与 HTML 不一致载荷
  均不能进入模型，空段可经清洗 HTML 原样往返，多视图、view 模式和 IME 继续隔离。
- 保存重建路径保留按来源 run 间隙锚定的未知 XML 节点，`a:br` 独立格式可解析并写回；保存重开后的段落、六类
  格式及 HTML/SVG 两条独立进程指纹均与有效投影一致。LibreOffice 无修复打开并导出 52,408-byte PDF。
- 新增专用确定性固件 `sample-editor-rich-clipboard.pptx`；连续两次生成的全固件聚合 SHA-256 均为
  `d3c35681462f613bc673dbea61870f2ddb9ee62cb28a0562c711db1af833aab1`。Spec/Standards 两轮复核最终均为 clean。
- `npm run check && npm test && npm run build` 全绿：1987 core 与 162 快照、403 edit-core、32 保存、
  182 editor、39 份固件 134 页 268 对双文本路径指纹、130 metafile，五个发布包全部构建成功。真实 Chrome
  2,000 字符富文本粘贴完整上屏 p95 5.6ms（预算 30ms），可信系统粘贴/纯文本粘贴/复制/剪切全部通过。
- 实测 gzip 为 edit-core 编辑入口 44.78KB、editor 27.33KB；`core`、`edit-core`、`editor` 三个 npm tarball
  dry-run 均通过。图片粘贴仍明确留给 M4 `AddImage`，没有建立第二条元素插入旁路。
