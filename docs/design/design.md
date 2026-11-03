# HV Minerva — Sistema de diseño "Papelería de notaría"

Referencia visual: `mockup.html` (capturas `mockup-light.png`, `mockup-dark.png`). Tokens y clases: `tokens.css`. Modo: Normal. Stack detectado: HTML/CSS/JS vanilla, sin librerías; se adopta CSS custom properties, sin framework.

## 1. Concepto

**Una hoja de vida es un trámite oficial con dignidad de papelería.** La interfaz se comporta como un escritorio de notaría: papel cálido, filetes finos (hairlines) en lugar de sombras, tipografía serif de edición para los títulos y una sola tinta de acento, el **verde tintero**. Minerva (diosa de la sabiduría y los oficios) aporta el tono: serio, sereno, sin gritar.

Por qué funciona para este producto:
- El resultado final es un documento impreso; la UI ya "huele" a papel, así que editor y vista previa se sienten del mismo mundo.
- Un solo acento tipo tinta evita el aspecto de SaaS genérico (degradados morados, azul Bootstrap) y reserva el color para lo que importa: acción principal, avance, "listo".
- Detalles distintivos y baratos: numeración itálica 01·02·03 en secciones, sello circular de avance, tarjetas de ítem con filete de tinta a la izquierda, navegación subrayada (no píldoras), radios casi rectos (2–6 px).
- Contención: sin gradientes, sin sombras en reposo, sin iconos decorativos.

## 2. Paleta (WCAG 2.1 AA verificada, relación de contraste calculada)

| Rol | Token | Claro | Oscuro |
|---|---|---|---|
| Fondo app | `--color-bg` | #F5F1E8 | #15130F |
| Superficie | `--color-surface` | #FCFAF5 | #1E1B16 |
| Hundido / lienzo | `--color-sunken` | #EAE4D6 | #0E0D0A |
| Tinta (texto) | `--color-ink` | #1C1A16 | #EBE5D6 |
| Texto secundario | `--color-ink-2` | #55503F | #B3AB97 |
| Texto terciario | `--color-ink-3` | #6B6453 | #9A9380 |
| Filete decorativo | `--color-line` | #D9D0BC | #36322A |
| Borde de control | `--color-line-strong` | #8A816C | #7A735F |
| Acento (verde tintero) | `--color-accent` | #1D4B41 | #86C7B2 |
| Acento hover | `--color-accent-hover` | #133A32 | #A3D8C6 |
| Acento suave | `--color-accent-soft` | #DEEAE3 | #1B2C27 |
| Texto sobre acento | `--color-on-accent` | #FBF9F4 | #0D1C18 |
| Aviso | `--color-warn` / `-soft` | #7A4F00 / #F4E6C4 | #E3B65A / #2E2512 |
| Error | `--color-danger` / `-soft` | #9E2A1C / #F5DAD3 | #F09482 / #331A15 |

Contrastes medidos (texto ≥4.5:1, no-texto ≥3:1):

| Par | Claro | Oscuro |
|---|---|---|
| ink / bg | 15.4 | 14.8 |
| ink / surface | 16.7 | 13.7 |
| ink-2 / bg | 7.2 | 8.1 |
| ink-2 / surface | 7.7 | 7.5 |
| ink-3 / bg | 5.2 | 6.1 |
| ink-3 / sunken | 4.6 | 6.4 |
| accent / bg | 8.7 | 9.6 |
| accent / surface | 9.4 | 8.9 |
| accent / accent-soft (badge ok) | 8.0 | 7.5 |
| on-accent / accent (botón primario) | 9.3 | 9.1 |
| on-accent / accent-hover | 11.9 | 11.0 |
| warn / warn-soft | 5.8 | 8.0 |
| danger / danger-soft | 5.7 | 7.1 |
| danger / surface | 7.2 | 7.6 |
| line-strong / surface (borde input) | 3.7 | 3.6 |
| line-strong / bg | 3.4 | 3.9 |

