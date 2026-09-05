import { unzipSync } from 'fflate';

export async function runCompatibilityGroupedCopyContract({ core, edit, bytes, eq, check, saveArtifact }) {
  for (const mode of ['patch', 'generated']) {
    const presentation = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
    const editor = new edit.Editor(edit.createDoc(presentation));
    try {
      const doc = editor.doc, slide = doc.slideOrder[0], chart = doc.slides[slide].children[0];
      editor.exec({ type: 'AddShape', slideId: slide, preset: 'rect', rect: { x: 10, y: 10, w: 30, h: 30 } });
      const shape = editor.selection.ids[0];
      editor.exec({ type: 'Group', ids: [chart, shape] });
      const group = editor.selection.ids[0];
      const payload = edit.copyElements(doc, [group]);
      eq(`${mode} 新建分组复制包含孩子引用的回退图片`, payload.resources.length, 1);
      editor.exec({ type: 'PasteElements', payload, at: { parentId: slide, x: 180, y: 80 } });
      if (mode === 'generated') presentation.dispose();
      const saved = await editor.save();
      saveArtifact?.(`grouped-copy-${mode}.pptx`, saved);
      const parts = unzipSync(saved);
      const source = unzipSync(bytes);
      for (const part of ['ppt/charts/chartEx1.xml', 'ppt/charts/_rels/chartEx1.xml.rels',
        'ppt/embeddings/chart-data.xlsx', 'ppt/media/chart-preview.png']) {
        check(`${mode} 分组复制后原样保留 ${part}`,
          !!parts[part] && Buffer.from(parts[part]).equals(Buffer.from(source[part])));
      }
      const xml = new TextDecoder().decode(parts['ppt/slides/slide1.xml']);
      eq(`${mode} 保存保留两份完整兼容外壳`, (xml.match(/<mc:AlternateContent/g) ?? []).length, 2);
      const reopened = await core.parse(saved, { lazy: false, edit: true });
      try {
        const groups = reopened.slides[0].elements;
        check(`${mode} 重开两个组合均含框架图表和普通形状`, groups.length === 2
          && groups.every((el) => el.kind === 'group' && el.children.length === 2
            && el.children[0].editInfo.editable === 'frame' && el.children[1].kind === 'shape'));
      } finally { reopened.dispose(); }
    } finally { editor.dispose(); presentation.dispose(); }
  }
}

export async function runCompatibilityUngroupedTableContract({ core, edit, bytes, eq }) {
  const presentation = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
  const editor = new edit.Editor(edit.createDoc(presentation));
  try {
    const doc = editor.doc, slide = doc.slideOrder[0], chart = doc.slides[slide].children[0];
    editor.exec({ type: 'AddTable', slideId: slide, rows: 2, cols: 2, rect: { x: 10, y: 10, w: 100, h: 80 } });
    editor.exec({ type: 'Group', ids: [chart, editor.selection.ids[0]] });
    editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [editor.selection.ids[0]]),
      at: { parentId: slide, x: 180, y: 80 } });
    const group = editor.selection.ids[0], table = doc.elements[group].children[1];
    editor.exec({ type: 'InsertRow', id: table });
    editor.exec({ type: 'Ungroup', id: group });
    const reopened = await core.parse(await editor.save(), { lazy: false });
    try {
      eq('解组转交来源不重复物化表格追加行', reopened.slides[0].elements[2].rows.length, 3);
    } finally { reopened.dispose(); }
  } finally { editor.dispose(); presentation.dispose(); }
}

export async function runCompatibilityGroupedChildCopyContract({ core, edit, bytes, eq }) {
  const presentation = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
  const editor = new edit.Editor(edit.createDoc(presentation));
  try {
    const doc = editor.doc, slide = doc.slideOrder[0], chart = doc.slides[slide].children[0];
    editor.exec({ type: 'AddShape', slideId: slide, preset: 'rect', rect: { x: 10, y: 10, w: 30, h: 30 } });
    editor.exec({ type: 'Group', ids: [chart, editor.selection.ids[0]] });
    editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [chart]),
      at: { parentId: slide, x: 200, y: 100 } });
    const reopened = await core.parse(await editor.save(), { lazy: false, edit: true });
    try {
      eq('新建分组中的兼容孩子可以单独复制', reopened.slides[0].elements.length, 2);
      eq('单独复制不携带父组或兄弟', reopened.slides[0].elements[1].editInfo.editable, 'frame');
      eq('单独复制使用幻灯片落点', reopened.slides[0].elements[1].x, 200);
    } finally { reopened.dispose(); }
  } finally { editor.dispose(); presentation.dispose(); }
}

export async function runCompatibilityRegroupedCopyContract({ core, edit, bytes, eq, check }) {
  const presentation = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
  const editor = new edit.Editor(edit.createDoc(presentation));
  try {
    const doc = editor.doc, slide = doc.slideOrder[0], chart = doc.slides[slide].children[0];
    editor.exec({ type: 'AddShape', slideId: slide, preset: 'rect', rect: { x: 10, y: 10, w: 30, h: 30 } });
    editor.exec({ type: 'Group', ids: [chart, editor.selection.ids[0]] });
    editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [editor.selection.ids[0]]),
      at: { parentId: slide, x: 180, y: 80 } });
    const outer = editor.selection.ids[0];
    editor.exec({ type: 'Group', ids: [...doc.elements[outer].children] });
    const inner = editor.selection.ids[0];
    editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [inner]),
      at: { parentId: slide, x: 300, y: 100 } });
    editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [outer]),
      at: { parentId: slide, x: 400, y: 100 } });
    const reopened = await core.parse(await editor.save(), { lazy: false, edit: true });
    try {
      const groups = reopened.slides[0].elements;
      eq('粘贴组的孩子再次分组后可复制内组和外组', groups.length, 4);
      check('来源完整片段按当前模型装配内层新组', groups[1].children.length === 1
        && groups[1].children[0].kind === 'group' && groups[1].children[0].children.length === 2);
      check('复制嵌套组保留兼容孩子权限', groups[3].children[0].children[0].editInfo.editable === 'frame');
    } finally { reopened.dispose(); }
  } finally { editor.dispose(); presentation.dispose(); }
}

