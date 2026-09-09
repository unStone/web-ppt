import { addressParts } from './workbook-range';

export function sharedCellAddress(key: string) {
  const separator = key.lastIndexOf('!');
  const sheet = decodeURIComponent(key.slice(0, separator)), address = key.slice(separator + 1);
  if (separator < 1 || !/^[A-Z]{1,3}[1-9]\d*$/.test(address)) throw new Error('共享单元格地址无效');
  return { sheet, ...addressParts(address) };
}
