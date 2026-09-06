import { prepareModernCharts } from '@web-ppt/core/modern-charts';
import { createAppearanceEditor, registerAppearanceEditing, queryPictureFx, queryScene3D,
  type PictureFx, type AppearanceCommand } from '@web-ppt/edit-core/appearance';
import { createCanvasAccessibility } from '@web-ppt/editor/accessibility';
import { enableEditContext, type EditContextEnhancement } from '@web-ppt/editor/edit-context';
import type { EditorSession, SlideEditor } from '@web-ppt/editor';

export async function appearanceBrowserContract(session: EditorSession, view: SlideEditor, bytes: Uint8Array): Promise<() => void> {
  await prepareModernCharts(bytes);
  registerAppearanceEditing();
  const effects: PictureFx = { alpha: .5, grayscale: true, duotone: ['#112233', '#FFEEDD'] };
  const commands: AppearanceCommand[] = [
    { type: 'SetPictureFx', id: 'picture', effects },
    { type: 'SetPictureFx', id: 'picture', effects: null },
    { type: 'SetScene3D', id: 'shape', scene: { extrusion: 0, bevelTop: 3, material: 'metal' } },
  ];
  const api = createAppearanceEditor(session.editor);
  commands.forEach((command) => api.exec(command));
  queryPictureFx(session.editor.doc, 'picture'); queryScene3D(session.editor.doc, 'shape');
  // @ts-expect-error 图片效果要求数值透明度。
  api.exec({ type: 'SetPictureFx', id: 'picture', effects: { alpha: '50%' } });
  // @ts-expect-error 双色调必须恰好两种颜色。
  api.exec({ type: 'SetPictureFx', id: 'picture', effects: { duotone: ['#000'] } });
  // @ts-expect-error 按需命令不扩张默认编辑器命令联合。
  session.editor.exec({ type: 'SetPictureFx', id: 'picture', effects });
  const accessibility = createCanvasAccessibility(session, view);
  const input: EditContextEnhancement = enableEditContext(session, view);
  return () => { input.dispose(); accessibility.dispose(); };
}
