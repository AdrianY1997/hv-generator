# Sincronización entre equipos (G04)

Opcional y cifrada de extremo a extremo. La app sigue siendo estática (GitHub Pages, sin backend): cada navegador cifra sus datos con
una **contraseña de sincronización** y deja la copia cifrada en un lugar que la persona ya controla. Nadie fuera de sus equipos (ni su
nube ni GitHub) puede leerla.

## Uso

En **Ajustes > Sincronización entre equipos**:

1. Elige el destino:
   - **Carpeta sincronizada** (Chrome/Edge de escritorio): una carpeta que ya sincroniza Google Drive, OneDrive, Dropbox o Syncthing.
     La app escribe ahí un solo archivo cifrado, `hv-generator-sync.json`; el cliente de esa nube lo lleva a los otros equipos.
   - **GitHub Gist secreto** (cualquier navegador, también móvil): pega un token personal de GitHub con permiso **solo** `gist`
     (classic: alcance `gist`; fine-grained: «Gists: lectura y escritura»), con fecha de vencimiento. Si pierdes un equipo, revoca el token en GitHub. El enlace del formulario abre
     `https://github.com/settings/tokens/new?scopes=gist`.
2. Escribe la contraseña de sincronización (mínimo 10 caracteres; la **misma** en todos los equipos; no se recupera).
3. «Conectar y sincronizar». En el segundo equipo se repite lo mismo: con Gist, la app encuentra sola la sincronización existente
   en la cuenta; con carpeta, elige la misma carpeta (ya sincronizada por la nube). Si ese equipo ya tenía datos, pregunta qué
   gana en lo que difiere (ver «Unirse»).
4. Después: «Sincronizar ahora» o automática (al abrir la app, al recuperar la conexión y un minuto después de editar).

«Desconectar» borra de ese navegador el token, la clave recordada y el estado; los datos locales y la copia remota se quedan.

## Diseño

```text
js/sync/
  provider.js     interfaz de proveedor, SyncError (mensajes en español), proveedor en memoria (pruebas)
  gist.js         proveedor GitHub Gist (fetch a https://api.github.com, nada más)
  folder.js       proveedor carpeta (File System Access API)
  sync-crypto.js  claves y sobres (reutiliza backup-crypto.js)
  sync-format.js  manifiesto, núcleo, trozos, validación de lo remoto
  clock.js        reloj de cambios (qué cambió y cuándo) + lápidas
  sync-merge.js   fusión "gana el cambio más reciente" por campo/registro/plantilla/archivo
  engine.js       syncOnce: leer -> descifrar -> fusionar -> aplicar (con copia previa) -> subir
  local-store.js  adaptador del motor sobre store.js + copia previa
  sync-db.js      IndexedDB `hv-sync` (config, claves recordadas, estado, copia previa)
  controller.js   conectar, desbloquear, sincronizar, opciones, automática, bloqueo entre pestañas
  sync-ui.js      tarjeta de Ajustes        css/sync.css
```

### Formato remoto

Un espacio remoto es un conjunto de archivos de texto:

| archivo | contenido |
| --- | --- |
| `hv-generator-sync.json` | manifiesto **en claro**: `{app, format:'hv-minerva-sync', v:1, rev, parent, updatedAt, kdf:{name,hash,iterations,salt}, digest, core:<n trozos>, blobs:{<id>:<n trozos>}, store:{blobGist}}` |
| `hv-core-000.txt`… | núcleo cifrado: `{format:'hv-minerva-sync-core', v:1, schemaVersion, profile, templates, clock, files:{<id>:{h, meta, b}}}` |
| `hv-blob-<id>-000.txt`… | un adjunto cifrado; `<id>` = HMAC del contenido (direccionado por contenido: un adjunto que no cambia no se vuelve a subir) |

