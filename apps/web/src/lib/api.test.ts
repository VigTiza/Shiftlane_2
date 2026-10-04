import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError, setAccessToken, setSessionExpiredHandler } from './api';

function respond(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  setAccessToken(null);
  setSessionExpiredHandler(null);
});

describe('cliente de la API', () => {
  it('con el token vencido renueva con la cookie y repite la petición', async () => {
    setAccessToken('viejo');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }))
      .mockResolvedValueOnce(respond(200, { accessToken: 'nuevo', expiresIn: 900 }))
      .mockResolvedValueOnce(respond(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await api('/vehicles')).toEqual({ ok: true });
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls[0]![1].headers).toMatchObject({ authorization: 'Bearer viejo' });
    expect(calls[1]![0]).toBe('/api/auth/refresh');
    expect(calls[1]![1].credentials).toBe('include');
    expect(calls[2]![1].headers).toMatchObject({ authorization: 'Bearer nuevo' });
  });

  it('si la sesión ya no se puede renovar, avisa para volver a entrar', async () => {
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respond(401, { error: { code: 'UNAUTHORIZED', message: 'Inicia sesión.' } }),
        ),
    );
    await expect(api('/vehicles')).rejects.toMatchObject({
      status: 401,
      message: 'Inicia sesión.',
    });
    expect(expired).toHaveBeenCalledOnce();
  });

  it('traduce los errores: mensaje de la API, de red y del servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          respond(409, { error: { code: 'CONFLICT', message: 'El chofer ya tiene un viaje.' } }),
        )
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(respond(500)),
    );
    await expect(api('/trips', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'El chofer ya tiene un viaje.',
    });
    const network = await api('/trips').catch((error: unknown) => error);
    expect(network).toBeInstanceOf(ApiError);
    expect((network as ApiError).message).toBe(
      'No hay conexión con el servidor. Revisa tu internet.',
    );
    await expect(api('/trips')).rejects.toMatchObject({
      message: 'El servidor tuvo un problema; intenta de nuevo en un momento.',
    });
  });
});
