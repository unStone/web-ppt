import { applyParagraphProps, flattenTextBody, textBodyFromOverride } from '../text-model';
import { assertTextRange } from '../data-validation';
import { assertParagraphPropertyInput } from '../paragraph-property-schema';
import { hydrateInsertionResourceSource } from '../session-assets';
import type { EditDoc, ElementImageReplacement, ParagraphPropertyOverrides, TextOverride } from '../types';
import type { CommandPatches, ImageResourcePatch, SetParaPropsCommand } from './types';
import { createImageResource, MAX_REPLACE_IMAGE_BYTES } from './image-resource';
import { prepareBulletImageResource, resolveBulletImageResource } from './bullet-image-resource';
import { inverseTextPatch, setTextPatch, textTargetContext } from './text-target';

const SOURCE_RID = 'rIdBulletImageUpload';

function validate(command: SetParaPropsCommand): void {
  assertTextRange(command.range, 'SetParaProps.range');
  assertParagraphPropertyInput(command.props, 'SetParaProps.props');
}

export function setParaPropsPatches(
  doc: EditDoc,
  command: SetParaPropsCommand,
  origin: string,
): CommandPatches {
  validate(command);
  const target = { id: command.id, ...(command.cell !== undefined ? { cell: command.cell } : {}) };
  const { body: source, before, patchTarget, levelTemplate, record } = textTargetContext(doc, target);
  let props = command.props as ParagraphPropertyOverrides;
  let imageOverride: ElementImageReplacement | undefined;
  let imageResourcePatch: ImageResourcePatch | undefined;
  const bullet = command.props.bullet;
  if (bullet?.kind === 'blip' && 'bytes' in bullet.image) {
    const part = record.meta.origin?.part;
    if (!part || !doc.package) throw new Error(`图片项目符号缺少可写回来源：${record.id}`);
    const resource = createImageResource(
      bullet.image.bytes, bullet.image.mime, 'SetParaProps.props.bullet.image',
      MAX_REPLACE_IMAGE_BYTES,
    );
    const prepared = prepareBulletImageResource(doc, part, SOURCE_RID, resource, origin);
    imageOverride = prepared.image;
    imageResourcePatch = prepared.resourcePatch;
    props = {
      ...command.props,
      bullet: { ...bullet, image: { src: imageOverride.src } },
    };
  } else if (bullet?.kind === 'blip' && 'src' in bullet.image) {
    const imageSource = bullet.image.src;
    const current = before?.kind === 'flat' ? before.paragraphs
      .find((paragraph) => {
        const image = paragraph.bulletImageOverride;
        const resource = image && doc.imageResources[image.resourceHash];
        return image?.src === imageSource || !!resource
          && hydrateInsertionResourceSource(image.src, resource) === imageSource;
      })
      ?.bulletImageOverride : undefined;
    if (current && doc.imageResources[current.resourceHash]) imageOverride = current;
    else {
      const part = record.meta.origin?.part;
      if (!part || !doc.package) throw new Error(`图片项目符号缺少可写回来源：${record.id}`);
      const resource = resolveBulletImageResource(
        doc, imageSource, 'SetParaProps.props.bullet.image',
      );
      const prepared = prepareBulletImageResource(doc, part, SOURCE_RID, resource, origin);
      imageOverride = prepared.image;
      imageResourcePatch = prepared.resourcePatch;
    }
    props = {
      ...command.props,
      bullet: { ...bullet, image: { src: imageOverride.src } },
    };
  }
  const body = before?.kind === 'flat'
    ? textBodyFromOverride(before)
    : source;
  const value: TextOverride = applyParagraphProps(
    body, command.range, props, before?.kind === 'flat' ? before : undefined,
    levelTemplate, source, imageOverride,
  );
  const baseline = before?.kind === 'flat' ? before : flattenTextBody(body);
  if (JSON.stringify(value) === JSON.stringify(baseline)) return { forward: [], inverse: [] };
  const resourceInverse: ImageResourcePatch[] = imageResourcePatch ? [{
    op: 'del', path: imageResourcePatch.path, origin,
  }] : [];
  return {
    forward: [...(imageResourcePatch ? [imageResourcePatch] : []), setTextPatch(patchTarget, value, origin)],
    inverse: [inverseTextPatch(patchTarget, before, origin), ...resourceInverse],
  };
}
