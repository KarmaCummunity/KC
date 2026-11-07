// FR-ADMIN-011 — keeps the app TopBar on every admin route (chat, notifications,
// settings, admin shortcut) while inner screens set the title and filter affordances.
// Stack-based shell routes (settings, worlds) use `useShellTopBarChrome` instead.
import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface AdminPortalChromeState {
  readonly title?: ReactNode;
  /** Filter / sort entry in the TopBar row (before notifications), like the Home Feed. */
  readonly headerRight?: ReactNode;
  /** Optional search row pinned directly under the TopBar (filter button stays in the bar). */
  readonly filterStrip?: ReactNode;
}

type ChromeKey = keyof AdminPortalChromeState;

interface AdminPortalChromeContextValue {
  readonly chrome: AdminPortalChromeState;
  readonly setChrome: (patch: AdminPortalChromeState) => void;
  readonly clearChromeKeys: (keys: readonly ChromeKey[]) => void;
}

const AdminPortalChromeContext = createContext<AdminPortalChromeContextValue | null>(null);

export function AdminPortalChromeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [chrome, setChromeState] = useState<AdminPortalChromeState>({});
  const setChrome = useCallback((patch: AdminPortalChromeState) => {
    setChromeState((prev) => ({ ...prev, ...patch }));
  }, []);
  const clearChromeKeys = useCallback((keys: readonly ChromeKey[]) => {
    setChromeState((prev) => {
      const next = { ...prev };
      for (const key of keys) {
        delete next[key];
      }
      return next;
    });
  }, []);
  const value = useMemo(
    () => ({ chrome, setChrome, clearChromeKeys }),
    [chrome, setChrome, clearChromeKeys],
  );
  return (
    <AdminPortalChromeContext.Provider value={value}>{children}</AdminPortalChromeContext.Provider>
  );
}

export function useAdminPortalChromeProvider(): AdminPortalChromeContextValue {
  const ctx = useContext(AdminPortalChromeContext);
  if (!ctx) throw new Error('useAdminPortalChromeProvider must run inside AdminPortalChromeProvider');
  return ctx;
}

const patchKeys = (patch: AdminPortalChromeState): ChromeKey[] =>
  (Object.keys(patch) as ChromeKey[]).filter((key) => patch[key] !== undefined);

/** Registers portal chrome for the shared TopBar; only clears the keys this call set on unmount. */
export function useAdminPortalChrome(patch: AdminPortalChromeState): void {
  const { setChrome, clearChromeKeys } = useAdminPortalChromeProvider();
  const { title, headerRight, filterStrip } = patch;
  React.useEffect(() => {
    const keys = patchKeys({ title, headerRight, filterStrip });
    setChrome({ title, headerRight, filterStrip });
    return () => clearChromeKeys(keys);
  }, [title, headerRight, filterStrip, setChrome, clearChromeKeys]);
}

export function useAdminPortalChromeState(): AdminPortalChromeState {
  return useAdminPortalChromeProvider().chrome;
}
