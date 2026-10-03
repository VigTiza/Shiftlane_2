// Regenera la matriz de permisos en docs/api.md. Uso: pnpm docs:permisos
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { replaceMatrix } from '../src/permissions-doc.ts';

const file = path.resolve(import.meta.dirname, '../../../docs/api.md');
writeFileSync(file, replaceMatrix(readFileSync(file, 'utf8')));
console.log('Matriz de permisos actualizada en docs/api.md');
