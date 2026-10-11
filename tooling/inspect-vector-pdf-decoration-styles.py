import sys
from pathlib import Path
import pymupdf as fitz

path=Path(sys.argv[1])
pdf=fitz.open(path)
page=pdf[0]
assert page.get_text().strip().count('ABC')>=8,page.get_text()
assert not page.get_images(),page.get_images()
# 内容流操作符：dash（d）、圆帽（1 J）、双线（两次 S 配对）、波浪（c 曲线）
import zlib
content=b''
for xref in range(1,pdf.xref_length()):
  t=pdf.xref_object(xref,compressed=True)
  if '/Filter/FlateDecode' in t and 'Contents' not in t and '/Type/Page' not in t:
    try: content+=zlib.decompress(pdf.xref_stream(xref))
    except Exception: pass
# 四行 y≈40(dashed) 130(dotted) 220(double) 310(wavy)，字号 24pt→12pt PDF→pix y = base*0.75
pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
# 每行取装饰线附近（y±10px）的墨迹像素数
def ink(y0,y1):
  c=0
  for y in range(y0,y1):
    for x in range(20,600):
      if pix.pixel(x,y)!=(255,255,255): c+=1
  return c
rows={'dashed':ink(100,180),'dotted':ink(240,320),'double':ink(370,450),'wavy':ink(460,540)}
# 每种样式都有墨迹
for name,count in rows.items():
  assert count>50,f'{name} 装饰线墨迹不足：{count}'
# 双线墨迹 > 单实线（两条线）；虚线/点线 < 实线但有值
assert rows['double']>rows['wavy']*1.2,f"双线墨迹应大于波浪（{rows['double']} vs {rows['wavy']}）"
print(f'多样式装饰线：dashed={rows["dashed"]} dotted={rows["dotted"]} double={rows["double"]} wavy={rows["wavy"]} 墨迹全部可见，双线大于波浪')
pix.save(path.with_name('decoration-styles.png'))
