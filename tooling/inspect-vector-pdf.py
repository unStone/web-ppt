import sys
from pathlib import Path
import hashlib
import json
import zipfile
import pymupdf

pdf=pymupdf.open(sys.argv[1])
if len(sys.argv)>2 and sys.argv[2]=='images':
    assert len(pdf)==3
    page=pdf[0]
    assert page.get_text().strip()=='ABC'
    images=page.get_images()
    assert len(images)==1 and images[0][1]>0 and images[0][2:4]==(8,8),images
    second=pdf[1].get_images()
    assert len(second)==2 and any(image[0]==images[0][0] for image in second)
    jpeg=next(image for image in second if image[2:4]==(1,1))
    assert jpeg[8]=='DCTDecode' and jpeg[1]==0,jpeg
    with zipfile.ZipFile('fixtures/sample-vector-pdf-images.pptx') as source:
        assert pdf.extract_image(jpeg[0])['image']==source.read('ppt/media/source.jpg')
    assert pdf[2].get_images()==[] and pdf[2].get_text().strip()=='ABC'
    border=next(p for p in pdf[1].get_drawings() if p['type']=='s')
    assert tuple(border['rect'])==(180,30,300,150) and abs(border['width']-2.25)<.001,border
    rgb,alpha=pdf.xref_stream(images[0][0]),pdf.xref_stream(images[0][1])
    assert len(rgb)==8*8*3 and len(alpha)==8*8
    for y in range(8):
        for x in range(8):
            expected_pixel=((255,0,0,128) if x<4 else (0,0,255,255)) if y<4 else ((0,255,0,255) if x<4 else (255,255,255,0))
            at=y*8+x
            assert (*rgb[at*3:at*3+3],alpha[at])==expected_pixel
    raster=page.get_pixmap(matrix=pymupdf.Matrix(2,2))
    # 取样避开放大后占 40 px 的像素插值带；边界另由整片视觉对照检验。
    for x,y,color in [(42,42,(255,213,79)),(90,85,(255,106,39)),(150,85,(0,0,255)),(90,155,(0,255,0)),(150,155,(255,213,79))]:
        pixel=raster.pixel(round(x*1.5),round(y*1.5))
        assert max(abs(a-b) for a,b in zip(pixel,color))<=1,(x,y,pixel,color)
    expected=pymupdf.Pixmap(str(Path(sys.argv[1]).with_name('images-reference.png')))
    if expected.alpha: expected=pymupdf.Pixmap(expected,0)
    actual_bytes,expected_bytes=raster.samples,expected.samples
    difference=[abs(actual_bytes[y*raster.stride+x]-expected_bytes[y*expected.stride+x]) for y in range(330) for x in range(330*3)]
    mean=sum(difference)/len(difference)
    # PDF 1.7 §4.8.3 明确不规定插值算法。原图只有 8×8，源像素在这里放大为
    # 60×40 输出像素；分别检查原始 RGBA、插值带以外的裁剪与像素，并完整记录带内差异。
    stable=[abs(actual_bytes[y*raster.stride+x*3+c]-expected_bytes[y*expected.stride+x*3+c])
            for y in range(330) for x in range(330) for c in range(3)
            if (x<148 or x>212) and (y<158 or y>202)]
    stable_mean=sum(stable)/len(stable)
    assert stable_mean<1,stable_mean
    Path(sys.argv[1]).with_suffix('.json').write_text(json.dumps({'rgbaPixelsExact':64,'cropRegionMae':mean,
      'outsideInterpolationBandsMae':stable_mean,'reader':pymupdf.VersionBind},indent=2)+'\n')
    raster.save(str(Path(sys.argv[1]).with_suffix('.png')))
    print(f'MuPDF：RGBA、裁剪、JPEG 原始字节、跨页复用及文字通过；非插值区域 MAE={stable_mean:.4f}，全区域 MAE={mean:.4f}')
    sys.exit(0)
if len(sys.argv)>2 and sys.argv[2]=='final-only':
    assert [p.get_text().strip() for p in pdf]==['B','C']
    assert all(list(p.annots())==[] for p in pdf)
    print('MuPDF：动画终态不导出已隐藏的文字，也不要求其字体')
    sys.exit(0)
