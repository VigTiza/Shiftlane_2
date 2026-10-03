// Acciones que deben ocurrir solo si los cambios se guardaron (avisos en tiempo real, por
// ejemplo). Cada transacción junta las suyas: si se confirma, pasan a la petición (o a quien
// la envuelva); si falla, se descartan. La petición las ejecuta al responder sin error.
import { AsyncLocalStorage } from 'node:async_hooks';

type Action = () => void;

const scope = new AsyncLocalStorage<Action[]>();

/**
 * Programa una acción para cuando se confirmen los cambios del ámbito actual. Fuera de
 * cualquier ámbito (por ejemplo, un script) se ejecuta de inmediato.
 */
export function afterCommit(action: Action): void {
  const queue = scope.getStore();
  if (queue) queue.push(action);
  else run([action]);
}

function run(actions: readonly Action[]) {
  for (const action of actions) {
    try {
      action();
    } catch {
      // Un aviso que falla nunca afecta la operación.
    }
  }
}

/**
 * Ejecuta `fn` en un ámbito propio. Si termina bien, sus acciones pasan al ámbito que lo
 * contiene (o se ejecutan si no hay); si lanza un error, se descartan.
 */
export async function withAfterCommit<T>(fn: () => Promise<T>): Promise<T> {
  const queue: Action[] = [];
  const result = await scope.run(queue, fn);
  const parent = scope.getStore();
  if (parent) parent.push(...queue);
  else run(queue);
  return result;
}

/** Ámbito de una petición: sus acciones se ejecutan solo si la respuesta no es un error. */
export function runInRequestScope(queue: Action[], next: () => void): void {
  scope.run(queue, next);
}

export function flushRequestScope(queue: Action[], succeeded: boolean) {
  if (succeeded) run(queue.splice(0));
  else queue.length = 0;
}
