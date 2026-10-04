// Controles con estado: selector, pestañas, código de un solo uso, paleta de comandos y avisos.
import { CaretDownIcon, CheckIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { Command as CommandPrimitive } from 'cmdk';
import { OTPInput, OTPInputContext } from 'input-otp';
import { Select as SelectPrimitive, Tabs as TabsPrimitive } from 'radix-ui';
import { useContext } from 'react';
import type { ComponentProps } from 'react';
import { Toaster as SonnerToaster } from 'sonner';

import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

// --- Selector ----------------------------------------------------------------------------

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40 disabled:opacity-50 data-[placeholder]:text-muted-foreground aria-invalid:border-danger [&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <CaretDownIcon className="size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={4}
        className={cn(
          'z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-[0_8px_24px_rgba(5,12,22,0.12)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none focus:bg-accent data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon weight="bold" className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

// --- Pestañas ------------------------------------------------------------------------------

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex items-center gap-1 border-b border-border', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('pt-4 outline-none', className)} {...props} />;
}

// --- Código de un solo uso (2FA) -----------------------------------------------------------

export function InputOTP({ className, ...props }: ComponentProps<typeof OTPInput>) {
  return (
    <OTPInput
      containerClassName={cn('flex items-center gap-2 has-[:disabled]:opacity-50', className)}
      {...props}
    />
  );
}

export function InputOTPSlot({ index, className }: { index: number; className?: string }) {
  const context = useContext(OTPInputContext);
  const slot = context.slots[index];
  return (
    <div
      data-active={slot?.isActive}
      className={cn(
        'relative flex size-11 items-center justify-center rounded-md border border-input bg-card font-mono text-lg tabular data-[active=true]:border-ring data-[active=true]:outline-2 data-[active=true]:outline-ring/40',
        className,
      )}
    >
      {slot?.char}
      {slot?.hasFakeCaret && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-5 w-px animate-pulse bg-foreground" />
        </span>
      )}
    </div>
  );
}

// --- Paleta de comandos (búsqueda global) --------------------------------------------------

export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn('flex h-full w-full flex-col overflow-hidden bg-popover', className)}
      {...props}
    />
  );
}

export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3">
      <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" />
      <CommandPrimitive.Input
        className={cn(
          'flex h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn('max-h-80 overflow-y-auto overflow-x-hidden p-1', className)}
      {...props}
    />
  );
}

export function CommandEmpty(props: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty className="py-8 text-center text-sm text-muted-foreground" {...props} />
  );
}

export function CommandGroup({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        'overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none select-none data-[selected=true]:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

// --- Avisos (toasts) ------------------------------------------------------------------------

export function Toaster() {
  const { resolved } = useTheme();
  return (
    <SonnerToaster
      theme={resolved}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: 'border border-border bg-popover text-popover-foreground font-sans rounded-md',
          description: 'text-muted-foreground',
        },
      }}
    />
  );
}
