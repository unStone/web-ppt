import type { ShapeCreationDefaults, TableCell, TableCreationDefaults, TextBody } from '@web-ppt/core';

const shapeText: TextBody = {
  anchor: 'middle', insets: [4.8, 9.6, 4.8, 9.6], wrap: true, fontScale: 1,
  paragraphs: [{
    align: 'center', lvl: 0, marL: 0, indent: 0, bullet: null,
    lineHeight: null, spaceBefore: 0, spaceAfter: 0,
    runs: [{
      text: '', b: false, i: false, u: false, strike: false,
      size: 18, color: '#FFFFFF', fonts: [],
    }],
  }],
};

const tableText: TextBody = {
  anchor: 'top', insets: [4.8, 9.6, 4.8, 9.6], wrap: true, fontScale: 1,
  paragraphs: [{
    align: 'left', lvl: 0, marL: 0, indent: 0, bullet: null,
    lineHeight: null, spaceBefore: 0, spaceAfter: 0,
    runs: [{
      text: '', b: false, i: false, u: false, strike: false,
      size: 18, color: '#000000', fonts: [],
    }],
  }],
};

const border = { color: 'rgba(0,0,0,0.25)', width: 1, dash: null } as const;
const tableCell: TableCell = {
  colSpan: 1, rowSpan: 1, merged: false,
  fill: { type: 'solid', color: '#FFFFFF' }, text: null,
  borders: { l: border, r: border, t: border, b: border },
  editInfo: { textTemplate: tableText },
};

/** `.ppt` 没有 OOXML 主题创建默认值；生成包因此用与固定骨架配套的显式中性值。 */
export const GENERATED_SHAPE_DEFAULTS: ShapeCreationDefaults = {
  fill: { type: 'solid', color: '#4472C4' },
  stroke: { color: '#2F5597', width: 1.5, dash: null },
  textTemplate: shapeText,
  // 生成路径直接写已求值的样式，不消费增量宿主 XML。
  styleMarkup: '', textBodyMarkup: '',
};

export const GENERATED_TABLE_DEFAULTS: TableCreationDefaults = {
  textBodyMarkup: '', cellPropertiesMarkup: ['', '', ''],
  firstRow: tableCell, bandRows: [tableCell, tableCell],
};
