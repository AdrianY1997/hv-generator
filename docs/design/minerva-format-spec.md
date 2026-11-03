# Formato Minerva: especificación extraída de docs/minerva.pdf

Fuente: `docs/minerva.pdf` ("Hoja de Vida para solicitud de empleo", LIBRE; Adobe LiveCycle Designer ES 8.2, AcroForm con 4 páginas).
No es el "Formato Único Hoja de Vida" de la función pública: es el formulario de solicitud de empleo de 4 páginas.

## Página y tipografía
- 4 páginas Carta (612 x 792 pt), sin rotación. Cada página tiene su propia caja de contenido (p. 1: x 71-581; p. 2-4: x 30-541; p. 3: x 71-581).
- Fuentes: Arial (regular, negrita, cursiva, negrita cursiva) y Arial Black (títulos y numerales). Etiquetas 5.3-7 pt negrita; títulos de sección 12.2 pt Arial Black con sombra (texto azul desplazado +1,+1 bajo texto blanco); "HOJA DE VIDA" 26 pt Arial Black. Campos del solicitante: 9 pt.
- Colores: azul de línea/texto `#144a7d`; barras de sección `#007ac0` (texto blanco); subencabezados `#75bee9`; celdas sombreadas `#a6cbe8` / `#bed4e6` / `#a6cbe8`; numerales de página (1-4, 30 pt, margen) `#a6cbe8`.
- Trazos 0.36-0.85 pt (grosor del marco del título 2.83 pt). Esquinas redondeadas en marcos y barras. Casillas de 10 x 10 pt (trazo 0.55 pt).
- Texto vertical derecho en p. 1: "© LIBRE Permitida toda reproducción, publicación, modificación. Todo sin fines lucrativos." (4.8 pt, cursiva).
- Marcas de comentario (nota amarilla) del PDF: no se replican (son anotaciones interactivas).

## Estructura (orden exacto)
- P. 1: título "HOJA DE VIDA / PARA SOLICITUD DE EMPLEO"; fila Fecha (D/M/A), Empleo o cargo interesado, Código cargo; **I. Información general** (apellidos, nombres, dirección/barrio, ciudad, teléfono, celular, correo, nacionalidad, profesión, estado civil, años de experiencia; caja de fotografía 3 x 4 cm = 85.1 x 113.4 pt en x 495.9, y 148.1); **Documentación** (cédula / extranjería, N°, expedida en, libreta militar N°, distrito, primera/segunda clase, tarjeta profesional, ¿tiene vehículo?, licencia N°, categoría); **II. Información personal** (21 preguntas con casillas Sí/No y líneas); **Objetivo** (3 renglones de 24 pt).
- P. 2: **III. Información familiar** (cónyuge, personas a cargo, padre/madre, hermanos: 2 filas); **IV. Educación y aptitudes** (tabla Primaria / Bachillerato Clásico-Técnico-Comercial-Otro / Superior Técnico-Tecnológico-Profesional / Postgrados con columnas año de finalización, años cursados, título, institución, ciudad; otros cursos; estudios actuales; otros conocimientos: sistemas y idiomas con grados R / B / MB); **V. Trayectoria por empresas** (38 clases de empresa + 18 áreas, casillas).
- P. 3: **VI. Experiencia laboral** (3 bloques idénticos: empresa, dirección, teléfono, cargo, jefe, fechas D/M/A, tiempo servido, sueldos, cargos, funciones, logros, tipo de contrato, horario, jornada, motivo de retiro, franja "Verificación (espacio exclusivo para el entrevistador)") e **Información de seguridad social** (EPS, pensiones, cesantías).
- P. 4: **VII. Referencias personales** (2 + 1 familiar, "Verificación"), autorización "Autorizo pedir información de mi Hoja de Vida sin ninguna restricción", "¡Importante!", Nota importante, Certificación, Firma del solicitante con C.C.; **VII. Administración proceso de selección** (espacio exclusivo para el empleador: se deja en blanco).

## Campos (86 + 124 + 103 + 59 widgets): ver `app/js/models/minerva.js` (`renderForm`) para la correspondencia clave del PDF -> campo del perfil.

## Cómo se reproduce
`docs/design/minerva-extract.py` (PyMuPDF) convierte cada página en SVG (trazados + texto estático con `textLength` para clavar los anchos) y lista las cajas de campos; resultado: `app/js/models/minerva-layout.js` (generado, no editar). `render()` superpone el texto del perfil (HTML escapado) y las X de las casillas. Estilo del papel: `app/css/paper.css`.
Comparación en blanco (renderizado vs PDF a 96 dpi, alineado): diferencia media ~3/255 por píxel; solo difiere el antialias del texto.
