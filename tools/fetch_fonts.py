"""Download the portfolio's web fonts and generate a local ``@font-face`` stylesheet.

What it produces (all under ``portfolio/assets/fonts/``):

* the ``.woff2`` files for Playfair Display (400, 700) and Inter (400, 600), each in the
  ``latin`` and ``cyrillic`` subsets — the site copy is Russian, so the cyrillic subset is
  not optional. Four files in all, serving eight ``@font-face`` rules. No italic is
  requested: nothing on the page renders an italic face, and an unused subset is dead
  weight in the repository even though the browser never downloads it;
* ``fonts.css`` — one ``@font-face`` rule per family/weight/style/subset combination, with
  ``src`` pointing at the local file, the ``unicode-range`` copied verbatim from the API
  response and ``font-display: swap``;
* ``playfair-display-OFL.txt`` and ``inter-OFL.txt`` — the upstream SIL OFL 1.1 texts.
  Licences are downloaded, never hand-written; a failed licence download aborts the run.

Why the User-Agent matters
--------------------------
The Google Fonts CSS API (``fonts.googleapis.com/css2``) content-negotiates on the
User-Agent header: it returns the font format the requesting browser supports. Python's
default ``Python-urllib/3.x`` agent is unknown to it and yields the oldest fallback
format (TrueType), not ``woff2``. Sending a current desktop Chrome UA is what makes the
response contain ``format('woff2')`` URLs plus the per-subset ``unicode-range`` blocks we
copy into the generated stylesheet. This is observed behaviour of the live endpoint, not
a documented contract — re-check the generated file if Google ever changes it.

Why urllib and not curl
-----------------------
``curl`` in this environment fails with an SSL error, so every request here goes through
``urllib.request`` from the standard library. No third-party packages, Python 3.14.

Variable fonts (important)
--------------------------
The css2 endpoint serves *variable* font files: the block for Inter 400 and the block for
Inter 600 (same subset) point at one and the same URL, and so do Playfair Display 400 and
700. The browser instances the weight axis from the ``font-weight`` declared in each
``@font-face`` rule. We therefore download each distinct URL once and let the rules that
share it share the local file — which is exactly what Google's own stylesheet does. Saving
identical bytes under one file name per weight would make a browser download the same
font twice.

Usage: ``python tools/fetch_fonts.py`` from the repository root. Idempotent — a second run
overwrites the same files with the same bytes.
"""

from __future__ import annotations

import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

# A current desktop Chrome UA string; see the module docstring for why it is required.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# One request covers both families. `display=swap` is what puts `font-display: swap` into
# every block of the response, which we then carry over into the generated stylesheet.
CSS_API_URL = (
    "https://fonts.googleapis.com/css2"
    "?family=Playfair+Display:wght@400;700"
    "&family=Inter:wght@400;600"
    "&display=swap"
)

# The response also carries latin-ext, cyrillic-ext, greek, greek-ext and vietnamese.
# The site needs Russian and Latin only; dropping the rest keeps the font budget small.
KEPT_SUBSETS = ("latin", "cyrillic")

# Both families are SIL OFL 1.1; the texts come from the upstream google/fonts repository.
LICENCES = {
    "playfair-display-OFL.txt": (
        "https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/OFL.txt"
    ),
    "inter-OFL.txt": "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt",
}

# Output directory, resolved from this file's location so the script works from any cwd
# (the documented invocation is still `python tools/fetch_fonts.py` from the repo root).
REPO_ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = REPO_ROOT / "portfolio" / "assets" / "fonts"

# Parses the API response: each `@font-face` rule is preceded by a `/* subset */` comment.
# Non-greedy body match is safe because `@font-face` bodies contain no nested braces.
BLOCK_RE = re.compile(r"/\*\s*(?P<subset>[\w-]+)\s*\*/\s*@font-face\s*\{(?P<body>.*?)\}", re.S)


def fetch(url: str) -> bytes:
    """Download ``url`` with the Chrome User-Agent and return the raw body.

    One attempt, no retry and no caching: the script is cheap to re-run by hand, and a
    silent retry would only hide a real outage behind a longer wait.

    Raises ``urllib.error.URLError`` / ``HTTPError`` on failure, which :func:`main` turns
    into a non-zero exit.
    """
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def parse_css(css: str) -> list[dict[str, str]]:
    """Turn the API stylesheet into one dict per kept ``@font-face`` block.

    Each dict holds ``subset``, ``family``, ``style``, ``weight``, ``url`` and
    ``unicode_range``. Blocks whose subset is not in :data:`KEPT_SUBSETS` are dropped, and
    the original order of the response is preserved so the generated file is stable
    between runs.
    """
    blocks: list[dict[str, str]] = []
    for match in BLOCK_RE.finditer(css):
        subset = match.group("subset")
        if subset not in KEPT_SUBSETS:
            continue
        body = match.group("body")

        def field(pattern: str) -> str:
            """Pull a single declaration out of the current block body."""
            found = re.search(pattern, body)
            if not found:
                raise ValueError(f"malformed @font-face block for subset {subset}: {body!r}")
            return found.group(1)

        blocks.append(
            {
                "subset": subset,
                "family": field(r"font-family:\s*'([^']+)'"),
                "style": field(r"font-style:\s*(\w+)"),
                "weight": field(r"font-weight:\s*(\d+)"),
                "url": field(r"url\((\S+?)\)"),
                "unicode_range": field(r"unicode-range:\s*([^;]+);"),
            }
        )
    return blocks


