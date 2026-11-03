"""Extrae de docs/minerva.pdf la geometria vectorial, el texto estatico y los campos (widgets)
y genera app/js/models/minerva-layout.js. Uso:  python docs/design/minerva-extract.py
Requiere: pip install pymupdf. Es una herramienta de desarrollo; la app no la usa en ejecucion."""
import json, os, re, sys, html
import pymupdf

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'docs', 'minerva.pdf')
OUT = os.path.join(ROOT, 'app', 'js', 'models', 'minerva-layout.js')

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
    i = 'italic' in low or bool(flags & 2)
    return 'bi' if b and i else 'b' if b else 'i' if i else 'a'

def main():
    d = pymupdf.open(SRC)
    pages = []
    for p in d:
        notes = [a.rect for a in p.annots()]
        svg = []
        for dr in p.get_drawings():
            r = dr['rect']
            if any(r.x0 >= a.x0 - 1 and r.x1 <= a.x1 + 1 and r.y0 >= a.y0 - 1 and r.y1 <= a.y1 + 1 for a in notes): continue
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
            svg.append('<path %s/>' % ' '.join(a))
        for b in p.get_text('dict')['blocks']:
            for l in b.get('lines', []):
                for s in l['spans']:
                    if not s['text'].strip(): continue
                    x0, y0, x1, y1 = s['bbox']; ox, oy = s['origin']
                    vert = abs(l['dir'][0]) < .5
                    length = (y1 - y0) if vert else (x1 - x0)
                    txt = s['text'].rstrip() if not s['text'].rstrip() == '' else s['text']
                    if txt != s['text']:  # el bbox incluye el espacio final: se mide proporcional
                        length = length * len(txt) / max(1, len(s['text']))
                    cls = font_class(s['font'], s['flags'])
                    a = ['x="%s" y="%s"' % (n(ox), n(oy)), 'class="f%s"' % cls, 'font-size="%s"' % n(s['size'])]
                    c = s['color']
                    if c != 0: a.append('fill="#%06x"' % c)
                    a.append('textLength="%s" lengthAdjust="spacingAndGlyphs"' % n(length))
                    if vert: a.append('transform="rotate(-90 %s %s)"' % (n(ox), n(oy)))
                    svg.append('<text %s xml:space="preserve">%s</text>' % (' '.join(a), html.escape(txt, quote=False)))
        wid = {}
        for w in p.widgets():
            m = re.search(r'\.(\w+?)\[(\d+)\]$', w.field_name)
            if not m: continue
            kind = {'Text': 't', 'CheckBox': 'c', 'Button': 'b'}.get(w.field_type_string)
            if not kind or (kind == 't' and w.field_name.find('CampoTexto1') >= 0): continue
            r = w.rect
            wid[kind + m.group(2)] = [round(r.x0, 1), round(r.y0, 1), round(r.width, 1), round(r.height, 1)]
        pages.append({'svg': ''.join(svg), 'w': wid})
    body = json.dumps({'width': 612, 'height': 792, 'pages': pages}, ensure_ascii=False, separators=(',', ':'))
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// GENERADO por docs/design/minerva-extract.py a partir de docs/minerva.pdf. No editar a mano.\n'
                '// pages[i].svg: geometria + texto estatico (pt, origen arriba-izq). pages[i].w: campos {t#,c#,b#:[x,y,w,h]}.\n'
                'export default ' + body + ';\n')
    print('ok', OUT, os.path.getsize(OUT))

main()