Cada núcleo y cada adjunto es **un sobre `hv-minerva-enc` v1 idéntico al de un respaldo cifrado** (`backup-crypto.js`:
PBKDF2-SHA-256 600 000 -> AES-256-GCM, cabecera como AAD), partido en trozos de texto. Consecuencias: el núcleo unido se abre con
`decryptBackup(sobre, contraseña)` (probado), y la validación del sobre (versión, KDF mínimo, tamaños) es la misma.

- **Gist**: dos Gists secretos. El *índice* (manifiesto + núcleo; pequeño) se lee en cada sincronización con `If-None-Match`
  (un 304 no gasta cuota); el de *adjuntos* solo cuando falta algún adjunto. Separados porque `GET /gists/:id` devuelve el contenido
  de todos los archivos: con los adjuntos en el índice, cada sincronización bajaría decenas de MB. Trozos de <= 800 000 caracteres
  (la API recorta el contenido de un archivo a partir de 1 MB y lo marca `truncated`; la app lo rechaza si lo ve). Escrituras en lotes
  de <= 8 MB / 60 archivos; adjuntos antes que el índice (un índice nunca apunta a trozos que no existen). Máximo 280 archivos de
  adjuntos (un Gist lista 300).
- **Carpeta**: un solo archivo `hv-generator-sync.json` (`{format:'hv-minerva-sync-folder', manifest, index, blobs}`), sin partir,
  escrito con `createWritable()` (archivo temporal + reemplazo al cerrar). Uno solo a propósito: el cliente de la nube mueve archivos
  por separado y en cualquier orden; con varios, otro equipo podría ver un índice nuevo con adjuntos viejos. Si la nube crea una copia
  en conflicto (`hv-generator-sync (1).json`), Ajustes lo avisa (la app usa solo el archivo principal).

### Cifrado y claves

- `deriveSyncKeys`: PBKDF2-SHA-256 (600 000, la sal del espacio, en el manifiesto) -> 32 bytes -> clave AES-256-GCM (la misma que
  derivaría `decryptBackup`) y, por HKDF (`info: hv-minerva-sync/mac/v1`), una clave HMAC-SHA-256. Ambas **no extraíbles**.
  Se deriva una vez por sesión (o se recuerda, ver abajo), no por trozo.
- HMAC (no SHA-256 simple) para el id de cada adjunto y el `digest` del núcleo: un hash en claro permitiría a quien tenga el mismo
  archivo confirmar que está en la nube.
- IV aleatorio de 12 bytes por sobre. La sal es por espacio (no por sobre) para poder reutilizar la clave; con IV aleatorio de 96 bits
  y una clave por espacio no hay riesgo práctico de repetir IV.
- Contraseña: NFKC, mínimo 10 puntos de código al crear o unirse (`MIN_PASSPHRASE` de backup-crypto), indicador de fortaleza
  orientativo, advertencia de que no se recupera y debe ser idéntica en todos los equipos. Nunca se guarda.
- «Recordar la contraseña en este equipo» (**desactivado por omisión**) guarda las **CryptoKey no extraíbles** en IndexedDB `hv-sync`
  (no la contraseña ni bytes de clave). Sin recordar, cada sesión pide la contraseña (se comprueba contra un sobre de control
  `check` antes de usarla). **Con «recordar» activado, la protección del token se limita a la CSP y al mismo origen**: un XSS en la
  página podría usar la CryptoKey recordada para desenvolver el token (no exfiltrarla como bytes, pero sí usarla mientras la página
  está abierta). Por eso la interfaz lo deja apagado, lo dice junto a la casilla y recomienda un token **fine-grained** («Gists:
  lectura y escritura») o **classic** restringido al alcance `gist`, con vencimiento, y **revocarlo en GitHub si se pierde el equipo**.
- El token de GitHub se guarda **envuelto** (sobre AES-GCM con la clave de sincronización) en `hv-sync`. Sin recordar la clave, el
  token es inutilizable sin la contraseña; con la clave recordada, solo lo protegen la CSP y el mismo origen (ver arriba).
