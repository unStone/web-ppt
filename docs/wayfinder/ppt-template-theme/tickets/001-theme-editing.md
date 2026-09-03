---
title: 编辑主题并传播到依赖页面
status: closed
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

现有解析器把主题、母版与版式求值后展平进 `Slide` / `SlideLayoutTemplate`，`EditDoc` 没有主题身份或覆盖；直接改
`ppt/theme/themeN.xml` 虽能保存，却不能让当前投影同步变化，也无法知道应失效哪些页面。如何用一条小接口交付
`SetTheme{ id, clrScheme?, fontScheme? }`，同时保持 Source Value / Override、继承优先级与多主题文稿的局部传播？

主题目录必须保留 OPC part 身份、名称、12 个标准颜色槽和 major/minor 字体集合；字体集合覆盖 latin / ea / cs
及已有脚本映射，未触碰的未知节点和属性逐字节语义保留。命令只接受纯数据和当前目录中的 theme id，字段级
`null` 恢复来源，显式颜色统一写成无变换的 sRGB；查询必须区分有效值、来源值、mixed 与 direct。

内部建立 `Theme → Master → Layout → Slide` 反向依赖索引，并把“以一组内存 part 覆盖重解析页面”收进一个深模块：
主题提交只让依赖页面整页失效，其他主题下的页面与 DOM 身份不动；页面/元素直接覆盖在新继承值上重新应用。
`SetLayout`、`AddSlide`、`RemoveSlide`、恢复和协同 replay 后索引仍准确，不能靠每次命令扫描所有 XML part 修正。

保存只改目标 theme part；撤销至来源后应恢复原始 part 直通。生成保存和 `.ppt → .pptx` 必须物化有效主题，
恢复日志与字段级 LWW 对不同颜色/字体槽独立收敛。新增确定性多主题固件，至少同时出现主题色填充、`phClr +
fillRef/lnRef`、主题字体、页面直设与两个母版分支，并用独立进程指纹、LibreOffice 像素/字体 oracle、真实 Chrome
跨页身份和性能契约证明即时投影等于保存重开结果。

公开类型、editor 会话 seam、React/Vue adapter 与中英文包文档必须可发现；未开启 `edit` 的 core 解析结果和
core/edit-core/editor 默认入口体积不吸收模板目录或重复主题 XML。最终四段仓库门禁全绿。

## Outcome

- `core` 在编辑模式下保留 OOXML 与二进制 PPT 的主题身份、12 色槽和 major/minor 字体来源，普通解析路径不增加
  主题目录；`.ppt → .pptx` 生成保存会物化有效主题。
- `edit-core` 交付 `SetTheme`、来源/直接值查询、字段级恢复、主题 XML 最小写回与增量反向依赖索引；主题变化仅
  重算依赖页面，并保留页面与元素直接覆盖、撤销重做、恢复及字段级 LWW。
- 确定性多主题固件覆盖投影、保存重开、两条文本路径指纹、LibreOffice 与真实 Chrome 200 页局部传播；公开类型
  契约和各适配包入口同步完成。
