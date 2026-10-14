"""Draws the app icons ("Trader Joe's" in red on white) into icons/.
Usage: python3 scripts/make-icons.py   (uses Avenir Next, which ships with macOS)"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

RED = (200, 16, 46)
WHITE = (255, 255, 255)
FONT = ("/System/Library/Fonts/Avenir Next.ttc", 8)  # Avenir Next Heavy
LINES = ("Trader", "Joe’s")
OUT = Path(__file__).resolve().parent.parent / "icons"


def draw(size, width_frac):
    s = 4  # supersample for smooth edges
    S = size * s
    img = Image.new("RGB", (S, S), WHITE)
    d = ImageDraw.Draw(img)
    path, index = FONT
    # Largest font size where the widest line fits in width_frac of the icon.
    fs = 10
    while max(d.textlength(l, font=ImageFont.truetype(path, fs + 4, index=index)) for l in LINES) <= S * width_frac:
        fs += 4
    font = ImageFont.truetype(path, fs, index=index)
    boxes = [d.textbbox((0, 0), l, font=font) for l in LINES]
    heights = [b[3] - b[1] for b in boxes]
    gap = fs * 0.08
    y = (S - sum(heights) - gap * (len(LINES) - 1)) / 2
    for line, b, h in zip(LINES, boxes, heights):
        d.text(((S - (b[2] - b[0])) / 2 - b[0], y - b[1]), line, font=font, fill=RED)
        y += h + gap
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(exist_ok=True)
draw(180, 0.8).save(OUT / "apple-touch-icon.png")
draw(192, 0.8).save(OUT / "icon-192.png")
draw(512, 0.8).save(OUT / "icon-512.png")
# Maskable icons get cropped to a circle on Android, so keep the text inside the middle.
draw(512, 0.62).save(OUT / "icon-maskable-512.png")
print("Icons written to", OUT)
