import {
  DesktopIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  SignOutIcon,
  SunIcon,
  UserSwitchIcon,
} from '@phosphor-icons/react';
import { isRoleKey, ROLES } from '@shiftlane/shared';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/controls';
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SheetContent,
} from '@/components/ui/overlays';
import { Avatar } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth';
import type { ThemePreference } from '@/lib/theme';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { designSystemItem, navigationFor, scopeLabels } from '@/navigation';
import type { NavGroup } from '@/navigation';

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#13315c" />
        <path d="M9 22 L14 10" stroke="#ffb703" strokeWidth="3" strokeLinecap="round" />
        <path
          d="M18 22 L23 10"
          stroke="#ffb703"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="3 3.2"
        />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight text-white">Shiftlane</span>
    </div>
  );
}

function Sidebar({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Brand />
      <nav aria-label="Secciones" className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.map((group) => (
          <div key={group.label} className="mt-4 first:mt-1">
            <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">
              {group.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.path === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-active hover:text-white',
                        isActive &&
                          'bg-sidebar-active font-medium text-white before:absolute before:inset-y-1 before:-left-2 before:w-1 before:rounded-r-sm before:bg-primary',
                      )
                    }
                  >
                    <item.icon className="size-[18px] shrink-0" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border px-2 py-2">
        <NavLink
          to={designSystemItem.path}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-sidebar-muted hover:bg-sidebar-active hover:text-white',
              isActive && 'text-white',
            )
          }
        >
          <designSystemItem.icon className="size-4" />
          {designSystemItem.label}
        </NavLink>
      </div>
    </div>
  );
}

function GlobalSearch({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: NavGroup[];
}) {
  const navigate = useNavigate();
  const { setPreference } = useTheme();
  const { logout } = useAuth();
  const go = (path: string) => {
    onOpenChange(false);
    void navigate(path);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl overflow-hidden p-0"
        hideClose
        aria-describedby={undefined}
      >
        <DialogPrimitive.Title className="sr-only">Búsqueda global</DialogPrimitive.Title>
        <Command>
          <CommandInput placeholder="Buscar secciones y acciones…" />
          <CommandList>
            <CommandEmpty>No hay resultados.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                {group.items.map((item) => (
                  <CommandItem
                    key={item.path}
                    value={`${item.label} ${item.keywords ?? ''}`}
                    onSelect={() => go(item.path)}
                  >
                    <item.icon />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            <CommandGroup heading="Acciones">
              <CommandItem value="tema claro" onSelect={() => setPreference('light')}>
                <SunIcon />
                Usar tema claro
              </CommandItem>
              <CommandItem value="tema oscuro noche" onSelect={() => setPreference('dark')}>
                <MoonIcon />
                Usar tema oscuro
              </CommandItem>
              <CommandItem
                value={`${designSystemItem.label} ${designSystemItem.keywords ?? ''}`}
                onSelect={() => go(designSystemItem.path)}
              >
                <designSystemItem.icon />
                {designSystemItem.label}
              </CommandItem>
              <CommandItem
                value="cerrar sesión salir"
                onSelect={() => {
                  onOpenChange(false);
                  void logout();
                }}
              >
                <SignOutIcon />
                Cerrar sesión
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function AccountMenu() {
  const { user, recentAccounts, logout, switchAccount } = useAuth();
  const { preference, setPreference } = useTheme();
  if (!user) return null;
  const roleNames = user.roles.map((key) => (isRoleKey(key) ? ROLES[key].name : key)).join(', ');
  const others = recentAccounts.filter((account) => account.email !== user.email);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent"
          aria-label="Mi cuenta"
        >
          <Avatar name={user.fullName} />
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-sm leading-tight font-medium">
              {user.fullName}
            </span>
            <span className="block truncate text-xs leading-tight text-muted-foreground">
              {scopeLabels[user.scope]}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-foreground">
          <span className="block text-sm font-semibold">{user.fullName}</span>
          <span className="block font-normal text-muted-foreground">{user.email}</span>
          <span className="mt-1 block font-normal text-muted-foreground">{roleNames}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => setPreference(value as ThemePreference)}
        >
          <DropdownMenuRadioItem value="light">
            <SunIcon /> Claro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon /> Oscuro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <DesktopIcon /> Como el sistema
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Cambiar de cuenta</DropdownMenuLabel>
        {others.map((account) => (
          <DropdownMenuItem key={account.email} onSelect={() => void switchAccount(account.email)}>
            <UserSwitchIcon />
            <span className="min-w-0">
              <span className="block truncate">{account.fullName}</span>
              <span className="block truncate text-xs text-muted-foreground">{account.email}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => void switchAccount()}>
          <UserSwitchIcon />
          Entrar con otra cuenta
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void logout()}>
          <SignOutIcon />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Marco del panel: barra lateral por rol, búsqueda global (Ctrl+K) y menú de cuenta. */
export function AppShell() {
  const { user } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const groups = user ? navigationFor(user.scope, user.permissions) : [];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 lg:block">
        <Sidebar groups={groups} />
      </aside>
      <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent title="Menú" aria-describedby={undefined}>
          <Sidebar groups={groups} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
          >
            <ListIcon className="size-5" />
          </Button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-muted-foreground hover:border-ring/60"
          >
            <MagnifyingGlassIcon className="size-4" />
            <span className="flex-1 text-left">Buscar…</span>
            <kbd className="hidden rounded-sm border border-border px-1.5 font-mono text-[11px] sm:inline">
              Ctrl K
            </kbd>
          </button>
          <div className="ml-auto">
            <AccountMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} groups={groups} />
    </div>
  );
}
