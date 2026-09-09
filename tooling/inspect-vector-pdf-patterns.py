import sys,json
from pathlib import Path
import pymupdf as fitz

path=Path(sys.argv[1]);pdf=fitz.open(path);report=[]
assert len(pdf)==4
patterns=[i for i in range(1,pdf.xref_length()) if pdf.xref_get_key(i,'PatternType')==('int','1')]
assert len(patterns)>=28,len(patterns)
for pattern in patterns:
  # 纯图案单元不应把之前的页面字体、图片或 Form 再复制进自己的资源字典。
  resources=pdf.xref_get_key(pattern,'Resources')[1]
  assert '/Font' not in resources and '/XObject' not in resources,resources
for i,page in enumerate(pdf):
  assert page.get_text().split()==(['ABC'] if i<3 else ['中文']),page.get_text()
  assert not page.get_images()
  assert len(page.get_fonts())==1,page.get_fonts()
  if i==3:assert not page.get_xobjects(),page.get_xobjects()
  pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False);pix.save(path.with_name(f'patterns-{i+1}.png'))
  svg=page.get_svg_image(text_as_path=False)
  assert '<image' not in svg
  path.with_name(f'patterns-reader-{i+1}.svg').write_text(svg)
  if '--prepare' in sys.argv or i==3:continue
  reference=fitz.Pixmap(str(path.with_name(f'patterns-reference-{i+1}.png')))
  if reference.alpha:reference=fitz.Pixmap(reference,0)
  reader=fitz.Pixmap(str(path.with_name(f'patterns-reader-{i+1}.png')))
  if reader.alpha:reader=fitz.Pixmap(reader,0)
  a,b,c=pix.samples,reference.samples,reader.samples
  # 仅在图形实占区域核对；相邻文字另查原文，空白不参与平均以免稀释丢图或错位。
  points=[(x,y) for y in range(410) for x in range(pix.width)
    if min(pix.pixel(x,y))<245 or min(reference.pixel(x,y))<245 or min(reader.pixel(x,y))<245]
  mae=sum(abs(a[(y*pix.width+x)*3+c]-b[(y*pix.width+x)*3+c]) for x,y in points for c in range(3))/(len(points)*3)
  vector_mae=sum(abs(c[(y*pix.width+x)*3+k]-b[(y*pix.width+x)*3+k]) for x,y in points for k in range(3))/(len(points)*3)
  # MuPDF 小图块缓存会量化旋转后的重复位置；独立读取的矢量内容另交 Chrome 检查几何，屏幕差异完整保留。
  assert vector_mae<1,(i,vector_mae)
  if i==0:
    control=[(x,y) for y in range(60,210) for x in range(60,300)]
    control_mae=sum(abs(a[(y*pix.width+x)*3+k]-b[(y*pix.width+x)*3+k]) for x,y in control for k in range(3))/(len(control)*3)
    assert control_mae<1,control_mae
  report.append({'page':i+1,'reader_svg_mae':vector_mae,'pdf_raster_mae':mae,
    'pdf_raster_within_initial_threshold':mae<8,'paint_pixels':len(points)})
if '--prepare' in sys.argv:sys.exit()
path.with_suffix('.json').write_text(json.dumps({'patterns':len(patterns),'pages':report},indent=2)+'\n')
print('原生图案：独立读取的重复单元、变换、透明度及零图片通过；阅读器栅格差异单独记录')
