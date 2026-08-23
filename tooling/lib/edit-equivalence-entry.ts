/** 只供 M0 独立进程指纹测试打包，确保两条链路使用同一份源码实现。 */
export { parse, renderSlideToSvg } from '../../packages/core/src/index';
export { createDoc, disposeDoc, toSlide } from '../../packages/edit-core/src/index';
