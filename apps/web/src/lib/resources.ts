// Tipos de lo que responde la API (los mismos nombres que en apps/api) y consultas comunes.
import type { DriverStatus, PenaltyType, RateBasis, VehicleStatus } from '@shiftlane/shared';
import { useQuery } from '@tanstack/react-query';

import { api } from './api';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DocumentCounts {
  expired: number;
  expiring: number;
}

export interface Vehicle {
  id: string;
  economicNumber: string;
  plates: string;
  make: string | null;
  model: string;
  year: number;
  capacity: number;
  requiredLicenseType: string | null;
  status: VehicleStatus;
  odometerKm: number;
  hasPhoto: boolean;
  notes: string | null;
  documents: DocumentCounts;
}

export interface Driver {
  id: string;
  fullName: string;
  employeeNumber: string | null;
  phone: string | null;
  status: DriverStatus;
  licenseNumber: string | null;
  licenseType: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  habitualVehicle: { id: string; economicNumber: string } | null;
  hasPhoto: boolean;
  notes: string | null;
  access: { pinSet: boolean; devices: number };
  documents: DocumentCounts;
}

export interface Enrollment {
  code: string;
  qrPayload: string;
  expiresAt: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Gate {
  id: string;
  name: string;
  active: boolean;
  qrPayload: string;
  location: LatLng | null;
}

export interface Plant {
  id: string;
  clientOrgId: string;
  name: string;
  address: string | null;
  timezone: string;
  location: LatLng | null;
  served: boolean;
  passengerActivationCode: string | null;
}

export interface PlantDetail extends Plant {
  gates: Gate[];
}

export const CONTACT_AREA_LABELS = {
  logistics: 'Logística',
  hr: 'Recursos humanos',
  security: 'Seguridad',
  purchasing: 'Compras',
  finance: 'Finanzas',
  management: 'Dirección',
  other: 'Otra',
} as const;
export type ContactArea = keyof typeof CONTACT_AREA_LABELS;

export interface Contact {
  id: string;
  clientOrgId: string;
  plantId: string | null;
  fullName: string;
  area: ContactArea;
  position: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export interface ClientOrg {
  id: string;
  name: string;
  legalName: string | null;
  rfc: string | null;
  managed: boolean;
  plants: Plant[];
}

export interface ClientOrgDetail extends ClientOrg {
  contacts: Contact[];
  contracts: {
    id: string;
    name: string;
    status: string;
    startsOn: string;
    endsOn: string | null;
  }[];
}

export type ContractStatus = 'draft' | 'active' | 'ended';

export interface Rate {
  id: string;
  name: string | null;
  basis: RateBasis;
  amount: number;
  routeId: string | null;
  weekdays: number[];
  startTime: string | null;
  endTime: string | null;
  holidays: boolean | null;
  minCapacity: number | null;
  maxCapacity: number | null;
  validFrom: string | null;
  validTo: string | null;
  minimumCharge: number | null;
  priority: number;
}

export interface Penalty {
  id: string;
  type: PenaltyType;
  description: string | null;
  amountType: 'fixed' | 'percent';
  amount: number;
  graceMinutes: number | null;
}

export interface Contract {
  id: string;
  clientOrgId: string;
  clientOrgName: string;
  plantId: string | null;
  name: string;
  number: string | null;
  status: ContractStatus;
  startsOn: string;
  endsOn: string | null;
  notes: string | null;
}

export interface ContractDetail extends Contract {
  rates: Rate[];
  penalties: Penalty[];
}

export interface Passenger {
  id: string;
  clientOrgId: string;
  plantId: string;
  employeeNumber: string;
  fullName: string;
  shiftName: string | null;
  phone: string | null;
  status: 'active' | 'inactive';
  activated: boolean;
  credentials: { id: string; kind: string; value: string | null; revokedAt: string | null }[];
}

export interface Invitation {
  id: string;
  plantId: string;
  email: string;
  fullName: string;
  role: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  acceptedAt: string | null;
}

export interface ImportReport {
  totalRows: number;
  created: number;
  updated: number;
  errors: { row: number; column?: string; message: string }[];
  applied: boolean;
}

export interface Company {
  id: string;
  name: string;
  legalName: string | null;
  rfc: string | null;
  hasLogo: boolean;
}

export type OnboardingStepKey =
  | 'company'
  | 'operation'
  | 'fleet'
  | 'clients'
  | 'routes'
  | 'plant_invite'
  | 'devices'
  | 'test_trip';

export interface Onboarding {
  steps: { key: OnboardingStepKey; done: boolean; count: number; markedManually: boolean }[];
  completed: number;
  total: number;
  dismissed: boolean;
}

export interface Shift {
  id: string;
  plantId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  weekdays: number[];
  active: boolean;
}

export interface AlertRule {
  type: string;
  label: string;
  enabled: boolean;
  severity: 'info' | 'warning' | 'critical';
  params: Record<string, unknown>;
  escalateAfterMinutes: number;
  notifyPlant: boolean;
  custom: boolean;
}

/** Trae todas las páginas de una lista (catálogos de cientos de registros, no miles). */
export async function fetchAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  const separator = path.includes('?') ? '&' : '?';
  for (let page = 1; page < 100; page++) {
    const result = await api<Paginated<T>>(`${path}${separator}page=${page}&pageSize=100`);
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) break;
  }
  return items;
}

export const keys = {
  vehicles: ['vehicles'] as const,
  drivers: ['drivers'] as const,
  clients: ['client-orgs'] as const,
  client: (id: string) => ['client-orgs', id] as const,
  plant: (id: string) => ['plants', id] as const,
  invitations: (plantId: string) => ['plants', plantId, 'invitations'] as const,
  contracts: ['contracts'] as const,
  contract: (id: string) => ['contracts', id] as const,
  passengers: (filters: object) => ['passengers', filters] as const,
  company: ['company'] as const,
  onboarding: ['onboarding'] as const,
  shifts: ['shifts'] as const,
  alertRules: ['alert-rules'] as const,
};

export function useVehicles() {
  return useQuery({ queryKey: keys.vehicles, queryFn: () => fetchAll<Vehicle>('/vehicles') });
}

export function useDrivers() {
  return useQuery({ queryKey: keys.drivers, queryFn: () => fetchAll<Driver>('/drivers') });
}

export function useClientOrgs() {
  return useQuery({ queryKey: keys.clients, queryFn: () => api<ClientOrg[]>('/client-orgs') });
}

export function useOnboarding(enabled = true) {
  return useQuery({
    queryKey: keys.onboarding,
    queryFn: () => api<Onboarding>('/onboarding'),
    enabled,
  });
}
