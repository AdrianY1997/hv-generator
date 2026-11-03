// Accesibilidad transversal (G08). Sin dependencias.

/** Tras cambiar de vista, el foco pasa al título (h1) para que lector de pantalla y teclado empiecen en el contenido y no en el menú. */
export function focusViewHeading(root = document) {
  const h1 = root.querySelector('h1');
  if (h1) { if (!h1.hasAttribute('tabindex')) h1.tabIndex = -1; h1.focus({ preventScroll: false }); }
  else root.focus?.();
}
