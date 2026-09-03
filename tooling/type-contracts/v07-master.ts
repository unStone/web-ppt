import type { MasterDesignState } from '@web-ppt/edit-core';
import { openEditor } from '@web-ppt/editor';
import {
  createDesignEditor, listMasters, queryMaster,
} from '@web-ppt/editor/design';
import type { MasterDesignState as ReactMasterDesignState } from '@web-ppt/react';
import type { MasterDesignState as VueMasterDesignState } from '@web-ppt/vue';

async function masterJourney(input: Uint8Array): Promise<void> {
  const session = await openEditor(input, { idPrefix: 'type-v07-master-' });
  const target = listMasters(session.editor.doc)[0].target;
  const state: MasterDesignState = queryMaster(session.editor.doc, target);
  session.editor.execDesign(target, {
    type: 'SetMasterTextStyle', target, category: 'body', level: 2,
    paragraph: { align: 'center' }, run: { font: 'Aptos', size: 24 },
  });
  session.editor.execDesign(target, {
    type: 'SetBackground', target, fill: { type: 'solid', color: '#112233' },
  });
  const design = createDesignEditor(document.body, session, { target });
  design.destroy();
  session.editor.execDesign(target, {
    // @ts-expect-error 母版文字默认值只接受 title/body/other 三类。
    type: 'SetMasterTextStyle', target, category: 'subtitle', level: 0, run: { size: 20 },
  });
  void (state satisfies ReactMasterDesignState);
  void (state satisfies VueMasterDesignState);
  session.dispose();
}

void masterJourney;
