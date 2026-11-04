// Registro de modelos de HV. Para agregar uno: crear js/models/<id>.js y registrarlo aquí (ver docs/MODELOS.md).
import minerva from './minerva.js';
import formatoUnico from './formato-unico.js';

const list = [minerva, formatoUnico];
export const registry = Object.fromEntries(list.map((m) => [m.id, m]));
export const DEFAULT_MODEL = minerva.id;
export const getModel = (id) => registry[id] || registry[DEFAULT_MODEL];

/** Modelo al que pertenece una plantilla. Las plantillas sin `modelId` (anteriores a G02 o importadas sin él) son del modelo por defecto;
 *  un `modelId` desconocido (respaldo de una versión con más modelos) se conserva tal cual: no se lista en ningún formato, pero no se pierde. */
export const templateModelId = (t) => t?.modelId || DEFAULT_MODEL;
/** Plantillas de un modelo (Plantillas, Documentos y Vista previa listan solo las del formato activo). */
export const templatesFor = (list, modelId) => (Array.isArray(list) ? list : []).filter((t) => templateModelId(t) === modelId);
