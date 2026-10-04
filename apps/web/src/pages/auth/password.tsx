import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircleIcon } from '@phosphor-icons/react';
import { forgotPasswordFormSchema, resetPasswordFormSchema } from '@shiftlane/shared';
import type { ForgotPasswordForm, ResetPasswordForm } from '@shiftlane/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';

import { AuthLayout, FormError } from './auth-layout';

function Done({ message }: { message: string }) {
  return (
    <div className="grid gap-5">
      <p className="flex gap-2 rounded-md border border-success/40 bg-success-soft px-3 py-3 text-sm">
        <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-success" weight="fill" />
        {message}
      </p>
      <Button asChild variant="outline">
        <Link to="/entrar">Volver a entrar</Link>
      </Button>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordFormSchema),
    defaultValues: { email: '' },
  });

  const submit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      const result = await api<{ message: string }>('/auth/password/forgot', {
        method: 'POST',
        body: { email: email.trim() },
        anonymous: true,
      });
      setSent(result.message);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Algo salió mal; intenta de nuevo.');
    }
  });

  return (
    <AuthLayout
      title="Recuperar contraseña"
      description="Te enviamos un enlace para crear una contraseña nueva."
    >
      {sent ? (
        <Done message={sent} />
      ) : (
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
                    <Input type="email" autoComplete="email" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Enviando…' : 'Enviar enlace'}
            </Button>
            <Button asChild variant="ghost">
              <Link to="/entrar">Volver a entrar</Link>
            </Button>
          </form>
        </Form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : 'El enlace no está completo. Pide uno nuevo.',
  );
  const form = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const submit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await api('/auth/password/reset', {
        method: 'POST',
        body: { token, password },
        anonymous: true,
      });
      setDone(true);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Algo salió mal; intenta de nuevo.');
    }
  });

  return (
    <AuthLayout
      title="Contraseña nueva"
      description="Elige una contraseña que no uses en otro lado."
    >
      {done ? (
        <Done message="Listo: tu contraseña cambió. Ya puedes entrar con ella." />
      ) : (
        <Form {...form}>
          <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
            <FormError message={error} />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contraseña nueva</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" autoFocus {...field} />
                  </FormControl>
                  <FormDescription>Al menos 10 caracteres, con letras y números.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Escríbela otra vez</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" size="lg" disabled={!token || form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Guardando…' : 'Guardar contraseña'}
            </Button>
          </form>
        </Form>
      )}
    </AuthLayout>
  );
}
