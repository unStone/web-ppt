import type { LayoutDesignState } from '@web-ppt/edit-core';
import { openEditor } from '@web-ppt/editor';
import {
  createDesignEditor, listLayouts, queryLayout,
} from '@web-ppt/editor/design';
import type { LayoutDesignState as ReactLayoutDesignState } from '@web-ppt/react';
import type { LayoutDesignState as VueLayoutDesignState } from '@web-ppt/vue';

async function layoutJourney(input: Uint8Array): Promise<void> {
  const session = await openEditor(input, { idPrefix: 'type-v07-layout-' });
  const target = listLayouts(session.editor.doc)[0].target;
  const state: LayoutDesignState = queryLayout(session.editor.doc, target);
  session.editor.execDesign(target, {
    type: 'SetBackground', target, fill: { type: 'solid', color: '#112233' },
  });
  session.editor.execDesign(target, {
    type: 'AddShape', target, preset: 'rect', rect: { x: 1, y: 2, w: 3, h: 4 },
  });
  const design = createDesignEditor(document.body, session, { target });
  design.destroy();
  // @ts-expect-error 页面可见性不属于版式画布命令。
  session.editor.execDesign(target, { type: 'SetHidden', id: 'slide', v: true });
  // @ts-expect-error 备注只属于普通页面。
  session.editor.execDesign(target, { type: 'SetNotes', id: 'slide', text: 'note' });
  // @ts-expect-error 时间树只属于普通页面。
  session.editor.execDesign(target, { type: 'SetAnimations', slideId: 'slide', steps: [] });
  void (state satisfies ReactLayoutDesignState);
  void (state satisfies VueLayoutDesignState);
  session.dispose();
}

void layoutJourney;
