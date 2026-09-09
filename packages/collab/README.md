# @web-ppt/collab

Optional, server-free collaboration for `@web-ppt/edit-core`. It maps the editor's absolute patch stream to field-level LWW registers and keeps transport behind a tiny provider interface.

```bash
npm i @web-ppt/edit-core @web-ppt/collab
```

Every replica must parse the same source with the same base `idPrefix`, then bind before its first local edit. The binding preserves that recovery prefix and records a replica-specific logical prefix plus exact numeric allocation ranges for identities created afterwards.

```ts
import { Editor, createDoc } from '@web-ppt/edit-core';
import { bindCollaboration, BroadcastChannelCollabProvider } from '@web-ppt/collab';

const doc = createDoc(presentation, { idPrefix: 'shared-deck-' });
const editor = new Editor(doc);
const provider = new BroadcastChannelCollabProvider('web-ppt-two-tab-demo');
const collaboration = bindCollaboration(editor, {
  documentId: 'shared-deck',
  replicaId: crypto.randomUUID(),
  replicaSlot: 17, // provider must assign a unique 0–4095 slot within this document
  provider,
});

// collaboration.dispose();
// provider.dispose();
```

`BroadcastChannelCollabProvider` is the two-tab demo and needs no backend. Production transports implement only `send(message)` and `subscribe(listener)`; storage, authentication and networking stay outside this package. The provider also owns replica membership: each active or offline-writable replica needs a distinct `replicaSlot` (0–4095). The slot exactly partitions logical ids and every global OOXML numeric namespace used by editing: `cNvPr@id`, slide/notes part numbers, presentation slide ids and relationship ids. Concurrent insertions therefore do not rely on hash-collision odds.

Disposing and rebinding the same `Editor` preserves its merge registers. For process recovery, persist `collaboration.checkpoint()` atomically with the latest editor recovery frame, then pass that checkpoint when binding the restored editor:

```ts
const checkpoint = collaboration.checkpoint();
// Persist `checkpoint` together with the latest RecoveryFrame.

const restored = bindCollaboration(restoredEditor, {
  documentId: 'shared-deck',
  replicaId: savedReplicaId,
  replicaSlot: savedReplicaSlot,
  provider,
  checkpoint,
});
```

Recovery frames restore the model and identity cursors; the checkpoint restores LWW registers, move intents, compressed replay watermarks and deferred patches. Replay state stores one contiguous high watermark per replica plus bounded out-of-order gaps, so a long session does not grow one checkpoint entry per message. A restored collaborative document without the matching checkpoint fails fast because those conflict decisions cannot be inferred safely from the model alone.

## Optional original-operation evidence

Use `bindCollaboration` from `@web-ppt/collab/migration` to retain the original scalar `set` or `del` operation for extension fields alongside their existing register stamps. The provider and binding options remain the same. Bind through this entry before editing, and use it again when restoring the checkpoint.

The optional `checkpoint.extensionOperations` entries use the same keys as `checkpoint.registers`; they do not introduce another clock. A deleted source element or slide does not erase the evidence or imply a field deletion. Old checkpoints without this list keep their evidence unknown. Rebinding an existing editor preserves its current session, so enabling this entry later only records future operations.

When `chart-shared` loads, this entry can resolve conflicting legacy chart fields using their original operations and stamps. Incoming legacy operations participate in the same decision, including a newer deletion that replaces previously unknown evidence. Missing evidence and contradictory operations with the same stamp leave the legacy data unchanged and read-only.

Slide copies freeze known original extension operations in their structural snapshots. A copy inherits the versions known at the moment of copying, including deletion evidence; its creation clock and later source changes cannot replace those versions. Remote changes to the copied fields also rebase its undo/redo snapshot before committing. Restoring an older snapshot from another replica preserves the receiving replica's known winning fields. A receiving editor that already loaded `chart-shared` resolves a late copy against its current fields in the same atomic batch. This does not reconstruct missing evidence in older bare models or resolve ambiguous identities.

Migration receipts are core execution records, not ordinary LWW fields. The optional entry re-evaluates incoming receipts against local evidence when consuming each message, including deferred messages. Winners retain their original stamps; the transport stamp does not replace them. Invalid batches roll back model, register and recovery changes together. The default entry rejects incoming receipts and does not load the migration implementation. Use the optional entry on every peer that exchanges versioned migration receipts.

## Why field-level LWW

| Choice | Runtime cost | Mapping to EditDoc | Offline replay | Result |
|---|---:|---|---|---|
| Field-level LWW | No dependency | Directly timestamps existing absolute patches | Idempotent message ids | Chosen |
| Yjs binding | Yjs plus a mirrored Y-type document | Requires a second structural model and conversion layer | Strong, but duplicates an ability the patch journal already has | Rejected for this layer |

Element deletion is remove-wins against concurrent field edits. Element z-order uses the existing fractional key and replica-unique new ids. Slide moves are rematerialized from timestamped move intents so delivery order cannot change the result. Identity watermarks merge monotonically; remote edits never enter local undo history.

Rich-text edits currently converge as one `TextOverride` LWW register. Character-level intention preservation, cursor presence, comments, permissions, server persistence and Peritext-style formatting CRDTs are deliberately out of scope.

## License

MIT.
