import { setShape3DRenderer } from '@web-ppt/core';
import { renderShape3D } from './three-d/mesh';
export { renderShape3D };
export { createCamera, cameraAngles } from './three-d/camera';
export function enableThreeD(): void { setShape3DRenderer(renderShape3D); }
