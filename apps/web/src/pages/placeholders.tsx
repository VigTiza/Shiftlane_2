import { CompassIcon, HammerIcon } from '@phosphor-icons/react';
import { Link, useLocation } from 'react-router';

import { EmptyState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { navigationFor } from '@/navigation';

/** Sección del menú que todavía no tiene pantalla. */
export function ComingSoonPage() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const item = user
    ? navigationFor(user.scope, user.permissions)
        .flatMap((group) => group.items)
        .find((candidate) => candidate.path === pathname)
    : undefined;
  return (
    <>
      <PageHeader title={item?.label ?? 'Sección'} />
      <EmptyState
        icon={HammerIcon}
        title="Esta pantalla está en construcción"
        description="La API ya está lista; la pantalla se arma en los siguientes pasos del panel web."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/">Ir al inicio</Link>
          </Button>
        }
      />
    </>
  );
}

export function NotFoundPage() {
  return (
    <EmptyState
      className="mt-12"
      icon={CompassIcon}
      title="No encontramos esta página"
      description="Revisa la dirección o vuelve al inicio."
      action={
        <Button asChild size="sm">
          <Link to="/">Ir al inicio</Link>
        </Button>
      }
    />
  );
}
