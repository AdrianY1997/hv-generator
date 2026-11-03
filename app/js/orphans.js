// Archivos huérfanos (PURO): ids guardados en IndexedDB que ni el perfil, ni el modelo, ni las plantillas referencian.
// Nunca borra nada: solo calcula. El borrado lo decide la persona (vista Ajustes).

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function collectStrings(v, set, depth = 0) {
  if (depth > 8) return;
  if (typeof v === 'string') set.add(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, set, depth + 1);
  else if (isObj(v)) for (const x of Object.values(v)) collectStrings(x, set, depth + 1);
}

/**
 * referencedFileIds(profile, templates, schema, certFileId) -> Set<string>
 *  - certificados: los mismos ids que genera `certFileId` para cada ítem/sección/campo existente del perfil y del modelo;
 *  - documentos: `doc:<id>` (primera página, siempre se ofrece) y los ids listados en profile.documents;
 *  - foto: `photo` siempre (el render la usa sin condición);
 *  - cualquier texto de las plantillas que coincida con un id (conservador).
 */
export function referencedFileIds(profile, templates, schema, certFileId) {
  const refs = new Set();
  const p = isObj(profile) ? profile : {};
  for (const s of schema?.sections || []) {
    if (s.repeatable) {
      const items = Array.isArray(p[s.id]) ? p[s.id] : [];
      for (const it of items) {
        if (!isObj(it) || !it.id) continue;
        refs.add(certFileId(s, it, null));
      }
    } else {
      if (s.certificate) refs.add(certFileId(s, null, null));
      for (const f of s.fields || []) if (f.certificate) refs.add(certFileId(s, null, f));
    }
  }
  // Foto: la vista siempre la lee del archivo 'photo' (no depende de qué campo la nombre), así que nunca es huérfana.
  refs.add('photo');
  for (const d of schema?.documents || []) refs.add(`doc:${d.id}`);
  if (isObj(p.documents)) for (const lst of Object.values(p.documents)) if (Array.isArray(lst)) for (const id of lst) if (typeof id === 'string') refs.add(id);
  collectStrings(templates, refs);
  return refs;
}

/** findOrphans(files:[{id, meta}], refs:Set) -> [{id, name, size, label}] ordenados por tamaño descendente. */
export function findOrphans(files, refs) {
  return (files || [])
    .filter((f) => f && typeof f.id === 'string' && !refs.has(f.id))
    .map((f) => ({ id: f.id, name: f.meta?.name || f.id, size: Number(f.meta?.size) || 0, label: f.meta?.label || '' }))
    .sort((a, b) => b.size - a.size);
}
