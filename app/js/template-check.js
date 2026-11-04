// Comprobaciones puras de una plantilla contra el perfil y los archivos (sin DOM). Las usan el modelo (`missing`, anexos),
// el editor de plantillas y la vista previa, para que los tres digan lo mismo.
//
// G27: qué documentos selecciona una plantilla.
// G06: certificados prometidos (campos y secciones simples con `certificate`) que no tienen archivo.

const has = (v) => !(v == null || v === '' || v === false || (Array.isArray(v) && !v.length));

/**
 * ¿La plantilla incluye este campo? Su bandera propia manda; sin ella, un campo con `replaces` (docs/MODELOS.md) usa la del campo al que
 * reemplaza (plantillas anteriores: desmarcar `experiencia.cargo` sigue ocultando la casilla «Cargo» de Minerva). Sin plantilla: sí.
 */
export function fieldIncluded(t, secId, f) {
  if (!t) return true;
  const fl = t.include?.fields, own = fl?.[`${secId}.${f?.id}`];
  if (typeof own === 'boolean') return own;
  return f?.replaces ? fl?.[`${secId}.${f.replaces}`] !== false : true;
}

/** Bandera explícita de la plantilla para un documento (true/false) o undefined si no la tiene. */
export const docFlag = (t, id) => (typeof t?.include?.documents?.[id] === 'boolean' ? t.include.documents[id] : undefined);

/**
 * ¿La plantilla selecciona este documento? (G27)
 *  - Bandera explícita: manda, aunque el documento esté oculto en Documentos (no se quita ni se agrega en silencio).
 *  - Sin bandera (plantilla anterior a que existiera el documento, o `include.documents` ausente): comportamiento anterior,
 *    solo cuenta si el documento está mostrado en Documentos (`shown`: Set de ids). Sin `shown` se asume mostrado.
 */
export function docSelected(t, id, shown) {
  const f = docFlag(t, id);
  return f !== undefined ? f : (shown ? shown.has(id) : true);
}

/** Documentos que la plantilla pide de forma explícita y no tienen ningún archivo cargado: [id]. `fileCount(id)` -> n. */
export function docsMissing(t, docIds, fileCount) {
  return docIds.filter((id) => docFlag(t, id) === true && !(fileCount(id) > 0));
}

/**
 * Certificados que la plantilla promete y no existen (G06). Solo con `options.attachCertificates`.
 *   sections: schema.sections; hasFile(fileId) -> bool
 *   kinds: qué revisar: 'item' (registros de secciones repetibles con certificado), 'field' (campo con `certificate` en sección simple),
 *          'section' (sección simple con `certificate`). Por defecto los tres.
 * Un campo o sección simple solo cuenta si tiene un dato en el perfil (sin dato no hay nada que respaldar).
 * -> [{ kind, secId, title, fileId, item?, index?, field?, label }]
 */
export function certGaps(sections, t, profile, hasFile, kinds = ['item', 'field', 'section']) {
  if (!t || !t.options?.attachCertificates) return [];
  const want = new Set(kinds), out = [];
  const secOn = (id) => t.include?.sections === undefined || t.include.sections[id] !== false;
  for (const s of sections) {
    if (!secOn(s.id)) continue;
    if (s.repeatable) {
      if (!s.certificate || !want.has('item')) continue;
      (Array.isArray(profile?.[s.id]) ? profile[s.id] : []).forEach((it, index) => {
        if (!it || t.include?.items?.[it.id] === false) return;
        const fileId = `cert:${it.id}`;
        if (!hasFile(fileId)) out.push({ kind: 'item', secId: s.id, title: s.title, fileId, item: it, index, label: s.title });
      });
      continue;
    }
    const data = profile?.[s.id] || {};
    if (want.has('field')) {
      for (const f of s.fields) {
        if (!f.certificate || t.include?.fields?.[`${s.id}.${f.id}`] === false || !has(data[f.id])) continue;
        const fileId = `cert:${s.id}:${f.id}`;
        if (!hasFile(fileId)) out.push({ kind: 'field', secId: s.id, title: s.title, fileId, field: f, label: f.label });
      }
    }
    if (want.has('section') && s.certificate && s.fields.some((f) => f.type !== 'photo' && t.include?.fields?.[`${s.id}.${f.id}`] !== false && has(data[f.id]))) {
      const fileId = `cert:${s.id}`;
      if (!hasFile(fileId)) out.push({ kind: 'section', secId: s.id, title: s.title, fileId, label: s.title });
    }
  }
  return out;
}
