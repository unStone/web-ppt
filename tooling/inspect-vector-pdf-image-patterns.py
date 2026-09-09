import sys,json
from pathlib import Path
import pymupdf as fitz

path=Path(sys.argv[1]);pdf=fitz.open(path);report=[]
assert len(pdf)==5
images=[i for i in range(1,pdf.xref_length()) if pdf.xref_get_key(i,'Subtype')==('name','/Image')]
assert len(images)==2,images
rgb_id=next(i for i in images if pdf.xref_get_key(i,'ColorSpace')==('name','/DeviceRGB'))
alpha_id=int(pdf.xref_get_key(rgb_id,'SMask')[1].split()[0])
assert all(pdf.xref_get_key(i,'Width')==('int','128') and pdf.xref_get_key(i,'Height')==('int','96') for i in images)
rgb,alpha=pdf.xref_stream(rgb_id),pdf.xref_stream(alpha_id)
assert len(rgb)==128*96*3 and len(alpha)==128*96
for y in range(96):
  for x in range(128):
    expected=((240,30,20,128) if x<64 else (20,70,240,255)) if y<48 else ((40,180,60,255) if x<64 else (220,180,40,0))
    at=y*128+x
    assert (*rgb[at*3:at*3+3],alpha[at])==expected,(x,y)
red=(247,121,49);blue=(20,70,240);green=(40,180,60);yellow=(255,213,79)
samples=[[(85,70,red),(175,70,blue),(85,130,green),(175,130,yellow)],
  [(66,46,red),(98,46,blue),(130,46,red),(286,46,red),(318,46,blue),(350,46,blue),(382,46,red),
   (66,181,red),(66,205,green),(66,229,green),(66,253,red),(350,229,yellow)],[],
  [(32,24,(247,142,137)),(96,24,blue),(32,72,green),(96,72,(255,255,255)),(160,24,(247,142,137))]]
for i,page in enumerate(pdf):
  assert page.get_text().split()==['ABC'],page.get_text()
  if i==4:assert not page.get_images() and not page.get_xobjects()
  pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False);pix.save(path.with_name(f'image-patterns-{i+1}.png'))
  if i<len(samples):
    for x,y,color in samples[i]:
      pixel=pix.pixel(round(x*1.5),round(y*1.5))
      assert max(abs(a-b) for a,b in zip(pixel,color))<=2,(i,x,y,pixel,color)
  path.with_name(f'image-patterns-reader-{i+1}.svg').write_text(page.get_svg_image(text_as_path=False))
  if '--prepare' in sys.argv or i==4:continue
  reference=fitz.Pixmap(str(path.with_name(f'image-patterns-reference-{i+1}.png')))
  if reference.alpha:reference=fitz.Pixmap(reference,0)
  reader=fitz.Pixmap(str(path.with_name(f'image-patterns-reader-{i+1}.png')))
  if reader.alpha:reader=fitz.Pixmap(reader,0)
  a,b,c=pix.samples,reference.samples,reader.samples
  background=yellow if i<3 else (255,255,255)
  # 图形实占区域取三个结果的并集，空白或均匀背景不稀释错位；文字在此区域以外另查原文。
  points=[(x,y) for y in range(410) for x in range(pix.width)
    if any(max(abs(p[k]-background[k]) for k in range(3))>3 for p in [pix.pixel(x,y),reference.pixel(x,y),reader.pixel(x,y)])]
  raster_mae=sum(abs(a[(y*pix.width+x)*3+k]-b[(y*pix.width+x)*3+k]) for x,y in points for k in range(3))/(len(points)*3)
  vector_mae=sum(abs(c[(y*pix.width+x)*3+k]-b[(y*pix.width+x)*3+k]) for x,y in points for k in range(3))/(len(points)*3)
  assert vector_mae<1,(i,vector_mae)
  report.append({'page':i+1,'reader_svg_mae':vector_mae,'pdf_raster_mae':raster_mae,'paint_pixels':len(points)})
if '--prepare' in sys.argv:sys.exit()
path.with_suffix('.json').write_text(json.dumps({'originalRgbaPixels':128*96,'imageObjects':len(images),'pages':report},indent=2)+'\n')
print('图片填充：原始 RGBA、偏移 / 翻转 / 裁剪、跨页资源复用及独立读取对照通过')
