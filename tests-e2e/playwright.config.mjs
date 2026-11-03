import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 4173);
const CI = !!process.env.CI;
// Carpetas de salida aisladas por ejecución: `npm run test:e2e` (run-e2e.mjs) fija PW_RUN y cada fase escribe en test-results/<PW_RUN>/,
// playwright-report/<PW_RUN>/ y out/<PW_RUN>/ (Playwright vacía su outputDir al arrancar: sin esto la fase de Firefox/WebKit borraba las trazas
// de la de Chromium, y el jsonl de impresión acumulaba líneas de ejecuciones anteriores). Sin PW_RUN (CI, ejecuciones sueltas) se usan las rutas de siempre.
const RUN = process.env.PW_RUN || '';
const sub = (dir) => (RUN ? `${dir}/${RUN}` : dir);
// firefox y webkit solo corren los specs de humo e impresión (ver testMatch); chromium corre todo.
const ALL = /.*\.spec\.mjs/;
const CROSS = /(smoke|print)\.spec\.mjs/;
const desktop = (d) => ({ ...d, viewport: { width: 1280, height: 900 } });

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : 4, // pocos workers: page.pdf de Chromium es sensible a la carga de la máquina (ver specs/print.spec.mjs)
  reporter: CI || RUN ? [['list'], ['html', { open: 'never', outputFolder: sub('playwright-report') }]] : [['list']],
  outputDir: sub('test-results'),
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    serviceWorkers: 'block', // salvo specs/offline.spec.mjs, que levanta su propio servidor con el sw sellado
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  webServer: {
    command: 'node serve.mjs',
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !CI,
    timeout: 30_000,
    env: { PORT: String(PORT) },
  },
  projects: [
    { name: 'chromium', use: desktop(devices['Desktop Chrome']), testMatch: ALL },
    { name: 'firefox', use: desktop(devices['Desktop Firefox']), testMatch: CROSS },
    { name: 'webkit', use: desktop(devices['Desktop Safari']), testMatch: CROSS },
  ],
});
