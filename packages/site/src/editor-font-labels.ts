import type {FontProblem} from '@web-ppt/fonts/glyphs';
import {message} from './i18n/message';
import type {Message} from './i18n/messages';

const reasons = {
  'font-bytes-unavailable':'没有可用的字体字节','face-unavailable':'没有可用的字体字节',
  'provider-disposed':'字体服务已关闭','invalid-font':'字体结构损坏或不受支持',
  'aborted':'字体请求已取消','duplicate-face-id':'字体名称或样式不唯一','ambiguous-face':'字体名称或样式不唯一',
  'resource-limit':'超过字体或文字处理预算，请缩小输入','embedding-restricted':'字体许可不允许嵌入',
  'preview-print-only':'字体仅允许预览和打印，不能用于编辑','bitmap-only':'字体只允许位图，不能输出轮廓',
  'cmap-not-supported':'字体结构损坏或不受支持','missing-glyphs':'字体不包含部分字符',
  'unsupported-script':'暂不支持这种文字脚本','unsupported-direction':'暂不支持双向或从右到左整形',
  'script-mismatch':'文字或脚本参数无效','invalid-text':'文字或脚本参数无效','invalid-request':'文字或脚本参数无效',
  'shaper-unavailable':'字形引擎无法完成请求，请重试','shaper-failed':'字形引擎无法完成请求，请重试',
  'invalid-glyph-id':'字形引擎无法完成请求，请重试','measurement-not-prepared':'字形引擎无法完成请求，请重试',
  'layout-failed':'字形引擎无法完成请求，请重试',
  'needs-container-decoder':'请提供静态单字体 TTF 文件','collection-not-supported':'请提供静态单字体 TTF 文件',
  'variable-not-supported':'请提供静态单字体 TTF 文件','cff-not-supported':'请提供静态单字体 TTF 文件',
  'color-font-not-supported':'请提供静态单字体 TTF 文件','decoder-unavailable':'嵌入字体无法解码','decode-failed':'嵌入字体无法解码',
  'eot-root-restricted':'嵌入字体存在站点或容器限制','eot-feature-not-supported':'嵌入字体存在站点或容器限制',
  'subset-not-permitted':'字体不允许子集化，需要完整字体','unsupported-layout':'暂不支持竖排、艺术字、公式或小型大写的字形检查',
  'face-style-mismatch':'缺少对应字重或斜体，请提供实际字体文件','font-install-failed':'浏览器无法安装该字体',
} satisfies Record<FontProblem,Message>;

export const fontProblemMessage = (reason: string) => message(Object.prototype.hasOwnProperty.call(reasons,reason)
  ? reasons[reason as FontProblem] : '字形引擎无法完成请求，请重试');
