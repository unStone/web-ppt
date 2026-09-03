import type { PresentationTheme, ThemeColorSlot } from '@web-ppt/core';
import type {
  GeneratedTemplateDesign, GeneratedTemplateLayout, GeneratedTemplateTextStyle,
} from '../generate/template';
import type { BuiltinTemplateCatalogItem, BuiltinTemplateId } from './types';

export interface BuiltinTemplateRecipe extends BuiltinTemplateCatalogItem, GeneratedTemplateDesign {}

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const pageNumber = { name: '页码', type: 'sldNum' as const, rect: rect(1120, 662, 96, 34), index: 12 };

function layouts(accent: 'accent1' | 'accent2'): readonly GeneratedTemplateLayout[] {
  return [
    {
      part: 1, type: 'title', name: '标题页',
      placeholders: [
        { name: '标题', type: 'ctrTitle', rect: rect(126, 184, 1028, 160) },
        { name: '副标题', type: 'subTitle', rect: rect(206, 370, 868, 94), index: 1 },
        pageNumber,
      ],
      decorations: [{
        name: '标题强调线', preset: 'rect', rect: rect(126, 354, 132, 7),
        fill: { slot: accent },
      }],
    },
    {
      part: 2, type: 'obj', name: '标题和内容',
      placeholders: [
        { name: '标题', type: 'title', rect: rect(80, 50, 1120, 92) },
        { name: '内容', type: 'body', rect: rect(96, 166, 1088, 446), index: 1 },
        pageNumber,
      ],
    },
    {
      part: 3, type: 'twoObj', name: '双内容',
      placeholders: [
        { name: '标题', type: 'title', rect: rect(80, 50, 1120, 92) },
        { name: '左侧内容', type: 'body', rect: rect(96, 166, 520, 446), index: 1 },
        { name: '右侧内容', type: 'body', rect: rect(664, 166, 520, 446), index: 2 },
        pageNumber,
      ],
    },
    {
      part: 4, type: 'secHead', name: '章节页',
      placeholders: [
        { name: '章节标题', type: 'title', rect: rect(126, 238, 1028, 132) },
        { name: '章节说明', type: 'body', rect: rect(206, 390, 868, 88), index: 1 },
        pageNumber,
      ],
      decorations: [{
        name: '章节强调块', preset: 'rect', rect: rect(80, 238, 16, 240),
        fill: { slot: accent },
      }],
    },
    { part: 5, type: 'blank', name: '空白', placeholders: [pageNumber] },
  ];
}

function theme(
  name: string,
  colors: PresentationTheme['colors'],
  major: string,
  minor: string,
): PresentationTheme {
  const collection = (latin: string) => ({ latin, ea: latin, cs: latin, scripts: {} });
  return { id: 'ppt/theme/theme1.xml', name, colors, fonts: { major: collection(major), minor: collection(minor) } };
}

const lightText = (color: ThemeColorSlot, font: 'major' | 'minor', size: number,
  extra: Partial<GeneratedTemplateTextStyle> = {}): GeneratedTemplateTextStyle => ({
  font, color: { slot: color }, size, ...extra,
});

