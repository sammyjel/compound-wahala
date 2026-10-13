"""Generate photoreal full-body character photos with Z-Image Turbo (Pinokio / Wan2GP).

Run with the Pinokio venv python:
  C:\\pinokio\\api\\wan.git\\app\\venv\\Scripts\\python.exe art/gen.py [ids...] [--seeds N]
Outputs art/raw/<id>_<seed>.png. Pick the best take per character, then run art/process.py.
All people are fictional; prompts describe them positively (Z-Image ignores negatives).
"""
import os, sys, shutil, json

APP = r"C:\pinokio\api\wan.git\app"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
os.makedirs(OUT, exist_ok=True)

STYLE = (
    "Photorealistic full-body photograph, the whole person visible from the top of the head down to the shoes "
    "with space above and below, standing upright facing the camera, relaxed natural pose, arms at the sides, "
    "plain seamless light grey studio backdrop, soft even studio lighting, sharp focus, natural skin texture, "
    "85mm lens, high detail, Lagos, Nigeria."
)

CHARS = {
    "chief": "A proud elderly Nigerian Igbo landlord in his late sixties, short grey hair and a neat grey beard, "
             "wearing a red traditional Igbo cap, a black embroidered traditional tunic with gold patterns, a red coral bead necklace, "
             "black trousers and dark red leather shoes, holding a dark wooden walking stick with a gold handle in his right hand, warm dignified smile.",
    "kemi": "A cheerful Nigerian Yoruba woman in her mid forties, long black box braids under a yellow gele head wrap, "
            "wearing a purple ankara dress with yellow dot patterns, flat sandals, holding a smartphone in one hand, "
            "lively curious expression with raised eyebrows and a big smile.",
    "amaka": "A Nigerian nurse in her early thirties, natural black hair in a neat puff bun, wearing teal hospital scrubs "
             "with a small name badge, white sneakers, a slightly tired but kind gentle smile, slim build.",
    "femi": "A stylish Nigerian man around thirty, low fade haircut, wearing black sunglasses, a bright orange short-sleeve shirt "
            "with yellow print pattern, a thin gold chain, slim navy chinos and clean white sneakers, holding a phone, "
            "confident charming grin, slim build.",
    "bisi": "A sturdy Nigerian Yoruba market woman in her early fifties, wearing a green ankara blouse and wrapper skirt with orange patterns, "
            "an orange and gold head tie, a cream cotton apron tied at the waist, brown sandals, "
            "warm businesslike smile, hands relaxed.",
    "tobi": "A playful Nigerian young man aged nineteen with a rounded afro, black over-ear headphones resting around his neck, "
            "wearing a bright pink hoodie, dark grey jogger trousers and white sneakers, big cheeky grin, slim build.",
    "player0": "A friendly Nigerian man in his late twenties, short black hair, wearing a royal blue t-shirt, dark jeans "
               "and orange sneakers, open friendly smile, medium build.",
    "player1": "A friendly Nigerian woman in her late twenties, black box braids tied back, wearing a mustard yellow ankara top "
               "and dark jeans, white sneakers, open warm smile, slim build.",
    "player2": "A friendly Nigerian man in his late twenties with a short afro and round glasses, wearing a teal button shirt, "
               "dark grey trousers and black sneakers, thoughtful kind smile, medium build.",
}


def main():
    argv = sys.argv[1:]
    seeds = 2
    if "--seeds" in argv:
        i = argv.index("--seeds")
        seeds = int(argv[i + 1])
        del argv[i : i + 2]
    args = argv
    ids = args or list(CHARS)
    os.chdir(APP)
    sys.path.insert(0, APP)
    from shared.api import init

    s = init(console_output=False)
    for cid in ids:
        for k in range(seeds):
            seed = 1000 + k * 77
            dst = os.path.join(OUT, f"{cid}_{seed}.png")
            if os.path.exists(dst):
                continue
            st = s.get_default_settings("z_image")
            st.update({"prompt": f"{CHARS[cid]} {STYLE}", "resolution": "768x1344", "seed": seed})
            r = s.run_task(st)
            errs = [str(e) for e in r.errors]
            if errs or not r.generated_files:
                print("FAIL", cid, seed, errs, flush=True)
                continue
            shutil.copy(r.generated_files[0], dst)
            print("OK", dst, flush=True)


if __name__ == "__main__":
    main()
