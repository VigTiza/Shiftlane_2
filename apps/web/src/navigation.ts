// Secciones del panel por ámbito y permiso. La barra lateral y la búsqueda global muestran solo
// lo que el usuario puede ver; la API vuelve a revisar cada acción.
import {
  BellIcon,
  BroadcastIcon,
  BuildingsIcon,
  BusIcon,
  CalendarBlankIcon,
  ChartBarIcon,
  ClipboardTextIcon,
  DeviceMobileIcon,
  FileTextIcon,
  GaugeIcon,
  GearIcon,
  HandshakeIcon,
  HouseIcon,
  IdentificationCardIcon,
  LifebuoyIcon,
  PaletteIcon,
  PathIcon,
  ReceiptIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  TrayIcon,
  UsersIcon,
  UsersThreeIcon,
  WrenchIcon,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import type { Permission, Scope } from '@shiftlane/shared';

export interface NavItem {
  label: string;
  path: string;
  icon: Icon;
  /** Con cualquiera de estos permisos se muestra (vacío: todos los del ámbito). */
  permissions: Permission[];
  /** Palabras extra para la búsqueda global. */
  keywords?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const carrier: NavGroup[] = [
  {
    label: 'Operación',
    items: [
      { label: 'Inicio', path: '/', icon: HouseIcon, permissions: ['dashboard.view'] },
      {
        label: 'Monitoreo en vivo',
        path: '/monitoreo',
        icon: BroadcastIcon,
        permissions: ['monitoring.view'],
        keywords: 'mapa unidades gps',
      },
      {
        label: 'Alertas',
        path: '/alertas',
        icon: BellIcon,
        permissions: ['alerts.manage'],
        keywords: 'incidentes pánico retraso',
      },
      {
        label: 'Programación',
        path: '/programacion',
        icon: CalendarBlankIcon,
        permissions: ['schedule.read'],
        keywords: 'viajes calendario asignar',
      },
      {
        label: 'Solicitudes',
        path: '/solicitudes',
        icon: TrayIcon,
        permissions: ['requests.manage'],
        keywords: 'plantas viajes extra',
      },
    ],
  },
  {
    label: 'Catálogos',
    items: [
      { label: 'Rutas', path: '/rutas', icon: PathIcon, permissions: ['routes.read'] },
      {
        label: 'Unidades',
        path: '/unidades',
        icon: BusIcon,
        permissions: ['vehicles.read'],
        keywords: 'camiones placas',
      },
      {
        label: 'Choferes',
        path: '/choferes',
        icon: IdentificationCardIcon,
        permissions: ['drivers.read'],
        keywords: 'operadores licencias',
      },
      {
        label: 'Clientes y plantas',
        path: '/clientes',
        icon: BuildingsIcon,
        permissions: ['clients.read'],
        keywords: 'maquiladoras crm prospectos',
      },
      {
        label: 'Contratos y tarifas',
        path: '/contratos',
        icon: HandshakeIcon,
        permissions: ['contracts.read'],
      },
      {
        label: 'Pasajeros',
        path: '/pasajeros',
        icon: UsersThreeIcon,
        permissions: ['passengers.read'],
        keywords: 'empleados credenciales gafetes',
      },
      {
        label: 'Celulares',
        path: '/celulares',
        icon: DeviceMobileIcon,
        permissions: ['devices.manage', 'monitoring.view'],
      },
    ],
  },
  {
    label: 'Administración',
    items: [
      {
        label: 'Configuración inicial',
        path: '/configuracion-inicial',
        icon: RocketLaunchIcon,
        permissions: ['settings.manage'],
        keywords: 'asistente empezar pasos',
      },
      {
        label: 'Cumplimiento',
        path: '/cumplimiento',
        icon: ShieldCheckIcon,
        permissions: ['compliance.read'],
        keywords: 'documentos vencimientos',
      },
      {
        label: 'Mantenimiento',
        path: '/mantenimiento',
        icon: WrenchIcon,
        permissions: ['maintenance.read'],
        keywords: 'servicios combustible',
      },
      {
        label: 'Conciliación y facturas',
        path: '/facturacion',
        icon: ReceiptIcon,
        permissions: ['reconciliation.manage', 'invoicing.manage'],
        keywords: 'prefacturas cobranza cfdi',
      },
      {
        label: 'Reportes',
        path: '/reportes',
        icon: ChartBarIcon,
        permissions: ['reports.operations', 'reports.finance'],
      },
      {
        label: 'Configuración',
        path: '/configuracion',
        icon: GearIcon,
        permissions: ['settings.manage', 'users.read'],
        keywords: 'usuarios roles turnos',
      },
    ],
  },
];

const plant: NavGroup[] = [
  {
    label: 'Mi transporte',
    items: [
      { label: 'Tablero en vivo', path: '/', icon: GaugeIcon, permissions: ['plant.dashboard'] },
      {
        label: 'Evidencia',
        path: '/evidencia',
        icon: ClipboardTextIcon,
        permissions: ['plant.evidence'],
      },
      {
        label: 'Solicitudes',
        path: '/solicitudes',
        icon: TrayIcon,
        permissions: ['plant.requests'],
      },
      { label: 'Empleados', path: '/empleados', icon: UsersIcon, permissions: ['plant.employees'] },
      {
        label: 'Prefacturas',
        path: '/prefacturas',
        icon: FileTextIcon,
        permissions: ['plant.prefactures'],
      },
      { label: 'Reportes', path: '/reportes', icon: ChartBarIcon, permissions: ['plant.reports'] },
    ],
  },
];

const platform: NavGroup[] = [
  {
    label: 'Plataforma',
    items: [
      { label: 'Cuentas', path: '/', icon: BuildingsIcon, permissions: ['platform.accounts'] },
      {
        label: 'Cobro',
        path: '/cobro',
        icon: ReceiptIcon,
        permissions: ['platform.billing'],
      },
      {
        label: 'Soporte',
        path: '/soporte',
        icon: LifebuoyIcon,
        permissions: ['platform.support'],
      },
      { label: 'Salud', path: '/salud', icon: GaugeIcon, permissions: ['platform.health'] },
    ],
  },
];

/** Siempre visible: la referencia del sistema de diseño (para el equipo). */
export const designSystemItem: NavItem = {
  label: 'Sistema de diseño',
  path: '/sistema-de-diseno',
  icon: PaletteIcon,
  permissions: [],
  keywords: 'componentes colores tipografía',
};

const groupsByScope: Record<Scope, NavGroup[]> = { carrier, plant, platform };

export function navigationFor(scope: Scope, permissions: readonly Permission[]): NavGroup[] {
  return groupsByScope[scope]
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.permissions.length === 0 || item.permissions.some((p) => permissions.includes(p)),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

export const scopeLabels: Record<Scope, string> = {
  carrier: 'Transportista',
  plant: 'Planta',
  platform: 'Plataforma Shiftlane',
};
