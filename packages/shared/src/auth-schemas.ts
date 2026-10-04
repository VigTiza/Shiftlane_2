// Reglas de acceso compartidas por la API y los formularios web (mismos mensajes en español).
import { z } from 'zod';

export const emailSchema = z.email({ message: 'Escribe un correo válido.' }).max(254);

export const passwordSchema = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres.')
  .max(128, 'La contraseña no puede tener más de 128 caracteres.')
  .refine((value) => /\p{L}/u.test(value) && /\d/.test(value), {
    message: 'La contraseña debe combinar letras y números.',
  });

export const totpCodeSchema = z.string().regex(/^\d{6}$/, 'El código debe tener 6 dígitos.');

export const loginFormSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Escribe tu contraseña.').max(128),
});

export const twoFactorFormSchema = z.object({ code: totpCodeSchema });

export const forgotPasswordFormSchema = z.object({ email: emailSchema });

/** En el formulario se pide la contraseña dos veces. */
export const resetPasswordFormSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((data) => data.password === data.confirm, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirm'],
  });

export type LoginForm = z.infer<typeof loginFormSchema>;
export type TwoFactorForm = z.infer<typeof twoFactorFormSchema>;
export type ForgotPasswordForm = z.infer<typeof forgotPasswordFormSchema>;
export type ResetPasswordForm = z.infer<typeof resetPasswordFormSchema>;
