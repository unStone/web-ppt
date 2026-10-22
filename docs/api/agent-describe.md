# Agent 结构化读出

`@web-ppt/edit-core/describe` 提供同步、只读的 `describePresentation(doc, options?)`。输入是当前 `EditDoc`，输出可直接序列化为 JSON；浏览器、Worker 与 Node 使用同一入口，无新增运行时依赖。

```ts
import { parse } from '@web-ppt/core';
import { createDoc, disposeDoc } from '@web-ppt/edit-core';
import { describePresentation } from '@web-ppt/edit-core/describe';

const presentation = await parse(bytes, { edit: true, keepPackage: true, lazy: false });
const doc = createDoc(presentation, { idPrefix: 'agent-' });
try {
  const result = describePresentation(doc, { maxChars: 24_000 });
  const json = JSON.stringify(result);
} finally {
  disposeDoc(doc);
  presentation.dispose?.();
}
```

| 输出 | 含义 |
|---|---|
| `version / source / width / height` | 输出协议版本、来源格式和当前页面尺寸（CSS px） |
| `totalSlides / totalElements` | 裁剪前总数；隐藏页计入；共享设计对象在每次页面出现时分别计入 |
| `slides[].id / number / hidden` | 编辑文档页 ID、从 1 开始的页码、隐藏状态 |
| `layout / master / section / notes` | 当前版式、母版、节的身份与名称、有效备注；不存在时引用为 null。只有名称而没有设计目录的旧格式版式，其 `id` 为空字符串 |
| `elements[].id / canvas / path` | 真实 `ElementId`、所属编辑画布、从根到自身的 ID 路径；每页按当前绘制序先序展开组合 |
| `kind / name / altText / editable / hidden / locked` | 有效类型、名称、替代标题/描述、编辑能力和继承祖先后的交互状态 |
| `bounds` | 页面坐标的轴对齐外框，含组合缩放、旋转与翻转；不扩张阴影、描边或三维效果 |
| `placeholder` | 类型、原始字符串序号，及按 idx 优先/等价类型匹配的版式与母版元素身份；来源链不等于每个属性都来自该层 |
| `paragraphs` | 段落文字、层级、显示项目符号和可用的自动编号来源；表格附从 0 开始的行列坐标；合并占位格不重复输出，普通组合不聚合后代文字 |
| `truncation` | 触发预算、完全省略页数、所有省略元素数，以及首个省略位置；完整输出的 reason/next 为 null |

返回的 ID 可以交给 `Editor.select`，后续命令仍遵循 `editable`、锁定和所属画布规则。版式切换后的静态设计图形返回其真实设计记录 ID 与 `canvas`；旧继承图形不进入结果。此接口只读取已有对象，未绑定的版式占位符通过现有版式查询获得。

图表、SmartArt 等框架对象只返回其宿主 ID，内部当前绘制文字聚合在该宿主的 `paragraphs`。这些对象内部的投影节点会在数据编辑时重建，不能作为独立的命令目标；普通组合继续逐个返回真实子元素。

| 选项 | 契约 |
|---|---|
| `maxChars` | `JSON.stringify(result)` 的 UTF-16 单元数，包含标点、JSON 转义和截断信息；非 UTF-8 字节数 |
| `maxTokens` | 完整紧凑 JSON 的 token 数上限，必须同时提供目标模型的 `countTokens(json)` |
| `countTokens` | 同一输入返回同一非负安全整数；不设置 maxTokens 时不调用 |

两个上限均须为非负安全整数，同时提供时均生效。接口保留完整页面元数据与元素的先序前缀，包含中文、代理对和长备注的字段均不会从中间截断；使用对数次计数选取一个符合预算的确定前缀，不保证填满预算。连最小定位结果也装不下时抛出 `budget-too-small`。

```ts
const result = describePresentation(doc, {
  maxTokens: 4_000,
  countTokens: (json) => tokenizer.encode(json).length,
});
```

| `DescribeError.reason` | 条件 |
|---|---|
| `invalid-budget` | 选项或上限非法 |
| `token-counter-required` | maxTokens 缺少计数函数 |
| `invalid-token-count / token-count-failed` | 计数结果非法 / 计数器抛出异常 |
| `budget-too-small` | 最小结果超过预算 |
| `invalid-document / unaddressable-element / invalid-geometry` | 文档无法读取、投影不能唯一映射回编辑身份、外框不是有限数值 |

文档错误带 `slideNumber` 与可定位时的 `elementId`；失败不返回半份成功结果。输出不包含图片/字体 URL、XML 和 run 样式。

JSON Schema 从公开 TypeScript 输出类型生成，随包通过 `@web-ppt/edit-core/describe/schema.json` 发布。`npm run schema:describe` 更新 Schema，`npm run verify` 校验其与类型一致。固定输入文档（含 ID）得到逐字节一致的紧凑 JSON；跨进程重新解析时显式使用相同 `idPrefix`。默认 `createDoc` 继续使用独立随机会话身份。
