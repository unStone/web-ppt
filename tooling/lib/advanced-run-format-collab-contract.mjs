export async function runAdvancedRunFormatCollabContract({
  bindPair, check, createPair, edit, OfflineHub, semanticDoc, seededShuffle, stringDiff,
}) {
  console.log('\n\x1b[36m▸ 高级字符格式、清除格式与远端恢复\x1b[0m');
  const pair = await createPair('sample-editor-text.pptx', 'collab-advanced-run-');
  const hub = new OfflineHub();
  const errors = [];
  const bindings = bindPair(pair, hub, errors);
  const record = Object.values(pair.left.elements)
    .find((candidate) => candidate.src.name === '重复格式');
  const range = {
    from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 1 },
  };
  pair.leftEditor.exec({
    type: 'SetRunProps', id: record.id, range,
    props: {
      underline: 'wavyDbl', strikeType: 'dblStrike', highlight: '#FDE68A',
      spacing: 2, caps: 'small', baseline: 25,
    },
  });
  hub.flush();

  const remoteFrames = [];
  const stopRecovery = pair.rightEditor.subscribeRecovery((frame) => remoteFrames.push(frame));
  pair.leftEditor.exec({ type: 'ClearFormat', id: record.id, range });
  pair.rightEditor.exec({
    type: 'SetRunProps', id: record.id, range,
    props: {
      underline: 'dotDashHeavy', strikeType: 'sngStrike', highlight: '#AABBCC',
      spacing: -1, caps: 'all', baseline: -25,
    },
  });
  hub.flush((messages) => seededShuffle(messages, 0xa0d005));
  stopRecovery();
  const left = edit.queryRunProps(pair.left, record.id, range);
  const right = edit.queryRunProps(pair.right, record.id, range);
  check('并发 ClearFormat 与高级 SetRunProps 按文字字段 LWW 原子收敛',
    semanticDoc(pair.left) === semanticDoc(pair.right) && errors.length === 0
      && JSON.stringify(left) === JSON.stringify(right)
      && ((left.underline.value === 'none' && left.highlight.value === null)
        || (left.underline.value === 'dotDashHeavy'
          && left.strikeType.value === 'sngStrike'
          && left.highlight.value === 'rgb(170,187,204)'
          && left.spacing.value === -1 && left.caps.value === 'all'
          && left.baseline.value === -25)),
    errors.map(String).join(' / ') || stringDiff(semanticDoc(pair.left), semanticDoc(pair.right)));

  const restoredPair = await createPair('sample-editor-text.pptx', 'collab-advanced-run-');
  const restored = new edit.Editor(restoredPair.right, {
    recoveryFrames: JSON.parse(JSON.stringify(remoteFrames)),
  });
  check('高级字符格式远端帧保持纯 JSON 并恢复最终有效投影',
    remoteFrames.length > 0
      && JSON.stringify(edit.queryRunProps(restoredPair.right, record.id, range))
        === JSON.stringify(right)
      && restored.history.undoCount === 0);
  bindings.forEach((binding) => binding.dispose());
}
