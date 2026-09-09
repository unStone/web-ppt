# 经典图表多级类别

`@web-ppt/edit-core/chart` 保留 `multiLvlStrRef` 的原生层级，类别身份不依赖标签文字。
缓存、公式范围和内嵌工作簿在同一次保存中更新；官网选择图表后，数据面板按根到叶显示各级。

| 输入/操作 | 支持与边界 |
|---|---|
| 层级矩阵 | 两级、三级及最多 64 级；类别沿行或列排列，矩形 A1 引用可明确映射到单一工作表 |
| 标签 | 重复文字保留独立类别身份；显式空字符串、缺失槽和文本零不合并；已有工作簿数值零保持数值类型 |
| 修改 | 单级改名、完整路径、叶级名称、类别/系列增删；删除组首会将仍在使用的父组提升到后继类别 |
| 历史与协同 | 按层级字段合并；清空组首记住当时继承的前驱，撤销恢复原覆盖；未到齐的新增路径等待余下字段 |
| 保存 | 补丁保存、源包释放后的生成保存、冷恢复和保存重开；删空系列后仍可重建 |
| 方形范围 | 类别数等于层数时，保留已知方向；无工作簿、新系列使用 literal 数值及全部类别/系列删空后重建均可往返 |
| 只读 | 共享工作簿、外部/命名/歧义公式、类别来源不一致、缓存与工作簿不符、缺失资源、未知单元格占用及超限输入 |
| 规模 | 最多 20,000 个类别、100,000 个层级槽；系列数据仍受既有矩阵上限约束，新增越界原子拒绝 |
| 当前画布 | 显示叶级类别；空类别保持空白。父级分组轴尚未绘制，但编辑面板与保存文件保留完整层级 |
| 跨文稿复制 | 目标须已有相同的有效 OPC 资源闭包；未保存的数据与样式计入匹配，旧资源原子拒绝；粘贴框架立即可查询、渲染和编辑 |

`ChartCategory.levels` 从根到叶记录**原生槽位**，并非展开后的完整标签路径。父级 `null` 延续前组；
更高层级开始新组时，下级不继承旧父组的标签。叶级 `null` 表示缺失标签，`""` 表示显式空字符串。
`label` 是叶级名称，既有平面图表 API 保持兼容。

```ts
import { createChartDataEditor, queryChartData } from '@web-ppt/edit-core/chart';

const api = createChartDataEditor(editor);
const data = queryChartData(editor.doc, chartId);
const categoryId = data.categories[0].id;

api.setCategoryLevel(chartId, categoryId, 0, '华东');
api.setCategoryPath(chartId, categoryId, ['华东', '杭州']);
api.setCategoryLabel(chartId, categoryId, '宁波'); // 多级图表只改叶级。
api.addCategory(chartId, [null, '温州']);
api.addCategory(chartId, '新类别'); // 延续最后一个可见父组。
const bytes = await editor.save();
```

`series[].bindings.categories.hierarchy` 提供只读的 `levels` 与 `orientation`：`rows` 表示类别沿行递增，
`columns` 表示类别沿列递增。它表达来源映射，不接受用户注入或修改工作簿公式。
数值 literal 和单格模板没有方向线索，保存时会在编辑元数据中保留已知类别方向。
读取优先使用明确的原生公式；既没有明确公式也没有有效方向记录的方形范围仍只读。
Editor、React、Vue 的既有 `chart` 子路径继续薄转发这些 API。

官网“空槽”开关区分 `null` 与空字符串。勾选表示延续前组或无叶标签；取消勾选后留空表示空字符串。
类型与样式面板共用数据绑定的只读判断。删除所有系列会清空其工作簿范围，类别保存在重建模板中；
模板不会因此获得未知单元格的写入权。

| 证据 | 入口/产物 |
|---|---|
| 源码及发布入口 | `npm run test:chart-hierarchy` / `npm run test:chart-hierarchy:dist`；已加入 `test` / `verify` |
| 确定性样本 | `tooling/make-chart-hierarchy-fixture.mjs`；三页覆盖两级、三级与横向矩阵，加入 `fixtures` |
| 渲染一致性 | 独立进程比较未编辑生成、已编辑补丁/生成的两条文字路径，12 对 SVG 逐字节一致 |
| 官网 | `node tooling/test-site-editor-browser.mjs --chart-hierarchy-only`；中英文、空槽、撤销/重做、保存重开，加入完整浏览器门禁 |
| 独立读取器 | `npm run test:chart-hierarchy:libreoffice`；`out/chart-hierarchy/libreoffice.json` |
| 方形缓存重建 | `npm run test:chart-shared` / `npm run test:chart-shared:dist`；单框架与共享框架、横向/纵向、二级/三级、异常方向提示及普通入口独立进程校验 |
| 视觉对照 | `npm run compare fixtures/sample-chart-hierarchy.pptx`；父级轴、字体和图表布局差异不作为编辑语义丢失的证据 |
| 成本 | `node tooling/measure-chart-hierarchy.mjs`；`out/chart-hierarchy/measure.json`，采样内存不冒充浏览器峰值 |

2026-09-08，本机 Node 24.3.0、三页样本、连续 25 次改名并保存的实测：

| 指标 | 结果 |
|---|---|
| 图表按需入口 | 81,526B 原始 / 24,927B gzip，排除既有 peer 与 fflate；原 25,000B gzip 预算不变 |
| 冷导入 / 首次查询 | 10.2ms / 14.0ms，冷导入含尚未加载的依赖 |
| 编辑并保存 | 中位 13.4ms，p95 31.4ms |
| 采样内存增量 | heap 93,510,656B / RSS 232,996,864B；未强制 GC，包含尚未回收的临时分配，不表示保留量或浏览器峰值 |

LibreOffice 26.2.5.2 重存保留两级/三级结构、非空父标签、重复叶标签和修改后的数值，补丁与生成结果一致；
它会省略显式空字符串，因此该读取器不能证明空字符串与缺失槽的区别。原生 XML/工作簿契约单独验证这一点。
Windows PowerPoint 真机验收继续暂缓。

原生缓存依据 [Microsoft MultiLevelStringCache](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.multilevelstringcache?view=openxml-2.20.0)；
层级从叶到根的存储顺序及稀疏分组可参考 [python-pptx 类别结构分析](https://python-pptx.readthedocs.io/en/latest/dev/analysis/cht-categories.html)。
