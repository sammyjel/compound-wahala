"""Turn chosen raw photos into game assets.

  C:\\pinokio\\api\\wan.git\\app\\venv\\Scripts\\python.exe art/process.py
Reads art/picks.json  {"chief": "chief_1000.png", ...}
Writes public/chars/<id>-body.webp (transparent cutout, 480px tall)
       public/chars/<id>-face.webp (256x256 head-and-shoulders on a soft colour)
"""
import json, os
from PIL import Image, ImageFilter
from rembg import new_session, remove

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "..", "public", "chars")
os.makedirs(OUT, exist_ok=True)

FACE_BG = {
    "chief": (247, 217, 208), "kemi": (234, 215, 245), "amaka": (213, 241, 238), "femi": (255, 225, 207),
    "bisi": (217, 242, 223), "tobi": (255, 217, 230), "player0": (214, 236, 255), "player1": (214, 236, 255), "player2": (214, 236, 255),
}

session = new_session("isnet-general-use")
picks = json.load(open(os.path.join(HERE, "picks.json")))

for cid, fname in picks.items():
    src = Image.open(os.path.join(RAW, fname)).convert("RGB")
    cut = remove(src, session=session, post_process_mask=True)
    a = cut.split()[-1]
    # Clean faint halo pixels from the grey backdrop.
    a = a.point(lambda v: 0 if v < 24 else v)
    cut.putalpha(a)
    bbox = a.getbbox()
    body = cut.crop(bbox)

    # Scene sprite: 480px tall keeps it crisp on retina phones.
    h = 480
    w = round(body.width * h / body.height)
    body.resize((w, h), Image.LANCZOS).save(os.path.join(OUT, f"{cid}-body.webp"), quality=86, method=6)

    # Face: find the head as the alpha mass in the top ~14% of the body.
    top = int(body.height * 0.14)
    head = body.split()[-1].crop((0, 0, body.width, top))
    hb = head.getbbox() or (0, 0, body.width, top)
    cx = (hb[0] + hb[2]) / 2
    size = int(body.height * 0.2)
    left = int(max(0, min(body.width - size, cx - size / 2)))
    up = max(0, int(-size * 0.04))
    face = body.crop((left, up, left + size, up + size))
    bg = Image.new("RGBA", face.size, FACE_BG.get(cid, (240, 230, 210)) + (255,))
    bg.alpha_composite(face)
    bg.convert("RGB").resize((256, 256), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1, 60, 2)).save(
        os.path.join(OUT, f"{cid}-face.webp"), quality=88, method=6)
    print("done", cid, body.size)
