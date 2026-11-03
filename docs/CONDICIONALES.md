# Campos condicionales del formulario (`showIf`)

El formulario de Perfil pregunta solo lo que aplica según las respuestas anteriores, igual que se llena el PDF `docs/minerva.pdf` («si trabaja actualmente, ¿en qué empresa?»). Es una clave **aditiva** del schema del modelo (`app/js/models/minerva.js`): `showIf` en campos y en secciones. El perfil, las plantillas y los ids de archivo **no cambian de forma**: un modelo o un respaldo sin `showIf` se comporta como siempre.

## Declaración

```js
{ id: 'empresaActual', label: '¿En qué empresa?', type: 'text', showIf: { field: 'trabajaActualmente', equals: 'Si' } }
{ id: 'conyugeNombre', ..., showIf: { field: 'personales.estadoCivil', in: ['Casado(a)', 'Unión libre'] } }   // otra sección simple: «sección.campo»
{ id: 'claseLibreta', ..., showIf: { allOf: [{ field: 'sexo', not: 'F' }, { field: 'libretaMilitar', notEmpty: true }] } }
```

- Hoja: `{ field, <un operador>, whenEmpty? }` con `equals`, `not`, `in`, `notIn`, `includes` (la lista contiene), `notEmpty`, `empty`, `gt`, `gte`, `lt`, `lte`. Combinadores: `allOf`, `anyOf`, `noneOf`.
- `field` sin punto = otro campo **del mismo registro** (en secciones repetibles, el mismo ítem: cada registro se evalúa por separado). `seccion.campo` = campo de una sección simple (no repetible).
- Lo evalúa un único módulo puro, `app/js/conditions.js` (sin DOM y **sin `eval`**: los operadores son una lista cerrada), con pruebas en `app/tests/conditions.test.mjs`. Una condición mal formada no oculta nada. Lo usan el formulario, `validateProfile`, `render()`/`missing()` del modelo y el editor de plantillas, así que dicen todos lo mismo.
- `whenEmpty: true|false` fija el resultado cuando el controlador está sin responder (por omisión, ver la regla siguiente).

## Reglas de datos (política)

| Qué | Regla |
|---|---|
| Valor de un campo oculto | **Se conserva** en el perfil y en los respaldos. Si la persona cambia de opinión, vuelve tal cual. |
| Formulario (Perfil) | El campo oculto lleva `hidden`: sale del orden de tabulación y del árbol de accesibilidad, y no se valida. El controlador declara `aria-controls`; al mostrar u ocultar se anuncia en una región viva («Ahora se muestra: …»); el foco no se mueve; los campos que aparecen entran con una animación corta (se reduce con `prefers-reduced-motion`). Cada sección con campos ocultos muestra una nota discreta («N campos ocultos según tus respuestas»). |
| Obligatorios y avisos | Un campo oculto **no se exige** ni cuenta en las insignias de pendientes de Perfil ni en «Faltan N dato(s)» de Vista previa, y **no se valida** (`validateProfile` lo omite: tampoco aparece en «dato(s) por revisar»). Ningún obligatorio del schema es condicional (una prueba lo impide). |
| Impresión / HV | `render()` trabaja sobre una copia del perfil **sin** lo que no aplica (`pruneProfile`): no sale en el formulario ni en la hoja de continuación, y no se anexa su certificado. |
| Plantillas | El editor sigue listando el campo (la elección de la plantilla se conserva), pero lo marca «Condicional: no aplica»; no cuenta como dato ni genera avisos de certificado faltante. |
| Lectura para lector de pantalla | La lectura lineal de la vista previa (`.hv-sr`, G08) se arma desde la misma copia sin lo que no aplica: un campo oculto por una condición tampoco se lee. Con objetivo de plantilla sustituye al perfil profesional, igual que la hoja. |
| Controlador sin responder | `equals`, `in`, `includes`, `gt`… dan «no se sabe»: el dependiente queda **oculto hasta responder**. `not`, `notIn` y `empty` sí tienen respuesta (vacío no es igual a nada): el dependiente se muestra. «Vacío» es no responder (`''`, nulo, espacios); una casilla sin marcar (`false`), `0` y una lista vacía **sí son respuestas**. |
| Perfiles anteriores | SOLO para perfiles que ya tenían datos **antes** de las condiciones: `migrate.js` (datos v2) les pone la marca `legacyConditions: true` en el perfil (metadato junto a `documents` y `documentsShown`; no es una sección). Con la marca, si el controlador está sin responder **y** el propio campo ya tiene un dato, el campo se muestra y se imprime (el dato no desaparece en silencio); en cuanto se responde el controlador, manda la respuesta. **Sin la marca** (perfil nuevo o vacío al migrar) un controlador sin responder —o que la persona respondió y luego borró— oculta al dependiente aunque tenga dato. La marca nunca se pone a un perfil vacío, la migración es idempotente, el respaldo la conserva (v2), y al fusionar un respaldo solo se adopta si el perfil actual está vacío (nunca se agrega a un perfil que no la tenía). |
| Umbral mal formado | `gt`/`gte`/`lt`/`lte` con un umbral que no es un número (`"5"`, `null`...) es una condición mal formada: da `true` (no oculta nada) y `checkSchemaConditions` la señala. |
| Cadenas | Si el controlador está oculto, el dependiente también. Los ciclos no ocultan nada. |
| Secciones (`showIf` en una sección) | Soportado (oculta la pestaña; no valida ni imprime la sección); el modelo Minerva no lo usa porque todas sus secciones están siempre en el PDF. |

