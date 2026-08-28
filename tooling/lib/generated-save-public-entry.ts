// 模拟真实应用同时导入 edit-core 与 edit-core/generate；同一模块图必须共享会话资源表。
export {
  createDoc, createEmptyDoc, disposeDoc, Editor, querySlideNotes, toSlide,
} from '../../packages/edit-core/src/index';
export { generateEditDoc } from '../../packages/edit-core/src/generate/index';
