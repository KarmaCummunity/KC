// Bridges the persisted theme preference (themeStore) and the OS color scheme
// into @kc/ui's ThemeProvider. Sits high in the tree so every consumer of
// useTheme()/makeUseStyles() resolves against the same context.
import React from 'react';
import { useColorScheme } from 'react-native';
import { ThemeProvider, type ResolvedScheme, type ThemeMode } from '@kc/ui';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';

export function AppThemeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const storedMode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  // `useColorScheme()` returns null briefly during cold start on some
  // platforms — default to light so first paint matches the legacy default.
  const osScheme = useColorScheme();
  const systemScheme: ResolvedScheme = osScheme === 'dark' ? 'dark' : 'light';

  // Signed-out surfaces (welcome, sign-in) always render light. The user's
  // persisted choice (FR-SETTINGS-014 AC3) is kept in storage and applies again
  // after sign-in — avoids a dark welcome when the device/OS prefers dark mode.
  const mode: ThemeMode =
    !isLoading && !isAuthenticated ? 'light' : storedMode;

  return (
    <ThemeProvider mode={mode} systemScheme={systemScheme} setMode={setMode}>
      {children}
    </ThemeProvider>
  );
}
