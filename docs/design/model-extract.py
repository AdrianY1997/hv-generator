"""Extractor generico de un formulario PDF para un modelo de HV: geometria vectorial, imagenes, texto estatico y cajas de campos.
Genera el modulo app/js/models/<id>-layout.js que usa el render del modelo. Herramienta de desarrollo: la app no la usa en ejecucion.

Uso (PyMuPDF: pip install pymupdf; ejecutar con -I porque el PDF es un dato externo):
  python -I docs/design/model-extract.py <pdf> <salida.js> [--fields cajas.json] [--legacy] [--tool texto]

  --fields  JSON {"pages":[{"clave":[x,y,w,h], ...}, ...]} con las cajas medidas a mano (pt, origen arriba-izq) para un PDF sin campos
            AcroForm (p. ej. docs/design/formato-unico-fields.json). Se suman a los widgets del PDF, si los hay.
  --legacy  Reproduce exactamente docs/design/minerva-extract.py (trazados primero, luego texto; widgets t#/c#/b#). Sirve para comprobar
            que este extractor no cambia el modelo Minerva: la salida coincide byte a byte con app/js/models/minerva-layout.js (salvo la
            linea de cabecera, que nombra la herramienta; con --tool se iguala tambien).
  Sin --legacy (modo "pintura"): se respeta el orden de pintado del PDF (seqno): trazados, imagenes y texto se intercalan como en el
            original, de modo que lo que el PDF tapa (p. ej. un rectangulo blanco sobre un texto viejo) queda tapado. Ademas:
            - el texto totalmente cubierto por un relleno opaco posterior no se emite (no llega a la capa de texto ni al ATS);
            - el texto invisible (modo 3) u opacidad 0 no se emite;
            - las copias exactas de un mismo texto se emiten una vez; una copia casi superpuesta (<1.5 pt: falsa negrita o sombra)
              se marca data-sh="1" con filter:opacity(.999) (mismo trato que minerva.js: se ve, pero no es texto extraible);
            - el ancho (textLength) se mide de glifo a glifo, sin espacios iniciales ni finales;
            - las fuentes que no son Arial/Helvetica llevan su familia en linea (p. ej. Verdana cursiva).
"""
import argparse, base64, html, json, os, re
import pymupdf


def hexc(c):
    return '#%02x%02x%02x' % tuple(round(v * 255) for v in c)


def n(v):
    s = ('%.2f' % v).rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def path_d(items, closed):
    out, last = [], None
    def pt(p): return n(p.x) + ' ' + n(p.y)
    for it in items:
        k = it[0]
        if k == 're':
            r = it[1]
            out.append('M%s %sH%sV%sH%sZ' % (n(r.x0), n(r.y0), n(r.x1), n(r.y1), n(r.x0))); last = None
        elif k == 'qu':
            q = it[1]
            out.append('M%sL%sL%sL%sZ' % (pt(q.ul), pt(q.ur), pt(q.lr), pt(q.ll))); last = None
        elif k == 'l':
            if last is None or abs(last.x - it[1].x) > .01 or abs(last.y - it[1].y) > .01: out.append('M' + pt(it[1]))
            out.append('L' + pt(it[2])); last = it[2]
        elif k == 'c':
            if last is None or abs(last.x - it[1].x) > .01 or abs(last.y - it[1].y) > .01: out.append('M' + pt(it[1]))
            out.append('C%s %s %s' % (pt(it[2]), pt(it[3]), pt(it[4]))); last = it[4]
    if closed: out.append('Z')
    return ''.join(out)


def font_class(name, flags):
    low = name.lower()
    if 'black' in low: return 'k'
    b = 'bold' in low or bool(flags & 16)
    i = 'italic' in low or 'oblique' in low or bool(flags & 2)
    return 'bi' if b and i else 'b' if b else 'i' if i else 'a'


