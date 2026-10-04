// Cliente de la API de Shiftlane. El token de acceso vive solo en memoria; la renovación usa
// la cookie httpOnly que pone la API (el navegador la manda sola con credentials: 'include').

const BASE_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

/** Error esperado de la API (mensaje en español listo para mostrar). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: { path?: string; message: string }[];

  constructor(
    status: number,
    code: string,
    message: string,
    details: { path?: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

/** Se llama cuando la sesión ya no se puede renovar (la app regresa al inicio de sesión). */
export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Rutas de acceso: no intentan renovar la sesión ante un 401. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

async function send(path: string, options: RequestOptions, token: string | null) {
  try {
    return await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : null,
      signal: options.signal ?? null,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK', 'No hay conexión con el servidor. Revisa tu internet.');
  }
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (response.ok) return data as T;
  const error = (data as { error?: { code?: string; message?: string; details?: [] } } | null)
    ?.error;
  throw new ApiError(
    response.status,
    error?.code ?? 'UNKNOWN',
    error?.message ??
      (response.status >= 500
        ? 'El servidor tuvo un problema; intenta de nuevo en un momento.'
        : 'No se pudo completar la acción.'),
    error?.details ?? [],
  );
}

/** Renueva el token de acceso con la cookie (una sola renovación aunque fallen varias). */
export function refreshSession(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const response = await send('/auth/refresh', { method: 'POST', anonymous: true }, null);
      if (!response.ok) return null;
      const { accessToken: token } = await parse<{ accessToken: string }>(response);
      accessToken = token;
      return token;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options, options.anonymous ? null : accessToken);
  if (response.status === 401 && !options.anonymous) {
    const token = await refreshSession();
    if (token) {
      response = await send(path, options, token);
    } else {
      accessToken = null;
      onSessionExpired?.();
    }
  }
  return parse<T>(response);
}
