# Détoure le fond vert de l'image Flow et découpe les 4 coureurs en PNG transparents.
# Usage : python assets-src/decoupe.py
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = 'assets-src/coureurs-flow.jpg'
NAMES = ['homme-bleu', 'femme-bleu', 'homme-rouge', 'femme-rouge']
HEIGHT = 280  # px de haut, soit 2x la taille affichée

img = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
green = g - np.maximum(r, b)              # forte valeur = fond vert
alpha = np.clip((90 - green) / 50, 0, 1)  # transition douce sur les bords

# Retire le reflet vert sur les contours
rgb = img.copy()
rgb[..., 1] = np.minimum(g, np.maximum(r, b) + 10)

# Les coureurs se chevauchent en colonnes (main de l'un au-dessus du pied du suivant) :
# on les sépare par composantes connexes. Les 4 plus grandes sont les corps, les petits
# morceaux détachés (mèches, semelles) rejoignent le corps le plus proche.
labels, n = ndimage.label(alpha > 0.5)
index = range(1, n + 1)
sizes = ndimage.sum(np.ones_like(alpha), labels, index)
centers = ndimage.center_of_mass(np.ones_like(alpha), labels, index)
bodies = sorted(np.argsort(sizes)[-4:], key=lambda i: centers[i][1])
owner = np.zeros(labels.shape, dtype=np.int32)
for i in range(n):
    if sizes[i] < 30:
        continue
    cy, cx = centers[i]
    k = min(range(4), key=lambda j: (centers[bodies[j]][0] - cy) ** 2 + (centers[bodies[j]][1] - cx) ** 2)
    owner[labels == i + 1] = k + 1
# Le halo semi-transparent autour suit le pixel attribué le plus proche
_, (iy, ix) = ndimage.distance_transform_edt(owner == 0, return_indices=True)
owner = owner[iy, ix]
print('composantes :', n, '- corps :', [int(sizes[i]) for i in bodies])

out = np.dstack([rgb, alpha * 255]).clip(0, 255).astype(np.uint8)
for k, name in enumerate(NAMES):
    mine = out.copy()
    mine[..., 3] = np.where(owner == k + 1, mine[..., 3], 0)
    ys, xs = np.where(mine[..., 3] > 128)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    pad = 4
    crop = Image.fromarray(mine[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad], 'RGBA')
    w = round(crop.width * HEIGHT / crop.height)
    crop = crop.resize((w, HEIGHT), Image.LANCZOS)
    crop.save(f'public/img/{name}.png', optimize=True)
    print(name, crop.size)
