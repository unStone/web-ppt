---
title: 实现保留型 XML 树
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./005-prove-m0-equivalence.md
  - ./011-render-element-api.md
  - ./012-render-text-html-api.md
  - ./013-layout-text-api.md
---

## Question

如何在 `edit-core` 中解析、定点修改并序列化 OOXML，同时保留声明、注释、处理指令、前缀、属性顺序、自闭合形态与 `AlternateContent`，并统一执行 schema 子元素顺序？

## Resolution

在 `@web-ppt/edit-core/xml` 增加无 DOM、无框架的按需入口；默认编辑模型入口继续保持
2.92KB gzip，保存期 XML 入口为 7.14KB gzip。解析器同时接受 `string` / `Uint8Array`，覆盖
XML 声明、DOCTYPE、注释、PI、CDATA、实体、命名空间、`AlternateContent`、混合引号、属性词法、
自闭合和 UTF-8 / UTF-16LE / UTF-16BE；未修改的字节输入直接返回原字节副本，字符串输入按声明
推断 UTF 编码，非 UTF 声明明确拒绝，避免声明与输出字节不一致。

修改面只公开定点属性增删、namespace URI 查询、节点创建/移除和安全插入。已有属性保留位置、空白、
引号与实体词法；新增文本和属性统一转义；自闭合节点按需展开，删除节点会收掉独占缩进。同值 setter
不标脏，`xmlns` 增删改会递归重绑后代展开名；QName 在解析、元素创建和属性创建三条入口统一校验，
`namespaceUri` 不能脱离真实 `xmlns` 文本做内存覆盖。

OOXML sequence 表以 `{namespace URI}localName` 注册，覆盖 `spPr`、`ln`、`rPr`、`pPr`、`txBody`、
`sp`、`cSld`、`sld`，所以任意前缀可用且不会误伤同名自定义 XML。公共 `insertXmlChild` 在已知容器
内强制转入有序插入；`mc:AlternateContent` 会比较所有 Choice/Fallback 分支的实际序位，分支横跨
插入点或无法判断时拒绝猜测，避免生成需要 PowerPoint 修复的 part。

性质与变异验证：16 份可读 `.pptx` 的 314 个 XML/rels/VML part 未修改逐字节回环；真实 slide 的
`a:xfrm/a:off@x` 变异证明 diff 只含旧值与新值；固定种子 5000 次属性增删改均可确定重序列化并重解析；
损坏 XML、非法 QName、未知 schema 子节点、歧义兼容分支均明确拒绝。曾临时调换 `txBody` 顺序表，
契约测试按预期失败，恢复后通过，证明顺序门禁不是空断言。

最终 `npm run check`、`npm test`、`npm run build` 全绿：1987 项 core、89 项 edit-core、130 项图元文件
断言，162 个快照与 194 对独立进程 SVG 指纹一致。210 页基准中 437/437 个 XML part 保留回环为
387.7ms（预算 500ms），编辑内存 +5.4%，只读路径零编辑状态；发布物主入口/XML 入口隔离导入和
`npm pack --dry-run` 均通过。
