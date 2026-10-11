import sys
from pathlib import Path
import pymupdf as fitz

path=Path(sys.argv[1])
pdf=fitz.open(path)
page=pdf[0]
assert 'A0B' in page.get_text().replace(chr(10),''),page.get_text()
assert not page.get_images(),page.get_images()
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
# 文字 "A0B" 在 x=40..200 CSS → PDF 30..150pt → pix 60..300
# 字号 32pt→16pt PDF→32px pix；描边红(#FF0000)应在字形边缘可见
def scan(x0,x1,y0,y1):
  red=blue=total=0
  for y in range(y0,y1):
    for x in range(x0,x1):
      r,g,b=pix.pixel(x,y)
      if (r,g,b)==(255,255,255): continue
      total+=1
      if r>180 and g<80 and b<80: red+=1
      elif b>100 and r<80: blue+=1
  return red,blue,total
red,blue,total=scan(50,320,80,180)
# 双轨渲染：描边红 + 填色黑/深蓝。描边在字形轮廓外缘，红像素 > 0
assert red>10,f'描边红像素不足：red={red} blue={blue} total={total}'
assert total>red+blue+20 or blue>0,f'应有填色像素：red={red} blue={blue} total={total}'
print(f'文字描边：stroke-only 轨红像素={red}、fill 轨像素={total-red}，双轨渲染通过')
pix.save(path.with_name('text-stroke.png'))
