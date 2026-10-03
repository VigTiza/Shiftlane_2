// Permisos por acción y matriz rol → permisos. La usan la API (para autorizar) y las apps web
// (para mostrar u ocultar opciones). docs/api.md se genera a partir de este archivo.

export type Scope = 'carrier' | 'plant' | 'platform';

export interface PermissionDefinition {
  description: string;
  scopes: readonly Scope[];
}

const carrier = ['carrier'] as const;
const plant = ['plant'] as const;
const platform = ['platform'] as const;
const carrierAndPlant = ['carrier', 'plant'] as const;

export const PERMISSIONS = {
  // Cuenta y usuarios (transportista y planta)
  'users.read': { description: 'Ver usuarios de la cuenta y sus roles', scopes: carrierAndPlant },
  'users.manage': {
    description: 'Invitar, desactivar usuarios y asignar roles o permisos',
    scopes: carrierAndPlant,
  },
  'audit.read': { description: 'Ver el historial de cambios', scopes: carrierAndPlant },

  // Transportista: configuración y suscripción
  'dashboard.view': { description: 'Ver el tablero de inicio', scopes: carrier },
  'settings.manage': {
    description: 'Configurar turnos, reglas de operación, plantillas y datos fiscales',
    scopes: carrier,
  },
  'subscription.manage': {
    description: 'Ver y administrar la suscripción y las facturas de Shiftlane',
    scopes: carrier,
  },

  // Transportista: catálogos
  'vehicles.read': { description: 'Ver unidades', scopes: carrier },
  'vehicles.write': { description: 'Dar de alta y editar unidades', scopes: carrier },
  'drivers.read': { description: 'Ver choferes', scopes: carrier },
  'drivers.write': { description: 'Dar de alta y editar choferes', scopes: carrier },
  'drivers.enroll': {
    description: 'Generar el QR de alta del chofer y restablecer su PIN',
    scopes: carrier,
  },
  'devices.manage': {
    description: 'Administrar celulares, modo kiosco y bloqueo remoto',
    scopes: carrier,
  },
  'clients.read': { description: 'Ver clientes, plantas y prospectos', scopes: carrier },
  'clients.write': {
    description: 'Editar clientes, plantas, contactos y prospectos',
    scopes: carrier,
  },
  'contracts.read': { description: 'Ver contratos y tarifas', scopes: carrier },
  'contracts.write': { description: 'Editar contratos, tarifas y penalizaciones', scopes: carrier },
  'passengers.read': { description: 'Ver pasajeros de las plantas atendidas', scopes: carrier },

  // Transportista: rutas, programación y operación
  'routes.read': { description: 'Ver rutas y paradas', scopes: carrier },
  'routes.write': { description: 'Editar rutas, paradas y cambios temporales', scopes: carrier },
  'schedule.read': { description: 'Ver la programación de viajes', scopes: carrier },
  'schedule.write': {
    description: 'Programar viajes y asignar unidades y choferes',
    scopes: carrier,
  },
  'requests.manage': { description: 'Atender solicitudes de las plantas', scopes: carrier },
  'monitoring.view': { description: 'Ver el monitoreo en vivo', scopes: carrier },
  'dispatch.operate': {
    description: 'Reasignar viajes, enviar unidad de respaldo y mensajes al chofer',
    scopes: carrier,
  },
  'alerts.manage': { description: 'Atender alertas e incidentes', scopes: carrier },
  'trips.execute': { description: 'Ejecutar viajes desde la app del chofer', scopes: carrier },

  // Transportista: cumplimiento, mantenimiento y finanzas
  'compliance.read': { description: 'Ver documentos y vencimientos', scopes: carrier },
  'compliance.write': { description: 'Cargar y actualizar documentos', scopes: carrier },
  'maintenance.read': { description: 'Ver mantenimiento y combustible', scopes: carrier },
  'maintenance.write': {
    description: 'Registrar servicios, reparaciones y cargas de combustible',
    scopes: carrier,
  },
  'reconciliation.manage': {
    description: 'Conciliar viajes, generar prefacturas y responder objeciones',
    scopes: carrier,
  },
  'invoicing.manage': { description: 'Emitir facturas y registrar cobranza', scopes: carrier },
  'reports.operations': {
    description: 'Ver reportes de operación, ocupación, choferes, unidades y clientes',
    scopes: carrier,
  },
  'reports.finance': { description: 'Ver reportes financieros', scopes: carrier },

  // Planta cliente
  'plant.dashboard': { description: 'Ver el tablero en vivo de sus rutas', scopes: plant },
  'plant.evidence': { description: 'Ver evidencia por viaje y puntualidad', scopes: plant },
  'plant.requests': {
    description: 'Solicitar viajes extra y cambios, y presentar quejas',
    scopes: plant,
  },
  'plant.prefactures': { description: 'Revisar, objetar y aprobar prefacturas', scopes: plant },
  'plant.employees': {
    description: 'Administrar la lista de empleados y los gafetes provisionales',
    scopes: plant,
  },
  'plant.attendance': { description: 'Ver la asistencia transportada', scopes: plant },
  'plant.compliance': { description: 'Ver el cumplimiento de sus proveedores', scopes: plant },
  'plant.complaints': { description: 'Ver encuestas y quejas de empleados', scopes: plant },
  'plant.reports': { description: 'Descargar reportes y configurar avisos', scopes: plant },
  'passenger.self': {
    description: 'Ver su ruta, su credencial y sus avisos; calificar viajes',
    scopes: plant,
  },

  // Plataforma (dueño de Shiftlane)
  'platform.accounts': { description: 'Administrar cuentas y pilotos', scopes: platform },
  'platform.billing': {
    description: 'Administrar suscripciones, igualaciones y cobranza',
    scopes: platform,
  },
  'platform.support': {
    description: 'Atender tickets y entrar a cuentas con permiso del cliente',
    scopes: platform,
  },
  'platform.health': { description: 'Ver la salud de clientes y del sistema', scopes: platform },
  'platform.announcements': { description: 'Publicar avisos', scopes: platform },
} as const satisfies Record<string, PermissionDefinition>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export interface RoleDefinition {
  name: string;
  scope: Scope;
  permissions: readonly Permission[];
}

