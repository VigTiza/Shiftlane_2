import { effectivePermissions } from '@shiftlane/shared';
import type { Permission, Scope } from '@shiftlane/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { api, ApiError, refreshSession, setAccessToken, setSessionExpiredHandler } from './api';

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  tenantId: string | null;
  clientOrgId: string | null;
  roles: string[];
  twoFactorEnabled: boolean;
  scope: Scope;
  permissions: Permission[];
}

type MeResponse =
  | {
      kind: 'user';
      id: string;
      fullName: string;
      email: string;
      tenantId: string | null;
      clientOrgId: string | null;
      roles: string[];
      twoFactorEnabled: boolean;
    }
  | { kind: 'driver' | 'passenger' };

type TokenResponse = { accessToken: string; expiresIn: number };
type LoginResponse = TokenResponse | { twoFactorRequired: true; challengeToken: string };

export type LoginOutcome = { status: 'ok' } | { status: 'two_factor'; challengeToken: string };

/** Cuenta que ya entró en este navegador (para cambiar de cuenta rápido). */
export interface RecentAccount {
  email: string;
  fullName: string;
}

interface AuthValue {
  status: 'loading' | 'anonymous' | 'authenticated';
  user: SessionUser | null;
  recentAccounts: RecentAccount[];
  login: (email: string, password: string) => Promise<LoginOutcome>;
  verifyTwoFactor: (challengeToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Cierra la sesión y deja listo el acceso con otra cuenta (correo sugerido). */
  switchAccount: (email?: string) => Promise<void>;
  /** Correo que el acceso propone después de cambiar de cuenta. */
  suggestedEmail: string | null;
  can: (...permissions: Permission[]) => boolean;
  forgetAccount: (email: string) => void;
}

const AuthContext = createContext<AuthValue | null>(null);
const RECENT_KEY = 'shiftlane.recent-accounts';

function readRecent(): RecentAccount[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as RecentAccount[]) : [];
  } catch {
    return [];
  }
}

function writeRecent(accounts: RecentAccount[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(accounts.slice(0, 5)));
  } catch {
    // Sin almacenamiento (modo privado): solo no se recuerdan las cuentas.
  }
}

function scopeOf(me: { tenantId: string | null; clientOrgId: string | null }): Scope {
  if (me.tenantId) return 'carrier';
  if (me.clientOrgId) return 'plant';
  return 'platform';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthValue['status']>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [recentAccounts, setRecentAccounts] = useState<RecentAccount[]>(readRecent);
  const [suggestedEmail, setSuggestedEmail] = useState<string | null>(null);

  const signOutLocally = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const loadMe = useCallback(async () => {
    const me = await api<MeResponse>('/auth/me');
    if (me.kind !== 'user') {
      await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
      signOutLocally();
      throw new ApiError(
        403,
        'WRONG_APP',
        'Esta cuenta es de la app del chofer o del pasajero; el panel es para el personal.',
      );
    }
    const scope = scopeOf(me);
    const session: SessionUser = {
      id: me.id,
      fullName: me.fullName,
      email: me.email,
      tenantId: me.tenantId,
      clientOrgId: me.clientOrgId,
      roles: me.roles,
      twoFactorEnabled: me.twoFactorEnabled,
      scope,
      permissions: effectivePermissions(scope, me.roles),
    };
    setUser(session);
    setStatus('authenticated');
    setRecentAccounts((current) => {
      const next = [
        { email: session.email, fullName: session.fullName },
        ...current.filter((a) => a.email !== session.email),
      ];
      writeRecent(next);
      return next;
    });
  }, [signOutLocally]);

  useEffect(() => {
    setSessionExpiredHandler(signOutLocally);
    // Al abrir: si la cookie de sesión sigue vigente, se entra sin pedir contraseña.
    void (async () => {
      const token = await refreshSession();
      if (!token) return signOutLocally();
      try {
        await loadMe();
      } catch {
        signOutLocally();
      }
    })();
    return () => setSessionExpiredHandler(null);
  }, [loadMe, signOutLocally]);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      const result = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { email, password },
        anonymous: true,
      });
      if ('twoFactorRequired' in result) {
        return { status: 'two_factor', challengeToken: result.challengeToken };
      }
      setAccessToken(result.accessToken);
      await loadMe();
      return { status: 'ok' };
    },
    [loadMe],
  );

  const verifyTwoFactor = useCallback(
    async (challengeToken: string, code: string) => {
      const result = await api<TokenResponse>('/auth/login/2fa', {
        method: 'POST',
        body: { challengeToken, code },
        anonymous: true,
      });
      setAccessToken(result.accessToken);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    signOutLocally();
  }, [signOutLocally]);

  const switchAccount = useCallback(
    async (email?: string) => {
      setSuggestedEmail(email ?? null);
      await logout();
    },
    [logout],
  );

  const forgetAccount = useCallback((email: string) => {
    setRecentAccounts((current) => {
      const next = current.filter((a) => a.email !== email);
      writeRecent(next);
      return next;
    });
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      recentAccounts,
      login,
      verifyTwoFactor,
      logout,
      switchAccount,
      suggestedEmail,
      forgetAccount,
      can: (...permissions) =>
        !!user && permissions.some((permission) => user.permissions.includes(permission)),
    }),
    [
      status,
      user,
      recentAccounts,
      login,
      verifyTwoFactor,
      logout,
      switchAccount,
      suggestedEmail,
      forgetAccount,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return value;
}
