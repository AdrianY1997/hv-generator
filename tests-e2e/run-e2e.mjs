// Ejecuta la suite e2e completa de forma repetible: Chromium (todo) y luego Firefox + WebKit (humo e impresión, 1 worker).
// Cada ejecución usa carpetas propias (test-results/<run>-<fase>, playwright-report/<run>-<fase>, out/<run>-<fase>) para que una fase no borre
// las trazas de la anterior ni se mezclen cifras de ejecuciones distintas. Se conservan las últimas KEEP ejecuciones; `npm run clean` borra todo.
//
// Uso:  node run-e2e.mjs [--only chromium|cross] [-- <argumentos extra de playwright test>]
// Código de salida: 0 si todas las fases pasan; si alguna falla, el de la primera que falló (las demás se ejecutan igual).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = createRequire(import.meta.url).resolve('@playwright/test/cli');
const KEEP = 3;
const argv = process.argv.slice(2);
const dd = argv.indexOf('--');
const extra = dd >= 0 ? argv.slice(dd + 1) : [];
const own = dd >= 0 ? argv.slice(0, dd) : argv;
const only = own.includes('--only') ? own[own.indexOf('--only') + 1] : '';

const stamp = new Date().toISOString().replace(/\..*$/, '').replace(/[:T]/g, '-'); // 2026-10-29-22-30-05
const PHASES = [
  { name: 'chromium', args: ['--project=chromium'] },
  { name: 'cross', args: ['--project=firefox', '--project=webkit', '--workers=1'] },
].filter((p) => !only || p.name === only);

// Limpieza: solo carpetas con nombre de ejecución (AAAA-MM-DD-hh-mm-ss-fase); las más antiguas que las últimas KEEP salen.
const prune = () => {
  for (const base of ['test-results', 'playwright-report', 'out']) {
    const dir = path.join(HERE, base);
    if (!fs.existsSync(dir)) continue;
    const runs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{4}(-\d\d){5}-/.test(d.name)).map((d) => d.name);
    const stamps = [...new Set(runs.map((n) => n.slice(0, 19)))].sort();
    for (const old of stamps.slice(0, Math.max(0, stamps.length - KEEP))) for (const n of runs.filter((r) => r.startsWith(old))) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
  }
};
prune();

let code = 0;
for (const ph of PHASES) {
  const run = `${stamp}-${ph.name}`;
  console.log(`\n=== fase ${ph.name}: salida en test-results/${run}, out/${run}, playwright-report/${run} ===`);
  const r = spawnSync(process.execPath, [CLI, 'test', ...ph.args, ...extra], { cwd: HERE, stdio: 'inherit', env: { ...process.env, PW_RUN: run } });
  if (r.status !== 0 && code === 0) code = r.status ?? 1;
}
console.log(code === 0 ? '\nSuite e2e: todo en verde.' : `\nSuite e2e: hubo fallos (código ${code}).`);
process.exit(code);