def font_family(name):
    """Familia en linea para las fuentes que paper.css no cubre (sus clases fa/fb/fi/fbi/fk son Arial)."""
    low = name.lower().split('+')[-1]
    if 'verdana' in low: return "Verdana,'DejaVu Sans',Geneva,sans-serif"
    if 'times' in low: return "'Times New Roman',Times,'Liberation Serif',serif"
    if 'courier' in low: return "'Courier New',Courier,'Liberation Mono',monospace"
    return None


def drawing_svg(dr):
    t = dr['type']
    a = ['d="%s"' % path_d(dr['items'], dr.get('closePath'))]
    fill = dr.get('fill') if 'f' in t else None
    stroke = dr.get('color') if 's' in t else None
    a.append('fill="%s"' % (hexc(fill) if fill else 'none'))
    if fill and dr.get('fill_opacity', 1) not in (1, None): a.append('fill-opacity="%s"' % n(dr['fill_opacity']))
    if dr.get('even_odd'): a.append('fill-rule="evenodd"')
    if stroke:
        a.append('stroke="%s"' % hexc(stroke)); a.append('stroke-width="%s"' % n(dr.get('width') or 1))
        if dr.get('lineCap') and dr['lineCap'][0] == 1: a.append('stroke-linecap="round"')
        if dr.get('lineJoin') == 1: a.append('stroke-linejoin="round"')
        ds = dr.get('dashes') or ''
        m = re.match(r'\[\s*([\d.\s]+)\]', ds)
        if m and m.group(1).strip(): a.append('stroke-dasharray="%s"' % m.group(1).strip())
    return '<path %s/>' % ' '.join(a)


def widgets(p):
    wid = {}
    for w in p.widgets():
        m = re.search(r'\.(\w+?)\[(\d+)\]$', w.field_name or '')
        if not m: continue
        kind = {'Text': 't', 'CheckBox': 'c', 'Button': 'b'}.get(w.field_type_string)
        if not kind or (kind == 't' and w.field_name.find('CampoTexto1') >= 0): continue
        r = w.rect
        wid[kind + m.group(2)] = [round(r.x0, 1), round(r.y0, 1), round(r.width, 1), round(r.height, 1)]
    return wid


# ---------- Modo legado: idéntico a docs/design/minerva-extract.py ----------
def legacy_page(p):
    notes = [a.rect for a in p.annots()]
    svg = []
    for dr in p.get_drawings():
        r = dr['rect']
        if any(r.x0 >= a.x0 - 1 and r.x1 <= a.x1 + 1 and r.y0 >= a.y0 - 1 and r.y1 <= a.y1 + 1 for a in notes): continue
        svg.append(drawing_svg(dr))
    for b in p.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                if not s['text'].strip(): continue
                x0, y0, x1, y1 = s['bbox']; ox, oy = s['origin']
                vert = abs(l['dir'][0]) < .5
                length = (y1 - y0) if vert else (x1 - x0)
                txt = s['text'].rstrip() if not s['text'].rstrip() == '' else s['text']
                if txt != s['text']:
                    length = length * len(txt) / max(1, len(s['text']))
                cls = font_class(s['font'], s['flags'])
                a = ['x="%s" y="%s"' % (n(ox), n(oy)), 'class="f%s"' % cls, 'font-size="%s"' % n(s['size'])]
                c = s['color']
                if c != 0: a.append('fill="#%06x"' % c)
                a.append('textLength="%s" lengthAdjust="spacingAndGlyphs"' % n(length))
                if vert: a.append('transform="rotate(-90 %s %s)"' % (n(ox), n(oy)))
                svg.append('<text %s xml:space="preserve">%s</text>' % (' '.join(a), html.escape(txt, quote=False)))
    return ''.join(svg)


# ---------- Modo pintura ----------
def opaque_rect(dr):
    """Rectangulo de un relleno opaco simple (un solo 're'/'qu' recto), o None."""
    if 'f' not in dr['type'] or (dr.get('fill_opacity') or 1) < 1 or not dr.get('fill'): return None
    its = dr['items']
    if len(its) != 1 or its[0][0] not in ('re', 'qu'): return None
    return dr['rect']


