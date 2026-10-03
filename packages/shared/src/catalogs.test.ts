import { describe, expect, it } from 'vitest';

import { daysUntil, documentStatus, todayIn } from './catalogs.ts';

describe('vencimiento de documentos', () => {
  const today = '2026-10-03';

  it('clasifica vigente, por vencer, vencido y sin vencimiento', () => {
    expect(documentStatus('2027-01-01', today)).toBe('valid');
    expect(documentStatus('2026-11-02', today)).toBe('expiring');
    expect(documentStatus('2026-11-03', today)).toBe('valid');
    expect(documentStatus('2026-10-03', today)).toBe('expiring');
    expect(documentStatus('2026-10-02', today)).toBe('expired');
    expect(documentStatus(null, today)).toBe('no_expiry');
  });

  it('cuenta los días que faltan', () => {
    expect(daysUntil('2026-10-08', today)).toBe(5);
    expect(daysUntil('2026-09-30', today)).toBe(-3);
  });

  it('calcula el día de hoy en la zona horaria de la planta', () => {
    // 05:30 UTC del 3 de octubre todavía es 2 de octubre en Ciudad Juárez (UTC-6).
    const instant = new Date('2026-10-03T05:30:00Z');
    expect(todayIn('America/Ciudad_Juarez', instant)).toBe('2026-10-02');
    expect(todayIn('UTC', instant)).toBe('2026-10-03');
  });
});
