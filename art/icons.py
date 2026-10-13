"""App icons for the web manifest / Android wrapper (same design as the favicon: gold house on green).
Run: C:\\pinokio\\api\\wan.git\\app\\venv\\Scripts\\python.exe art/icons.py
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)


def icon(size, maskable=False):
    s = size / 32
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, size, size], fill="#1f6f50")
        k, off = 0.7, size * 0.15  # keep the house inside the safe zone
    else:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(7 * s), fill="#1f6f50")
        k, off = 1.0, 0
    p = lambda x, y: (off + x * s * k, off + y * s * k)
    d.polygon([p(6, 15), p(16, 7), p(26, 15), p(26, 26), p(6, 26)], fill="#f2b632")
    d.rectangle([p(13, 18), p(19, 26)], fill="#c8553d")
    return img


for n in (192, 512):
    icon(n).save(os.path.join(OUT, f"icon-{n}.png"))
icon(512, maskable=True).save(os.path.join(OUT, "maskable-512.png"))
icon(180).convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"))
print("icons written to", os.path.abspath(OUT))
