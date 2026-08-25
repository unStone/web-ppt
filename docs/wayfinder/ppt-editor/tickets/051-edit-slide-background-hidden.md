---
title: 编辑页面矢量背景与隐藏状态
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./006-preserving-xml-tree.md
  - ./008-command-patch-history.md
  - ./014-editor-session-static-view.md
  - ./041-add-slide-from-layout.md
  - ./044-move-slide.md
  - ./047-shape-fill-stroke.md
---

## Question

如何让任意 UI 框架通过稳定 `SlideId` 和公开纯数据 seam 编辑一个或多个页面的矢量背景与隐藏状态，
同时让有效预览、撤销重做、页面重排/复制、增量多视图和保留型 `.pptx` 保存保持同一语义？

公开命令固定为 `SetBackground { id, fill }` 与 `SetHidden { id, v }`。背景只接受
`VectorFill | null`：`null` 恢复来源，`{ type: "none" }` 是显式无填充；图片背景另票处理资源上传、裁剪与
关系生命周期，不能伪装成 data URL 塞进本票。隐藏值接受 `boolean | null`：`null` 恢复来源，`true` 隐藏，
`false` 显式可见。`querySlideBackground` 与 `querySlideHidden` 必须支持稳定 `SlideId[]`，返回
effective/source/mixed/direct，工具栏不得读取 `src/ovr`；空选区、已删除页、类型错误和非有限颜色参数必须有
明确结果或原子拒绝。批量修改通过既有事务提交，一个用户动作只能产生一个撤销项。

投影继续复用同一 `Slide` → SVG 高保真链路，不引入第二套页面渲染。背景变化只使对应页变脏；所有挂载该页的
view 都更新，未命中的页面 DOM 身份保持不变。隐藏是页面目录元数据：编辑器仍可显式打开和编辑隐藏页，查看器
默认播放策略保持现状，不得因为属性面板提交而删除页面或跳走。新增、复制、移动和删除页面后，命令与查询始终
按稳定身份工作；撤销重做恢复命令前的页面属性和各 view 的本地当前页。

保存时直接背景写入 `p:cSld/p:bg/p:bgPr`，以 DrawingML 的 `noFill`、`solidFill`、`gradFill`、`pattFill`
表达；不能把主题继承背景先摊平成直接格式。隐藏页写 `p:sld@show="0"`，显式可见移除该属性，恢复来源则由
基线重建还原原 XML。缺少 `p:bg` 时按 schema 次序插入；替换来源 `p:bgRef` 时只控制背景 choice，未知属性、
扩展节点、transition、timing、相邻关系与未触碰 part 保持。新建/复制页也要写出各自有效的直接状态，连续保存
不能漂移。保存重开后再次投影必须与保存前 effective 状态一致。

确定性固件覆盖：主题/版式继承背景、直接纯色/透明色/渐变/图案/无填充、来源隐藏页、显式可见、未知扩展、
新增页和复制页。Node 从发布入口验证命令、混合态查询、事务/历史、稳定身份、最小 XML 写回与连续保存；独立
进程比较 HTML/原生 SVG；真实 Chrome 验证多 view 只更新目标页，200 页批量属性提交 p95 不超过 16ms，单页
完整上屏 p95 不超过 16ms。LibreOffice 必须无修复打开，并以像素/页序和重存 XML oracle 验证背景与隐藏状态；
产物加入既有 PowerPoint 清单等待真机取证。本票不实现图片背景、母版/版式背景编辑、隐藏页播放策略设置、
页面尺寸/方向、备注或 section UI。

## Resolution

- 公开 `SetBackground` / `SetHidden` 与 `querySlideBackground` / `querySlideHidden` 纯数据 seam；命令始终按
  `SlideId` 定位，`null` 恢复来源，显式 `none` / `false` 保留直接语义，批量事务只产生一个历史项。背景变化只把
  目标页加入 `renderSlides`，隐藏状态仅更新目录元数据；多 view 未命中页的 DOM 身份不变，编辑器仍可打开隐藏页。
- 保存层以导入基线重建 `p:bg` / `p:bgPr` 与 `p:sld@show`，支持无填充、纯色、渐变和图案，保持主题继承、
  XML 顺序、未知扩展和连续保存幂等；新增页、复制页与来源恢复共用同一写回路径。保存重开后的 8 页 HTML / 原生
  SVG 指纹均与保存前有效投影一致。
- 新固件连续两次全量生成的 SHA-256 均为
  `ebcf4735cbf99ad74a4233986c92d319e0fabf7e9834ca016b9b44a6451e63cb`。精确执行
  `npm run check && npm test && npm run build`：core 2125、edit-core 670、保存 261、PowerPoint 报告契约 9、
  editor 286、58 份固件 / 178 页 / 356 对独立 SVG 指纹、metafile 130 全绿，五个发布包构建成功。
- 真实 Chrome 中 200 页批量属性提交 / 单页完整上屏 p95 为 `10.1ms / 6.7ms`，均低于 16ms；LibreOffice
  28/28 份保存产物无修复打开并导出 PDF，本产物的图案背景像素通过且 2 张隐藏页未进入 6 页 PDF；重存后
  8 页顺序、隐藏位、渐变/主题/新增页背景 XML 均通过 oracle。Windows
  PowerPoint 真机证据已加入 28 份统一清单，但当前 macOS 无可用 PowerPoint，继续由
  [010](010-prove-m1-save.md) 作为外部阻塞跟踪，不能冒充已验收。