- Compatibilidad entre equipos: los parámetros (iteraciones, sal) viajan en el manifiesto y en cada sobre, autenticados como AAD;
  un manifiesto con KDF por debajo de 600 000 o un algoritmo distinto se rechaza (degradación). Versiones: manifiesto `v`, núcleo
  `v`, sobre `v` y `schemaVersion` de los datos; una versión más nueva que la app se rechaza con «Actualiza la app»; un
  `schemaVersion` más viejo se migra (`migrate.js`, renombrando también índice y reloj).

### Semántica de la fusión

**Por qué no `backup-merge.js` tal cual**: al importar un respaldo, en secciones simples el respaldo solo llena campos vacíos, y una
plantilla con el mismo id y contenido distinto se agrega como «(importada)». Usado para sincronizar, un campo editado en el equipo A
nunca llegaría al B (los dos lo tienen lleno) y cada edición de una plantilla crearía copias en cada ida y vuelta. La sincronización
necesita saber qué cambió y cuándo; se reutilizan de `backup-merge.js` / `backup-validate.js` las reglas de vacío, la validación y la
normalización (`validateBackup`, `normalizeTemplate`, tipos permitidos, `sniffMime`).

- **Reloj** (`clock.js`, localStorage `hv.sync.clock`): `store.js` fecha cada guardado comparando lo anterior con lo nuevo:
  `p:<sec>.<campo>` (sección simple, incluido `documents.<docId>`), `p:<clave>` (escalares y listas de texto como `documentsShown`),
  `i:<sec>/<id>` (registro repetible), `t:<id>` (plantilla), `f:<id>` (archivo: contenido o metadatos) y lápidas `x…` para borrados
  de registros, plantillas y archivos. También importar un respaldo fecha lo que cambió. El reloj es estrictamente creciente por
  clave (`max(ahora, anterior+1)`): una edición hecha tras ver un valor remoto siempre gana aunque el reloj del sistema esté atrasado.
- **Gana el más reciente** por entidad; para registros y plantillas también cuenta su `updatedAt`. Una lápida más nueva que la última
  edición borra; una edición posterior a la lápida «resucita». Vaciar un campo a propósito también se propaga.
- **Empates** (típicamente datos anteriores a la sincronización, sin fecha en ningún lado): gana lo remoto, salvo que lo remoto esté
  vacío y lo local no (se llenan huecos). Es asimétrico a propósito: así todos los equipos convergen (probado: sin ida y vuelta
  infinita).
- **Unirse** (primer `syncOnce` de un equipo con datos propios contra un remoto que ya existe): diálogo «Preferir la copia
  sincronizada» (por omisión) o «Preferir los datos de este equipo» (sella con fecha actual todo lo local sin fecha, así gana).
- **Nunca se sobrescribe a ciegas**: modo normal = leer, descifrar, fusionar, aplicar en local, subir. Si el remoto cambió desde la
  última lectura propia (`rev` distinta) se fusiona; si alguien escribió entre la lectura y la escritura, el proveedor lanza
  `conflict` y el motor vuelve a empezar (hasta 3 intentos). Si la persona editó mientras se sincronizaba (`applySync` compara con lo
  leído), tampoco se pisa: `local-changed` y reintento.
- **Copia previa**: antes de aplicar cambios recibidos se guarda en `hv-sync` el perfil, plantillas, reloj y los archivos que se van a
  reemplazar o borrar. Ajustes > Opciones avanzadas > «Descargar la copia previa a la última sincronización» la entrega como respaldo
  JSON normal (sin cifrar; importable con Vista previa > Importar JSON). No se descarga sola: con sincronización automática serían
  descargas en cada apertura (el respaldo manual sigue igual).
