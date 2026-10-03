import { todayIn } from '@shiftlane/shared';
import type { FastifyBaseLogger } from 'fastify';

const CHECK_EVERY_MS = 15 * 60_000;
const STARTUP_DELAY_MS = 5_000;

export interface DailyTask {
  name: string;
  description: string;
  run: () => Promise<Record<string, unknown>>;
}

/**
 * Tareas diarias dentro de la API: corren al arrancar y después una vez al día a partir de la
 * hora configurada (hora local). Deben ser idempotentes: repetirlas no cambia el resultado.
 * Un error en una tarea no impide que corran las demás.
 */
export function createDailyScheduler(options: {
  log: FastifyBaseLogger;
  timeZone: string;
  hour: number;
  tasks: DailyTask[];
}) {
  let timer: NodeJS.Timeout | undefined;
  let lastRunDate: string | null = null;
  let running: Promise<void> | null = null;

  function localHour() {
    return Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: options.timeZone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()),
    );
  }

  async function run() {
    lastRunDate = todayIn(options.timeZone);
    for (const task of options.tasks) {
      const started = Date.now();
      try {
        const result = await task.run();
        options.log.info({ job: task.name, ms: Date.now() - started, ...result }, task.description);
      } catch (error) {
        options.log.error({ err: error, job: task.name }, 'Falló una tarea diaria');
      }
    }
  }

  function tick(force = false) {
    if (running) return;
    const due = force || (todayIn(options.timeZone) !== lastRunDate && localHour() >= options.hour);
    if (!due) return;
    running = run().finally(() => {
      running = null;
    });
  }

  return {
    start() {
      timer = setTimeout(() => {
        tick(true);
        timer = setInterval(() => tick(), CHECK_EVERY_MS);
        timer.unref();
      }, STARTUP_DELAY_MS);
      timer.unref();
    },
    async stop() {
      clearTimeout(timer);
      clearInterval(timer);
      await running;
    },
  };
}
