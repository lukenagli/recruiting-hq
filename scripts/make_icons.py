"""Draw the Recruiting HQ app icon in every size phones, browsers and Windows ask for.

Run:  python scripts/make_icons.py   (writes frontend/public/app-*.png, app-icon.ico)

A white "R" on a navy-to-blue gradient with a gold rising trend line and a faint skyline along the bottom. Full-bleed
squares for phones (iOS and Android round the corners themselves, and Android's "maskable" icon keeps everything
inside the middle 80%); rounded squares with clear corners for the browser tab and the Windows taskbar.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "frontend" / "public"
FONT = "C:/Windows/Fonts/arialbd.ttf"
TOP, BOTTOM = (10, 24, 58), (33, 86, 217)       # navy to royal blue
GOLD = (247, 190, 72)
S = 2048                                          # drawn large, then scaled down


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = min(1.0, (0.35 * x + 0.65 * y) / size)  # diagonal, mostly top to bottom
            px[x, y] = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
    return img


def art(scale: float = 1.0) -> Image.Image:
    """The full-bleed square. `scale` shrinks the drawing toward the middle (0.8 for Android's safe zone)."""
    size = 512
    img = gradient(size).resize((S, S), Image.BICUBIC).convert("RGBA")
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c, k = S / 2, S * scale  # centre, drawing size

    def p(x: float, y: float) -> tuple[float, float]:  # drawing coordinates 0..1 -> pixels
        return c + (x - 0.5) * k, c + (y - 0.5) * k

    # Skyline along the bottom: towers of different heights, a shade lighter than the background.
    towers = [(0.00, 0.80), (0.07, 0.72), (0.13, 0.77), (0.19, 0.64), (0.26, 0.70), (0.33, 0.60), (0.40, 0.74),
              (0.47, 0.67), (0.54, 0.58), (0.61, 0.69), (0.68, 0.62), (0.75, 0.73), (0.82, 0.66), (0.89, 0.76), (0.95, 0.70)]
    for i, (x, top) in enumerate(towers):
        w = 0.07 if i < len(towers) - 1 else 0.06
        d.rectangle([p(x, top), p(x + w - 0.008, 1.02)], fill=(255, 255, 255, 26))
    # The "R".
    font = ImageFont.truetype(FONT, int(0.62 * k))
    box = d.textbbox((0, 0), "R", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text((c - w / 2 - box[0] - 0.03 * k, c - h / 2 - box[1] - 0.06 * k), "R", font=font, fill=(255, 255, 255, 255))
    # The gold trend line rising across the bottom right, with an arrowhead, and a soft glow under it.
    pts = [p(0.16, 0.86), p(0.38, 0.73), p(0.52, 0.80), p(0.80, 0.52)]
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).line(pts, fill=GOLD + (150,), width=int(0.075 * k), joint="curve")
    layer = Image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(0.03 * k)), layer)
    d = ImageDraw.Draw(layer)
    d.line(pts, fill=GOLD + (255,), width=int(0.045 * k), joint="curve")
    tip, back = p(0.86, 0.46), 0.11
    d.polygon([tip, p(0.86 - back, 0.46 + 0.02), p(0.86 - 0.02, 0.46 + back)], fill=GOLD + (255,))
    for x, y in pts[:-1]:
        r = 0.032 * k
        d.ellipse([x - r, y - r, x + r, y + r], fill=GOLD + (255,))
    return Image.alpha_composite(img, layer)


def rounded(img: Image.Image, radius: float = 0.22) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=int(radius * img.size[0]), fill=255)
    out = img.copy()
    out.putalpha(mask)
    return out


def main() -> None:
    full, safe = art(), art(0.8)
    full.resize((512, 512), Image.LANCZOS).save(OUT / "app-512.png")
    full.resize((192, 192), Image.LANCZOS).save(OUT / "app-192.png")
    safe.resize((512, 512), Image.LANCZOS).save(OUT / "app-maskable-512.png")
    full.convert("RGB").resize((180, 180), Image.LANCZOS).save(OUT / "app-apple-touch.png")  # iOS wants no transparency
    tab = rounded(full)
    tab.resize((64, 64), Image.LANCZOS).save(OUT / "app-favicon.png")
    tab.resize((256, 256), Image.LANCZOS).save(OUT / "app-icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)])
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