Reglas de uso: el acento nunca es el único portador de significado (los badges llevan texto, el "listo" lleva check). `--color-line` (1.4:1) es solo decorativo; los controles usan `--color-line-strong`. La hoja impresa (`--color-paper`) es siempre blanca, también en oscuro (es lo que se imprime).

## 3. Tipografía

Autoalojadas (carpeta `fonts/`, solo subconjunto latino: cubre á é í ó ú ñ ü ¿ ¡):
- **Newsreader** (variable, normal + cursiva) — títulos, numeración, hoja impresa. Licencia SIL OFL 1.1 (Production Type). Fuente: paquete `@fontsource-variable/newsreader` vía jsDelivr, descargado a `fonts/`.
- **Inter** (variable) — UI, etiquetas, formularios. Licencia SIL OFL 1.1 (Rasmus Andersson). Descargada de `@fontsource-variable/inter`.
- Respaldo sin red: `Iowan Old Style, Palatino Linotype, Georgia` / `system-ui, Segoe UI`.
- Total ≈167 KB, `font-display: swap`. Si hay que reducir: eliminar la cursiva (los números 01·02 caen a oblicua sintética).

| Token | Tamaño | Uso |
|---|---|---|
| `--text-xs` | 12 | eyebrow (mayúsculas, tracking .14em), badges |
| `--text-sm` | 13 | ayuda, chips, nav, botones |
| `--text-base` | 15 | cuerpo, inputs |
| `--text-md` | 17 | título de tarjeta, fila de documento |
| `--text-lg` | 22 | título de sección |
| `--text-xl` | 30 | título de página |
| `--text-2xl` | 40 | estados vacíos / portada |

Interlineado 1.15 (títulos) / 1.55 (cuerpo). Etiquetas de campo: Inter 600, 12 px, mayúsculas, tracking .06em.

## 4. Tokens estructurales

- **Espacio** (base 4): `--space-1..8` = 4, 8, 12, 16, 24, 32, 48, 72 px.
- **Radio**: `xs 2` (casillas, filetes), `sm 4` (botones/inputs), `md 6` (tarjetas), `lg 10` (diálogo), `pill` (chips).
- **Elevación**: reposo = filete 1 px, sin sombra. `--shadow-paper` solo para las hojas de la vista previa; `--shadow-overlay` solo diálogo y toasts.
- **Movimiento**: `--ease: cubic-bezier(.2,.7,.2,1)`; 120 ms (hover/color), 200 ms (diálogo, aparición), 320 ms (barra de progreso). `prefers-reduced-motion` anula todo. Sin rebotes ni parallax.
- **Layout**: contenido máx. 72rem, formulario 46rem, cabecera 3.5rem.

## 5. Componentes (clases `mn-*` en tokens.css)

