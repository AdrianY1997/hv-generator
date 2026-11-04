# HV Minerva (hv-generator)

Generador de Hoja de Vida (Colombia) como app estática, sin build ni dependencias. Modelos: formato Minerva (solicitud de empleo) y Formato Único de Hoja de Vida – Persona Natural de la Función Pública; un solo perfil compartido entre ellos ([`docs/MODELOS.md`](docs/MODELOS.md)).

Sitio en vivo: https://adriany1997.github.io/hv-generator/ · Código: https://github.com/AdrianY1997/hv-generator

- App: [`app/`](app/README.md) (uso, arquitectura, formas de datos, cómo agregar un modelo, respaldo). Al imprimir salen como anexos los certificados y los documentos cargados (también los PDF, convertidos a imagen) y todas las páginas usan margen 0 con una zona segura interna: el resultado no depende del margen elegido en el diálogo de impresión.
- Brechas conocidas y pendientes: [`docs/GAPS.md`](docs/GAPS.md). Formulario condicional (`showIf`, reglas de datos y tabla de condiciones): [`docs/CONDICIONALES.md`](docs/CONDICIONALES.md). Accesibilidad y ATS: [`docs/ACCESIBILIDAD.md`](docs/ACCESIBILIDAD.md). Verificación legal de la lista de documentos de soporte (normas, vigencias, qué puede exigir un empleador; cierre parcial de G07): [`docs/VERIFICACION-LEGAL.md`](docs/VERIFICACION-LEGAL.md). Impresión y paginación: [`docs/IMPRESION.md`](docs/IMPRESION.md). Sincronización cifrada entre equipos (carpeta sincronizada o Gist secreto): [`docs/SYNC.md`](docs/SYNC.md).
Probar en local: `cd app && python -m http.server 8000` y abrir `http://localhost:8000`. Los módulos ES requieren HTTP, no `file://`.

Privacidad: todo (perfil, plantillas, archivos) se guarda solo en el navegador del usuario. La sincronización entre equipos es opcional y sube solo una copia cifrada en el propio equipo. Hay que exportar un respaldo; borrar los datos del navegador lo pierde todo.

## Publicar en GitHub Pages

1. En la carpeta del proyecto: `git init`, `git add .` y `git commit -m "Primera versión"`.
2. Crear un repositorio vacío en GitHub (sin README ni .gitignore) y conectarlo: `git remote add origin https://github.com/<usuario>/<repo>.git`.
3. Subir la rama `main`: `git branch -M main` y `git push -u origin main`.
4. En GitHub: Settings → Pages → Source: **GitHub Actions**.
5. El workflow `.github/workflows/pages.yml` corre en cada push a `main`: pruebas unitarias y e2e (Chromium), y si pasan publica la carpeta `app/`. Cualquier fallo de pruebas bloquea la publicación.
6. Antes de publicar, el service worker (`app/sw.js`) se estampa con el SHA del commit, así cada versión tiene su propia caché.
7. La URL queda en `https://adriany1997.github.io/hv-generator/`. Todas las rutas son relativas, por lo que funciona bajo `/hv-generator/`. El primer despliegue se sigue en la pestaña **Actions** del repositorio.

## Pruebas

La app no tiene build ni dependencias; las pruebas son herramientas de desarrollo y **no se despliegan** (`tests-e2e/` y `tools/` no están en `app/`).

| Qué | Comando | Dónde |
|---|---|---|
| Unitarias (`node:test`, sin dependencias, Node >= 22) | `npm test` (en la raíz) | `app/tests/*.test.mjs` |
| e2e con Playwright (Chromium completo; Firefox y WebKit: humo e impresión) | `cd tests-e2e && npm ci && npm run browsers && npm run test:e2e` | `tests-e2e/specs/` |
| Solo Chromium / solo humo+impresión en Firefox y WebKit | `npm run test:e2e:chromium` / `npm run test:cross` | |
| Borrar salidas de pruebas (`test-results/`, `out/`, `playwright-report/`) | `npm run clean` (en `tests-e2e/`) | |
| Accesibilidad (axe, WCAG 2.2 AA, claro/oscuro, 375 px) | `npm run a11y` | `tests-e2e/specs/a11y.spec.mjs` |
| Impresión y paginación (G14) | `npm run test:print` | `tests-e2e/specs/print.spec.mjs`, cifras en `docs/IMPRESION.md` |

`npm run browsers` descarga Chromium, Firefox y WebKit de Playwright (la primera vez). Playwright levanta solo su servidor estático (`tests-e2e/serve.mjs`, Node puro, puerto 4173 o `PORT`). `npm run test:e2e` (`tests-e2e/run-e2e.mjs`) corre Chromium y luego Firefox + WebKit, y cada fase escribe en carpetas propias con el nombre de la ejecución (`AAAA-MM-DD-hh-mm-ss-chromium` / `-cross`): los PDF de impresión y las cifras en `tests-e2e/out/<ejecución>/`, informes y trazas de fallos en `tests-e2e/playwright-report/<ejecución>/` y `tests-e2e/test-results/<ejecución>/` (`npx playwright show-report playwright-report/<ejecución>`). Se conservan las últimas 3 ejecuciones y el código de salida es distinto de 0 si falla cualquier fase (las dos corren siempre). Sin el ejecutor (`npx playwright test ...`, CI) se usan `out/`, `test-results/` y `playwright-report/` directamente; todas son carpetas ignoradas por git (`.gitignore`). Notas:

- Cada prueba parte de un almacenamiento vacío y siembra lo que necesita (perfil, plantillas, archivos) sin tocar datos reales; un `console.error` o una excepción de la página hace fallar la prueba.
- Firefox y WebKit se ejecutan con 1 worker (Firefox se queja al cerrar contextos en paralelo). El WebKit de Playwright no guarda `Blob` en IndexedDB: los casos con archivos adjuntos se omiten ahí.
- La prueba sin conexión usa su propio servidor con `sw.js` sellado (`__BUILD__` reemplazado) como en Pages.
- CI: `.github/workflows/ci.yml` (unitarias, e2e Chromium, axe, Firefox y WebKit); `pages.yml` no despliega si fallan las pruebas.
- Auditorías sueltas (axe 28 estados, teclado, ATS con PyMuPDF): `tools/README.md`.
