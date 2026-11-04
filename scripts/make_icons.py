"""Draw the Recruiting HQ app icon in every size phones, browsers and Windows ask for.

Run:  python scripts/make_icons.py   (writes frontend/public/app-*.png, app-icon.ico)

A white "R" over the New York skyline at dusk: a midnight-to-indigo sky with a warm glow on the horizon, a few stars,
and the Empire State Building, the Chrysler Building and One World Trade Center in silhouette with lit windows. The
skyline always runs edge to edge; only the "R" shrinks for Android's "maskable" icon (which keeps the middle 80%).
Full-bleed squares for phones (iOS and Android round the corners themselves); rounded squares with clear corners for
the browser tab and the Windows taskbar.
"""
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "frontend" / "public"
FONT = "C:/Windows/Fonts/arialbd.ttf"
SKY = [(0.00, (6, 10, 30)), (0.45, (22, 34, 98)), (0.78, (78, 62, 140)), (1.00, (236, 132, 92))]  # top to horizon
CITY = (7, 10, 26)
GOLD = (255, 196, 90)
S = 2048  # drawn large, then scaled down


def sky() -> Image.Image:
    col = Image.new("RGB", (1, 256))
    for y in range(256):
        t = y / 255
        for (a, ca), (b, cb) in zip(SKY, SKY[1:]):
            if a <= t <= b:
                f = (t - a) / (b - a)
                col.putpixel((0, y), tuple(int(ca[i] + (cb[i] - ca[i]) * f) for i in range(3)))
                break
    return col.resize((S, S), Image.BICUBIC).convert("RGBA")


def skyline(d: ImageDraw.ImageDraw, lights: ImageDraw.ImageDraw) -> None:
    p = lambda x, y: (x * S, y * S)  # noqa: E731
    rng = random.Random(7)

    def block(x0, x1, top, windows=True, until=0.985):
        d.rectangle([p(x0, top), p(x1, 1.01)], fill=CITY + (255,))
        if not windows:
            return
        step = 0.019
        y = top + 0.02
        while y < until:
            x = x0 + 0.012
            while x < x1 - 0.01:
                if rng.random() < 0.24:
                    r = 0.0045
                    lights.rectangle([p(x - r, y - r * 1.3), p(x + r, y + r * 1.3)], fill=GOLD + (rng.randint(150, 235),))
                x += step
            y += step

    # filler towers, back to front
    for x0, x1, top in [(-0.02, 0.07, 0.80), (0.06, 0.12, 0.74), (0.37, 0.45, 0.76), (0.44, 0.52, 0.70), (0.51, 0.55, 0.79),
                        (0.69, 0.73, 0.75), (0.90, 0.96, 0.72), (0.95, 1.02, 0.79)]:
        block(x0, x1, top)
    # Empire State Building: setbacks, a mast, a gold-tipped spire
    block(0.12, 0.30, 0.66)
    block(0.145, 0.275, 0.59, until=0.65)
    block(0.17, 0.25, 0.53, until=0.58)
    d.rectangle([p(0.195, 0.475), p(0.225, 0.53)], fill=CITY + (255,))
    d.polygon([p(0.203, 0.475), p(0.217, 0.475), p(0.210, 0.40)], fill=CITY + (255,))
    lights.ellipse([p(0.204, 0.394), p(0.216, 0.406)], fill=GOLD + (255,))
    # Chrysler Building: a body, a crown of narrowing arches, a needle
    block(0.555, 0.665, 0.66)
    for k, (w, y) in enumerate([(0.050, 0.66), (0.040, 0.625), (0.030, 0.595), (0.020, 0.570)]):
        cx = 0.61
        d.pieslice([p(cx - w, y - w * 1.25), p(cx + w, y + w * 1.25)], 180, 360, fill=CITY + (255,))
        if k < 3:
            for j in range(3):  # the crown's lit triangles
                tx = cx - w * 0.6 + j * w * 0.6
                lights.polygon([p(tx - 0.006, y - 0.004), p(tx + 0.006, y - 0.004), p(tx, y - 0.02)], fill=GOLD + (200,))
    d.polygon([p(0.606, 0.552), p(0.614, 0.552), p(0.610, 0.49)], fill=CITY + (255,))
    # One World Trade Center: tapering to a square top, then the spire (the tallest)
    d.polygon([p(0.75, 1.01), p(0.89, 1.01), p(0.855, 0.45), p(0.785, 0.45)], fill=CITY + (255,))
    d.rectangle([p(0.80, 0.43), p(0.84, 0.45)], fill=CITY + (255,))
    d.polygon([p(0.816, 0.43), p(0.824, 0.43), p(0.820, 0.33)], fill=CITY + (255,))
    lights.ellipse([p(0.814, 0.324), p(0.826, 0.336)], fill=(255, 120, 120, 255))
    for i in range(14):  # its windows follow the taper
        y = 0.48 + i * 0.037
        half = 0.035 + (0.07 - 0.035) * (y - 0.45) / 0.56
        for j in range(5):
            if rng.random() < 0.35:
                x = 0.82 - half * 0.75 + j * half * 0.375
                lights.rectangle([p(x - 0.004, y - 0.006), p(x + 0.004, y + 0.006)], fill=GOLD + (rng.randint(150, 230),))


def art(scale: float = 1.0) -> Image.Image:
    """The full-bleed square. `scale` shrinks the "R" toward the middle (0.8 for Android's safe zone)."""
    img = sky()
    stars = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd, rng = ImageDraw.Draw(stars), random.Random(3)
    for _ in range(46):
        x, y, r = rng.random() * S, rng.random() * 0.45 * S, rng.choice([2, 3, 3, 4, 5])
        sd.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, rng.randint(90, 220)))
    img = Image.alpha_composite(img, stars)
    # the horizon's glow behind the city
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([-0.2 * S, 0.62 * S, 1.2 * S, 1.35 * S], fill=(255, 150, 100, 110))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(0.08 * S)))
    city, lights = Image.new("RGBA", (S, S), (0, 0, 0, 0)), Image.new("RGBA", (S, S), (0, 0, 0, 0))
    skyline(ImageDraw.Draw(city), ImageDraw.Draw(lights))
    img = Image.alpha_composite(img, city)
    img = Image.alpha_composite(img, lights.filter(ImageFilter.GaussianBlur(5)))  # a soft halo
    img = Image.alpha_composite(img, lights)
    # The "R", with a soft light behind it.
    k = S * scale
    font = ImageFont.truetype(FONT, int(0.46 * k))
    letter = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(letter)
    box = ld.textbbox((0, 0), "R", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    cx, cy = S / 2 - 0.02 * S, S / 2 - 0.19 * k
    ld.text((cx - w / 2 - box[0], cy - h / 2 - box[1]), "R", font=font, fill=(255, 255, 255, 255))
    halo = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    halo.paste((150, 180, 255, 150), mask=letter.getchannel("A"))
    img = Image.alpha_composite(img, halo.filter(ImageFilter.GaussianBlur(0.035 * S)))
    # a gold bar under the "R", like a lit ledge
    bar = ImageDraw.Draw(img)
    by = cy + h / 2 + 0.035 * k
    bar.rounded_rectangle([cx - w * 0.42, by, cx + w * 0.42, by + 0.022 * k], radius=int(0.011 * k), fill=GOLD + (255,))
    return Image.alpha_composite(img, letter)


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
