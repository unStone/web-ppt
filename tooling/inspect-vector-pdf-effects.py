import sys
from pathlib import Path
import pymupdf as fitz

path=Path(sys.argv[1])
pdf=fitz.open(path)
page=pdf[0]
assert page.get_text().strip()=='ABC',page.get_text()
images=page.get_image_info()
assert len(images)==1,images
image=images[0]
# 阴影不能裁到形状边界，也不能把相邻文字所在的整页包进图片。
x0,y0,x1,y1=image['bbox']
assert 0 < x0 < 30 and 0 < y0 < 30 and 150 < x1 < 190 and 105 < y1 < 150,image
assert image['width'] < 400 and image['height'] < 300,image
assert len(page.get_fonts())==1
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
pix.save(path.with_suffix('.png'))
reference=fitz.Pixmap(str(path.with_name('effects-reference.png')))
if reference.alpha: reference=fitz.Pixmap(reference,0)
a,b=pix.samples,reference.samples
assert pix.width==reference.width and pix.height==reference.height and pix.n==reference.n==3
mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c])
  for y in range(300) for x in range(400) for c in range(3))/(300*400*3)
assert mae < 1,mae
print(f'对象级回退：阴影边界、相邻可搜索文字及 Chrome/MuPDF 对照通过，MAE={mae:.4f}')
page=pdf[1]
assert page.get_text().strip()=='ABC',page.get_text()
images=page.get_image_info()
assert len(images)==1,images
assert images[0]['bbox'][0] > 150 and images[0]['bbox'][2] < 400,images
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
pix.save(path.with_name('effects-group.png'))
reference=fitz.Pixmap(str(path.with_name('effects-group-reference.png')))
if reference.alpha: reference=fitz.Pixmap(reference,0)
a,b=pix.samples,reference.samples
mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c])
  for y in range(60,400) for x in range(300,760) for c in range(3))/(340*460*3)
assert mae < 1,mae
print(f'组内文字回退：旋转、缩放及真实字体 Chrome/MuPDF 对照通过，MAE={mae:.4f}')
page=pdf[2]
assert page.get_text().strip()=='ABC',page.get_text()
assert len(page.get_image_info())==1,page.get_image_info()
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
pix.save(path.with_name('effects-image.png'))
reference=fitz.Pixmap(str(path.with_name('effects-image-reference.png')))
if reference.alpha: reference=fitz.Pixmap(reference,0)
a,b=pix.samples,reference.samples
mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c])
  for y in range(380) for x in range(400) for c in range(3))/(380*400*3)
assert mae < 1,mae
print(f'图片回退：源图片、裁剪及阴影 Chrome/MuPDF 对照通过，MAE={mae:.4f}')
page=pdf[3]
assert page.get_text().strip()=='ABC',page.get_text()
assert len(page.get_image_info())==1,page.get_image_info()
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
pix.save(path.with_name('effects-css.png'))
for point,expected in [((125,120),(154,154,154)),((240,120),(18,18,18)),((125,240),(182,182,182))]:
  assert max(abs(a-b) for a,b in zip(pix.pixel(*point),expected))<=2,(point,pix.pixel(*point))
reference=fitz.Pixmap(str(path.with_name('effects-css-reference.png')))
if reference.alpha: reference=fitz.Pixmap(reference,0)
a,b=pix.samples,reference.samples
mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c])
  for y in range(380) for x in range(400) for c in range(3))/(380*400*3)
assert mae<1,mae
print(f'图片 CSS 滤镜：灰度、透明叠加、相邻可搜索文字和 Chrome/MuPDF 对照通过，MAE={mae:.4f}')
