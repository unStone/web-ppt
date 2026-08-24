---
title: 实现文字字符格式编辑闭环
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./030-basic-text-editing.md
---

## Question

如何沿用基础文字编辑已经固定的三个公共 seam——发布的 `Editor.exec(SetRunProps)`、
`openEditor(...).mount(...)` 的真实 DOM 文本选区、`editor.save()` 后由 core 重开——让用户对文字选区设置
字体、字号、粗体、斜体、下划线与删除线，并让折叠光标选择的格式可靠地作用于后续输入，同时保证撤销重做、
多视图同步和 OOXML 继承语义不分叉？

`SetRunProps { id, range, props }` 必须是纯 JSON 原子命令；非空选区只改半开区间内的 marks，分裂、覆盖与同一来源
被切开的相邻同格式片段合并均保持规范化。公式原子不可拆分，公式内部字符格式不属于本票，单独整选时必须是严格
no-op 而不能制造伪历史。折叠选区不得制造零宽 OOXML run，而应成为编辑会话的待输入
格式；后续 `EditText` 消费它并生成对应 mark。`props` 只允许本票 P0 字段，显式 `null` 表示删除直接覆盖并恢复继承，
不能把解析后的继承值摊平写回。

DOM 侧拦截 `formatBold`、`formatItalic`、`formatUnderline` 和常用平台快捷键，保留并还原真实 Range；混合格式选区
按逐属性三态读取，切换命令只改变目标属性。命令入口必须能被未来无框架工具栏、React/Vue/Web Component 适配层
直接调用，不把格式状态藏在 DOM。只读模式、非文字对象、其它视图与 IME 组词期间不得误触格式命令。

确定性固件覆盖跨 run、跨段、公式、空文本框、继承字体与 RTL；保存只修改目标 `a:rPr` / `a:endParaRPr`，字体同时
写 `a:latin/a:ea/a:cs`，字号按百分之一磅换算，布尔/枚举按规范写回。保存重开逐字符与逐属性相等，未触碰 ZIP 条目
字节相同，两条文本渲染路径仍可展示，LibreOffice 打开不得修复。真实 Chrome 验证选区快捷键和后续输入，上屏 p95
继续不超过 `30ms`。

本票不实现颜色、高亮、字距、大小写、上下标、超链接、段落属性、富文本粘贴、格式工具栏 UI 与框架适配包；它们
后续只消费本票稳定的公开命令与查询结果，不另建格式状态旁路。

## Resolution

- `@web-ppt/edit-core` 新增纯 JSON `SetRunProps` 与三态 `queryRunProps`，覆盖字体、字号、粗体、斜体、下划线、删除线；选区按半开区间规范化，`null` 删除直接格式并恢复继承，公式原子保持不可拆分且单独格式化严格 no-op。
- `@web-ppt/editor` 把 DOM Range、快捷键、`beforeinput`、IME 和折叠光标待输入格式收敛到同一事务；公开 `registerTextUi`、`queryRunProps`、`setRunProps`，框架工具栏无需维护第二份格式状态，多视图与 view 模式继续隔离。
- 纯格式保存只补丁受影响的 `a:rPr` / `a:endParaRPr` 或替换被切分源 run 的原槽位；字段、公式、未知节点和相邻注释/处理指令保留。字体同步写入 latin/ea/cs，保存产物经 core 重开、HTML/SVG 独立指纹和 LibreOffice 导出 PDF（44,851 bytes）验证。
- 固件连续生成两次的 39 文件聚合 SHA-256 均为 `2970265c8c4f96aa82157a8e76cd20ac7bba77b27955a2a0bb795c8d07bb97d2`；最终门禁通过：core 1987 项与 162 快照、edit-core 383 项、保存 32 项、editor 165 项、38 份固件 133 页的 266 对 SVG 指纹、图元文件 130 项，五个发布包构建成功。
- 性能预算全部通过：可信文字输入 p95 0.700ms，文字 HTML 上屏 0.105ms，210 页编辑内存 +9.6%，50.6MB 文稿修改 3 页保存 114.6ms；实测 gzip 为 edit-core 主入口 41.55KB、保存增量 6.21KB、editor 24.65KB。两个发布包 `npm pack --dry-run` 均通过。
- Spec 与 Standards 双轴复核最终均为 clean；审查发现的最小写回、字体回退混合态、可信选区快捷键、中段 run 切分固件和活动文本解析重复均已在本票内收敛。
