# 只读批注与交付

官网首页、样本预览、编辑器及独立查看器均有“批注”按钮。面板默认关闭，按需加载，翻页跟随当前页，
换文稿或关闭预览时释放。作者、时间、正文显示原文；界面语言不会改写文稿。此阶段不包含新增、回复、修改或删除批注。

| 交付方式 | 默认 | `showComments: true` |
|---|---|---|
| PNG | 幻灯片画面 | 画面加批注标记 |
| 独立 SVG | 原生 `<text>` | 加批注标记及可读标题 |
| 图片 ZIP | 全稿 PNG | 每页 PNG 加标记 |
| 打印 HTML / PDF | 幻灯片页面 | 加标记及独立正文附录，保留作者、时间和换行 |
| PPTX 补丁保存 | 保留源批注 | 无需开关；复制页拥有独立部件，未知扩展保留 |
| PPTX 生成保存 | 写出投影中的批注 | 无需开关；保留作者、时间、正文和锚点，分配有效新索引 |

编辑器的批注操作不改变未保存状态；“导出包含批注”也适用于工具栏的图片 ZIP。PNG/SVG API 使用尾部参数，
既有比例和隐藏元素调用仍然兼容。源索引只用于只读显示；生成包会紧凑重编号，副本使用未被占用的作者索引。

```ts
import { slideToPng, slideToSvgFile, presentationToPrintableHtml } from '@web-ppt/core';
import { presentationToImageZip } from '@web-ppt/core/image-zip';
import { createCommentsPanel } from '@web-ppt/viewer-core/comments';

const options = { showComments: true };
await slideToPng(pres, pres.slides[0], 2, options);
await slideToSvgFile(pres, pres.slides[0], undefined, options);
await presentationToImageZip(pres, options);
await presentationToPrintableHtml(pres, options);

const panel = createCommentsPanel(container, '本页没有批注');
panel.setSlide(pres.slides[0]); // 翻页时由宿主更新。
panel.dispose();
```

`npm run test:comments` 执行保存、阅读顺序、索引边界、XML 扩展保留、导出转义和面板生命周期契约；
`node tooling/test-comments.mjs --dist` 经包名消费同一套契约。真实 Chrome 另外检查四种导出、PNG 标记像素、
四个产品入口及中英文流程。生成与补丁批注工件进入统一 Office 清单；Windows 真机按用户要求暂缓。
