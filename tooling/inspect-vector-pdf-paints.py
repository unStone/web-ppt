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
page=pdf[4]
assert not page.get_images(),page.get_images()
assert page.get_text().strip()=='AB',page.get_text()
# 文字渐变走 Pattern colorspace：Shading 包成 PatternType 2，Tj 前由 /Pattern cs /Ptn scn 设填充
assert any(pdf.xref_get_key(i,'PatternType')[1]=='2' for i in range(1,pdf.xref_length())),[pdf.xref_get_key(i,'PatternType') for i in range(1,min(pdf.xref_length(),60))]
assert b'/Pattern cs /Pt' in page.read_contents(),page.read_contents()[:200]
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
reference=fitz.Pixmap(str(path.with_name('paints-5-reference.png')))
if reference.alpha: reference=fitz.Pixmap(reference,0)
# 左侧字形红分量占优、右侧蓝分量占优：渐变按整段文字 x 范围分布
left,right=pix.pixel(88,120),pix.pixel(150,120)
assert left[0]>left[2]+40,(left,right)
assert right[2]>right[0]+40,(left,right)
a,b=pix.samples,reference.samples
mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c])
  for y in range(250) for x in range(360) for c in range(3))/(250*360*3)
pix.save(path.with_name('paints-5.png'))
assert mae<1,mae
print(f'文字渐变：Pattern colorspace 原生填充、左右色相与 Chrome/MuPDF 对照通过，MAE={mae:.4f}')
page=pdf[5]
assert not page.get_images(),page.get_images()
assert ''.join(page.get_text().split())=='bqio',page.get_text()
assert any(pdf.xref_get_key(i,'PatternType')[1]=='2' for i in range(1,pdf.xref_length()))
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
reference=fitz.Pixmap(str(path.with_name('paints-6-reference.png')))
if reference.alpha: reference=fitz.Pixmap(reference,0)
# 垂直渐变：同一字形上下取色依赖墨迹框 y（b 上伸部红、q 下伸部蓝）；
# 斜向渐变窄小，按窗口扫描：左上窗最红像素须红占优，右下窗最蓝像素须蓝占优
vertical=(pix.pixel(80,95),pix.pixel(145,150))
assert vertical[0][0]>vertical[0][2]+40 and vertical[1][2]>vertical[1][0]+40,vertical
def dominant(x0,x1,y0,y1,channel):
  best=None
  for y in range(y0,y1):
    for x in range(x0,x1):
      r,g,b=pix.pixel(x,y)
      score=r-b if channel=='r' else b-r
      if (255,255,255)!=(r,g,b) and (best is None or score>best[0]): best=(score,(r,g,b))
  return best
topLeft=dominant(518,546,90,116,'r'); bottomRight=dominant(552,582,124,144,'b')
assert topLeft and topLeft[0]>40,topLeft
assert bottomRight and bottomRight[0]>40,bottomRight
a,b=pix.samples,reference.samples
mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c])
  for y in range(250) for x in range(800) for c in range(3))/(250*800*3)
pix.save(path.with_name('paints-6.png'))
assert mae<1,mae
print(f'垂直与斜向文字渐变：字形墨迹框取色、色相断言与 Chrome/MuPDF 对照通过，MAE={mae:.4f}')
page=pdf[6]
assert not page.get_images(),page.get_images()
assert ''.join(page.get_text().split())=='Ab01',page.get_text()
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
reference=fitz.Pixmap(str(path.with_name('paints-7-reference.png')))
if reference.alpha: reference=fitz.Pixmap(reference,0)
# 多重渐变：两个 run 各自的渐变框（Chrome 对 tspan fill=url 按 tspan 分框，参考图已证）
# 第一 run 前半红、第二 run 头部蓝、第二 run 尾部红——三个窗口的色相可判别分框语义
def hue(x0,x1,channel):
  best=None
  for y in range(100,150):
    for x in range(x0,x1):
      r,g,b=pix.pixel(x,y)
      score=r-b if channel=='r' else b-r
      if (255,255,255)!=(r,g,b) and (best is None or score>best[0]): best=(score,(r,g,b))
  return best
firstRed=hue(105,140,'r'); secondBlue=hue(160,185,'b'); secondRed=hue(200,230,'r')
assert firstRed and firstRed[0]>40,firstRed
assert secondBlue and secondBlue[0]>40,secondBlue
assert secondRed and secondRed[0]>40,secondRed
a,b=pix.samples,reference.samples
mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c])
  for y in range(250) for x in range(360) for c in range(3))/(250*360*3)
pix.save(path.with_name('paints-7.png'))
# 分框语义由三窗色相断言承担；MAE 只作对照记录：两字窄 run 下墨迹框边界的
# 亚像素差（pathBounds 曲线保守 vs Chrome ink bbox）被窄框放大，阈值放到 2
assert mae<2,mae
print(f'多重文字渐变：run 分框色相断言通过，Chrome/MuPDF 对照 MAE={mae:.4f}（窄 run 亚像素框差）')
page=pdf[7]
assert not page.get_images(),page.get_images()
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
reference=fitz.Pixmap(str(path.with_name('paints-8-reference.png')))
if reference.alpha: reference=fitz.Pixmap(reference,0)
# 渐变 + 下划线：装饰色继承渐变（同一 Pattern 走描边色彩空间），线左端红右端蓝
def underlineHue(x0,x1,channel):
  best=None
  for y in range(132,150):
    for x in range(x0,x1):
      r,g,b=pix.pixel(x,y)
      score=r-b if channel=='r' else b-r
      if (255,255,255)!=(r,g,b) and (best is None or score>best[0]): best=(score,(r,g,b))
  return best
leftRed=underlineHue(72,100,'r'); rightBlue=underlineHue(125,152,'b')
assert leftRed and leftRed[0]>40,leftRed
assert rightBlue and rightBlue[0]>40,rightBlue
a,b=pix.samples,reference.samples
mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c])
  for y in range(250) for x in range(360) for c in range(3))/(250*360*3)
pix.save(path.with_name('paints-8.png'))
assert mae<1,mae
print(f'渐变下划线：装饰线继承渐变（Pattern 描边）、两端色相与 Chrome/MuPDF 对照通过，MAE={mae:.4f}')
