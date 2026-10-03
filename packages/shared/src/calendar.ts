// Calendario laboral: días de descanso obligatorio en México y conversión de horas locales.

export interface OfficialHoliday {
  /** AAAA-MM-DD */
  date: string;
  name: string;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** N-ésimo lunes de un mes (n = 1 primero, 3 tercero). */
function nthMonday(year: number, month: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (8 - first) % 7; // días hasta el primer lunes
  return iso(year, month, 1 + offset + (n - 1) * 7);
}

/**
 * Días de descanso obligatorio de la Ley Federal del Trabajo (artículo 74). No incluye la
 * jornada electoral, que se agrega por año cuando hay elecciones.
 */
export function mexicanOfficialHolidays(year: number): OfficialHoliday[] {
  const holidays: OfficialHoliday[] = [
    { date: iso(year, 1, 1), name: 'Año Nuevo' },
    { date: nthMonday(year, 2, 1), name: 'Día de la Constitución' },
    { date: nthMonday(year, 3, 3), name: 'Natalicio de Benito Juárez' },
    { date: iso(year, 5, 1), name: 'Día del Trabajo' },
    { date: iso(year, 9, 16), name: 'Día de la Independencia' },
    { date: nthMonday(year, 11, 3), name: 'Día de la Revolución' },
    { date: iso(year, 12, 25), name: 'Navidad' },
  ];
  // Transmisión del Poder Ejecutivo Federal: 1 de octubre cada seis años (2024, 2030, ...).
  if (year >= 2024 && (year - 2024) % 6 === 0) {
    holidays.push({ date: iso(year, 10, 1), name: 'Transmisión del Poder Ejecutivo Federal' });
  }
  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

/** Diferencia en minutos entre la hora local de una zona y UTC en un instante dado. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((local - instant.getTime()) / 60_000);
}

/**
 * Instante UTC de una fecha y hora locales (AAAA-MM-DD, HH:MM) en la zona de la planta,
 * respetando el horario de verano.
 */
export function zonedDateTime(date: string, time: string, timeZone: string): Date {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day, hours, minutes);
  // Dos pasadas: el desfase puede cambiar justo en el día del cambio de horario.
  let instant = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  instant = guess - offsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant);
}

/** Suma días a una fecha AAAA-MM-DD. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
