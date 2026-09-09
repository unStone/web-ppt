import sys,json
from pathlib import Path
import pymupdf as fitz

path=Path(sys.argv[1]);pdf=fitz.open(path);report=[]
assert len(pdf)==5
for i,page in enumerate(pdf):
  assert page.get_text().split()==['ABC'],page.get_text()
  assert not page.get_images()
  pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False);pix.save(path.with_name(f'markers-{i+1}.png'))
  reference=fitz.Pixmap(str(path.with_name(f'markers-reference-{i+1}.png')))
  if reference.alpha:reference=fitz.Pixmap(reference,0)
  a,b=pix.samples,reference.samples
  # 只核对蓝色图形，独立提取另查相邻文字；不把宿主系统字体差异混入箭头误差。
  points=[(x,y) for y in range(pix.height) for x in range(pix.width)
    if pix.pixel(x,y)[2]>pix.pixel(x,y)[0]+20 or reference.pixel(x,y)[2]>reference.pixel(x,y)[0]+20]
  mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c]) for x,y in points for c in range(3))/(len(points)*3)
  assert mae<8,(i,mae)
  paths=[d for d in page.get_drawings() if d['color'] or d['fill']!=(1,1,1)]
  assert len(paths)>=(15 if i==0 else 3),len(paths)
  report.append({'page':i+1,'ink_mae':mae,'vector_paths':len(paths)})
path.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n')
print('原生箭头：五种线端、曲线切线、组变换、退化 / 多子 / 闭合路径及零图片通过')
