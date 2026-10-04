import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';

import { Providers, routes } from '@/app';

type Handler = (body: unknown, url: URL) => { status?: number; body?: unknown } | undefined;

/**
 * API simulada: responde por «MÉTODO /ruta». Lo que no está definido responde 404 con el
 * formato de error de la API. `calls` guarda lo que pidió la app.
 */
export function fakeApi(handlers: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    const path = url.pathname.replace(/^\/api/, '');
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : init?.body instanceof FormData
          ? init.body
          : undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method, path, body, auth: headers.authorization ?? null });
    const handler = handlers[`${method} ${path}`];
    const result = handler?.(body, url) ?? {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'No se encontró.' } },
    };
    return Promise.resolve(
      new Response(result.body === undefined ? null : JSON.stringify(result.body), {
        status: result.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export const owner = {
  kind: 'user',
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'Ana Torres',
  email: 'ana@transportes.mx',
  tenantId: '22222222-2222-4222-8222-222222222222',
  clientOrgId: null,
  roles: ['owner'],
  twoFactorEnabled: false,
};

export const dispatcher = {
  ...owner,
  id: '33333333-3333-4333-8333-333333333333',
  fullName: 'Luis Méndez',
  email: 'luis@transportes.mx',
  roles: ['dispatcher'],
};

/** Sesión iniciada como dueño (con permisos de la API). */
export function signedInHandlers(me: Record<string, unknown> = owner): Record<string, Handler> {
  return {
    'POST /auth/refresh': () => ({ body: { accessToken: 'token-de-acceso', expiresIn: 900 } }),
    'GET /auth/me': () => ({ body: me }),
    'POST /auth/logout': () => ({ status: 204 }),
  };
}

export function page<T>(items: T[]) {
  return { items, total: items.length, page: 1, pageSize: 100 };
}

export const unauthorized = {
  status: 401,
  body: { error: { code: 'UNAUTHORIZED', message: 'Inicia sesión.' } },
};

export function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...view, router };
}