export async function runCompatibilityGroupedRecoveryContract({ core, edit, bytes, eq, check }) {
  const presentation = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
  const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: 'group-copy-history-' }));
  const frames = [];
  const unsubscribe = editor.subscribeRecovery((frame) => frames.push(structuredClone(frame)));
  try {
    const doc = editor.doc, slide = doc.slideOrder[0], chart = doc.slides[slide].children[0];
    editor.exec({ type: 'AddShape', slideId: slide, preset: 'rect', rect: { x: 10, y: 10, w: 30, h: 30 } });
    editor.exec({ type: 'Group', ids: [chart, editor.selection.ids[0]] });
    editor.undo();
    eq('分组复制前撤销还原两个独立对象', doc.slides[slide].children.length, 2);
    editor.redo();
    editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [editor.selection.ids[0]]),
      at: { parentId: slide, x: 180, y: 80 } });
    const copy = editor.selection.ids[0];
    editor.exec({ type: 'RemoveElement', id: doc.elements[copy].children[1] });
    editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [copy]),
      at: { parentId: slide, x: 300, y: 100 } });
    for (const replay of ['recovery', 'external']) {
      const source = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
      const restoredDoc = edit.createDoc(source, { idPrefix: 'group-copy-history-' });
      const restored = new edit.Editor(restoredDoc, replay === 'recovery' ? { recoveryFrames: frames } : {});
      try {
        if (replay === 'external') for (const frame of frames) {
          if (frame.patches.length) restored.applyExternalPatches(frame.patches);
        }
        const last = restoredDoc.slides[slide].children.at(-1);
        restored.exec({ type: 'PasteElements', payload: edit.copyElements(restoredDoc, [last]),
          at: { parentId: slide, x: 400, y: 100 } });
        source.dispose();
        check(`${replay} 原包释放后才开始生成保存`, restoredDoc.package.disposed);
        const saved = await restored.save();
        const reopened = await core.parse(saved, { lazy: false, edit: true });
        try {
          const groups = reopened.slides[0].elements;
          eq(`${replay} 回放及二次复制不复活已删除孩子`, groups.map((el) => el.children.length).join(','), '2,1,1,1');
          check(`${replay} 每组均保留框架图表`, groups.every((el) => el.children[0].editInfo.editable === 'frame'));
        } finally { reopened.dispose(); }
      } finally { restored.dispose(); source.dispose(); }
    }
  } finally { unsubscribe(); editor.dispose(); presentation.dispose(); }
}

export async function runCompatibilityUngroupedCopyContract({ core, edit, bytes, eq, check }) {
  for (const mode of ['patch', 'generated']) {
    const presentation = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
    const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: 'ungroup-copy-' }));
    const frames = [];
    const unsubscribe = editor.subscribeRecovery((frame) => frames.push(structuredClone(frame)));
    try {
      const doc = editor.doc, slide = doc.slideOrder[0], chart = doc.slides[slide].children[0];
      editor.exec({ type: 'AddShape', slideId: slide, preset: 'rect', rect: { x: 10, y: 10, w: 30, h: 30 } });
      editor.exec({ type: 'Group', ids: [chart, editor.selection.ids[0]] });
      editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [editor.selection.ids[0]]),
        at: { parentId: slide, x: 180, y: 80 } });
      const group = editor.selection.ids[0];
      editor.exec({ type: 'Ungroup', id: group });
      const detachedChart = editor.selection.ids[0];
      editor.undo();
      eq(`${mode} 撤销解组还原原父链`, doc.elements[detachedChart].parent, group);
      editor.redo();
      editor.exec({ type: 'PasteElements', payload: edit.copyElements(doc, [detachedChart]),
        at: { parentId: slide, x: 300, y: 100 } });
      if (mode === 'generated') presentation.dispose();
      const reopened = await core.parse(await editor.save(), { lazy: false, edit: true });
      try {
        const elements = reopened.slides[0].elements;
        eq(`${mode} 解组后的兼容孩子保留来源并可复制`, elements.length, 4);
        check(`${mode} 脱离父组的两份图表均保留框架权限`, [elements[1], elements[3]]
          .every((el) => el.kind === 'image' && el.editInfo.editable === 'frame'));
      } finally { reopened.dispose(); }
      for (const replay of ['recovery', 'external']) {
        const source = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
        const restored = new edit.Editor(edit.createDoc(source, { idPrefix: 'ungroup-copy-' }),
          replay === 'recovery' ? { recoveryFrames: frames } : {});
        try {
          if (replay === 'external') for (const frame of frames) {
            if (frame.patches.length) restored.applyExternalPatches(frame.patches);
          }
          if (mode === 'generated') source.dispose();
          const reopened = await core.parse(await restored.save(), { lazy: false, edit: true });
          try {
            eq(`${mode}/${replay} 解组来源转交可回放`, reopened.slides[0].elements.map((el) => el.kind).join(','),
              'group,image,shape,image');
          } finally { reopened.dispose(); }
        } finally { restored.dispose(); source.dispose(); }
      }
    } finally { unsubscribe(); editor.dispose(); presentation.dispose(); }
  }
}
