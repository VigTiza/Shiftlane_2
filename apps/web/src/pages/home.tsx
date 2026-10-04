import { ArrowRightIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { PageHeader } from '@/components/states';
import { useAuth } from '@/lib/auth';
import { navigationFor } from '@/navigation';

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
