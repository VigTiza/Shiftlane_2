// Corrección de la hora del celular: su reloj puede estar adelantado o atrasado.

/** Diferencias menores se deben a la latencia de la red, no al reloj del celular. */
export const CLOCK_NOISE_MS = 2_000;

/** Hora del servidor menos hora del celular al enviar (0 si es solo latencia). */
export function clockOffsetMs(sentAt: Date, receivedAt: Date): number {
  const offset = receivedAt.getTime() - sentAt.getTime();
  return Math.abs(offset) < CLOCK_NOISE_MS ? 0 : offset;
}

/** Hora corregida de algo que ocurrió en el celular; nunca después de llegar al servidor. */
export function correctedTime(at: Date, offsetMs: number, receivedAt: Date): Date {
  const corrected = new Date(at.getTime() + offsetMs);
  return corrected > receivedAt ? receivedAt : corrected;
}
