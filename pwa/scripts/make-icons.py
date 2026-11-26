"""Draws the app icons (two rounded bars, the game's left and right) as PNGs. No dependencies.
Run: python3 scripts/make-icons.py"""
import struct, zlib, os

BG = (13, 15, 21); LEFT = (125, 139, 255); RIGHT = (255, 122, 166)

def rounded(x, y, x0, y0, x1, y1, r):
    cx = min(max(x, x0 + r), x1 - r); cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r and x0 <= x <= x1 and y0 <= y <= y1

def draw(size, pad_frac, corner_frac):
    ss = 4  # supersampling for smooth edges
    S = size * ss
    bar_w, bar_h = 0.17 * S, 0.40 * S
    gap = 0.045 * S
    total = 2 * bar_w + gap
    pad = pad_frac * S
    scale = 1 - 2 * pad_frac
    bw, bh, gp = bar_w * scale / 0.9 * 0.9, bar_h * scale, gap * scale
    x0 = (S - (2 * bw + gp)) / 2; y0 = (S - bh) / 2
    bars = [((x0, y0, x0 + bw, y0 + bh), LEFT), ((x0 + bw + gp, y0, x0 + 2 * bw + gp, y0 + bh), RIGHT)]
    br = bw * 0.32
    corner = corner_frac * S
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    X = px * ss + sx + 0.5; Y = py * ss + sy + 0.5
                    if corner and not rounded(X, Y, 0, 0, S, S, corner):
                        continue
                    col = BG
                    for (a, b, c, d), cc in bars:
                        if rounded(X, Y, a, b, c, d, br): col = cc
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 255
            n = ss * ss
            row += bytes([acc[0] // n, acc[1] // n, acc[2] // n, acc[3] // n])
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

out = os.path.join(os.path.dirname(__file__), '..', 'icons')
specs = {
    'icon-192.png': (192, 0.0, 0.0), 'icon-512.png': (512, 0.0, 0.0),
    'maskable-512.png': (512, 0.12, 0.0),          # extra padding for Android's shape masks
    'apple-touch-icon.png': (180, 0.0, 0.0), 'icon-32.png': (32, 0.0, 0.22),
}
for name, (size, pad, corner) in specs.items():
    with open(os.path.join(out, name), 'wb') as f: f.write(draw(size, pad, corner))
    print('wrote', name)
