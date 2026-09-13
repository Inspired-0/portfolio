"""Minimal RTF -> plain text converter for the résumé kept in the repo root.

The résumé is an RTF file (cp1251, Russian) despite its .doc extension. This script
extracts readable text so subagents can read facts from a plain file instead of
parsing RTF themselves. It is a dev helper only; it is not part of the site.

Usage: python tools/rtf2txt.py SRC.doc DST.txt
"""
import re
import sys

# Groups whose whole content is dropped: header tables, metadata, embedded pictures.
SKIP_GROUPS = {
    "fonttbl", "colortbl", "stylesheet", "info", "listtable", "listoverridetable",
    "generator", "xmlnstbl", "rsidtbl", "latentstyles", "themedata",
    "colorschememapping", "datastore", "pgdsctbl", "pict", "shppict", "nonshppict",
    "object", "header", "footer", "headerl", "headerr", "footerl", "footerr",
    "fldinst", "xmlopen", "xmlclose", "mmathPr", "wgrffmtfilter", "ftnsep",
    "ftnsepc", "aftnsep", "aftnsepc",
}


def strip_groups(raw: str) -> str:
    """Walk the RTF brace structure and remove skipped groups, including nested ones.

    A group is skipped when it starts with `{\\*` (an ignorable destination) or with
    `{\\<name>` where <name> is in SKIP_GROUPS. Everything else is kept verbatim for
    the control-word pass below.
    """
    out = []
    depth_skip = None  # brace depth at which a skipped group started
    depth = 0
    i = 0
    n = len(raw)
    while i < n:
        ch = raw[i]
        if ch == "{":
            depth += 1
            if depth_skip is None:
                m = re.match(r"\{\\(\*\\)?([a-zA-Z]+)", raw[i:i + 40])
                if m and (m.group(1) or m.group(2) in SKIP_GROUPS):
                    depth_skip = depth
            i += 1
            continue
        if ch == "}":
            if depth_skip == depth:
                depth_skip = None
            depth -= 1
            i += 1
            continue
        if depth_skip is None:
            out.append(ch)
        i += 1
    return "".join(out)


def main(src: str, dst: str) -> None:
    raw = open(src, "rb").read().decode("latin-1")
    raw = strip_groups(raw)

    # Structural control words -> whitespace.
    raw = re.sub(r"\\(par|line|row)\b", "\n", raw)
    raw = re.sub(r"\\(tab|cell)\b", "\t", raw)

    # Encoded characters: \'xx (cp1251 byte) and \uNNNN (unicode with optional fallback).
    raw = re.sub(r"\\'([0-9a-fA-F]{2})",
                 lambda m: bytes([int(m.group(1), 16)]).decode("cp1251", "replace"), raw)
    raw = re.sub(r"\\u(-?\d+)\s?\??", lambda m: chr(int(m.group(1)) % 65536), raw)

    # Remaining control words and symbols, then tidy whitespace.
    raw = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", raw)
    raw = re.sub(r"\\[^a-zA-Z]", "", raw)
    raw = re.sub(r"[ \t]+\n", "\n", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)

    open(dst, "w", encoding="utf-8").write(raw.strip() + "\n")
    print(len(raw), "chars ->", dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
