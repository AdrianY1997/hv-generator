// Registro de modelos de HV. Para agregar uno: crear js/models/<id>.js y registrarlo aquí.
import minerva from './minerva.js';

const list = [minerva];
export const registry = Object.fromEntries(list.map((m) => [m.id, m]));
export const DEFAULT_MODEL = minerva.id;
export const getModel = (id) => registry[id] || registry[DEFAULT_MODEL];
