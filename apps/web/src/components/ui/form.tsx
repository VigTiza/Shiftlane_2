// Formularios con React Hook Form + Zod: etiqueta, control, ayuda y error enlazados con aria
// para lectores de pantalla. Los mensajes vienen de los esquemas (en español).
import { Slot } from 'radix-ui';
import { createContext, useContext, useId } from 'react';
import type { ComponentProps } from 'react';
import { Controller, FormProvider, useFormContext, useFormState } from 'react-hook-form';
import type { ControllerProps, FieldPath, FieldValues } from 'react-hook-form';

import { cn } from '@/lib/utils';

import { Label } from './primitives';

export const Form = FormProvider;

const FieldContext = createContext<{ name: string } | null>(null);
const ItemContext = createContext<{ id: string } | null>(null);

export function FormField<
  TValues extends FieldValues = FieldValues,
  TName extends FieldPath<TValues> = FieldPath<TValues>,
  TTransformed = TValues,
>(props: ControllerProps<TValues, TName, TTransformed>) {
  return (
    <FieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FieldContext.Provider>
  );
}

function useField() {
  const field = useContext(FieldContext);
  const item = useContext(ItemContext);
  const { getFieldState } = useFormContext();
  if (!field || !item) throw new Error('useField debe usarse dentro de <FormField> y <FormItem>');
  const state = useFormState({ name: field.name });
  const fieldState = getFieldState(field.name, state);
  return {
    name: field.name,
    id: item.id,
    controlId: `${item.id}-control`,
    descriptionId: `${item.id}-description`,
    messageId: `${item.id}-message`,
    error: fieldState.error,
  };
}

export function FormItem({ className, ...props }: ComponentProps<'div'>) {
  const id = useId();
  return (
    <ItemContext.Provider value={{ id }}>
      <div className={cn('grid gap-1.5', className)} {...props} />
    </ItemContext.Provider>
  );
}

export function FormLabel({ className, ...props }: ComponentProps<typeof Label>) {
  const { controlId, error } = useField();
  return (
    <Label
      htmlFor={controlId}
      data-error={!!error}
      className={cn('data-[error=true]:text-danger', className)}
      {...props}
    />
  );
}

export function FormControl(props: ComponentProps<typeof Slot.Root>) {
  const { controlId, descriptionId, messageId, error } = useField();
  return (
    <Slot.Root
      id={controlId}
      aria-describedby={error ? `${descriptionId} ${messageId}` : descriptionId}
      aria-invalid={!!error}
      {...props}
    />
  );
}

export function FormDescription({ className, ...props }: ComponentProps<'p'>) {
  const { descriptionId } = useField();
  return (
    <p id={descriptionId} className={cn('text-xs text-muted-foreground', className)} {...props} />
  );
}

export function FormMessage({ className, children, ...props }: ComponentProps<'p'>) {
  const { messageId, error } = useField();
  const body = error?.message ?? children;
  if (!body) return null;
  return (
    <p
      id={messageId}
      role="alert"
      className={cn('text-xs font-medium text-danger', className)}
      {...props}
    >
      {body}
    </p>
  );
}
