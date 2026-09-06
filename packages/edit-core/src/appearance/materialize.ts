import type { EditElementXml } from '../save/extension-elements';
import type { Shape3D } from '@web-ppt/core';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import type { XmlDocument, XmlElement } from '../xml/types';
import type { ElementRecord } from '../types';
import { normalizePicture, normalizeScene, sourcePicture, sourceScene } from './values';
import type { AppearanceState, PictureFx } from './types';

export function materializeAppearance(tree: XmlDocument, record: ElementRecord, generated: boolean, xml: EditElementXml): void {
  const { findXmlChild, xmlElementChildren, removeXmlChild, insertXmlChildUnchecked,
    setXmlAttribute, insertXmlInOrder, locateElementHost, namespacedElement, appendDrawingColor } = xml;
  const child = (parent: XmlElement, name: string, ns = DRAWINGML_NS) =>
    findXmlChild(parent, { localName: name, namespaceUri: ns });
  const emu = (value: number) => String(Math.round(value * 9525));
  function add(parent: XmlElement, name: string, attrs: Record<string, string> = {}): XmlElement {
    const node = namespacedElement(parent, DRAWINGML_NS, name);
    for (const [key, value] of Object.entries(attrs)) setXmlAttribute(node, key, value);
    insertXmlChildUnchecked(parent, node, child(parent, 'extLst'));
    return node;
  }

  function materializePicture(host: XmlElement, effects: PictureFx): void {
    const fill = child(host, 'blipFill', PRESENTATIONML_NS);
    const blip = fill && child(fill, 'blip');
    if (!blip) throw new Error('图片缺少可写回的 blip');
    for (const node of xmlElementChildren(blip)) {
      if (node.namespaceUri === DRAWINGML_NS && ['alphaModFix', 'grayscl', 'duotone'].includes(node.localName)) {
        removeXmlChild(blip, node);
      }
    }
    if (effects.alpha !== undefined && effects.alpha < 1) add(blip, 'alphaModFix', { amt: String(Math.round(effects.alpha * 100000)) });
    if (effects.grayscale) add(blip, 'grayscl');
    if (effects.duotone) {
      const duo = add(blip, 'duotone');
      effects.duotone.forEach((color) => appendDrawingColor(duo, color));
    }
  }

  function materializeScene(host: XmlElement, scene: Shape3D): void {
    const properties = child(host, 'spPr', PRESENTATIONML_NS);
    if (!properties) throw new Error('立体形状缺少 spPr');
    // 该命令替换立体设置；邻接的填充、二维效果与宿主扩展仍原样保留。
    for (const name of ['scene3d', 'sp3d']) {
      const old = child(properties, name);
      if (old) removeXmlChild(properties, old);
    }
    if (!Object.keys(scene).length) return;
    const sceneNode = namespacedElement(properties, DRAWINGML_NS, 'scene3d');
    insertXmlInOrder(properties, sceneNode);
    const camera = add(sceneNode, 'camera', { prst: 'orthographicFront' });
    if (scene.rotX !== undefined || scene.rotY !== undefined) add(camera, 'rot', {
      lat: String(Math.round((scene.rotY ?? 0) * 60000)), lon: '0', rev: String(Math.round((scene.rotX ?? 0) * 60000)),
    });
    add(sceneNode, 'lightRig', { rig: 'threePt', dir: 't' });
    const shape = namespacedElement(properties, DRAWINGML_NS, 'sp3d');
    insertXmlInOrder(properties, shape);
    if (scene.extrusion !== undefined) setXmlAttribute(shape, 'extrusionH', emu(scene.extrusion));
    if (scene.contourWidth !== undefined) setXmlAttribute(shape, 'contourW', emu(scene.contourWidth));
    if (scene.material) setXmlAttribute(shape, 'prstMaterial', scene.material);
    if (scene.bevelTop !== undefined) add(shape, 'bevelT', { w: emu(scene.bevelTop), h: emu(scene.bevelTop), prst: 'circle' });
    if (scene.bevelBottom !== undefined) add(shape, 'bevelB', { w: emu(scene.bevelBottom), h: emu(scene.bevelBottom), prst: 'circle' });
    if (scene.extrusionColor) appendDrawingColor(add(shape, 'extrusionClr'), scene.extrusionColor);
    if (scene.contourColor) appendDrawingColor(add(shape, 'contourClr'), scene.contourColor);
  }


  const state = record.ovr.extensions?.appearance as AppearanceState | undefined;
  const picture = record.src.kind === 'image' && (state?.picture !== undefined || generated);
  const scene = record.src.kind === 'shape' && (state?.scene !== undefined || generated && record.src.scene3d);
  if (!picture && !scene) return;
  const { host } = locateElementHost(tree, record);
  if (picture && record.src.kind === 'image') materializePicture(host, state?.picture !== undefined
    ? normalizePicture(JSON.parse(state.picture)) : sourcePicture(record.src));
  if (scene) materializeScene(host, state?.scene !== undefined
    ? normalizeScene(JSON.parse(state.scene)) : sourceScene(record.src.scene3d));
}
