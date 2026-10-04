import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeftIcon, EyeIcon, EyeSlashIcon } from '@phosphor-icons/react';
import { loginFormSchema, twoFactorFormSchema } from '@shiftlane/shared';
import type { LoginForm, TwoFactorForm } from '@shiftlane/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPSlot } from '@/components/ui/controls';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

import { AuthLayout, FormError } from './auth-layout';

function messageOf(error: unknown) {
  return error instanceof ApiError ? error.message : 'Algo salió mal; intenta de nuevo.';
}

function TwoFactorStep({
  challengeToken,
  onBack,
  onDone,
}: {
  challengeToken: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const { verifyTwoFactor } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<TwoFactorForm>({
    resolver: zodResolver(twoFactorFormSchema),
    defaultValues: { code: '' },
  });

  const submit = form.handleSubmit(async ({ code }) => {
    setError(null);
    try {
      await verifyTwoFactor(challengeToken, code);
      onDone();
    } catch (failure) {
      setError(messageOf(failure));
      form.setValue('code', '');
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={(event) => void submit(event)} className="grid gap-5" noValidate>
        <FormError message={error} />
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Código de 6 dígitos</FormLabel>
              <FormControl>
                <InputOTP
                  maxLength={6}
                  inputMode="numeric"
                  autoFocus
                  value={field.value}
                  onChange={field.onChange}
                  onComplete={() => void submit()}
                >
                  {Array.from({ length: 6 }, (_, index) => (
                    <InputOTPSlot key={index} index={index} />
                  ))}
                </InputOTP>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Verificando…' : 'Verificar'}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeftIcon className="size-4" />
          Usar otra cuenta
        </Button>
      </form>
    </Form>
  );
}

export function LoginPage() {
  const { status, login, recentAccounts, suggestedEmail } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('siguiente') ?? '/';
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: params.get('correo') ?? suggestedEmail ?? '', password: '' },
  });

  if (status === 'authenticated') return <Navigate to={next} replace />;

  const finish = () => void navigate(next, { replace: true });

  const submit = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      const outcome = await login(email.trim(), password);
      if (outcome.status === 'two_factor') setChallenge(outcome.challengeToken);
      else finish();
    } catch (failure) {
      setError(messageOf(failure));
    }
  });

  if (challenge) {
    return (
      <AuthLayout
        title="Verificación en dos pasos"
        description="Escribe el código que muestra tu app de autenticación."
      >
        <TwoFactorStep
          challengeToken={challenge}
          onBack={() => setChallenge(null)}
          onDone={finish}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Entrar al panel" description="Usa el correo con el que te invitaron.">
      <Form {...form}>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
          <FormError message={error} />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Correo</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="username" autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel>Contraseña</FormLabel>
                  <Link
                    to="/recuperar-contrasena"
                    className="text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    ¿La olvidaste?
                  </Link>
                </div>
                <div className="relative">
                  <FormControl>
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      className="pr-10"
                      {...field}
                    />
                  </FormControl>
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showPassword ? (
                      <EyeSlashIcon className="size-4" />
                    ) : (
                      <EyeIcon className="size-4" />
                    )}
                  </button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" size="lg" className="mt-2" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </Form>

      {recentAccounts.length > 0 && (
        <div className="mt-8">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Cuentas recientes
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {recentAccounts.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  onClick={() => {
                    form.setValue('email', account.email);
                    form.setFocus('password');
                  }}
                  className="w-full rounded-md border border-border px-3 py-2 text-left hover:bg-accent"
                >
                  <span className="block text-sm font-medium">{account.fullName}</span>
                  <span className="block text-xs text-muted-foreground">{account.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AuthLayout>
  );
}