def paint_page(doc, p):
    notes = [a.rect for a in p.annots()]
    items = []  # (seqno, orden, svg)
    covers = []  # (seqno, rect) rellenos opacos
    for k, dr in enumerate(p.get_drawings()):
        r = dr['rect']
        if any(r.x0 >= a.x0 - 1 and r.x1 <= a.x1 + 1 and r.y0 >= a.y0 - 1 and r.y1 <= a.y1 + 1 for a in notes): continue
        items.append((dr['seqno'], k, drawing_svg(dr)))
        rr = opaque_rect(dr)
        if rr is not None: covers.append((dr['seqno'], rr))
    # Imágenes: su seqno es su índice en el registro de pintado (bboxlog).
    log = p.get_bboxlog()
    img_seq = [(i, pymupdf.Rect(b[1])) for i, b in enumerate(log) if b[0] == 'fill-image']
    for info in p.get_image_info(xrefs=True):
        xref = info.get('xref') or 0
        if not xref: continue
        bb = pymupdf.Rect(info['bbox'])
        seq = next((i for i, r in img_seq if abs(r.x0 - bb.x0) < .5 and abs(r.y0 - bb.y0) < .5), 0)
        x = doc.extract_image(xref)
        if x.get('ext') in ('png', 'jpeg', 'jpg') and not x.get('smask'):
            mime, data = ('image/png' if x['ext'] == 'png' else 'image/jpeg'), x['image']
        else:
            pix = pymupdf.Pixmap(doc, xref)
            if x.get('smask'): pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(doc, x['smask']))
            if pix.n - pix.alpha > 3: pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
            mime, data = 'image/png', pix.tobytes('png')
        href = 'data:%s;base64,%s' % (mime, base64.b64encode(data).decode('ascii'))
        items.append((seq, 0, '<image x="%s" y="%s" width="%s" height="%s" preserveAspectRatio="none" href="%s"/>' % (n(bb.x0), n(bb.y0), n(bb.width), n(bb.height), href)))
    # Texto: seqno, modo y opacidad vienen de get_texttrace (por glifo); la forma (spans, glifos) de rawdict.
    seq_at, hidden_at = {}, set()
    for s in p.get_texttrace():
        invisible = s.get('type') == 3 or (s.get('opacity', 1) or 0) <= 0
        for c in s['chars']:
            key = (round(c[2][0], 1), round(c[2][1], 1))
            seq_at.setdefault(key, s['seqno'])
            if invisible: hidden_at.add(key)
    def seq_of(origin):
        key = (round(origin[0], 1), round(origin[1], 1))
        if key in seq_at: return seq_at[key], key in hidden_at
        best = min(seq_at.items(), key=lambda kv: abs(kv[0][0] - key[0]) + abs(kv[0][1] - key[1]), default=None)
        return (best[1], best[0] in hidden_at) if best else (0, False)
    spans = []
    for b in p.get_text('rawdict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                chars = s.get('chars') or []
                kept = [c for c in chars]
                while kept and not kept[0]['c'].strip(): kept.pop(0)
                while kept and not kept[-1]['c'].strip(): kept.pop()
                if not kept: continue
                txt = ''.join(c['c'] for c in kept)
                vert = abs(l['dir'][0]) < .5
                ox, oy = kept[0]['origin']
                bb0, bb1 = kept[0]['bbox'], kept[-1]['bbox']
                length = (max(bb0[3], bb1[3]) - min(bb0[1], bb1[1])) if vert else (bb1[2] - bb0[0])
                box = pymupdf.Rect(min(c['bbox'][0] for c in kept), min(c['bbox'][1] for c in kept), max(c['bbox'][2] for c in kept), max(c['bbox'][3] for c in kept))
                seq, hidden = seq_of(kept[0]['origin'])
                if hidden: continue
                if any(cs > seq and cr.x0 - .5 <= box.x0 and cr.y0 - .5 <= box.y0 and cr.x1 + .5 >= box.x1 and cr.y1 + .5 >= box.y1 for cs, cr in covers): continue
                spans.append({'txt': txt, 'x': ox, 'y': oy, 'len': length, 'vert': vert, 'font': s['font'], 'flags': s['flags'], 'size': s['size'], 'color': s['color'], 'seq': seq})
    # Copias: exacta -> se queda la última (la que se ve encima); casi superpuesta -> la anterior es sombra (data-sh).
    out_spans = []
    for i, s in enumerate(spans):
        later = [q for q in spans[i + 1:] if q['txt'] == s['txt'] and q['color'] == s['color']]
        if any(abs(q['x'] - s['x']) < .3 and abs(q['y'] - s['y']) < .3 for q in later): continue
        s['sh'] = any(abs(q['x'] - s['x']) < 1.5 and abs(q['y'] - s['y']) < 1.5 for q in later)
        out_spans.append(s)
    for k, s in enumerate(out_spans):
        a = ['x="%s" y="%s"' % (n(s['x']), n(s['y'])), 'class="f%s"' % font_class(s['font'], s['flags']), 'font-size="%s"' % n(s['size'])]
        style = []
        fam = font_family(s['font'])
        if fam: style.append('font-family:' + fam)
        if s['sh']: style.append('filter:opacity(.999)')
        if s['color'] != 0: a.append('fill="#%06x"' % s['color'])
        a.append('textLength="%s" lengthAdjust="spacingAndGlyphs"' % n(s['len']))
        if s['vert']: a.append('transform="rotate(-90 %s %s)"' % (n(s['x']), n(s['y'])))
        if s['sh']: a.insert(0, 'data-sh="1"')
        if style: a.append('style="%s"' % html.escape(';'.join(style)))
        items.append((s['seq'], 100000 + k, '<text %s xml:space="preserve">%s</text>' % (' '.join(a), html.escape(s['txt'], quote=False))))
    items.sort(key=lambda it: (it[0], it[1]))
    return ''.join(it[2] for it in items)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf'); ap.add_argument('out')
    ap.add_argument('--fields'); ap.add_argument('--legacy', action='store_true'); ap.add_argument('--tool', default='docs/design/model-extract.py')
    a = ap.parse_args()
    d = pymupdf.open(a.pdf)
    extra = json.load(open(a.fields, encoding='utf-8'))['pages'] if a.fields else []
    pages = []
    for i, p in enumerate(d):
        w = widgets(p)
        for k, v in (extra[i] if i < len(extra) else {}).items():
            if k.startswith('_'): continue
            w[k] = [round(float(x), 2) for x in v]
        pages.append({'svg': legacy_page(p) if a.legacy else paint_page(d, p), 'w': w})
    r0 = d[0].rect
    body = json.dumps({'width': round(r0.width, 2) if r0.width % 1 else int(r0.width), 'height': round(r0.height, 2) if r0.height % 1 else int(r0.height), 'pages': pages}, ensure_ascii=False, separators=(',', ':'))
    src = a.pdf.replace('\\', '/')
    rel = re.sub(r'^.*?/(docs/)', r'\1', src)
    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// GENERADO por %s a partir de %s. No editar a mano.\n' % (a.tool, rel)
                + ('// pages[i].svg: geometria + texto estatico (pt, origen arriba-izq). pages[i].w: campos {t#,c#,b#:[x,y,w,h]}.\n' if a.legacy else
                   '// pages[i].svg: geometria, imagenes y texto estatico en orden de pintado (pt, origen arriba-izq). pages[i].w: cajas {clave:[x,y,w,h]} (widgets del PDF y --fields).\n')
                + 'export default ' + body + ';\n')
    print('ok', a.out, os.path.getsize(a.out))


main()
