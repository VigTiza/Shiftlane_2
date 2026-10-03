import { PERMISSIONS, ROLE_KEYS, ROLES } from './permissions.ts';
import type { Permission, RoleDefinition } from './permissions.ts';

export const MATRIX_START = '<!-- matriz-permisos:inicio (generado, no editar) -->';
export const MATRIX_END = '<!-- matriz-permisos:fin -->';

const SCOPE_NAMES = { carrier: 'Transportista', plant: 'Planta', platform: 'Plataforma' };

const code = (value: string) => '`' + value + '`';

/** Tabla Markdown de permisos por rol para docs/api.md. */
export function renderPermissionMatrix(): string {
  const header = ['Permiso', 'Ámbito', 'Descripción', ...ROLE_KEYS.map(code)];
  const rows = (Object.keys(PERMISSIONS) as Permission[]).map((permission) => {
    const definition = PERMISSIONS[permission];
    const marks = ROLE_KEYS.map((key) => {
      const role: RoleDefinition = ROLES[key];
      return role.permissions.includes(permission) ? '✓' : '';
    });
    const scopes = definition.scopes.map((scope) => SCOPE_NAMES[scope]).join(', ');
    return [code(permission), scopes, definition.description, ...marks];
  });
  const roleNames = ROLE_KEYS.map((key) => `- ${code(key)}: ${ROLES[key].name}`).join('\n');
  const table = [header, header.map(() => '---'), ...rows]
    .map((cells) => `| ${cells.join(' | ')} |`)
    .join('\n');
  return `${MATRIX_START}\n\n${table}\n\nRoles:\n\n${roleNames}\n\n${MATRIX_END}`;
}

/** Reemplaza la matriz entre los marcadores de un documento. */
export function replaceMatrix(document: string): string {
  const start = document.indexOf(MATRIX_START);
  const end = document.indexOf(MATRIX_END);
  if (start === -1 || end === -1) {
    throw new Error('docs/api.md no tiene los marcadores de la matriz.');
  }
  return (
    document.slice(0, start) + renderPermissionMatrix() + document.slice(end + MATRIX_END.length)
  );
}