- **Forzar**: «Reemplazar la copia remota con este equipo» (`mode:'push'`, sube sin fusionar) y «Reemplazar este equipo con la copia
  remota» (`mode:'pull'`, deja lo local idéntico, borrando lo que sobra, con copia previa). Ambos piden confirmación.
- **Adjuntos y presupuesto**: perfil y plantillas siempre; adjuntos mientras quepan en el límite (por omisión 20 MB, de 0 a 40;
  primero la foto, luego documentos y certificados, de menor a mayor). Lo que ya está en el remoto se queda aunque el límite de otro
  equipo sea menor (si no, dos equipos con límites distintos se pisarían sin fin). Lo que no cabe se lista en Ajustes. Un adjunto que
  otro equipo no subió queda en el índice como «fantasma»: este equipo no lo borra ni lo pisa con una versión vieja.
- **Integridad de lo recibido**: cada sobre se autentica (GCM); además cada adjunto se verifica por su HMAC, su tipo real
  (`sniffMime`) y su tamaño, y el núcleo pasa por `validateBackup` (las mismas reglas que importar). Un adjunto alterado se omite y
  se avisa; el resto llega.
- **Automática**: solo si se configuró (marca `hv.sync.on`; sin ella no se crea ni abre la base `hv-sync`). Al abrir la app (1,5 s),
  al volver la conexión (3 s) y 60 s después del último cambio local. Web Locks evita dos sincronizaciones a la vez entre pestañas.
  Si aplicó cambios y la vista abierta no es Ajustes, se vuelve a montar la vista (para no mostrar ni volver a guardar datos viejos)
  y se avisa con un toast. Errores que requieren acción (token rechazado, contraseña, Gist borrado) se avisan una vez por sesión; el
  resto se ve en Ajustes.

### Versiones distintas de la app (cargo / cargoJefe)

Dos equipos pueden tener versiones distintas (uno ya conoce un campo aditivo como `experiencia.cargoJefe`, el otro no). Garantías, probadas en `tests/audit5.test.mjs`:

- Una versión anterior **ignora** el campo (no lo muestra ni lo imprime) pero **lo conserva**: `normalizeProfile` solo descarta claves reservadas y tipos erróneos de nivel superior; las claves desconocidas de un registro (y las secciones desconocidas) se mantienen, y el formulario edita el registro en el sitio sin quitarle claves.
- Un registro con el mismo id en los dos lados gana ENTERO el más reciente (reloj / `updatedAt`), pero **no pierde los campos que solo tenía el otro** (`fillAbsent` en `backup-merge.js`, usado también por `sync-merge.js`): una edición de `cargo` hecha en el equipo viejo no borra el `cargoJefe` escrito en el nuevo. Un valor vacío del ganador cuenta como borrado a propósito y no se rellena. Los registros borrados (lápida más nueva) no resucitan.
- Un perfil con `cargo` y sin `cargoJefe` se imprime en Minerva con el cargo anterior en la casilla del jefe (`replaces`); uno con ambos usa `cargoJefe`.
- Un respaldo o un núcleo de sincronización de un esquema MÁS NUEVO que la app (`schemaVersion` mayor) se rechaza con un mensaje claro en lugar de interpretarlo mal.
- `documentsShown` (lista de documentos visibles): con empate de fechas (datos anteriores a la sincronización, o cada equipo migró por su cuenta a la v3) se **une** (ordenada, igual en todos los equipos); si una edición es más nueva, manda esa (ocultar un documento se propaga). Un equipo con la lista y otro sin ella conservan la lista.

## Límites conocidos

- **Borrados**: se propagan con lápidas que viven **180 días**. Un equipo que pase más tiempo sin sincronizar puede volver a traer algo
  borrado en otro (ese equipo aún lo tiene y no ve lápida). Se dice en Opciones avanzadas.
