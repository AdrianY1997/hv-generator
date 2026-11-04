"""Fidelidad de un modelo frente a su PDF oficial (herramienta de desarrollo; PyMuPDF + Pillow + numpy).

  python -I docs/design/model-compare.py refs <pdf> <carpeta>          Dibuja cada pagina del PDF a 96 dpi (MuPDF) como <carpeta>/ref-96dpi-<n>.png.
                                                                       Son las referencias que usa tests-e2e/specs/modelos-fidelidad.spec.mjs.
  python -I docs/design/model-compare.py diff <pdf> <prefijo-png>      Compara <prefijo>-<n>.png (captura del render en blanco, 816x1056) con la
                                                                       pagina n del PDF: diferencia media por pixel (0-255) con el mejor
                                                                       desplazamiento de +-2 px.
El PDF es un dato externo: ejecutar siempre con python -I."""
import sys
import numpy as np
import pymupdf
from PIL import Image


def ref_pages(pdf):
    d = pymupdf.open(pdf)
    for p in d:
        pix = p.get_pixmap(dpi=96, alpha=False)
        yield Image.frombytes('RGB', (pix.w, pix.h), pix.samples)


def mean_diff(ref, got, r=2):
    a0, b0 = np.asarray(ref, dtype=np.int16), np.asarray(got.convert('RGB'), dtype=np.int16)
    h, w = min(a0.shape[0], b0.shape[0]), min(a0.shape[1], b0.shape[1])
    best = None
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            a = a0[max(0, dy):h + min(0, dy), max(0, dx):w + min(0, dx)]
            b = b0[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)]
            hh, ww = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
            m = float(np.abs(a[:hh, :ww] - b[:hh, :ww]).mean())
            if best is None or m < best[0]: best = (m, dx, dy)
    return best


def main():
    cmd, pdf, arg = sys.argv[1], sys.argv[2], sys.argv[3]
    if cmd == 'refs':
        for i, im in enumerate(ref_pages(pdf)):
            im.save('%s/ref-96dpi-%d.png' % (arg, i + 1), optimize=True)
            print('ref', i + 1, im.size)
    elif cmd == 'diff':
        for i, im in enumerate(ref_pages(pdf)):
            m, dx, dy = mean_diff(im, Image.open('%s-%d.png' % (arg, i + 1)))
            print('hoja %d: diferencia media %.2f/255 (dx=%d, dy=%d)' % (i + 1, m, dx, dy))
    else:
        raise SystemExit(__doc__)


main()
