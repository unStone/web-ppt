import { registerMediaEditing } from '@web-ppt/edit-core/media';

// 显式调用必须能穿过真实打包器的摇树优化，恢复端不必创建插入工具。
registerMediaEditing();
