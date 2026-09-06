/** CDP 原生点击必须经历 pointer capture；dispatchEvent 的 dblclick 不能覆盖这条路径。 */
export async function doubleClickAt({ request }, point) {
  for (const clickCount of [1, 2]) {
    await request('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount, ...point });
    await request('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount, ...point });
  }
}

export async function doubleClickElement(context, selector) {
  const point = await context.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await doubleClickAt(context, point);
}