## Decisiones por campo

Criterio: se condiciona solo lo que el PDF presenta como dependiente de una pregunta anterior; **no se inventan condiciones que dejen un dato inalcanzable**. Cada condición tiene una prueba de alcanzabilidad (existe un estado del controlador que muestra el campo).

- **Siempre aplicables** (sin condición): «¿Trabajó antes en esta empresa?», «¿Aceptaría trabajar en otra ciudad?», tiempo de residencia, obligaciones y aspiración salarial, aficiones, padre y madre, hermanos, tarjeta profesional del encabezado, expedida en, tipo y número de documento, foto, y todo lo de referencias, idiomas, sistemas y cursos.
- **Libreta militar** (`sexo ≠ F`): la libreta no aplica a mujeres; con el sexo sin responder o «Otro» se pregunta. Clase y distrito aparecen al escribir el número. Quien tenga una libreta voluntaria puede elegir «Otro» en sexo o dejarlo vacío.
- **Cónyuge**: solo con estado civil «Casado(a)» o «Unión libre» (el PDF dice «esposa(o) o compañera(o)»). Separado, divorciado y viudo no.
- **Experiencia**: se agregó la casilla **«Es mi trabajo actual»** (`experiencia.actual`, campo nuevo y opcional; los perfiles anteriores sin ella siguen igual). Marcada oculta «Fecha de retiro» y «Motivo de retiro», y el total de tiempo servido se calcula hasta hoy si no se escribió. El plazo del contrato solo aplica al contrato fijo; «Contrato otro: ¿cuál?» solo con vinculación «Otro».
- **Estudios superiores**: «Graduado» marcado muestra fecha de grado y tarjeta profesional y oculta «Semestres aprobados»; sin marcar, al revés. «Años cursados» siempre.
- **Educación básica**: con nivel «Primaria» se ocultan tipo de bachillerato, años cursados de bachillerato y las filas «Primaria: …» (la primaria es el propio nivel). Con el nivel sin elegir, la primaria se pregunta.
- **Familiar**: parentesco y edades de dependientes solo si «N.º de personas que dependen» es mayor que 0.
- **Seguridad social**: nombre, fecha y tipo de afiliación solo si la respuesta es «Sí» (EPS, pensiones y cesantías por separado).
- **Trayectoria**: los «otros (¿cuáles?)» aparecen al marcar «Industria: otros», «OTROS SECTORES» u «Otras áreas».
- **Sin contraparte en el schema** (no se inventaron campos): tipo y placa del vehículo, vencimiento de la licencia, régimen de salud, número de hijos como pregunta aparte, y estado «en curso» de idiomas y cursos. «¿Tiene vehículo?» no gobierna nada; el número de licencia depende de que haya categoría.

## Tabla completa (generada del schema)

La última columna es el resultado con el perfil vacío; con la marca `legacyConditions` (perfiles anteriores) un campo que ya tiene un dato se muestra igualmente (ver «Perfiles anteriores»).

