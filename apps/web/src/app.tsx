import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import type { RouteObject } from 'react-router';

import { Toaster } from '@/components/ui/controls';
import { TooltipProvider } from '@/components/ui/overlays';
import { AppShell } from '@/layout/app-shell';
import { ApiError } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ThemeProvider } from '@/lib/theme';
import { navigationFor } from '@/navigation';
import { LoginPage } from '@/pages/auth/login';
import { ForgotPasswordPage, ResetPasswordPage } from '@/pages/auth/password';
import { ClientDetailPage } from '@/pages/catalogs/client-detail';
import { ClientsPage } from '@/pages/catalogs/clients';
import { ContractDetailPage } from '@/pages/catalogs/contract-detail';
import { ContractsPage } from '@/pages/catalogs/contracts';
import { DriversPage } from '@/pages/catalogs/drivers';
import { PassengersPage } from '@/pages/catalogs/passengers';
import { VehiclesPage } from '@/pages/catalogs/vehicles';
import { DesignSystemPage } from '@/pages/design-system';
import { HomePage } from '@/pages/home';
import { OnboardingPage } from '@/pages/onboarding';
import { ComingSoonPage, NotFoundPage } from '@/pages/placeholders';

/** Pantalla mientras se revisa si la sesión sigue vigente. */
function Splash() {
  return (
    <div className="flex min-h-svh items-center justify-center" aria-busy="true">
      <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 animate-[pulse_1s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>
      <span className="sr-only">Cargando</span>
    </div>
  );
}

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'anonymous') {
    const next = location.pathname + location.search;
    return (
      <Navigate
        to={next === '/' ? '/entrar' : `/entrar?siguiente=${encodeURIComponent(next)}`}
        replace
      />
    );
  }
  return <Outlet />;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <Splash />;
  return children;
}

/** Inicio según el ámbito: si no tiene el tablero, la primera sección que sí puede ver. */
function Home() {
  const { user } = useAuth();
  if (!user) return null;
  const sections = navigationFor(user.scope, user.permissions).flatMap((group) => group.items);
  const home = sections.find((item) => item.path === '/');
  if (home) return user.scope === 'carrier' ? <HomePage /> : <ComingSoonPage />;
  const first = sections[0];
  return first ? <Navigate to={first.path} replace /> : <HomePage />;
}

export const routes: RouteObject[] = [
  {
    path: '/entrar',
    element: (
      <PublicOnly>
        <LoginPage />
      </PublicOnly>
    ),
  },
  { path: '/recuperar-contrasena', element: <ForgotPasswordPage /> },
  { path: '/restablecer-contrasena', element: <ResetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Home /> },
          { path: 'sistema-de-diseno', element: <DesignSystemPage /> },
          { path: 'unidades', element: <VehiclesPage /> },
          { path: 'choferes', element: <DriversPage /> },
          { path: 'clientes', element: <ClientsPage /> },
          { path: 'clientes/:id', element: <ClientDetailPage /> },
          { path: 'contratos', element: <ContractsPage /> },
          { path: 'contratos/:id', element: <ContractDetailPage /> },
          { path: 'pasajeros', element: <PassengersPage /> },
          { path: 'configuracion-inicial', element: <OnboardingPage /> },
          ...[
            'monitoreo',
            'alertas',
            'programacion',
            'solicitudes',
            'rutas',
            'celulares',
            'cumplimiento',
            'mantenimiento',
            'facturacion',
            'reportes',
            'configuracion',
            'evidencia',
            'empleados',
            'prefacturas',
            'cobro',
            'soporte',
            'salud',
          ].map((path) => ({ path, element: <ComingSoonPage /> })),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Los errores esperados (4xx) no se reintentan; los de red sí, dos veces.
        retry: (count, error) =>
          count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
    },
  });
}

/** Proveedores comunes (también los usan las pruebas con un enrutador en memoria). */
export function Providers({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider delayDuration={300}>
            {children}
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export function App() {
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  );
}
