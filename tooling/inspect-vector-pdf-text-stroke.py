import sys
from pathlib import Path
import pymupdf as fitz

path=Path(sys.argv[1])
pdf=fitz.open(path)
page=pdf[0]
# 两段文字各自可搜索（形状 y=40..140 / 200..300 CSS → 30..105 / 150..225 pt）
for y0,y1 in ((30,105),(150,225)):
  clip=fitz.Rect(0,y0,page.rect.width,y1)
  assert 'A0B' in page.get_text(clip=clip).replace(chr(10),''),(y0,page.get_text(clip=clip))
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
# 第二段：无填充 + 水平渐变描边（左 #00B000 → 右 #0000FF），形状 y=200..300 CSS → pix 300..450
green_x=[];blue_x=[];dark=0
for y in range(300,450):
  for x in range(50,500):
    r,g,b=pix.pixel(x,y)
    if (r,g,b)==(255,255,255): continue
    if g>b+40 and g>r+40: green_x.append(x)
    elif b>g+40 and b>r+40: blue_x.append(x)
    elif r<60 and g<60 and b<60: dark+=1
assert len(green_x)>20 and len(blue_x)>20,f'渐变描边不可见：green={len(green_x)} blue={len(blue_x)}'
gx=sum(green_x)/len(green_x);bx=sum(blue_x)/len(blue_x)
assert gx<bx,f'渐变方向应左绿右蓝：green 均值 x={gx:.1f} blue 均值 x={bx:.1f}'
# 无填充：不能出现默认黑色填色
assert dark<20,f'无填充文字出现深色填色像素：{dark}'
print(f'渐变描边：green={len(green_x)}@x{gx:.0f} blue={len(blue_x)}@x{bx:.0f} 深色={dark}，左绿右蓝通过')
pix.save(path.with_name('text-stroke.png'))
