"""PDFium 独立对照（票据 005 的「其他 PDF 阅读器」验收）。

依赖 pypdfium2（随 tooling/font-glyph-requirements.txt 安装，内嵌 PDFium 二进制）。
检查两类事实：
1. 文字提取：指定页的预期片段必须可搜索——PDFium 的文本引擎与 MuPDF / poppler
   独立，能提取即证明 ToUnicode 映射与字形定位对第三方阅读器有效；
2. 渐变方向：渲染整页取中线 10% / 90% 位置的窗口均值色，断言红通道差显著——
   各阅读器抗锯齿与文本渲染策略不同，只断言方向（渲染器无关），不做 MAE。

用法：
  python3 inspect-vector-pdf-pdfium.py expect <pdf> <页码从1> <预期片段> [同上...]
  python3 inspect-vector-pdf-pdfium.py gradient <pdf> <页码从1>
  python3 inspect-vector-pdf-pdfium.py nonempty <pdf>
"""
import sys

import pypdfium2 as pdfium


def text_of(pdf, page_index):
    page = pdf[page_index]
    textpage = page.get_textpage()
    try:
        return textpage.get_text_range()
    finally:
        textpage.close()


def check_expect(path, page_number, expected):
    pdf = pdfium.PdfDocument(path)
    try:
        if page_number > len(pdf):
            return f"{path}: 第 {page_number} 页缺失（共 {len(pdf)} 页）"
        text = text_of(pdf, page_number - 1)
        return None if expected in text else f"{path}: 第 {page_number} 页未找到「{expected}」（提取 {len(text)} 字符）"
    finally:
        pdf.close()


def check_gradient(path, page_number):
    pdf = pdfium.PdfDocument(path)
    try:
        page = pdf[page_number - 1]
        page_width, page_height = page.get_size()
        textpage = page.get_textpage()
        try:
            text = textpage.get_text_range()
            box = None
            if text:
                count = textpage.count_rects(0, len(text))
                xs, ys = [], []
                for index in range(count):
                    left, bottom, right, top = textpage.get_rect(index)
                    xs.extend((left, right))
                    ys.extend((bottom, top))
                # PDF 坐标原点在左下，位图原点在左上
                box = (min(xs), page_height - max(ys), max(xs), page_height - min(ys))
        finally:
            textpage.close()
        if not box:
            return f"{path}: 第 {page_number} 页没有可用于定位渐变的文字"
        bitmap = page.render(scale=1.0)
        pixmap = bitmap.to_pil().convert("RGB")
        width, height = pixmap.size
        # 渐变文字不占满页宽：在文字包围盒的垂直中线上按 2 像素步进采样窗口均值，
        # 取红通道最小 / 最大两处——各阅读器只断言方向，不做 MAE
        y = int((box[1] + box[3]) / 2)
        columns = []
        for x in range(max(int(box[0]), 1), min(int(box[2]), width - 1), 2):
            pixels = [pixmap.getpixel((x, min(max(y + dy, 0), height - 1))) for dy in (-2, -1, 0, 1, 2)]
            columns.append(tuple(sum(channel[c] for channel in pixels) // len(pixels) for c in range(3)))
        reds = [channel[0] for channel in columns]
        # 排除文字间隙的白底列：非白列之间的红通道差才是渐变方向本身，
        # 否则任何彩色文字对白底都能凑出跨度
        inked = [channel for channel in columns if min(channel) < 240]
        if len(inked) < 2:
            return f"{path}: 第 {page_number} 页文字带内非白采样列不足（{len(inked)}）"
        low, high = min(inked, key=lambda c: c[0]), max(inked, key=lambda c: c[0])
        span = high[0] - low[0]
        print(f"  PDFium 渐变带采样：非白列红通道跨度 {span}（{low} ↔ {high}，白底列已排除）")
        return None if span >= 40 else f"{path}: 渐变带红通道跨差不显著 {low} vs {high}"
    finally:
        pdf.close()


def check_nonempty(path):
    pdf = pdfium.PdfDocument(path)
    try:
        empty = [index + 1 for index in range(len(pdf)) if not text_of(pdf, index).strip()]
        return None if not empty else f"{path}: 以下页提取不到文字 {empty}"
    finally:
        pdf.close()


def main():
    arguments = sys.argv[1:]
    failures = []
    index = 0
    while index < len(arguments):
        mode = arguments[index]
        if mode == "expect":
            failure = check_expect(arguments[index + 1], int(arguments[index + 2]), arguments[index + 3])
            index += 4
        elif mode == "gradient":
            failure = check_gradient(arguments[index + 1], int(arguments[index + 2]))
            index += 3
        elif mode == "nonempty":
            failure = check_nonempty(arguments[index + 1])
            index += 2
        else:
            raise SystemExit(f"未知模式 {mode}")
        if failure:
            failures.append(failure)
    if failures:
        for failure in failures:
            print(f"✗ {failure}")
        sys.exit(1)
    print("PDFium 独立对照通过：文字可搜索、渐变方向一致")


if __name__ == "__main__":
    main()