- **Botón** `.mn-btn` 40 px alto (32 `--sm`). Variantes: `--primary` (sólido tinta; una por vista), por defecto (contorno `line-strong`), `--quiet` (sin borde), `--danger` (contorno rojo). Iconos 16 px a la izquierda. Estados: hover (fondo hundido), `:active` 1 px abajo, disabled 45 %, foco 2 px acento con offset 2.
- **Campo** `.mn-field` + `.mn-label` (mayúsculas pequeñas, asterisco `.mn-req` en acento) + `.mn-input/.mn-select/.mn-textarea`. Foco: borde acento + halo `accent-soft`. Error: borde rojo + `.mn-error` con icono y texto que dice qué hacer (no solo color); `aria-invalid="true"`. Ayuda `.mn-help`. Casillas `.mn-check` propias, con estado indeterminado.
- **Tarjeta** `.mn-card` plana con filete. `--item` (ítem repetible: filete de acento a la izquierda de 3 px), `--select` (plantilla; `aria-selected="true"` tiñe con `accent-soft`).
- **Chips / badges**: `.mn-chip` píldora con icono y botón de quitar (archivo adjunto: nombre · tamaño). `.mn-badge` rectangular casi recto, mayúsculas 12 px: `--ok` (check), `--warn` ("Pendiente"), `--danger` ("Vencido"), neutro.
- **Zona de carga** `.mn-slot`: borde punteado vacío; `--filled` sólido con chip + badge. Hover/arrastre tiñe con `accent-soft`.
- **Navegación**: cabecera `.mn-header` (marca "HV *Minerva*" con Minerva en cursiva acento, selector de modelo, `.mn-nav` con subrayado de 2 px en `aria-current="page"`, botón de tema). Sección de Perfil: `.mn-sidenav` pegajosa con numeración itálica 01–05 y filete izquierdo; activa en tinta con filete acento.
- **Pestañas** `.mn-tabs` (`role="tablist"`), subrayado acento, sin fondos.
- **Progreso**: `.mn-progress` línea de 4 px (`--value`), con `role="progressbar"`; el avance se acompaña de número "8 / 11" en serif y `.mn-stamp`, sello circular doble (leve rotación −8°) que da el único toque expresivo. Fila `.mn-doc`: marca circular → check al completar, título serif, meta, acción o badge a la derecha.
- **Diálogo** `.mn-dialog` sobre `.mn-scrim`: cabecera serif, cuerpo, pie con fondo `bg` y filete; botón secundario `quiet` + primario. Marco de recorte 3:4 `.mn-crop` con regla de tercios y sliders `.mn-range`. Cierra con Esc, foco atrapado, `aria-modal`.
- **Toast** `.mn-toast` tinta invertida (fondo `ink`), 1 línea, icono check, `role="status"`, 4 s, sin botón salvo "Deshacer".
- **Estado vacío** `.mn-empty`: borde punteado, icono 36 px en gris, título serif, una frase, una sola acción primaria.
- **Vista previa**: `.mn-toolbar` (zoom −/+ con porcentaje tabular, Imprimir, Descargar PDF) y `.mn-canvas` sobre `--color-sunken`, hojas `.mn-page` 210 mm, blancas con `--shadow-paper`, separadas 24 px.

## 6. Iconografía

Conjunto en línea, rejilla 24 px, trazo 1.5 (1.75 solo en check), `stroke-linecap/linejoin: round`, `currentColor`, sin relleno. Se muestran a 16 px en botones, 14 px en badges/errores, 36 px en vacíos. Definidos como `<symbol>` en el `<svg>` oculto al inicio de `mockup.html` (copiar el bloque tal cual): `i-user`, `i-folder`, `i-layout`, `i-eye`, `i-sun`, `i-moon`, `i-upload`, `i-check`, `i-x`, `i-plus`, `i-trash`, `i-download`, `i-print`, `i-zoom-in`, `i-zoom-out`, `i-alert`, `i-clip`, `i-chevron`. Uso: `<svg width="16" height="16"><use href="#i-upload"/></svg>`. Los iconos que acompañan texto son decorativos (`aria-hidden`); los botones solo-icono llevan `aria-label`. No se usan en la navegación principal (texto solo).

## 7. Tono de microcopy (español de Colombia, "tú")

Sereno, claro, cálido, sin jerga ni signos de exclamación. Verbos de acción concretos; explica el porqué en una línea.
- Títulos: "Cuéntanos quién eres", "Documentos requeridos", "Tus formatos".
- Botones: "Agregar experiencia", "Adjuntar", "Guardar foto", "Descargar PDF" (no "Submit", no "OK").
- Errores: qué pasó + cómo arreglarlo: "Falta el dominio, por ejemplo @gmail.com".
- Vencimientos: "Vencido hace 12 días, descarga uno nuevo".
- Privacidad como tranquilidad: "Todo se guarda en este equipo."
- Vacíos: "Aún no hay plantillas propias" + invitación a crear.
- Evitar: "¡Genial!", "Oops", jerga técnica ("payload", "parse"), mayúsculas sostenidas fuera de eyebrow/etiquetas.

