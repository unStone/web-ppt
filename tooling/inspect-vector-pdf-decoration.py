import sys,json
from pathlib import Path
import pymupdf as fitz

path=Path(sys.argv[1])
pdf=fitz.open(path)
page=pdf[0]
assert page.get_text().split()==['ABC']*4,page.get_text()
assert not page.get_images()
lines=[d for d in page.get_drawings() if d['type']=='s']
assert len(lines)==4,lines
blue=[d for d in lines if d['color'][2]>.7]
assert len(blue)==2,blue
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
pix.save(path.with_suffix('.png'))
reference=fitz.Pixmap(str(path.with_name('decoration-reference.png')))
if reference.alpha: reference=fitz.Pixmap(reference,0)
assert any(reference.pixel(120,y)[2]>reference.pixel(120,y)[0]+30 for y in range(152,165)), '原生 SVG 必须保留下划线颜色'
a,b=pix.samples,reference.samples
# 原生字体的像素抗锯齿本身有差异，先记录同页普通文字控制组，再独立核对装饰线。
differences=[]
for left,top in [(60,100),(60,280),(540,100),(540,280)]:
  mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c])
    for y in range(top,top+70) for x in range(left,left+150) for c in range(3))/(70*150*3)
  differences.append(mae)
def line_metrics(image,x,start,end,color):
  values=[max(0,min(1,(255-image.pixel(x,y)[0])/(255-color[0]))) for y in range(start,end)]
  thickness=sum(values)
  return thickness,sum(value*(start+i+.5) for i,value in enumerate(values))/thickness
metrics=[]
for x,start,end,color in [(109,152,165,(21,101,192)),(589,332,345,(21,101,192)),(109,305,321,(0,0,0)),(589,305,321,(0,0,0))]:
  actual=line_metrics(pix,x,start,end,color);expected=line_metrics(reference,x,start,end,color)
  assert abs(actual[0]-expected[0])<.3,(actual,expected)
  assert abs(actual[1]-expected[1])<.5,(actual,expected)
  metrics.append({'pdf':actual,'chrome':expected})
path.with_suffix('.json').write_text(json.dumps({'text_regions_mae':differences,'line_metrics':metrics},indent=2)+'\n')
page=pdf[1]
assert page.get_text().split()==['q̇']*2,page.get_text()
assert not page.get_images()
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
pix.save(path.with_name('decoration-descenders.png'))
reference=fitz.Pixmap(str(path.with_name('decoration-descenders-reference.png')))
# 同页普通 q 的实心下伸部提供独立位置，避免将字体抗锯齿差异当作装饰线颜色错误。
crossings=[(x,y) for y in range(154,159) for x in range(75,115)
  if max(reference.pixel(x+480,y)[:3])<20 and max(pix.pixel(x+480,y))<20]
assert len(crossings)>=3,crossings
for x,y in crossings:
  assert max(reference.pixel(x,y)[:3])<20,(x,y,reference.pixel(x,y))
  assert max(pix.pixel(x,y))<20,(x,y,pix.pixel(x,y))
path.with_name('decoration-descenders.json').write_text(json.dumps({'solid_descender_crossings':len(crossings)},indent=2)+'\n')
print('文字装饰：可搜索原文、矢量装饰线、颜色 / 线位 / 粗细及下伸部交叠顺序通过')
