// Recorrido SOLO con teclado del flujo principal de HV Minerva (Playwright). Herramienta de desarrollo; NO se despliega.
// Uso:  node tools/keyboard.mjs [--deps <carpeta>]      Sale con codigo 1 si algun paso falla.
// Comprueba: enlace "Saltar al contenido", orden de tabulacion con foco visible, secciones del perfil, alta/baja de registros,
// editor de foto (foco dentro del dialogo, Esc, retorno del foco, flechas y +/- sobre el encuadre), selector de documentos,
// editor de plantillas (casillas con Espacio, guardar con Enter) y cambio de tema.
import { chromium, BASE, server, SEED, png, settle } from './_lib.mjs';

const steps = [];
const ok = (name, cond, detail = '') => { steps.push({ name, pass: !!cond, detail }); console.log(`${cond ? 'OK  ' : 'FALLA'} ${name}${cond ? '' : '  -> ' + detail}`); };
const consoleErrors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror ' + e.message));
page.on('dialog', (d) => d.accept().catch(() => {}));

// Playwright activa la interceptacion del selector de archivos de forma asincrona: se espera antes de pulsar (si no, carrera intermitente).
const chooserAfter = async (action) => { const p = page.waitForEvent('filechooser'); await settle(page, 250); await action(); return p; };
const tab = async (n = 1, shift = false) => { for (let i = 0; i < n; i++) await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab'); };
// Descripcion corta del elemento enfocado + si tiene indicador de foco visible (outline o sombra).
const focused = () => page.evaluate(() => {
  const e = document.activeElement; if (!e || e === document.body) return { tag: 'body', name: '', visible: false };
  const s = getComputedStyle(e);
  const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2;
  const shadow = s.boxShadow !== 'none';
  const name = (e.getAttribute('aria-label') || e.textContent || e.value || e.id || '').trim().replace(/\s+/g, ' ').slice(0, 50);
  return { tag: e.tagName.toLowerCase(), name, visible: outline || shadow, inDialog: !!e.closest('dialog[open]') };
});
const focusRing = async (label) => { const f = await focused(); ok(`foco visible: ${label}`, f.visible, JSON.stringify(f)); return f; };

await page.goto(BASE + '#/perfil');
await page.evaluate(SEED);
await page.goto(BASE + '#/perfil'); await page.reload(); await page.waitForSelector('#app h1'); await settle(page, 500);
// El aviso de privacidad es parte del orden de tabulacion: se descarta con teclado mas abajo.

// 1. Saltar al contenido
await tab(); let f = await focused();
ok('primer Tab = "Saltar al contenido"', /Saltar al contenido/.test(f.name), JSON.stringify(f));
await page.keyboard.press('Enter');
ok('Enter en el enlace lleva el foco a <main>', (await page.evaluate(() => document.activeElement?.id)) === 'app');

// 2. Cabecera: marca, modelo, 5 enlaces, tema (ordenado, con foco visible)
await page.focus('.skip'); await tab(); // tras el enlace: marca, modelo, 5 enlaces, tema
const header = [];
for (let i = 0; i < 8; i++) { f = await focused(); header.push(f); await tab(); }
const names = header.map((x) => x.name).join(' | ');
ok('orden de cabecera: marca, modelo, navegacion, tema', /HV Minerva/.test(header[0].name) && header[1].tag === 'select' && /Perfil/.test(header[2].name) && /Ajustes/.test(header[6].name) && /tema/i.test(header[7].name), names);
ok('todos los controles de la cabecera muestran foco', header.every((x) => x.visible), names);

// 3. Tema con teclado
await page.focus('#theme-toggle');
const before = await page.evaluate(() => document.documentElement.dataset.theme || '');
await page.keyboard.press('Enter');
ok('Enter en el boton de tema cambia el tema', (await page.evaluate(() => document.documentElement.dataset.theme || '')) !== before);
await page.keyboard.press('Space');

// 4. Aviso de privacidad: descartarlo con teclado
const gotIt = page.getByRole('button', { name: 'Entendido' });
if (await gotIt.count()) { await gotIt.focus(); await focusRing('boton Entendido'); await page.keyboard.press('Enter'); }
ok('aviso de privacidad descartable con Enter', (await page.locator('[data-notice=privacy]').count()) === 0);

// 5. Perfil: secciones con Enter/Espacio (el foco pasa al h2) y campos
await page.focus('.mn-sidenav button:nth-child(2)');
await focusRing('boton de seccion');
await page.keyboard.press('Enter');
f = await focused();
ok('Enter en una seccion mueve el foco a su titulo (h2)', f.tag === 'h2', JSON.stringify(f));
await page.focus('.mn-sidenav button:nth-child(1)'); await page.keyboard.press('Space');
await tab(2); // tras el h2 -> primer campo
f = await focused();
ok('Tab tras la seccion llega a un campo del formulario', ['input', 'select', 'textarea', 'button'].includes(f.tag), JSON.stringify(f));
await page.keyboard.press('Escape');

// 6. Registros repetibles: agregar, mover, eliminar (confirm aceptado)
const nSec = await page.locator('.mn-sidenav button').count();
for (let i = 1; i <= nSec; i++) { await page.focus(`.mn-sidenav button:nth-child(${i})`); await page.keyboard.press('Enter'); await settle(page, 120); if (await page.locator('.sec-title__act:visible').count()) break; }
const nBefore = await page.locator('.items > li.item').count();
const addBtn = page.locator('.sec-title__act');
await addBtn.focus(); await page.keyboard.press('Enter'); await settle(page, 200);
ok('Agregar registro con Enter lo crea y enfoca su primer campo', (await page.locator('.items > li.item').count()) === nBefore + 1 && (await focused()).tag !== 'body', String(await page.locator('.items > li.item').count()));
await page.locator('.item-del').last().focus(); await focusRing('Eliminar registro'); await page.keyboard.press('Enter'); await settle(page, 300);
ok('Eliminar registro con teclado', (await page.locator('.items > li.item').count()) === nBefore);

// 7. Foto: editor accesible
await page.focus('.mn-sidenav button:nth-child(2)'); await page.keyboard.press('Enter'); await settle(page, 200);
const photoBtn = page.getByRole('button', { name: /Elegir fotografía|Reemplazar: Fotografía/ }).first();
await photoBtn.focus(); await focusRing('boton Elegir fotografia');
const fc = await chooserAfter(() => page.keyboard.press('Enter'));
await fc.setFiles({ name: 'foto.png', mimeType: 'image/png', buffer: await png(page) });
await page.waitForSelector('dialog.pe-dialog[open]'); await settle(page, 600);
f = await focused();
ok('al abrir el editor de foto el foco queda dentro del dialogo', f.inDialog, JSON.stringify(f));
let escaped = false;
for (let i = 0; i < 30; i++) { await tab(); const g = await focused(); if (g.tag !== 'body' && !g.inDialog) { escaped = true; break; } }
ok('el foco queda atrapado en el dialogo (30 Tab)', !escaped);
// flechas y +/- sobre el encuadre
await page.focus('.pe-stage'); await focusRing('encuadre de la foto');
const zoom0 = await page.inputValue('.pe-ctrl input[type=range]');
await page.keyboard.press('+'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp');
ok('"+" acerca la foto desde el teclado', (await page.inputValue('.pe-ctrl input[type=range]')) !== zoom0);
const sl = page.locator('.pe-ctrl input[type=range]').nth(1); await sl.focus(); await focusRing('control de brillo'); const b0 = await sl.inputValue(); await page.keyboard.press('ArrowRight');
ok('flechas mueven el control deslizante de brillo', (await sl.inputValue()) !== b0);
await page.keyboard.press('Escape'); await settle(page, 300);
ok('Esc cierra el editor', (await page.locator('dialog.pe-dialog').count()) === 0);
f = await focused();
ok('al cerrar, el foco vuelve al boton que abrio el editor', /fotograf/i.test(f.name) && f.tag === 'button', JSON.stringify(f));
// guardar la foto con teclado y comprobar que el foco no se pierde
const fc2 = await chooserAfter(() => page.keyboard.press('Enter'));
await fc2.setFiles({ name: 'foto.png', mimeType: 'image/png', buffer: await png(page) });
await page.waitForSelector('dialog.pe-dialog[open]'); await settle(page, 600);
await page.getByRole('button', { name: 'Guardar foto' }).focus(); await page.keyboard.press('Enter'); await settle(page, 800);
f = await focused();
ok('tras guardar la foto el foco no se pierde en <body>', f.tag !== 'body', JSON.stringify(f));

// 8. Navegacion entre vistas: el foco pasa al h1
await page.focus('.mn-nav a[data-path="/documentos"]'); await page.keyboard.press('Enter'); await page.waitForSelector('.documentos'); await settle(page, 400);
f = await focused();
ok('al cambiar de vista el foco pasa al titulo (h1)', f.tag === 'h1', JSON.stringify(f));
ok('el titulo de la ventana refleja la vista', /Documentos/.test(await page.title()));

// 9. Documentos: selector (dialogo), casillas con Espacio, Esc y retorno del foco
await page.focus('#doc-add'); await page.keyboard.press('Enter'); await page.waitForSelector('dialog.doc-picker[open]');
f = await focused(); ok('el selector de documentos enfoca un control dentro del dialogo', f.inDialog, JSON.stringify(f));
const cb = page.locator('dialog.doc-picker input[type=checkbox]').first(); await cb.focus(); await focusRing('casilla del selector');
const c0 = await cb.isChecked(); await page.keyboard.press('Space');
ok('Espacio alterna la casilla del selector', (await cb.isChecked()) !== c0);
await page.keyboard.press('Space');
escaped = false; for (let i = 0; i < 40; i++) { await tab(); const g = await focused(); if (g.tag !== 'body' && !g.inDialog) { escaped = true; break; } }
ok('foco atrapado en el selector (40 Tab)', !escaped);
await page.keyboard.press('Escape'); await settle(page, 250);
f = await focused(); ok('al cerrar el selector el foco vuelve a "Anadir documento"', f.name.includes('Añadir documento'), JSON.stringify(f));
// filas: adjuntar con teclado
const att = page.getByRole('button', { name: /^Adjuntar/ }).first(); await att.focus(); await focusRing('Adjuntar');
const fc3 = await chooserAfter(() => page.keyboard.press('Enter'));
await fc3.setFiles({ name: 'c.png', mimeType: 'image/png', buffer: await png(page) }); await settle(page, 900);
f = await focused(); ok('tras adjuntar el foco no se pierde en <body>', f.tag !== 'body', JSON.stringify(f));
await page.getByRole('button', { name: /^Eliminar archivo/ }).first().focus(); await page.keyboard.press('Enter'); await settle(page, 500);
f = await focused(); ok('tras quitar el archivo el foco no se pierde en <body>', f.tag !== 'body', JSON.stringify(f));
const det = page.locator('details.doc-how > summary').first(); await det.focus(); await focusRing('"Como obtenerlo"'); await page.keyboard.press('Enter');
ok('Enter abre/cierra el bloque plegable', await page.evaluate(() => document.querySelector('details.doc-how').open));

// 10. Plantillas: editar, casillas, guardar
await page.focus('.mn-nav a[data-path="/plantillas"]'); await page.keyboard.press('Enter'); await page.waitForSelector('.plantillas .tpl-card'); await settle(page, 300);
await page.getByRole('button', { name: /^Editar plantilla/ }).first().focus(); await page.keyboard.press('Enter'); await page.waitForSelector('form.tpl-form');
f = await focused(); ok('el editor de plantilla enfoca el campo Nombre', f.tag === 'input', JSON.stringify(f));
const chk = page.locator('.tpl-form .tpl-sec-head input[type=checkbox]').first(); await chk.focus(); await focusRing('casilla de seccion');
const k0 = await chk.isChecked(); await page.keyboard.press('Space');
ok('Espacio alterna la casilla de una seccion', (await chk.isChecked()) !== k0);
await page.keyboard.press('Space');
await page.getByRole('button', { name: 'Guardar plantilla' }).focus(); await page.keyboard.press('Enter'); await page.waitForSelector('.tpl-list'); await settle(page, 300);
f = await focused(); ok('tras guardar la plantilla el foco pasa al titulo', f.tag === 'h1', JSON.stringify(f));

// 11. Vista previa: region desplazable con teclado
await page.focus('.mn-nav a[data-path="/vista-previa"]'); await page.keyboard.press('Enter'); await page.waitForSelector('.pv-stage'); await settle(page, 900);
await page.focus('.pv-stage'); const sc0 = await page.evaluate(() => document.querySelector('.pv-stage').scrollTop);
await page.keyboard.press('PageDown'); await settle(page, 200);
ok('la vista previa se enfoca y se desplaza con el teclado', (await page.evaluate(() => document.querySelector('.pv-stage').scrollTop)) > sc0);

ok('sin errores de consola durante el recorrido', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
await browser.close(); server.close();
const fails = steps.filter((s) => !s.pass);
console.log(`\n${steps.length - fails.length}/${steps.length} pasos correctos`);
process.exit(fails.length ? 1 : 0);
