"""Run once to generate the extension icons from cow.png."""
from PIL import Image, ImageDraw, ImageFont
import os

SIZES = [16, 48, 128]
OUT   = os.path.join(os.path.dirname(__file__), "icons")
BG    = (30, 58, 138)   # #1e3a8a navy blue


def make_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Navy circle background
    draw.ellipse([0, 0, size - 1, size - 1], fill=(*BG, 255))

    # White "D" centred
    font_size = int(size * 0.55)
    try:
        font = ImageFont.truetype("arial.ttf", font_size)
    except IOError:
        font = ImageFont.load_default()

    text = "D"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1]
    draw.text((x, y), text, fill="white", font=font)

    path = os.path.join(OUT, f"icon{size}.png")
    img.save(path)
    print(f"  Saved {path}")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for s in SIZES:
        make_icon(s)
    print("Done.")
