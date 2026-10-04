// Campos de formulario listos (etiqueta + control + ayuda + error) para no repetir el patrón
// de React Hook Form en cada pantalla.
import type { ComponentProps, ReactNode } from 'react';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './controls';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from './form';
import { Input, Textarea } from './input';

interface BaseProps<T extends FieldValues, R> {
  control: Control<T, unknown, R>;
  name: FieldPath<T>;
  label: string;
  description?: ReactNode;
  className?: string;
}

export function TextField<T extends FieldValues, R = T>({
  control,
  name,
  label,
  description,
  className,
  ...input
}: BaseProps<T, R> & Omit<ComponentProps<typeof Input>, 'name' | 'defaultValue'>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...input} {...field} value={field.value ?? ''} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function TextAreaField<T extends FieldValues, R = T>({
  control,
  name,
  label,
  description,
  className,
  ...input
}: BaseProps<T, R> & Omit<ComponentProps<typeof Textarea>, 'name' | 'defaultValue'>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Textarea {...input} {...field} value={field.value ?? ''} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SelectField<T extends FieldValues, R = T>({
  control,
  name,
  label,
  description,
  className,
  options,
  placeholder = 'Elige una opción',
}: BaseProps<T, R> & {
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <Select value={field.value ?? ''} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
