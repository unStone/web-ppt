# 模板填充生成

`@web-ppt/edit-core/fill` 接收模板与大纲，在私有文稿中生成原生可编辑的 PPTX。输入模板和大纲不被修改；生成器不调用模型、网络或桌面 Office。

此入口从 `0.8.0-beta.1` 提供，安装时保持包版本一致：

```bash
npm i @web-ppt/core@0.8.0-beta.1 @web-ppt/edit-core@0.8.0-beta.1
```

```ts
import { fillTemplate } from '@web-ppt/edit-core/fill';

const result = await fillTemplate('editorial', {
  version: 1,
  slides: [
    { type: 'title', title: 'Quarterly results', subtitle: 'Native editable content' },
    { type: 'content', title: 'Progress', body: [
      { text: 'Revenue grows', level: 0, bullet: true },
    ] },
  ],
}, {
  idPrefix: 'generated-',
  lint: { measureText, fonts: { available, embedded }, resolveContrast },
});
```

`template` 可为 `aurora`、`editorial`、`midnight` 或普通 PPTX/POTX 模板字节 `Uint8Array`。POTX 主内容类型转换为返回的 PPTX 文稿类型，宏主类型返回 `unsupported-template`。真实测量、字体库存和复杂背景取样沿用[布局检查](agent-layout-lint.md)的资源契约；不能用估算字宽或虚构字体库存代替。

| 页类型 | 大纲内容 | 角色匹配 |
|---|---|---|
| `title` | `title`、可选 `subtitle` | 标题与副标题槽 |
| `section` | `title`、可选段落 `body` | 章节版式；显式 `layoutId` 可指定满足角色的版式 |
| `content` | `title`、非空段落 `body` | 标题与单内容槽 |
| `two-column` | `title`、二元 `columns` | 标题与从左到右的两个内容槽 |
| `image` | `title`、`image`、可选说明段落 `body` | 优先图片槽，其次等价通用内容槽；保持比例 `contain` 或 `cover` |
| `chart` | `title`、`chart` | 优先图表槽，其次等价通用内容槽；写入原生 chart 与 XLSX |

每页可带 `notes`、`layoutId`。段落为 `{ text, level?, bullet? }`，层级 0–8；图像为 `{ bytes, mime, fit?, altText? }`，`bytes` 是规范 Base64。图表支持 `bar/line/pie/doughnut/area/scatter/radar/bubble`；类别图的 `categories` 与每个系列 `values` 等长，散点和气泡图使用空 `categories` 与等长 `x/values`，气泡另需 `sizes`。`null` 保持缺失点，不能替换成零。

## 检查与设计调整

默认在生成副本中修复可确定处理的模板出血、字体、文字适配和对比度问题，再保存、重新解析并运行完整检查。调整必须改变真实模型和文件，不能过滤诊断或降低阈值；无法可靠修复则返回明确失败。

| 选项或结果 | 契约 |
|---|---|
| `repair` | 默认 `true`；`false` 保留模板原始设计及其真实诊断 |
| `requireClean` | 默认 `true`，最终仍有任何选中检查问题则拒绝；`false` 允许返回带完整报告的产物 |
| `signal` | 取消后释放生成器私有文稿，不返回部分成功文件 |
| `bytes` | 完整原生 PPTX 字节 |
| `description` | 最终字节真实重开后的 describe；用相同 `idPrefix` 重开可逐字段比较 |
| `lint` | 最终实际文稿的完整检查报告 |
| `bindings` | 最终页号、版式、标题、内容和对象 ID，供后续编辑 |
| `repairs` | 实际执行的调整、前后属性及原生来源锚点；元素 ID 映射到最终文稿 |

JSON Schema 由公开类型生成，发布路径为 `@web-ppt/edit-core/fill/schema.json`，运行期使用预编译校验器。XML 1.0 非法字符和孤立代理在创建文稿前拒绝；合法 CR/CRLF 统一为 LF，输入对象保留原值。

## 失败与确定性

`TemplateFillError` 包含 `reason`、`message`、`slideNumber`、`field` 和 `elementId`；布局拒绝还携带完整 `lint`。常见 reason 为 `invalid-outline`、`invalid-image`、`invalid-chart-data`、`layout-not-found`、`layout-role-mismatch`、`measurement-required`、`layout-invalid`、`aborted`。极端裁剪在原生格式精度内无法保留正面积时返回 `image-crop-unrepresentable`。

同一模板、大纲、配置与真实测量环境在独立进程中生成相同 PPTX 字节。临时编辑身份不作为最终身份返回；源包、图表生成阶段和规范化文稿各自持有资源并在结束时释放。

源码与发布入口使用 `npm run test:fill` / `npm run test:fill:dist` 验证。外部模板可通过 `TEMPLATE_FILL_EXTERNAL` 指定；真实外部语料不提交到 `fixtures/`。

独立读取器验收使用 `npm run test:fill:libreoffice`，覆盖无修复打开、页数和有效预览。本轮实测 Quick Look 对深色动态页码继承、稀疏图表缓存和气泡预览有近似；LibreOffice 的原生字段和数据另行验证，不将读取成功等同跨实现像素一致。
