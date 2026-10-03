import { describe, expect, it } from 'vitest';

import { addDays, mexicanOfficialHolidays, zonedDateTime } from './calendar.ts';

describe('días de descanso obligatorio (LFT art. 74)', () => {
  it('calcula los lunes móviles de 2026', () => {
    expect(mexicanOfficialHolidays(2026).map((h) => h.date)).toEqual([
      '2026-01-01',
      '2026-02-02',
      '2026-03-16',
      '2026-05-01',
      '2026-09-16',
      '2026-11-16',
      '2026-12-25',
    ]);
  });

  it('agrega la transmisión del Poder Ejecutivo cada seis años', () => {
    expect(mexicanOfficialHolidays(2030).map((h) => h.date)).toContain('2030-10-01');
    expect(mexicanOfficialHolidays(2027).map((h) => h.date)).not.toContain('2027-10-01');
  });
});

describe('horas locales de la planta', () => {
  it('convierte la hora de Ciudad Juárez con y sin horario de verano', () => {
    // Octubre: horario de verano de la montaña (UTC-6).
    expect(zonedDateTime('2026-10-05', '05:30', 'America/Ciudad_Juarez').toISOString()).toBe(
      '2026-10-05T11:30:00.000Z',
    );
    // Diciembre: horario normal (UTC-7).
    expect(zonedDateTime('2026-12-07', '05:30', 'America/Ciudad_Juarez').toISOString()).toBe(
      '2026-12-07T12:30:00.000Z',
    );
  });

  it('Ciudad de México no tiene horario de verano (UTC-6 todo el año)', () => {
    expect(zonedDateTime('2026-07-01', '06:00', 'America/Mexico_City').toISOString()).toBe(
      '2026-07-01T12:00:00.000Z',
    );
    expect(zonedDateTime('2026-12-01', '06:00', 'America/Mexico_City').toISOString()).toBe(
      '2026-12-01T12:00:00.000Z',
    );
  });

  it('suma días sin problemas de horario', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