if len(sys.argv)>2 and sys.argv[2]=='geometry':
    assert len(pdf)==2
    quadratic=next(p for p in pdf[1].get_drawings() if p['type']=='s')['items']
    assert len(quadratic)==1 and quadratic[0][0]=='c'
    assert all(abs(a-b)<.001 for point,expected in zip(quadratic[0][1:],[(30,30),(90,30),(120,50),(120,90)]) for a,b in zip(point,expected)),quadratic
    page=pdf[0]
    assert page.get_images()==[]
    path=next(p for p in page.get_drawings() if p['type']=='s')
    assert len([p for p in path['items'] if p[0]=='c'])==4
    assert path['lineCap']==(1,1,1)
    # MuPDF 的 get_drawings 在旋转 CTM 下会缩放 width / dashes / lineJoin；
    # MuPDF 读取 SVG 又会丢虚线；所以外观参考由 Chrome 原生 SVG 产生。
    raster=page.get_pixmap(matrix=pymupdf.Matrix(2,2))
    expected=pymupdf.Pixmap(str(Path(sys.argv[1]).with_name('geometry-reference.png')))
    if expected.alpha: expected=pymupdf.Pixmap(expected,0)
    assert raster.width==expected.width and raster.height==expected.height
    actual_bytes,expected_bytes=raster.samples,expected.samples
    difference=[abs(actual_bytes[y*raster.stride+x]-expected_bytes[y*expected.stride+x]) for y in range(300) for x in range(360*3)]
    mean=sum(difference)/len(difference)
    assert mean<1,mean
    # 120×80 px 的椭圆绕 (100,80) 旋转 30°；抽样端点可独立确定变换方向。
    first=path['items'][0][1]
    assert abs(first.x-36.028857)<.001 and abs(first.y-37.5)<.001,first
    page.get_pixmap(matrix=pymupdf.Matrix(2,2)).save(str(Path(sys.argv[1]).with_suffix('.png')))
    print(f'MuPDF：椭圆曲线、旋转端点及独立 SVG 对照通过，局部像素 MAE={mean:.4f}')
    sys.exit(0)
if len(sys.argv)>2 and sys.argv[2]=='jobs':
    assert [p.get_text().strip() for p in pdf]==['A\nB','B','C']
    for page in [pdf[0],pdf[1]]:
        annotations=list(page.annots())
        assert [a.info['content'] for a in annotations]==['批注','回复']
        assert annotations[0].info['title']=='作者'
        assert annotations[1].irt_xref==annotations[0].xref
    assert list(pdf[2].annots())==[]
    print('MuPDF：动画批次、隐藏页、批注和回复关系通过')
    sys.exit(0)
assert len(pdf)==1
page=pdf[0]
assert page.rect.width==480 and page.rect.height==270
text_case=len(sys.argv)>2 and sys.argv[2]=='text'
expected='á q̇ café\n中文测试。\nABC 中文 ffi' if text_case else 'AV office ffi ﬃ'
assert page.get_text().strip()==expected,repr(page.get_text())
assert page.get_images()==[], '普通形状和文字不能栅格化'
if not text_case:
    assert any(item['fill'] and abs(item['fill'][0]-229/255)<.001 for item in page.get_drawings()), '红色形状应保留 PDF 路径'
fonts=page.get_fonts(full=True)
assert fonts and all(font[2]=='Type0' for font in fonts),fonts
originals=[Path('tooling/font-glyph-samples/'+name+'.ttf').read_bytes() for name in (['latin','chinese'] if text_case else ['latin'])]
for font in fonts:
    assert hashlib.sha256(pdf.extract_font(font[0])[3]).digest() in [hashlib.sha256(original).digest() for original in originals], '嵌入完整字体应来自同一输入字节'
page.get_pixmap(matrix=pymupdf.Matrix(2,2)).save(str(Path(sys.argv[1]).with_suffix('.png')))
print('MuPDF：原文、Type0 字体、完整字体字节、矢量填充及零图片通过')