- El orden de los registros de una sección repetible no se sincroniza (solo su contenido); los nuevos remotos se agregan al final.
- Datos de antes de activar la sincronización no tienen fecha: el primer encuentro lo decide el diálogo de «Unirse».
- **Relojes adelantados**: los sellos remotos se limitan a *ahora + 1 día* al fusionar y al sanear un reloj (`clock.js`, `sync-merge.js`; el reloj fusionado que se sube ya lleva el sello acotado) y un `updatedAt` más allá de ese tope se ignora: un equipo con la hora muy adelantada (o un remoto alterado) ya no puede ganar para siempre todas las ediciones futuras.
- **Adjuntos huérfanos en Gist**: los trozos de adjuntos que ya no se usan se borran *después* de que el índice nuevo se escribió bien (y nunca si hubo conflicto); si ese borrado falla, quedan huérfanos pero inofensivos.
- **Copia previa**: la nueva se guarda primero en una ranura pendiente y solo reemplaza a la anterior cuando `applySync` terminó bien.
- Gist no tiene escritura condicional: entre la comprobación de conflicto y el `PATCH` queda una ventana de ~1 s. Si dos equipos la
  pisan, el índice queda con la versión del último, pero **no se pierden datos**: el otro equipo los conserva con su fecha y los vuelve a
  subir en su próxima sincronización (probado). Lo mismo con dos clientes de nube escribiendo la carpeta a la vez (copia en conflicto).
- Si se edita en Perfil justo durante una sincronización automática que trae cambios de la misma sección, la vista se vuelve a montar;
  una edición de los últimos 400 ms antes de eso puede ganar sobre el cambio remoto de esa sección (queda en la copia previa).
- Adjuntos: límite de 40 MB en total (`MAX_TOTAL`), 5 MB por archivo, 280 archivos de trozos en el Gist de adjuntos. La primera
  subida de 20 MB a GitHub tarda (base64 + cifrado: ~27 MB de texto).
- El manifiesto va en claro: revela cuántos adjuntos hay, su tamaño aproximado (por el número de trozos), el número de trozos del
  núcleo y cuándo se sincronizó. No revela nombres, tipos ni contenido, pero **sí deja ver conteos y tamaños aproximados** (no es cierto
  que «no diga nada del aspirante»). `store.blobGist` se valida (32 hex) antes de usarlo; cualquier otro valor invalida el manifiesto.
- Rollback: quien pueda escribir en el Gist o la carpeta (p. ej. con el token robado) puede reponer una versión anterior completa y
  coherente del espacio; no puede leerla ni fabricar una nueva. La fusión no pierde los cambios locales más nuevos.
- Un `schemaVersion` más nuevo en el remoto se rechaza hasta actualizar la app en ese equipo (recargar la página).
- Carpeta: solo Chrome/Edge de escritorio. El permiso sobre la carpeta se pide con un clic; en cada sesión nueva la sincronización
  automática no puede pedirlo y espera a «Sincronizar ahora» (Chrome puede recordarlo con «Permitir siempre»).
- Si el Gist índice se borra en GitHub, la sincronización da 404: desconectar y volver a conectar crea uno nuevo (o lo encuentra).

## Modelo de amenazas

