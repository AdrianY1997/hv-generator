// Modelo de plantilla (sin dependencias). Forma vinculante compartida con el render.
const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'tpl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

/** newTemplate(model) -> plantilla vacía con todas las secciones y documentos incluidos. */
export function newTemplate(model) {
  const schema = model?.schema || { sections: [], documents: [] };
  const now = new Date().toISOString();
  return {
    id: newId(),
    name: '',
    modelId: model?.id || '',
    jobType: '',
    createdAt: now,
    updatedAt: now,
    include: {
      sections: Object.fromEntries(schema.sections.map((s) => [s.id, true])),
      items: {},
      fields: {},
      documents: Object.fromEntries((schema.documents || []).map((d) => [d.id, true])),
    },
    options: { showPhoto: true, attachCertificates: true, attachDocuments: true, objective: '' },
  };
}

/** Antigüedad máxima (días desde la expedición, 1 a 365) que exige la plantilla a los documentos con vigencia, o null = la regla de cada documento. */
export function templateMaxAge(t) {
  const n = Number(t?.options?.maxAgeDays);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max, def = '') => (typeof v === 'string' ? v.slice(0, max) : def);
const boolMap = (v) => {
  const out = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) if (k !== '__proto__' && typeof x === 'boolean') out[k] = x;
  return out;
};

/**
 * normalizeTemplate(raw) -> plantilla solo con los campos conocidos y tipos correctos, o null si `raw` no es un objeto.
 * `id` queda '' si falta (quien llama decide). include.documents queda ausente si no venía (ausente = todos incluidos).
 * No muta `raw`.
 */
export function normalizeTemplate(raw) {
  if (!isObj(raw)) return null;
  const inc = isObj(raw.include) ? raw.include : {};
  const opt = isObj(raw.options) ? raw.options : {};
  const include = { sections: boolMap(inc.sections), items: boolMap(inc.items), fields: boolMap(inc.fields) };
  if (isObj(inc.documents)) include.documents = boolMap(inc.documents);
  return {
    id: str(raw.id, 200),
    name: str(raw.name, 200),
    modelId: str(raw.modelId, 100),
    jobType: str(raw.jobType, 200),
    createdAt: str(raw.createdAt, 40),
    updatedAt: str(raw.updatedAt, 40),
    include,
    options: {
      showPhoto: typeof opt.showPhoto === 'boolean' ? opt.showPhoto : true,
      attachCertificates: typeof opt.attachCertificates === 'boolean' ? opt.attachCertificates : true,
      attachDocuments: typeof opt.attachDocuments === 'boolean' ? opt.attachDocuments : true,
      objective: str(opt.objective, 5000),
      // Clave opcional (G20): ausente = sin límite propio de la plantilla.
      ...(templateMaxAge({ options: opt }) ? { maxAgeDays: templateMaxAge({ options: opt }) } : {}),
    },
  };
}
