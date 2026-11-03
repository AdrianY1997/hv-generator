// Comprobacion ATS de la HV impresa: genera el PDF con page.pdf() (medio "print", igual que Imprimir > Guardar como PDF)
// y extrae el texto con PyMuPDF (python -m pip install pymupdf). Herramienta de desarrollo; NO se despliega.
// Uso:  node tools/ats.mjs [--deps <carpeta>] [--out hv.pdf] [--pkg paquete.pdf] [--overlay <carpeta>]
// Verifica: los valores del formulario salen como texto real, los rotulos de seccion no salen duplicados y la interfaz (avisos) no se imprime.
// Segunda parte (paquete PDF, G08): genera el paquete con la UI (hojas rasterizadas + capa de texto invisible) y comprueba con PyMuPDF que
// nombre, cedula, correo, empresa y cargo salen UNA vez por hoja, que el texto esta dentro de la pagina y que las paginas siguen siendo imagen.
// --overlay <carpeta>: guarda un PNG por pagina de la HV con las cajas de palabras extraidas (para revisar a ojo que la capa coincide con la imagen).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium, BASE, server, SEED, settle, arg } from './_lib.mjs';

const out = path.resolve(arg('out', path.join(os.tmpdir(), 'hv-ats.pdf')));
const browser = await chromium.launch();
const page = await (await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } })).newPage();
await page.goto(BASE + '#/perfil'); await page.evaluate(SEED);
await page.goto(BASE + '#/vista-previa'); await page.reload(); await page.waitForSelector('.pv-stage .hv-sheet'); await settle(page, 1200);
const dom = await page.evaluate(() => { const z = document.querySelector('.pv-zoom'); return { svgText: z.querySelectorAll('svg text').length, fieldDivs: z.querySelectorAll('.mv-f').length, notice: !!document.querySelector('.notice') }; });
await page.emulateMedia({ media: 'print' });
fs.writeFileSync(out, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
// ---- Paquete PDF: se genera con el boton real de Vista previa ----
const pkgOut = path.resolve(arg('pkg', path.join(os.tmpdir(), 'hv-ats-paquete.pdf')));
const ctx2 = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page2 = await ctx2.newPage();
await page2.goto(BASE + '#/perfil'); await page2.evaluate(SEED);
await page2.goto(BASE + '#/vista-previa'); await page2.reload(); await page2.waitForSelector('.pv-stage .hv-sheet'); await settle(page2, 1200);
const [dl] = await Promise.all([page2.waitForEvent('download', { timeout: 90000 }), page2.click('#pv-package')]);
await dl.saveAs(pkgOut);
const pkgMsg = await page2.locator('.pv-notice').innerText().catch(() => '');
await browser.close(); server.close();

const py = `import sys, pymupdf
d = pymupdf.open(sys.argv[1]); nl = chr(10)
t = nl.join(p.get_text('text', sort=True) for p in d)
sys.stdout.buffer.write(('PAGES=%d' % len(d)).encode() + nl.encode() + t.encode('utf-8'))`;
const r = spawnSync('python', ['-I', '-c', py, out], { encoding: 'buffer', maxBuffer: 1 << 26 });
if (r.status !== 0) { console.error('No se pudo extraer el texto (falta PyMuPDF?):\n' + r.stderr.toString()); process.exit(2); }
const text = r.stdout.toString('utf8'); const pages = +text.match(/PAGES=(\d+)/)[1];
let fails = 0;
const ok = (name, cond, detail = '') => { if (!cond) fails++; console.log(`${cond ? 'OK  ' : 'FALLA'} ${name}${cond ? '' : '  -> ' + detail}`); };
console.log(`DOM: ${dom.svgText} <text> SVG (rotulos), ${dom.fieldDivs} campos .mv-f (valores)  |  PDF: ${pages} paginas, ${text.length} caracteres  |  ${out}`);
ok('los rotulos de la hoja son texto SVG real (no contornos)', dom.svgText > 100, String(dom.svgText));
for (const v of ['Ana María', 'Pérez Gómez', '1020304050', 'ana.perez@example.com']) ok(`valor extraible del PDF: ${v}`, text.includes(v), 'no aparece');
ok('rotulos de seccion sin duplicar ("IV.IV.")', !/\b([IVX]+\.)\1/.test(text) && !/EDUCACIONEDUCACION/.test(text));
const flat = text.replace(/\s+/g, ' ');
for (const t of ['INFORMACIÓN GENERAL', 'INFORMACIÓN PERSONAL', 'INFORMACIÓN FAMILIAR']) {
  const n = flat.split(t).length - 1;
  ok(`titulo de seccion exactamente una vez (la sombra no es texto): ${t}`, n === 1, `aparece ${n} veces`);
}
ok('la interfaz no se imprime (aviso de privacidad)', !/Tus datos se quedan en este equipo/.test(text), 'aparece el aviso');


// ---------------- Paquete PDF ----------------
console.log(`\nPaquete: ${pkgOut} (${(fs.statSync(pkgOut).size / 1024).toFixed(0)} KB)  ${pkgMsg.trim().slice(0, 120)}`);
const overlay = arg('overlay', '');
if (overlay) fs.mkdirSync(path.resolve(overlay), { recursive: true });
const py2 = `import sys, json, pymupdf
d = pymupdf.open(sys.argv[1]); ov = sys.argv[2]; out = []
for i, p in enumerate(d):
    words = p.get_text('words', sort=True)
    inside = all(-1 <= w[0] and w[2] <= p.rect.width + 1 and -1 <= w[1] and w[3] <= p.rect.height + 1 for w in words)
    out.append({'w': p.rect.width, 'h': p.rect.height, 'imgs': len(p.get_images(full=True)), 'text': p.get_text('text', sort=True), 'inside': inside, 'nwords': len(words)})
    if ov and words:
        for w in words:
            p.draw_rect(pymupdf.Rect(w[:4]), color=(1, 0, 0), width=0.4)
        p.get_pixmap(dpi=100).save(ov + '/pagina-%d.png' % (i + 1))
sys.stdout.buffer.write(json.dumps(out).encode('ascii'))`;
const r2 = spawnSync('python', ['-I', '-c', py2, pkgOut, overlay ? path.resolve(overlay) : ''], { encoding: 'buffer', maxBuffer: 1 << 28 });
if (r2.status !== 0) { console.error('PyMuPDF fallo en el paquete:\n' + r2.stderr.toString()); process.exit(2); }
const pk = JSON.parse(r2.stdout.toString('ascii'));
const hvPages = pk.filter((p) => p.nwords > 0 && p.imgs > 0);
const all = pk.map((p) => p.text).join('\n').replace(/\s+/g, ' ');
const cnt = (t) => all.split(t).length - 1;
ok('el paquete tiene paginas de la HV con imagen y capa de texto', hvPages.length >= 4, `${hvPages.length} paginas con texto`);
ok('el texto invisible cae dentro de la pagina', pk.every((p) => p.inside));
ok('la capa trae texto suficiente en cada hoja', hvPages.every((p) => p.nwords > 25), hvPages.map((p) => p.nwords).join(','));
for (const v of ['Ana María', 'Pérez Gómez', 'ana.perez@example.com', 'Empresa o entidad 1', 'Cargo 1']) ok(`paquete: "${v}" una vez`, cnt(v) === 1, `aparece ${cnt(v)} veces`);
ok('paquete: la cedula sale una vez por pagina donde esta (paginas 1 y 4)', pk.filter((p) => p.text.includes('1020304050')).length === 2 && pk.every((p) => p.text.split('1020304050').length - 1 <= 1));
for (const t of ['INFORMACIÓN GENERAL', 'INFORMACIÓN PERSONAL', 'INFORMACIÓN FAMILIAR']) ok(`paquete: titulo una vez: ${t}`, cnt(t) === 1, `aparece ${cnt(t)} veces`);
ok('paquete: sin rotulos duplicados ("IV.IV.")', !/\b([IVX]+\.)\s*\1/.test(all));
console.log(fails ? `\n${fails} comprobaciones fallidas` : '\nTodo correcto (incluido el paquete)');
process.exit(fails ? 1 : 0);