| Quién | Qué ve / puede | Mitigación |
| --- | --- | --- |
| GitHub, el proveedor de nube, quien tenga la URL del Gist secreto | Solo sobres AES-256-GCM, el manifiesto (conteos, sal) y fechas | Cifrado en el equipo antes de salir; HMAC en vez de hash para los ids; nada en claro en nombres de archivo |
| Atacante con el token | Leer/borrar/reemplazar los Gists de la cuenta (ciphertext), reponer versiones viejas | Token solo con `gist` y con vencimiento (la UI lo indica y avisa si tiene alcances de más); revocarlo en GitHub; no puede descifrar |
| Atacante fuera de línea con la copia cifrada | Fuerza bruta de la contraseña | PBKDF2 600 000 (OWASP 2023); mínimo 10 caracteres + indicador; PBKDF2 y no Argon2 porque es lo que ofrece WebCrypto en todos los navegadores |
| Manifiesto alterado | Degradar el KDF, apuntar a otros trozos | Se rechaza KDF < 600 000 o distinto; los parámetros son AAD de cada sobre; cada trozo se autentica |
| XSS en la app | Lo mismo que ya podía: leer los datos locales (en claro) y, **si «Recordar» está activado**, usar la clave recordada y el token mientras la página está abierta (entonces la protección del token se limita a la CSP y al mismo origen) | CSP estricta en `index.html` (`script-src 'self'` + hash del único script en línea, `connect-src 'self' https://api.github.com`); claves no extraíbles (no se pueden exfiltrar como bytes); la interfaz de sincronización arma el DOM con nodos de texto (sin `innerHTML`) |
| Otra persona en el mismo equipo/navegador | Los datos locales (ya en claro) y la sincronización si la clave está recordada | Dejar «Recordar» apagado (es lo normal: pide la contraseña en cada sesión y el token queda inutilizable sin ella); «Borrar todos mis datos» borra también `hv-sync` |
| Consola / registros | — | Nunca se registran token, contraseña ni claves; los errores conocidos se registran solo por su código |

El token solo viaja a `https://api.github.com` en el encabezado `Authorization` (nunca en la URL; `credentials:'omit'`,
`referrerPolicy:'no-referrer'`, `redirect:'error'`); las pruebas lo comprueban.

## Pruebas

- Unitarias (`npm test`): `app/tests/sync-merge.test.mjs` (reloj, fusión, lápidas, empates, convergencia),
  `sync-format.test.mjs` (trozos, manifiesto, núcleo, claves, compatibilidad con `decryptBackup`, contraseña),
  `sync-engine.test.mjs` (dos y tres equipos con proveedor en memoria: crear/traer, ediciones cruzadas, borrados, conflicto con
  reintento, edición durante la sincronización, presupuesto y fantasmas sin ida y vuelta, trozos, contraseña distinta, adjunto
  alterado, unirse, modos forzados), `sync-providers.test.mjs` (Gist con GitHub falso `tests/_fake-github.mjs`: crear, encontrar,
  304, conflicto antes y dentro de la ventana, errores 401/403/404/422/5xx/límite/red, solo api.github.com; carpeta con directorio
  falso: un archivo, permisos, archivo ajeno o dañado, conflicto, copias en conflicto) y `csp.test.mjs` (hash del script en línea,
  red limitada).
- e2e (`tests-e2e/specs/sync.spec.mjs`, Chromium): `page.route` sirve el GitHub falso; dos contextos = dos equipos: conectar,
  traer, editar en ambos y combinar, borrado propagado, copia previa descargable, sin texto claro en GitHub ni token en claro en el
  navegador, ninguna otra salida a internet; unirse con datos propios (diálogo), clave no recordada -> bloqueada -> desbloquear
  (incorrecta y correcta), desconectar conserva datos; errores 401 y límite de uso; automática al abrir. axe (claro/oscuro) sin
  configurar, conectada, bloqueada, error y diálogo de unirse. Además comprueba en el navegador que la CSP bloquea un script en línea inyectado y un `fetch` a otro sitio.

### Falta verificar a mano (no automatizable aquí)

- **Carpeta real**: `showDirectoryPicker`, permiso persistente entre sesiones, y que Drive/OneDrive/Dropbox/Syncthing lleven el
  archivo a otro equipo (y qué copias en conflicto crean).
- **GitHub real**: CORS de `api.github.com` con `If-None-Match` y `X-GitHub-Api-Version` desde el origen de Pages, respuesta 304
  real, tokens fine-grained (permiso «Gists»), límites de tamaño reales de `PATCH` y del Gist de adjuntos con 20-40 MB.
- Firefox/Safari (solo Gist), móvil, y la CSP con el visor de PDF en pestaña nueva (`window.open` de un `blob:`) en cada navegador.
