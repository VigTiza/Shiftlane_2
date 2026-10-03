import { z } from 'zod';

// Mensajes de validación en español para todos los esquemas de la API.
// Los módulos importan z desde aquí para que la configuración siempre esté aplicada.
z.config(z.locales.es());

export { z };
