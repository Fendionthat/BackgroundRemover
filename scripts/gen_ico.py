"""Packs icons/icon-32.png, icon-192.png and icon-512.png into icons/app.ico
(modern ICO format with embedded PNG frames, supported since Windows Vista).
Run after gen_icon.py:
    python scripts/gen_ico.py
"""
import os
import struct

HERE = os.path.dirname(__file__)
ICONS_DIR = os.path.join(HERE, "..", "icons")
SIZES = [32, 192, 512]


def build_ico():
    frames = []
    for size in SIZES:
        with open(os.path.join(ICONS_DIR, f"icon-{size}.png"), "rb") as f:
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