export const BUILTIN_TEMPLATE_RECIPES: Readonly<Record<BuiltinTemplateId, BuiltinTemplateRecipe>> = {
  aurora: {
    id: 'aurora', name: '极光', description: '明亮留白与流动色彩',
    preview: {
      surface: '#F6F7FF', foreground: '#17223B', accent: '#6D5EF7', secondary: '#32C6B7', motif: 'orb',
    },
    theme: theme('极光', {
      dk1: 'rgb(23,34,59)', lt1: 'rgb(246,247,255)', dk2: 'rgb(48,55,90)', lt2: 'rgb(231,235,252)',
      accent1: 'rgb(109,94,247)', accent2: 'rgb(50,198,183)', accent3: 'rgb(255,145,112)',
      accent4: 'rgb(83,139,255)', accent5: 'rgb(191,114,255)', accent6: 'rgb(86,198,113)',
      hlink: 'rgb(70,91,220)', folHlink: 'rgb(142,83,183)',
    }, 'Aptos Display', 'Aptos'),
    masterBackground: { slot: 'lt1' },
    masterDecorations: [
      { name: '极光主光晕', preset: 'ellipse', rect: rect(1010, -170, 440, 440), fill: { slot: 'accent1', alpha: 0.14 } },
      { name: '极光次光晕', preset: 'ellipse', rect: rect(-130, 560, 300, 300), fill: { slot: 'accent2', alpha: 0.18 } },
    ],
    textStyles: {
      title: lightText('dk1', 'major', 38, { step: 1, bold: true }),
      body: lightText('dk1', 'minor', 22, { step: 1.25, bullet: true }),
      other: lightText('dk2', 'minor', 18, { step: 0.75 }),
    },
    layouts: layouts('accent1'), initialLayoutPart: 1,
  },
  editorial: {
    id: 'editorial', name: '刊页', description: '纸张质感与编辑式分栏',
    preview: {
      surface: '#F5F0E8', foreground: '#221F1A', accent: '#C94F37', secondary: '#D5A84B', motif: 'rule',
    },
    theme: theme('刊页', {
      dk1: 'rgb(34,31,26)', lt1: 'rgb(245,240,232)', dk2: 'rgb(73,65,55)', lt2: 'rgb(229,220,207)',
      accent1: 'rgb(201,79,55)', accent2: 'rgb(213,168,75)', accent3: 'rgb(67,121,112)',
      accent4: 'rgb(91,105,142)', accent5: 'rgb(151,92,111)', accent6: 'rgb(111,126,78)',
      hlink: 'rgb(44,91,139)', folHlink: 'rgb(121,72,118)',
    }, 'Georgia', 'Arial'),
    masterBackground: { slot: 'lt1' },
    masterDecorations: [
      { name: '刊页左栏', preset: 'rect', rect: rect(0, 0, 18, 720), fill: { slot: 'accent1' } },
      { name: '刊页页脚线', preset: 'line', rect: rect(80, 650, 1120, 1), stroke: { slot: 'accent2', width: 2 } },
    ],
    textStyles: {
      title: lightText('dk1', 'major', 36, { step: 1, bold: true }),
      body: lightText('dk2', 'minor', 21, { step: 1, bullet: true }),
      other: lightText('dk2', 'minor', 17, { step: 0.5 }),
    },
    layouts: layouts('accent1'), initialLayoutPart: 1,
  },
  midnight: {
    id: 'midnight', name: '夜幕', description: '深色画布与高对比光束',
    preview: {
      surface: '#101827', foreground: '#F7FAFF', accent: '#4ED7F1', secondary: '#9B8CFF', motif: 'beam',
    },
    theme: theme('夜幕', {
      dk1: 'rgb(16,24,39)', lt1: 'rgb(247,250,255)', dk2: 'rgb(31,43,64)', lt2: 'rgb(215,224,238)',
      accent1: 'rgb(78,215,241)', accent2: 'rgb(155,140,255)', accent3: 'rgb(255,111,145)',
      accent4: 'rgb(255,196,92)', accent5: 'rgb(75,139,255)', accent6: 'rgb(85,221,166)',
      hlink: 'rgb(99,202,255)', folHlink: 'rgb(189,148,255)',
    }, 'Arial', 'Arial'),
    masterBackground: { slot: 'dk1' },
    masterDecorations: [
      { name: '夜幕主光束', preset: 'rect', rect: rect(930, -210, 130, 700), fill: { slot: 'accent1', alpha: 0.16 }, rotation: 28 },
      { name: '夜幕次光束', preset: 'rect', rect: rect(1080, -160, 88, 620), fill: { slot: 'accent2', alpha: 0.2 }, rotation: 28 },
    ],
    textStyles: {
      title: lightText('lt1', 'major', 38, { step: 1, bold: true }),
      body: lightText('lt2', 'minor', 22, { step: 1.25, bullet: true }),
      other: lightText('lt2', 'minor', 18, { step: 0.75 }),
    },
    layouts: layouts('accent1'), initialLayoutPart: 1,
  },
};
