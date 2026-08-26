import {
  createIndexedDbRecoveryStore, fingerprintSource, openEditor,
} from '/out/editor/editor.mjs';

postMessage({
  imported: typeof openEditor === 'function'
    && typeof fingerprintSource === 'function'
    && typeof createIndexedDbRecoveryStore === 'function',
  withoutDocument: typeof document === 'undefined',
});
