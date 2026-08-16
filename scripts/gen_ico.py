"""Packs icons/ico-16/48/256.png into icons/app.ico (modern ICO format with
embedded PNG frames, supported since Windows Vista). These are Windows'
own conventional shell-icon sizes -- separate from icon-32/192/512.png,
which are the web favicon/PWA sizes. Both sets are rendered from
icons/cirno-source.png via scripts/build-icon.html.
Run:
    python scripts/gen_ico.py
"""
import os
import struct

HERE = os.path.dirname(__file__)
ICONS_DIR = os.path.join(HERE, "..", "icons")
SIZES = [16, 48, 256]


def build_ico():
    frames = []
    for size in SIZES:
        with open(os.path.join(ICONS_DIR, f"ico-{size}.png"), "rb") as f:
            frames.append(f.read())

    num = len(frames)
    header = struct.pack("<HHH", 0, 1, num)

    dir_entries = b""
    data_blob = b""
    offset = 6 + 16 * num

    for size, png in zip(SIZES, frames):
        w = h = 0 if size >= 256 else size
        entry = struct.pack(
            "<BBBBHHII",
            w, h, 0, 0, 1, 32, len(png), offset,
        )
        dir_entries += entry
        data_blob += png
        offset += len(png)

    return header + dir_entries + data_blob


if __name__ == "__main__":
    ico = build_ico()
    path = os.path.join(ICONS_DIR, "app.ico")
    with open(path, "wb") as f:
        f.write(ico)
    print("wrote", path, len(ico), "bytes")
