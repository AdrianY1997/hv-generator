// Se ejecuta con Node puro (no por el cargador de Playwright, que trata app/**/*.js como CommonJS) y vuelca el esquema real del modelo como JSON.
import model from '../../app/js/models/minerva.js';
process.stdout.write(JSON.stringify({ id: model.id, sections: model.schema.sections, documents: model.schema.documents }));
