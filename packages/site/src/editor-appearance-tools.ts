import { createAppearanceEditor, queryPictureFx, queryScene3D, SCENE_MATERIALS } from '@web-ppt/edit-core/appearance';
import type { EditorSession } from '@web-ppt/editor';
import { colorInputValue } from './editor-color-input';
import { setText } from './i18n/runtime';
import { moveLanguageControl } from './i18n/controls';
import type { Message } from './i18n/messages';

type Label = Exclude<Message, `${string}{${string}`>;

export function showAppearanceTools(session: EditorSession, id: string, current: () => EditorSession | null): void {
  if (document.querySelector('#appearanceDialog')) return;
  const record = session.editor.doc.elements[id];
  if (!record || record.meta.editable !== 'full' || record.meta.locked) return;
  const picture = record.src.kind === 'image';
  if (!picture && record.src.kind !== 'shape') return;
  const api = createAppearanceEditor(session.editor);
  const dialog = document.createElement('dialog');
  dialog.id = 'appearanceDialog';
  dialog.setAttribute('aria-labelledby', 'appearanceTitle');
  dialog.innerHTML = `<style>
#appearanceDialog{width:min(420px,calc(100vw - 48px));max-height:calc(100vh - 48px);border:1px solid #ddd;border-radius:12px;padding:24px}
#appearanceDialog::backdrop{background:#11182770}#appearanceDialog label{display:flex;justify-content:space-between;gap:12px;margin:12px 0}
#appearanceDialog input:not([type=checkbox]),#appearanceDialog select{width:140px}#appearanceDialog footer{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px}
</style><header><h2 id="appearanceTitle"></h2></header><form><div class="fields"></div><p role="alert"></p><footer></footer></form>`;
  setText(dialog.querySelector('h2')!, picture ? '图片效果' : '立体效果');
  const form = dialog.querySelector('form')!, fields = dialog.querySelector('.fields')!;
  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const input = (key: string, label: Label, type: string, value: string | number | boolean, min = 0, max = 100) => {
    const row = document.createElement('label'), text = document.createElement('span');
    setText(text, label);
    const control = document.createElement('input');
    control.name = key; control.type = type;
    if (type === 'checkbox') control.checked = !!value;
    else control.value = String(value);
    if (type === 'number') { control.min = String(min); control.max = String(max); control.step = 'any'; control.required = true; }
    row.append(text, control); fields.append(row); inputs.set(key, control);
    return control;
  };
  if (picture) {
    const value = queryPictureFx(session.editor.doc, id);
    input('alpha', '不透明度（%）', 'number', (value.alpha ?? 1) * 100);
    input('grayscale', '灰度', 'checkbox', value.grayscale ?? false);
    const enabled = input('duotone', '双色调', 'checkbox', !!value.duotone);
    const dark = input('dark', '暗部颜色', 'color', colorInputValue(value.duotone?.[0] ?? '#102030'));
    const light = input('light', '亮部颜色', 'color', colorInputValue(value.duotone?.[1] ?? '#F0C080'));
    const sync = () => { dark.disabled = light.disabled = !enabled.checked; };
    enabled.onchange = sync; sync();
  } else {
    const value = queryScene3D(session.editor.doc, id);
    for (const [key, label] of [['extrusion', '挤出深度'], ['bevelTop', '顶部斜角'], ['bevelBottom', '底部斜角'], ['contourWidth', '轮廓宽度']] as const) {
      input(key, label, 'number', value[key] ?? 0, 0, 10000);
    }
    input('extrusionColor', '挤出颜色', 'color', colorInputValue(value.extrusionColor ?? '#334155'));
    input('contourColor', '轮廓颜色', 'color', colorInputValue(value.contourColor ?? '#334155'));
    input('rotX', 'X 轴视角', 'number', value.rotX ?? 20, -360, 360);
    input('rotY', 'Y 轴视角', 'number', value.rotY ?? 35, -360, 360);
    const row = document.createElement('label'), label = document.createElement('span');
    setText(label, '材质');
    const select = document.createElement('select'); select.name = 'material';
    const names = ['经典哑光', '经典塑料', '经典金属', '经典线框', '哑光', '塑料', '金属', '暖哑光',
      '半透明粉末', '粉末', '深色边缘', '柔和边缘', '透明', '平面', '柔和金属'] as const;
    SCENE_MATERIALS.forEach((material, index) => {
      const option = new Option('', material); setText(option, names[index]); select.add(option);
    });
    select.value = value.material ?? 'matte';
    row.append(label, select); fields.append(row); inputs.set('material', select);
    const hint = document.createElement('p'); setText(hint, '浏览器预览使用等轴测近似；保存保留立体参数。'); fields.append(hint);
  }
  const button = (label: Label, action?: () => void) => {
    const node = document.createElement('button'); node.className = 'button';
    node.type = action ? 'button' : 'submit'; setText(node, label); if (action) node.onclick = action;
    dialog.querySelector('footer')!.append(node);
  };
  const number = (name: string) => Number(inputs.get(name)!.value);
  const checked = (name: string) => (inputs.get(name) as HTMLInputElement).checked;
  const apply = (mode: 'set' | 'clear' | 'source') => {
    if (current() !== session || !session.editor.doc.elements[id]) { dialog.close(); return; }
    try {
      if (picture) api.exec({ type: 'SetPictureFx', id, effects: mode === 'source' ? null : mode === 'clear' ? {} : {
        alpha: number('alpha') / 100, grayscale: checked('grayscale'),
        ...(checked('duotone') ? { duotone: [inputs.get('dark')!.value, inputs.get('light')!.value] as const } : {}),
      } });
      else api.exec({ type: 'SetScene3D', id, scene: mode === 'source' ? null : mode === 'clear' ? {} : {
        extrusion: number('extrusion'), bevelTop: number('bevelTop'), bevelBottom: number('bevelBottom'),
        contourWidth: number('contourWidth'), extrusionColor: inputs.get('extrusionColor')!.value,
        contourColor: inputs.get('contourColor')!.value, rotX: number('rotX'), rotY: number('rotY'), material: inputs.get('material')!.value,
      } });
      dialog.close();
    } catch (error) { setText(dialog.querySelector('[role=alert]')!, '外观修改失败：{detail}', { detail: error instanceof Error ? error.message : String(error) }); }
  };
  button('恢复来源', () => apply('source')); button('清除效果', () => apply('clear'));
  button('取消', () => dialog.close()); button('应用');
  form.onsubmit = (event) => { event.preventDefault(); apply('set'); };
  document.body.append(dialog);
  const restoreLanguage = moveLanguageControl(dialog.querySelector('header')!);
  dialog.addEventListener('close', () => { restoreLanguage(); dialog.remove(); }, { once: true });
  dialog.showModal();
}
