// Theme runtime — light/dark palette swap.
//
// `@kc/ui` stays framework-agnostic (no zustand, no AsyncStorage). The mobile
// composition root owns persistence/system detection and feeds the resolved
// mode into <ThemeProvider>. Consumers call `useTheme()` / `useThemedStyles()`.

import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { darkColors, lightColors, type ColorPalette } from './colors';
import { getPlatformTokens, type PlatformTokens } from '../platform/platformTokens';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedScheme = 'light' | 'dark';

export interface ThemeContextValue {
  mode: ThemeMode;                            // user preference
  scheme: ResolvedScheme;                     // mode resolved against OS
  isDark: boolean;
  colors: ColorPalette;
  platform: PlatformTokens;
  setMode: (mode: ThemeMode) => void;
}

const fallbackPalette: ColorPalette = lightColors;

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  scheme: 'light',
  isDark: false,
  colors: fallbackPalette,
  platform: getPlatformTokens(),
  setMode: () => {},
});

export interface ThemeProviderProps {
  mode: ThemeMode;
  systemScheme: ResolvedScheme;
  setMode: (mode: ThemeMode) => void;
  children: React.ReactNode;
}

export function ThemeProvider({ mode, systemScheme, setMode, children }: ThemeProviderProps) {
  const platform = useMemo(() => getPlatformTokens(), []);
  const value = useMemo<ThemeContextValue>(() => {
    const scheme: ResolvedScheme = mode === 'system' ? systemScheme : mode;
    const isDark = scheme === 'dark';
    return {
      mode,
      scheme,
      isDark,
      colors: isDark ? darkColors : lightColors,
      platform,
      setMode,
    };
  }, [mode, systemScheme, setMode, platform]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

// Convenience hook for screens that want to keep the `StyleSheet.create` shape
// but recompute when the palette changes. The factory's return type is fed
// through `StyleSheet.NamedStyles` so RN preserves literal-typed style props
// (`flexDirection: 'row'`, `position: 'absolute'`) without forcing `as const`.
//
//   const useStyles = makeUseStyles(({ colors }) => ({
//     container: { backgroundColor: colors.background },
//   }));
//   const styles = useStyles();
type StyleSheetNamedStyles<T> = {
  [P in keyof T]: ViewStyle | TextStyle | ImageStyle;
};

export function makeUseStyles<S extends StyleSheetNamedStyles<S>>(
  factory: (theme: ThemeContextValue) => S,
): () => S {
  return function useStyles(): S {
    const theme = useTheme();
    return useMemo(() => StyleSheet.create(factory(theme)), [theme]);
  };
}
