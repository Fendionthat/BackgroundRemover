"""Generates the app icon as PNGs (no external deps). Run once during setup:
    python scripts/gen_icon.py
Produces icons/icon-512.png and icons/icon-192.png: a rounded square split
into a solid half (the "before") and a checkerboard half (the "after",
transparency), representing background removal.
"""
import struct
import zlib
import os

ACCENT = (91, 140, 255)      # #5b8cff
SUBJECT = (255, 255, 255)    # white "subject" silhouette
CHECK_LIGHT = (232, 234, 237)
CHECK_DARK = (190, 195, 202)


def rounded_square_mask(x, y, size, radius):
    cx0, cy0 = radius, radius
    cx1, cy1 = size - radius, radius
    cx2, cy2 = radius, size - radius
    cx3, cy3 = size - radius, size - radius
    if x < radius and y < radius:
        return (x - cx0) ** 2 + (y - cy0) ** 2 <= radius ** 2
    if x >= size - radius and y < radius:
        return (x - cx1) ** 2 + (y - cy0) ** 2 <= radius ** 2
    if x < radius and y >= size - radius:
        return (x - cx2) ** 2 + (y - cy2) ** 2 <= radius ** 2
    if x >= size - radius and y >= size - radius:
        return (x - cx3) ** 2 + (y - cy3) ** 2 <= radius ** 2
    return True


def render(size):
    radius = int(size * 0.2)
    pad = int(size * 0.14)
    circle_r = (size / 2) - pad
    ccx = ccy = size / 2
    check_cell = max(4, size // 16)

    pixels = bytearray()
    for y in range(size):
        pixels.append(0)  # filter byte
        for x in range(size):
            if not rounded_square_mask(x, y, size, radius):
                pixels += bytes((0, 0, 0, 0))
                continue

            dx, dy = x - ccx, y - ccy
            in_circle = dx * dx + dy * dy <= circle_r * circle_r

            if not in_circle:
                r, g, b = ACCENT
            elif x < ccx:
                r, g, b = SUBJECT
            else:
                cell_x = (x - int(ccx)) // check_cell
                cell_y = (y - int(ccy - circle_r)) // check_cell
                light = (cell_x + cell_y) % 2 == 0
                r, g, b = CHECK_LIGHT if light else CHECK_DARK

            pixels += bytes((r, g, b, 255))
    return bytes(pixels)


def write_png(path, size, raw):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(
            ">I", zlib.crc32(tag + data) & 0xFFFFFFFF
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    comp = zlib.compress(raw, 9)
    data = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", comp) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(data)


if __name__ == "__main__":
    out_dir = os.path.join(os.path.dirname(__file__), "..", "icons")
    os.makedirs(out_dir, exist_ok=True)
    for size in (512, 192, 32):
        raw = render(size)
        path = os.path.join(out_dir, f"icon-{size}.png")
        write_png(path, size, raw)
        print("wrote", path)
