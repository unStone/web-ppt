import zipfile
import xml.etree.ElementTree as ET

path = "/Users/chenlei/Downloads/3123123123.pptx"
ns = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

def local(tag):
    return tag.split("}")[-1]

def dump(el, depth=0, limit=6):
    if depth > limit:
        return
    attrs = " ".join(f"{local(k)}={v}" for k, v in el.attrib.items())
    text = (el.text or "").strip()
    line = "  " * depth + local(el.tag)
    if attrs:
        line += " " + attrs
    if text:
        line += " " + text[:80]
    print(line)
    for child in el:
        dump(child, depth + 1, limit)

with zipfile.ZipFile(path) as z:
    slide = ET.fromstring(z.read("ppt/slides/slide1.xml"))
    layout = ET.fromstring(z.read("ppt/slideLayouts/slideLayout1.xml"))

print("=== slide timing ===")
timing = slide.find("p:timing", ns)
dump(timing, 0, 12)

print("\n=== layout shapes ===")
for sp in layout.findall(".//p:sp", ns):
    nv = sp.find(".//p:cNvPr", ns)
    ph = sp.find(".//p:ph", ns)
    xfrm = sp.find(".//a:xfrm", ns)
    body = sp.find(".//a:bodyPr", ns)
    name = nv.get("name") if nv is not None else "?"
    ph_s = " ".join(f"{local(k)}={v}" for k, v in (ph.attrib.items() if ph is not None else []))
    off = xfrm.find("a:off", ns) if xfrm is not None else None
    ext = xfrm.find("a:ext", ns) if xfrm is not None else None
    body_s = " ".join(f"{local(k)}={v}" for k, v in (body.attrib.items() if body is not None else []))
    print(name, ph_s)
    if off is not None:
        print("  off", off.attrib, "ext", ext.attrib if ext is not None else None)
    print("  body", body_s)
