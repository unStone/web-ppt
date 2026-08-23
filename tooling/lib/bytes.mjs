export function equalBytes(left, right) {
  return !!left && !!right && left.length === right.length
    && left.every((value, index) => value === right[index]);
}
