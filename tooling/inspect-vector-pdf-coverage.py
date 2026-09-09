import sys,json
from pathlib import Path
import pymupdf as fitz

path=Path(sys.argv[1]);pdf=fitz.open(path);report=[]
assert len(pdf)==6
for i,page in enumerate(pdf):
  assert page.get_text().split()==(['ABC','ABC'] if i in [3,5] else ['ABC']),page.get_text()
  assert len(page.get_images())==(1 if i<2 else 0)
  pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
  pix.save(path.with_name(f'coverage-{i+1}.png'))
  reference=fitz.Pixmap(str(path.with_name(f'coverage-reference-{i+1}.png')))
  if reference.alpha:reference=fitz.Pixmap(reference,0)
  # 只比较目标对象；邻居文字的可搜索性已由独立读取器单独检查。
  a,b=pix.samples,reference.samples
  region=(45,45,405,255)
  if i in [3,5]:
    # 表格文字的字体抗锯齿另有控制组；这里固定四条原生边线的位置和颜色。
    assert len([d for d in page.get_drawings() if d['type']=='s'])==(4 if i==3 else 3)
    points=[(60,120),(330,120),(160,60)]+([(160,210)] if i==3 else [])
    for x,y in points:
      assert pix.pixel(x,y)[2]>150 and pix.pixel(x,y)[0]<50,(x,y,pix.pixel(x,y))
    if i==5:
      assert all(pix.pixel(x,60)[2]>150 and pix.pixel(x,60)[0]<50 for x in range(65,326))
      assert all(min(pix.pixel(x,210))>250 for x in range(65,326))
    report.append({'page':i+1,'native_lines':4 if i==3 else 3,'zero_width_and_dash':i==5})
    continue
  x1,y1,x2,y2=region
  mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c])
    for y in range(y1,y2) for x in range(x1,x2) for c in range(3))/((y2-y1)*(x2-x1)*3)
  assert mae<1,mae
  if i==2:
    report.append({'page':i+1,'object_mae':mae,'native_arrow':True});continue
  if i==4:
    assert any(item[0]=='c' for d in page.get_drawings() for item in d['items'])
    report.append({'page':i+1,'object_mae':mae,'native_circle':True});continue
  image=page.get_images()[0];bbox=page.get_image_rects(image[0])[0]
  assert bbox.x1<300 and bbox.width<200,bbox
  report.append({'page':i+1,'object_mae':mae,'image_bbox':list(bbox)})
path.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n')
print('SVG 覆盖：对象回退、相邻可搜索文字、原生表格 / 圆形、零线宽及全零虚线通过')
