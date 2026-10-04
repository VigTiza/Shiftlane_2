import type { ReactNode } from 'react';

/** Pantallas de acceso: el formulario a la izquierda y la marca a la derecha. */
export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="#0b2545" />
              <path d="M9 22 L14 10" stroke="#ffb703" strokeWidth="3" strokeLinecap="round" />
              <path
                d="M18 22 L23 10"
                stroke="#ffb703"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="3 3.2"
              />
            </svg>
            <span className="text-lg font-semibold tracking-tight">Shiftlane</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1.5 text-muted-foreground">{description}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
      <aside
        className="relative hidden overflow-hidden bg-sidebar lg:flex lg:flex-col lg:justify-end"
        aria-hidden="true"
      >
        {/* Carriles de carretera: la línea punteada ámbar es la marca. */}
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 600 800"
          preserveAspectRatio="xMidYMid slice"
        >
          <path
            d="M120 820 C 260 560, 300 360, 520 -20"
            stroke="#13315c"
            strokeWidth="90"
            fill="none"
          />
          <path
            d="M120 820 C 260 560, 300 360, 520 -20"
            stroke="#ffb703"
            strokeWidth="5"
            strokeDasharray="26 22"
            fill="none"
          />
          <path
            d="M-40 640 C 160 520, 360 520, 660 300"
            stroke="#102a4e"
            strokeWidth="60"
            fill="none"
          />
        </svg>
        <div className="relative max-w-md p-12 text-white">
          <p className="text-3xl leading-tight font-semibold tracking-tight">
            Cada turno a tiempo, cada pasajero contado.
          </p>
          <p className="mt-3 text-sidebar-muted">
            Rutas, viajes, unidades y cobro de tu transporte de personal en un solo lugar.
          </p>
        </div>
      </aside>
    </div>
  );
}

/** Mensaje de error del formulario (lo que respondió la API). */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      {message}
    </p>
  );
}
