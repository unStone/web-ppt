import sys
from pathlib import Path
import pymupdf as fitz

path=Path(sys.argv[1])
pdf=fitz.open(path)
page=pdf[0]
assert page.get_text().strip()=='ABC',page.get_text()
assert not page.get_images()
drawings=page.get_drawings()
transparent=next(d for d in drawings if abs(d['rect'].x0-30)<0.01)
assert abs(transparent['fill_opacity']-.5)<0.0001,transparent
assert abs(transparent['stroke_opacity']-.25)<0.0001,transparent
opaque=next(d for d in drawings if abs(d['rect'].x0-210)<0.01)
assert opaque['fill_opacity']==1,opaque
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
for point,expected in [((150,120),(255,128,128)),((150,57),(191,191,255)),((150,63),(191,95,159)),((450,120),(255,0,0))]:
  actual=pix.pixel(*point)
  assert max(abs(a-b) for a,b in zip(actual,expected))<=1,(point,actual,expected)
reference=fitz.Pixmap(str(path.with_name('paints-1-reference.png')))
if reference.alpha: reference=fitz.Pixmap(reference,0)
a,b=pix.samples,reference.samples
mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c])
  for y in range(250) for x in range(620) for c in range(3))/(250*620*3)
assert mae<1,mae
pix.save(path.with_name('paints-1.png'))
print(f'矢量透明填充及描边：独立 alpha、相邻不透明对象和 Chrome/MuPDF 对照通过，MAE={mae:.4f}')
page=pdf[1]
assert not page.get_images()
shadings=[pdf.xref_get_key(i,'ShadingType')[1] for i in range(1,pdf.xref_length())]
assert shadings.count('2')>=1 and shadings.count('3')==1,shadings
assert [item[0] for item in page.get_bboxlog()].count('fill-shade')==2,page.get_bboxlog()
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
reference=fitz.Pixmap(str(path.with_name('paints-2-reference.png')))
if reference.alpha: reference=fitz.Pixmap(reference,0)
a,b=pix.samples,reference.samples
mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c])
  for y in range(380) for x in range(800) for c in range(3))/(380*800*3)
pix.save(path.with_name('paints-2.png'))
assert mae<1,mae
print(f'矢量线性和径向渐变：原生 Shading、多色标、曲线路径及旋转 Chrome/MuPDF 对照通过，MAE={mae:.4f}')
page=pdf[2]
assert not page.get_images()
assert any(pdf.xref_get_key(i,'SMask/S')==('name','/Luminosity') for i in range(1,pdf.xref_length()))
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
reference=fitz.Pixmap(str(path.with_name('paints-3-reference.png')))
if reference.alpha: reference=fitz.Pixmap(reference,0)
for point,expected in [((560,120),(255,0,0)),((580,120),(0,0,255))]:
  assert pix.pixel(*point)==expected,(point,pix.pixel(*point))
a,b=pix.samples,reference.samples
mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c])
  for y in range(260) for x in range(800) for c in range(3))/(260*800*3)
pix.save(path.with_name('paints-3.png'))
assert mae<1,mae
print(f'矢量透明渐变：灰度软蒙版、相同位置色标的硬切换与 Chrome/MuPDF 对照通过，MAE={mae:.4f}')
page=pdf[3]
images=page.get_images()
assert len(images)==1 and images[0][2:4]==(8,8),images
mask=fitz.Pixmap(pdf,images[0][1])
assert mask.pixel(0,0)==(128,) and mask.pixel(7,0)==(255,) and mask.pixel(7,7)==(0,)
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
for point,expected in [((125,120),(255,191,191)),((240,120),(128,128,255)),((125,240),(128,255,128)),((240,240),(255,255,255)),((450,120),(255,0,0))]:
  actual=pix.pixel(*point)
  assert max(abs(a-b) for a,b in zip(actual,expected))<=1,(point,actual,expected)
pix.save(path.with_name('paints-4.png'))
print('图片透明度：保留 8×8 原始像素及源 alpha，叠加对象透明度且不影响相邻对象')
