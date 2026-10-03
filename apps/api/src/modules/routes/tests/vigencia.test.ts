import { describe, expect, it } from 'vitest';

import { effectiveVersion, stopTimeFor } from '../versioning.ts';
import type { TemporaryChangeForDate, VersionForDate } from '../versioning.ts';

const versions: VersionForDate[] = [
  { id: 'v1', kind: 'regular', validFrom: '2026-10-01' },
  { id: 'v2', kind: 'regular', validFrom: '2026-11-01' },
  { id: 'temp', kind: 'temporary', validFrom: '2026-10-20' },
];

const changes: TemporaryChangeForDate[] = [
  { id: 'c1', versionId: 'temp', startsOn: '2026-10-20', endsOn: '2026-10-22', cancelled: false },
];

describe('versión vigente de una ruta', () => {
  it('aplica la versión regular más reciente que ya empezó', () => {
    expect(effectiveVersion(versions, [], '2026-10-01')?.versionId).toBe('v1');
    expect(effectiveVersion(versions, [], '2026-10-31')?.versionId).toBe('v1');
    expect(effectiveVersion(versions, [], '2026-11-01')?.versionId).toBe('v2');
    expect(effectiveVersion(versions, [], '2027-05-01')?.versionId).toBe('v2');
  });

  it('antes de la primera versión la ruta no existe', () => {
    expect(effectiveVersion(versions, [], '2026-09-30')).toBeNull();
  });

  it('un cambio temporal aplica solo entre sus fechas y luego vuelve la versión normal', () => {
    expect(effectiveVersion(versions, changes, '2026-10-19')).toEqual({
      versionId: 'v1',
      temporaryChangeId: null,
      suspended: false,
    });
    expect(effectiveVersion(versions, changes, '2026-10-20')).toEqual({
      versionId: 'temp',
      temporaryChangeId: 'c1',
      suspended: false,
    });
    expect(effectiveVersion(versions, changes, '2026-10-22')?.versionId).toBe('temp');
    expect(effectiveVersion(versions, changes, '2026-10-23')?.versionId).toBe('v1');
  });

  it('un cambio temporal puede suspender el servicio y luego vuelve solo', () => {
    const suspension: TemporaryChangeForDate[] = [
      { id: 's1', versionId: null, startsOn: '2026-12-24', endsOn: '2026-12-25', cancelled: false },
    ];
    expect(effectiveVersion(versions, suspension, '2026-12-24')).toEqual({
      versionId: null,
      temporaryChangeId: 's1',
      suspended: true,
    });
    expect(effectiveVersion(versions, suspension, '2026-12-26')?.suspended).toBe(false);
  });

  it('un cambio temporal no aplica antes de que exista la ruta', () => {
    const early = [{ ...changes[0]!, startsOn: '2026-09-01', endsOn: '2026-09-05' }];
    expect(effectiveVersion(versions, early, '2026-09-02')).toBeNull();
  });

  it('un cambio temporal cancelado no aplica', () => {
    const cancelled = [{ ...changes[0]!, cancelled: true }];
    expect(effectiveVersion(versions, cancelled, '2026-10-21')?.versionId).toBe('v1');
  });

  it('si se traslapan cambios temporales gana el que empezó después', () => {
    const overlapping: TemporaryChangeForDate[] = [
      ...changes,
      {
        id: 'c2',
        versionId: 'temp2',
        startsOn: '2026-10-21',
        endsOn: '2026-10-25',
        cancelled: false,
      },
    ];
    expect(effectiveVersion(versions, overlapping, '2026-10-21')?.temporaryChangeId).toBe('c2');
    expect(effectiveVersion(versions, overlapping, '2026-10-20')?.temporaryChangeId).toBe('c1');
  });
});

describe('horario de una parada por día', () => {
  const variants = [
    { weekdays: [], time: '05:10' },
    { weekdays: [6], time: '06:40' },
  ];

  it('usa la variante del día o la general', () => {
    expect(stopTimeFor(variants, '2026-10-05')).toBe('05:10'); // lunes
    expect(stopTimeFor(variants, '2026-10-10')).toBe('06:40'); // sábado
    expect(stopTimeFor([{ weekdays: [1, 2, 3, 4, 5], time: '05:00' }], '2026-10-11')).toBeNull(); // domingo
  });
});
