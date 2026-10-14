# Genere les icones PNG d'installation a partir du dessin de public/icon.svg (cabas sur fond vert).
# Usage : python scripts/make-icons.py   (Pillow requis)
import os
from PIL import Image, ImageDraw

GREEN, CREAM = (47, 125, 79, 255), (243, 245, 240, 255)
OUT = os.path.join(os.path.dirname(__file__), '..', 'public')


def bezier(p0, p1, p2, p3, n=24):
    return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d
                  for a, b, c, d in zip(p0, p1, p2, p3)) for t in (i / n for i in range(n + 1))]


def arc_corner(a, b, c, n=8):
    # Coin arrondi approche par une courbe quadratique a -> c, controle b.
    return [tuple((1 - t) ** 2 * x + 2 * (1 - t) * t * y + t * t * z for x, y, z in zip(a, b, c)) for t in (i / n for i in range(n + 1))]


def draw(size, full_bleed, glyph=1.0, badge=False):
    # badge : silhouette blanche sur fond transparent (petite icone de notification Android).
    k = 4  # sur-echantillonnage pour lisser les bords
    S = size * k
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fg, stripe = ((255, 255, 255, 255), (0, 0, 0, 0)) if badge else (CREAM, GREEN)
    if full_bleed and not badge:
        d.rectangle([0, 0, S, S], fill=GREEN)
    elif not badge:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 14 / 64, fill=GREEN)
    u = S / 64 * glyph
    off = (S - 64 * u) / 2
    P = lambda x, y: (off + x * u, off + y * u)
    # Corps du cabas.
    body = [P(14, 26), P(50, 26), P(46, 50)] + [P(*q) for q in arc_corner((46, 50), (45.5, 53), (42, 53))] \
        + [P(22, 53)] + [P(*q) for q in arc_corner((22, 53), (18.5, 53), (18, 50))]
    d.polygon(body, fill=fg)
    # Anse.
    pts = [P(*q) for q in bezier((22, 26), (22, 18), (26, 13), (32, 13)) + bezier((32, 13), (38, 13), (42, 18), (42, 26))]
    w = 4 * u
    d.line(pts, fill=fg, width=round(w), joint='curve')
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=fg)
    # Rayures.
    w = 3 * u
    for x in (26, 32, 38):
        (x0, y0), (x1, y1) = P(x, 34), P(x, 46)
        d.line([(x0, y0), (x1, y1)], fill=stripe, width=round(w))
        for cx, cy in ((x0, y0), (x1, y1)):
            d.ellipse([cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2], fill=stripe)
    return img.resize((size, size), Image.LANCZOS)


def save(img, name, opaque=False):
    if opaque:
        img = img.convert('RGB')
    img.save(os.path.join(OUT, name), optimize=True)
    print(name)


save(draw(192, False), 'icon-192.png')
save(draw(512, False), 'icon-512.png')
save(draw(512, True, 0.78), 'icon-maskable-512.png')   # dessin dans la zone sure (cercle de 80 %)
save(draw(180, True, 0.86), 'apple-touch-icon.png', opaque=True)  # iOS arrondit lui-meme les coins
save(draw(96, True, 1.25, badge=True), 'badge-96.png')  # notifications : Android n'en garde que la transparence
