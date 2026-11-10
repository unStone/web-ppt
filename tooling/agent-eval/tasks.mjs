import assert from 'node:assert/strict';

export const FONT_FAMILY = 'WebPPT Template Fill Latin';
export const TITLE_NAME = 'Evaluation title';
export const EXPECTED_TITLE = 'Approved quarterly report';
const kinds = [
  'clean',
  'text-overflow',
  'element-overlap',
  'off-canvas',
  'low-contrast',
  'missing-font',
  'placeholder-prompt-left',
  'image-distorted',
];

export const TASKS = Object.freeze(
  kinds.map((kind, index) => {
    const id = `case-${String(index + 1).padStart(2, '0')}`;
    return Object.freeze({
      version: 1,
      id,
      kind,
      expectedTitle: EXPECTED_TITLE,
      titleName: TITLE_NAME,
      fontFamily: FONT_FAMILY,
      minFontSize: 12,
      fixtureName: `${id}-input.pptx`,
      referenceName: `${id}-reference.pptx`,
    });
  }),
);

export function getTask(id) {
  const task = TASKS.find((item) => item.id === id);
  assert(task, `Unknown Agent evaluation task: ${String(id)}`);
  return task;
}

export function createTaskPrompt(id, paths) {
  const task = getTask(id);
  assert(paths && typeof paths === 'object' && !Array.isArray(paths), 'Task prompt paths must contain inputPath and outputPath');
  const { inputPath, outputPath } = paths;
  assert(typeof inputPath === 'string' && inputPath.trim(), 'inputPath must be a nonempty local path');
  assert(typeof outputPath === 'string' && outputPath.trim(), 'outputPath must be a nonempty local path');
  assert.notEqual(inputPath, outputPath, 'inputPath and outputPath must be different');
  return `Use only the provided PowerPoint MCP tools for this task.
Open ${JSON.stringify(inputPath)} and change the complete text of the object named ${JSON.stringify(task.titleName)} to ${JSON.stringify(task.expectedTitle)}.
Preserve every other original word and all original image bytes and image crop values. Preserve the number, identities, visibility, and order of all slides and objects. Keep all original text visible with opaque foreground text colors. Do not add, remove, hide, or replace objects, and do not change themes, masters, or layouts.
You may adjust object positions and sizes, text font families, text sizes, and foreground text colors to make all seven layout checks report zero issues. Keep font sizes at least ${task.minFontSize} px and use only the actually registered font family ${JSON.stringify(task.fontFamily)}. Keep each image at least half its original displayed area and preserve its entire image without cropping.
Optional previews may be written only inside the render directory, for example "render/preview.svg" or "render/preview.png"; you may omit the render path to receive inline data.
Save the edited presentation to ${JSON.stringify(outputPath)}, verify the saved presentation can be reopened with all seven checks reporting zero issues, then close your sessions. Do not read other files or use any non-MCP tools.`;
}