function inScope(scope: Scope, except: readonly Permission[] = []): Permission[] {
  return ALL_PERMISSIONS.filter(
    (permission) =>
      (PERMISSIONS[permission].scopes as readonly Scope[]).includes(scope) &&
      !except.includes(permission),
  );
}

const ownerPermissions = inScope('carrier', ['trips.execute']);

export const ROLES = {
  owner: { name: 'Dueño', scope: 'carrier', permissions: ownerPermissions },
  manager: {
    name: 'Gerente',
    scope: 'carrier',
    permissions: ownerPermissions.filter((p) => p !== 'subscription.manage'),
  },
  planner: {
    name: 'Programador de rutas',
    scope: 'carrier',
    permissions: [
      'dashboard.view',
      'vehicles.read',
      'drivers.read',
      'clients.read',
      'contracts.read',
      'passengers.read',
      'routes.read',
      'routes.write',
      'schedule.read',
      'schedule.write',
      'requests.manage',
      'monitoring.view',
      'compliance.read',
      'reports.operations',
    ],
  },
  dispatcher: {
    name: 'Despachador',
    scope: 'carrier',
    permissions: [
      'dashboard.view',
      'vehicles.read',
      'drivers.read',
      'drivers.write',
      'drivers.enroll',
      'clients.read',
      'passengers.read',
      'routes.read',
      'schedule.read',
      'schedule.write',
      'monitoring.view',
      'dispatch.operate',
      'alerts.manage',
      'compliance.read',
      'reports.operations',
    ],
  },
  billing: {
    name: 'Administración',
    scope: 'carrier',
    permissions: [
      'dashboard.view',
      'clients.read',
      'contracts.read',
      'reconciliation.manage',
      'invoicing.manage',
      'reports.operations',
      'reports.finance',
    ],
  },
  maintenance: {
    name: 'Mantenimiento',
    scope: 'carrier',
    permissions: [
      'dashboard.view',
      'vehicles.read',
      'vehicles.write',
      'compliance.read',
      'compliance.write',
      'maintenance.read',
      'maintenance.write',
    ],
  },
  driver: { name: 'Chofer', scope: 'carrier', permissions: ['trips.execute'] },
  plant_logistics: {
    name: 'Logística de planta',
    scope: 'plant',
    permissions: [
      'users.read',
      'users.manage',
      'audit.read',
      'plant.dashboard',
      'plant.evidence',
      'plant.requests',
      'plant.prefactures',
      'plant.compliance',
      'plant.reports',
    ],
  },
  plant_hr: {
    name: 'Recursos humanos de planta',
    scope: 'plant',
    permissions: [
      'plant.dashboard',
      'plant.employees',
      'plant.attendance',
      'plant.complaints',
      'plant.reports',
    ],
  },
  passenger: { name: 'Pasajero', scope: 'plant', permissions: ['passenger.self'] },
  platform_admin: {
    name: 'Administrador de plataforma',
    scope: 'platform',
    permissions: inScope('platform'),
  },
} as const satisfies Record<string, RoleDefinition>;

export type RoleKey = keyof typeof ROLES;

export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}

export function isRoleKey(value: string): value is RoleKey {
  return Object.hasOwn(ROLES, value);
}

export interface PermissionOverrides {
  grants?: readonly string[];
  revokes?: readonly string[];
}

/**
 * Permisos efectivos: los de sus roles, más los otorgados, menos los quitados. Solo cuentan
 * permisos del ámbito del usuario, aunque se hayan guardado otros por error.
 */
export function effectivePermissions(
  scope: Scope,
  roleKeys: readonly string[],
  overrides: PermissionOverrides = {},
): Permission[] {
  const result = new Set<Permission>();
  for (const key of roleKeys) {
    if (!isRoleKey(key)) continue;
    const role: RoleDefinition = ROLES[key];
    if (role.scope !== scope) continue;
    for (const permission of role.permissions) result.add(permission);
  }
  for (const permission of overrides.grants ?? []) {
    if (isPermission(permission) && permissionAllowedIn(permission, scope)) result.add(permission);
  }
  for (const permission of overrides.revokes ?? []) {
    if (isPermission(permission)) result.delete(permission);
  }
  return ALL_PERMISSIONS.filter((permission) => result.has(permission));
}

export function permissionAllowedIn(permission: Permission, scope: Scope): boolean {
  return (PERMISSIONS[permission].scopes as readonly Scope[]).includes(scope);
}