## 8. HV impresa (print.css) — coherente con la UI y compatible con ATS

Principios: texto real, una sola columna de flujo, encabezados semánticos, sin fondos ni imágenes salvo la foto 3×4, todo en negro sobre blanco. Implementación de referencia al final de `tokens.css` (`.hv-doc`).
- `@page { size: A4; margin: 14mm 16mm }`. Imprimir con `print-color-adjust: economy` (no forzar colores).
- **Tipos**: Newsreader (con respaldo Georgia/Palatino; en impresión local embebida para el PDF) 10.5 pt/1.4 cuerpo; nombre en `h1` 22 pt peso 600; datos de contacto en Inter 10 pt. Cifras lineales (`lining-nums`).
- **Secciones**: `h2` en Inter 600, 8.5 pt, mayúsculas, tracking .16em, con filete inferior de 0.75 pt negro (el filete de papelería, mismo lenguaje que la UI); `break-after: avoid`.
- **Ítems**: título en peso 600, fechas alineadas a la derecha (mismo renglón, `float:right`, texto no tabla), descripción debajo; `break-inside: avoid`.
- **Color**: ninguno en el documento (el verde tintero queda fuera del papel; opcional: filete en gris #333). Enlaces sin subrayado, visibles como texto.
- **ATS**: sin tablas de maquetación, sin cajas de texto/columnas múltiples en el orden de lectura (solo "Idiomas" usa dos columnas CSS cortas, sustituible por lista), sin iconos ni texto en imagen, encabezados con nombres estándar (Perfil profesional, Formación académica, Experiencia laboral, Idiomas). Foto con `alt`.
- La hoja en pantalla (vista previa) reproduce exactamente estas reglas dentro de `.mn-page`; en tema oscuro el papel sigue blanco.

## 9. Accesibilidad y verificación

- WCAG 2.1 AA: contrastes de la sección 2; foco visible 2 px en todos los interactivos (2.4.7); objetivos ≥ 40 px (32 px en densos, ≥24 px mínimo 2.5.8); error identificado en texto (3.3.1); `prefers-reduced-motion` y `color-scheme` respetados.
- Pruebas sugeridas: axe sobre cada vista en ambos temas; navegación solo teclado (tabs, diálogo con Esc/focus trap); zoom 200 % sin scroll horizontal; imprimir/PDF y copiar el texto del PDF para validar orden de lectura ATS.
- Rendimiento: 3 fuentes variables ≈167 KB; sin JS en estilos; sin imágenes decorativas.

## 10. Aplicación en `app/` (pasos)

1. Copiar `tokens.css` y `fonts/` (ajustar rutas `url()`); cargar antes del CSS propio.
2. Mapear las variables actuales de la app a los tokens (`--color-*`); alternar `data-theme` en `<html>` desde el botón de tema.
3. Reemplazar botones/inputs/tarjetas/badges por clases `mn-*` (o heredar sus reglas).
4. Portar el bloque `.hv-doc` a `print.css`.
5. Revisión visual contra `mockup-light.png` / `mockup-dark.png`.

## 11. Iteración de revisión (registro)

Captura 1 → hallazgos: la hoja HV de muestra quedaba demasiado corta para parecer un A4, encabezados de tarjeta de ítem débiles, páginas Documentos/Plantillas con jerarquía plana. Cambios: `min-height: 250mm` en hoja, `h3` de tarjeta a 17 px/600, título de Plantillas más descriptivo. Un intento de eyebrow redundante se descartó. Pendiente consciente: el papel blanco es muy brillante en tema oscuro (opción: `filter: brightness(.94)` solo en pantalla).

Mode: Normal · Metrics: screens=5, components=14, tokens≈70
