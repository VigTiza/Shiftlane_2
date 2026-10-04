import { ArrowRightIcon, RocketLaunchIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';

import { PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys, useOnboarding } from '@/lib/resources';
import { navigationFor } from '@/navigation';

/** Mientras la cuenta no esté lista: cuánto falta y el botón para seguir. */
function OnboardingCard() {
  const queryClient = useQueryClient();
  const onboarding = useOnboarding();
  const data = onboarding.data;
  if (!data || data.dismissed || data.completed >= data.total) return null;
  const percent = Math.round((data.completed / data.total) * 100);
  return (
    <section className="mb-8 flex flex-wrap items-center gap-5 rounded-lg border border-border bg-card p-5">
      <span className="flex size-11 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <RocketLaunchIcon className="size-6" weight="fill" />
      </span>
      <div className="min-w-56 flex-1">
        <p className="font-semibold">Configura tu cuenta para empezar a operar</p>
        <p className="text-sm text-muted-foreground">
          {data.completed} de {data.total} pasos listos
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          onClick={() =>
            void api('/onboarding/dismissed', { method: 'PUT', body: { dismissed: true } }).then(
              () => queryClient.invalidateQueries({ queryKey: keys.onboarding }),
            )
          }
        >
          Ocultar
        </Button>
        <Button asChild>
          <Link to="/configuracion-inicial">Continuar</Link>
        </Button>
      </div>
    </section>
  );
}

function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

/** Inicio: por ahora, acceso directo a cada sección (el tablero del turno llega en F08-P07). */
export function HomePage() {
  const { user } = useAuth();
  if (!user) return null;
  const groups = navigationFor(user.scope, user.permissions);
  const firstName = user.fullName.split(' ')[0];
  return (
    <>
      {user.permissions.includes('settings.manage') && <OnboardingCard />}
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description="Elige una sección para empezar. El resumen del turno con alertas e indicadores aparecerá aquí."
      />
      <div className="grid gap-8">
        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="pb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              {group.label}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.items
                .filter((item) => item.path !== '/')
                .map((item) => (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:border-ring/70"
                    >
                      <span className="flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                        <item.icon className="size-5" />
                      </span>
                      <span className="flex-1 font-medium">{item.label}</span>
                      <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
