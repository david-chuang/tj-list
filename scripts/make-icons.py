"""Draws the app icons (a checkmark on a red tile) into icons/. Usage: python3 scripts/make-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

RED = (181, 18, 27)
CREAM = (250, 246, 239)
OUT = Path(__file__).resolve().parent.parent / "icons"


def draw(size, full_bleed):
    s = 4  # supersample for smooth edges
    img = Image.new("RGB", (size * s, size * s), RED)
    d = ImageDraw.Draw(img)
    S = size * s
    # Maskable icons get cropped to a circle, so keep the artwork inside the middle 60%.
    scale = 0.6 if full_bleed else 0.78
    pad = S * (1 - scale) / 2
    box = S * scale
    # list lines
    for i, y in enumerate((0.22, 0.5, 0.78)):
        yy = pad + box * y
        d.rounded_rectangle(
            (pad + box * 0.42, yy - box * 0.045, pad + box * 0.98, yy + box * 0.045),
            radius=box * 0.045, fill=CREAM if i else (255, 214, 214),
        )
    # check mark beside the first line
    w = int(box * 0.08)
    pts = [(pad + box * 0.05, pad + box * 0.21), (pad + box * 0.14, pad + box * 0.30), (pad + box * 0.30, pad + box * 0.11)]
    d.line(pts, fill=CREAM, width=w, joint="curve")
    for x, y in (pts[0], pts[-1]):
        d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=CREAM)
    # empty circles beside the other lines
    for y in (0.5, 0.78):
        cx, cy, r = pad + box * 0.17, pad + box * y, box * 0.11
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=CREAM, width=int(box * 0.05))
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(exist_ok=True)
draw(180, False).save(OUT / "apple-touch-icon.png")
draw(192, False).save(OUT / "icon-192.png")
draw(512, False).save(OUT / "icon-512.png")
draw(512, True).save(OUT / "icon-maskable-512.png")
print("Icons written to", OUT)
