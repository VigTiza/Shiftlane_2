import { Prisma } from '../generated/prisma/client.ts';

/** ¿Es una violación de índice único? Si se indica columna, que sea sobre esa columna. */
export function isUniqueViolation(error: unknown, column?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return false;
  if (!column) return true;
  const details = JSON.stringify(error.meta ?? {}) + error.message;
  return details.includes(column);
}
