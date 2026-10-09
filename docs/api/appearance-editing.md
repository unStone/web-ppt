# 图片与立体效果编辑

`@web-ppt/edit-core/appearance` 是按需入口。官网编辑器在选中图片或形状后显示「图片效果」或「立体效果」；
SDK 的默认命令集合与默认编辑器包不加载这组工具。

```ts
import { createAppearanceEditor, queryPictureFx, queryScene3D } from '@web-ppt/edit-core/appearance';

const appearance = createAppearanceEditor(session.editor);
appearance.exec({ type: 'SetPictureFx', id: pictureId,
  effects: { alpha: 0.6, grayscale: true, duotone: ['#112233', '#FFEEDD'] } });
appearance.exec({ type: 'SetScene3D', id: shapeId,
  scene: { extrusion: 12, bevelTop: 3, material: 'metal', rotX: 20, rotY: 35 } });
const picture = queryPictureFx(session.editor.doc, pictureId);
const scene = queryScene3D(session.editor.doc, shapeId);
```

| 参数 | 语义 |
|---|---|
| `effects.alpha` | 0–1 不透明度，量化到十万分之一 |
| `effects.grayscale` | 灰度开关 |
| `effects.duotone` | 暗部、亮部两个不透明 RGB 颜色，先灰度后着色，保留原始 alpha |
| `scene.extrusion / bevelTop / bevelBottom / contourWidth` | 像素尺寸；保存量化到 EMU，显式 `extrusion: 0` 保留零厚度 |
| `scene.extrusionColor / contourColor` | 挤出与轮廓颜色 |
| `scene.rotX / rotY` | ±360°，规范化为 0–360° |
| `scene.material` | `SCENE_MATERIALS` 列出的 DrawingML 材质 |
| `null` | 移除本次覆盖，恢复文稿来源效果 |
| `{}` | 显式清除这组效果；未管理的来源图片滤镜仍保留 |

每次命令替换完整的一组设置。要只改一个属性，先查询当前设置再展开修改。立体预览沿用等轴测近似，
不做真实相机投影；查询接口返回可直接再次写回的深度，避免材质近似让反复保存的物体越来越厚。

| 链路 | 契约 |
|---|---|
| 权限 | 图片/形状、完整编辑权限、非锁定、非只读；兼容整壳对象内部不可编辑 |
| 历史与恢复 | 同一编辑器事务；撤销、重做、恢复帧与外部补丁均使用既有扩展机制 |
| 协同 | 图片和立体设置分别为原子字段，使用现有 LWW；同一组参数的并发修改整体决胜 |
| 补丁保存 | 修改 `a:blip` 或 `a:scene3d/a:sp3d`，保留相邻内容、裁剪及未知扩展 |
| 生成保存 | 注册扩展后支持受管图片效果与立体设置；其他 CSS 滤镜继续明确拒绝，避免静默丢失 |
| 复制 | 已编辑图片跨文稿复制保留效果；复杂图表复制仍遵守既有 OPC 闭包限制 |

恢复或接收协同外观数据前，显式调用 `registerAppearanceEditing()`。只有保留原包的文稿才支持来源 XML
直通；无原包生成保存需要加载对应效果入口。编辑器借用原包期间不要主动释放它。

确定性样本为 `sample-editor-appearance.pptx` 与 `sample-editor-mixed.pptx`。回归覆盖两条保存、清除/恢复、
零厚度二次保存、历史/恢复/外部补丁、跨文稿复制、XML 必需节点、真实 Chrome 控件，以及 PNG/独立 SVG 的实际颜色。