def local_file_name(blocks: list[dict[str, str]]) -> str:
    """Build the local file name shared by all ``blocks`` that came from one source URL.

    Pattern: ``<family>-<weights>-<subset>.woff2``, e.g.
    ``playfair-display-400-700-latin.woff2`` for the variable file that serves both the
    400 and the 700 rule, or ``inter-400-600-cyrillic.woff2``. Listing every weight the
    file serves keeps the name honest about the shared variable file.

    The pattern carries no style segment because :data:`CSS_API_URL` requests upright faces
    only. The guard below is what keeps that assumption safe: were an italic axis added back
    to the request, its file would otherwise collide with the upright one of the same
    family/weights/subset and silently overwrite it.
    """
    first = blocks[0]
    if first["style"] != "normal":
        raise ValueError(
            f"unexpected font style {first['style']!r}: the file name pattern assumes upright "
            "faces only — add a style segment before requesting italics again"
        )
    family = first["family"].lower().replace(" ", "-")
    weights = "-".join(sorted({block["weight"] for block in blocks}))
    return f"{family}-{weights}-{first['subset']}.woff2"


def render_stylesheet(blocks: list[dict[str, str]], file_names: dict[str, str]) -> str:
    """Render ``fonts.css``: one ``@font-face`` rule per kept block, pointing at local files.

    ``file_names`` maps a remote URL to the local file name it was saved as, so rules that
    share a variable font file also share the ``src``.
    """
    lines = [
        "/*",
        " * Local font declarations for the portfolio.",
        " *",
        " * GENERATED FILE — do not edit by hand. Regenerate with:",
        " *     python tools/fetch_fonts.py",
        " *",
        " * Source: the Google Fonts CSS API (css2), requested with a desktop Chrome",
        " * User-Agent so the response carries woff2 URLs and per-subset character ranges.",
        " * Only the latin and cyrillic subsets are kept, and every character range below is",
        " * copied verbatim from that response.",
        " *",
        " * The css2 endpoint serves variable fonts, so several rules intentionally point at",
        " * the same file: the browser downloads it once and instances the weight axis from",
        " * the weight declared in each rule (Google's own stylesheet does the same).",
        " *",
        " * The swap behaviour declared in every rule below, plus the system fallback stacks",
        " * in styles/base.css, keep the text readable before the fonts arrive.",
        " *",
        " * Comment lines here deliberately avoid the literal declaration names so that a",
        " * grep over this file counts the rules, not the prose.",
        " */",
        "",
    ]
    for block in blocks:
        lines += [
            f"/* {block['family']} {block['weight']} — {block['subset']} */",
            "@font-face {",
            f"  font-family: '{block['family']}';",
            f"  font-style: {block['style']};",
            f"  font-weight: {block['weight']};",
            "  font-display: swap;",
            f"  src: url('{file_names[block['url']]}') format('woff2');",
            f"  unicode-range: {block['unicode_range']};",
            "}",
            "",
        ]
    return "\n".join(lines)


def main() -> int:
    """Run the whole download, report every saved file and the total byte count.

    Returns 0 on success and 1 if any download failed — in particular a failed licence
    download aborts the run instead of leaving the fonts without their OFL text.
    """
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    total_bytes = 0

    try:
        css = fetch(CSS_API_URL).decode("utf-8")
    except (urllib.error.URLError, urllib.error.HTTPError) as error:
        print(f"ERROR: could not fetch the Google Fonts CSS API: {error}", file=sys.stderr)
        return 1

    blocks = parse_css(css)
    if not blocks:
        print("ERROR: the API response contained no latin/cyrillic blocks", file=sys.stderr)
        return 1

    # Group the blocks by source URL: one download per distinct variable font file.
    by_url: dict[str, list[dict[str, str]]] = {}
    for block in blocks:
        by_url.setdefault(block["url"], []).append(block)

    file_names: dict[str, str] = {}
    for url, url_blocks in by_url.items():
        name = local_file_name(url_blocks)
        try:
            data = fetch(url)
        except (urllib.error.URLError, urllib.error.HTTPError) as error:
            print(f"ERROR: could not download {url}: {error}", file=sys.stderr)
            return 1
        (FONT_DIR / name).write_bytes(data)
        file_names[url] = name
        total_bytes += len(data)
        weights = ", ".join(sorted({b["weight"] for b in url_blocks}))
        print(f"saved {name} ({len(data)} bytes, serves weight(s) {weights})")

    # The generated stylesheet is written after the fonts so it can never reference a file
    # that failed to download.
    stylesheet = render_stylesheet(blocks, file_names)
    css_path = FONT_DIR / "fonts.css"
    css_path.write_text(stylesheet, encoding="utf-8", newline="\n")
    total_bytes += len(stylesheet.encode("utf-8"))
    print(f"saved fonts.css ({len(stylesheet.encode('utf-8'))} bytes, {len(blocks)} @font-face rules)")

    # Licences last: they are mandatory, and a failure here must fail the whole run.
    for name, url in LICENCES.items():
        try:
            text = fetch(url)
        except (urllib.error.URLError, urllib.error.HTTPError) as error:
            print(f"ERROR: could not download the licence {url}: {error}", file=sys.stderr)
            return 1
        (FONT_DIR / name).write_bytes(text)
        total_bytes += len(text)
        print(f"saved {name} ({len(text)} bytes)")

    print(f"total: {len(by_url) + 1 + len(LICENCES)} files, {total_bytes} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