| Sección | Campo | Se muestra cuando | Controlador sin responder |
|---|---|---|---|
| Información general | Libreta militar (número / clase / distrito) | «Sexo» ≠ Femenino | se muestra |
| Información general | Libreta militar: clase | «Sexo» ≠ Femenino y «Libreta militar (número / clase / distrito)» con dato | oculto |
| Información general | Libreta militar: distrito | «Sexo» ≠ Femenino y «Libreta militar (número / clase / distrito)» con dato | oculto |
| Información general | Licencia de conducción: número | «Licencia de conducción (categoría)» con dato | oculto |
| Información personal | ¿En qué empresa? | «¿Está trabajando actualmente?» = Sí | oculto |
| Información personal | Vinculación actual | «¿Está trabajando actualmente?» = Sí | oculto |
| Información personal | Tipo de contrato | «¿Está trabajando actualmente?» = Sí | oculto |
| Información personal | Fecha de la solicitud anterior | «¿Solicitó empleo antes en esta empresa?» = Sí | oculto |
| Información personal | Quién lo recomienda: nombre | «¿Lo recomienda alguien de esta empresa?» = Sí | oculto |
| Información personal | Quién lo recomienda: dependencia | «¿Lo recomienda alguien de esta empresa?» = Sí | oculto |
| Información personal | Parientes: nombre | «¿Tiene parientes que trabajan en esta empresa?» = Sí | oculto |
| Información personal | Parientes: dependencia | «¿Tiene parientes que trabajan en esta empresa?» = Sí | oculto |
| Información personal | Otro medio (¿cuál?) | «¿Cómo tuvo conocimiento de la existencia de la vacante?» = Otro | oculto |
| Información personal | Nombre del arrendador | «Vive en casa» = Alquilada | oculto |
| Información personal | Teléfono del arrendador | «Vive en casa» = Alquilada | oculto |
| Información personal | Descríbalo e indique su valor mensual | «¿Actualmente tiene algún ingreso adicional?» = Sí | oculto |
| Información personal | ¿Por qué conceptos? | «¿Actualmente tiene algún ingreso adicional?» = Sí | oculto |
| Información personal | Deporte: ¿cuál(es)? | «¿Practica algún deporte?» = Sí | oculto |
| Información personal | Distinciones: ¿cuál(es)? | «¿Ha obtenido distinciones o reconocimientos por su desempeño en actividades deportivas, culturales, sociales?» = Sí | oculto |
| Información personal | Asociación: ¿cuál(es)? | «¿Pertenece a algún tipo de asociación comunitaria, deportiva, cultural?» = Sí | oculto |
| Información familiar | Nombre esposa(o) o compañera(o) | Información general › «Estado civil» ∈ {Casado(a), Unión libre} | oculto |
| Información familiar | Profesión, ocupación u oficio | Información general › «Estado civil» ∈ {Casado(a), Unión libre} | oculto |
| Información familiar | Empresa donde trabaja | Información general › «Estado civil» ∈ {Casado(a), Unión libre} | oculto |
| Información familiar | Cargo actual | Información general › «Estado civil» ∈ {Casado(a), Unión libre} | oculto |
| Información familiar | Dirección | Información general › «Estado civil» ∈ {Casado(a), Unión libre} | oculto |
| Información familiar | Teléfono | Información general › «Estado civil» ∈ {Casado(a), Unión libre} | oculto |
| Información familiar | Ciudad | Información general › «Estado civil» ∈ {Casado(a), Unión libre} | oculto |
| Información familiar | Parentesco | «N.º de personas que dependen económicamente del solicitante» > 0 | oculto |
| Información familiar | Edades | «N.º de personas que dependen económicamente del solicitante» > 0 | oculto |
| Educación básica y media | Tipo de bachillerato | «Nivel alcanzado» ∈ {Bachiller básico, Bachiller académico, Bachiller técnico} | oculto |
| Educación básica y media | Años cursados (bachillerato) | «Nivel alcanzado» ∈ {Bachiller básico, Bachiller académico, Bachiller técnico} | oculto |
| Educación básica y media | Primaria: institución | «Nivel alcanzado» ≠ Primaria | se muestra |
| Educación básica y media | Primaria: ciudad | «Nivel alcanzado» ≠ Primaria | se muestra |
| Educación básica y media | Primaria: año de finalización | «Nivel alcanzado» ≠ Primaria | se muestra |
| Educación básica y media | Primaria: años cursados | «Nivel alcanzado» ≠ Primaria | se muestra |
| Educación básica y media | Primaria: título obtenido | «Nivel alcanzado» ≠ Primaria | se muestra |
| Educación superior y postgrados (por registro) | Semestres aprobados | «Graduado» no marcada | se muestra |
| Educación superior y postgrados (por registro) | Fecha de grado / finalización | «Graduado» = marcada | oculto |
| Educación superior y postgrados (por registro) | Tarjeta profesional No. | «Graduado» = marcada | oculto |
| Estudios actuales | ¿Qué tipo de estudios? | «¿Cursa estudios actualmente?» = Sí | oculto |
| Estudios actuales | Duración (años, semestres, meses) | «¿Cursa estudios actualmente?» = Sí | oculto |
| Estudios actuales | Año / semestre que cursa | «¿Cursa estudios actualmente?» = Sí | oculto |
| Estudios actuales | Nombre de la institución | «¿Cursa estudios actualmente?» = Sí | oculto |
| Estudios actuales | Horario | «¿Cursa estudios actualmente?» = Sí | oculto |
| Trayectoria por empresas | Industria: otros (¿cuáles?) | «Clase de empresa(s) en las que ha trabajado» incluye «Industria: otros» | oculto |
| Trayectoria por empresas | Otros sectores (¿cuáles?) | «Clase de empresa(s) en las que ha trabajado» incluye «OTROS SECTORES» | oculto |
| Trayectoria por empresas | Otras áreas (¿cuáles?) | «Área(s) de la empresa en que se ha desempeñado» incluye «Otras áreas» | oculto |
| Experiencia laboral (por registro) | Fecha de retiro | «Es mi trabajo actual» no marcada | se muestra |
| Experiencia laboral (por registro) | Contrato: ¿cuánto tiempo? | «Tipo de contrato: término» = Fijo | oculto |
| Experiencia laboral (por registro) | Contrato otro: ¿cuál? | «Contrato: vinculación» = Otro | oculto |
| Experiencia laboral (por registro) | Motivo de retiro | «Es mi trabajo actual» no marcada | se muestra |
| Seguridad social | EPS: ¿cuál? | «¿Está afiliado a una EPS?» = Sí | oculto |
| Seguridad social | EPS: fecha de afiliación | «¿Está afiliado a una EPS?» = Sí | oculto |
| Seguridad social | EPS: afiliación | «¿Está afiliado a una EPS?» = Sí | oculto |
| Seguridad social | Pensiones: ¿cuál? | «¿Está afiliado a un fondo de pensiones?» = Sí | oculto |
| Seguridad social | Pensiones: fecha de afiliación | «¿Está afiliado a un fondo de pensiones?» = Sí | oculto |
| Seguridad social | Cesantías: ¿cuál? | «¿Está afiliado a un fondo de cesantías?» = Sí | oculto |
| Seguridad social | Cesantías: fecha de afiliación | «¿Está afiliado a un fondo de cesantías?» = Sí | oculto |

Total: 58 campos condicionales (más el campo nuevo `experiencia.actual`, que no es condicional).

## Aviso de texto largo

Los campos de una línea del PDF recortan lo que no cabe (`overflow:hidden`, ver `docs/IMPRESION.md`). Perfil avisa **sin bloquear** (no usa `maxlength`): `model.fitLimit(sección, campo)` calcula, con la geometría de `minerva-layout.js` (que no se toca) y la misma heurística de `render()` (glifo medio de 0,5 em), cuántos caracteres caben a la letra normal (9 pt, `comfort`) y a la mínima (`max`: 5 pt en una línea, 4,5 pt en filas). Entre ambos el aviso dice que el PDF usará letra más pequeña; por encima, que se recortará, con un contador «N / máx.». El texto del aviso solo cambia al cambiar de estado, para no repetirse en cada tecla. La tabla de casillas está en `FIT` (`minerva.js`) y el cálculo en `js/models/minerva-fit.js` (con pruebas).

Límites: es una estimación (el ancho real depende de la fuente); en secciones repetibles manda la casilla más pequeña de los bloques posibles, y los registros que no caben se imprimen en la hoja de continuación sin recorte, así que allí el aviso puede ser conservador; el nombre de la referencia se imprime junto al parentesco.
