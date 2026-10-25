"""Build the self-contained report and slides: every screenshot is shrunk and embedded in the HTML file.

    .venv\\Scripts\\python.exe docs\\build.py

Reads docs/src/report.html and docs/src/slides.html, writes docs/report.html and docs/slides.html.
"""
import base64
import io
import re
from pathlib import Path

from PIL import Image

DOCS = Path(__file__).resolve().parent
MAX_WIDTH = 1500


def embed(match: re.Match) -> str:
    path = DOCS / match.group(1)
    img = Image.open(path).convert("RGB")
    if img.width > MAX_WIDTH:
        img = img.resize((MAX_WIDTH, round(img.height * MAX_WIDTH / img.width)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=78, optimize=True)
    return f'src="data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode()}"'


for name in ("report.html", "slides.html"):
    source = (DOCS / "src" / name).read_text(encoding="utf-8")
    built = re.sub(r'src="(screenshots/[\w.-]+\.jpg)"', embed, source)
    (DOCS / name).write_text(built, encoding="utf-8")
    print(f"{name}: {len(built) / 1e6:.1f} MB")
