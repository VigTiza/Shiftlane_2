const mxnFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
});

/** Formatea un importe en pesos mexicanos, por ejemplo 2000 → "$2,000.00". */
export function formatMxn(amount: number): string {
  return mxnFormatter.format(amount);
}
