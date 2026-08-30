/** @web-ppt/collab —— 基于 EditDoc 补丁的无服务端协同适配层。 */
export { bindCollaboration } from './binding';
export { BroadcastChannelCollabProvider } from './broadcast-channel';
export type {
  CollabDeferredCheckpoint, CollabLifecycleCheckpoint, CollabMessage, CollabMessageListener,
  CollabRegisterCheckpoint,
  CollabProvider, CollabSeenCheckpoint, CollabSlideMoveCheckpoint, CollabStamp, CollaborationBinding,
  CollaborationCheckpoint, CollaborationOptions,
} from './types';
